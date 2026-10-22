import type { Db } from '../db';
import { READER, TRUST_ORDER, type ActivityEntry, type IdentityPlug, type Trust } from '../plugs';
import { periodKey, periodOrdinal, type Period } from './periods';
import { decide, NEVER_EARNS, readStreak, type Progress, type Rule } from './rules';

export interface Award { quest: string; points: number; step?: string }
export interface NotAwarded { quest: string | null; reason: string }
export interface EntryResult { entry: string; awards: Award[]; notAwarded: NotAwarded[] }

interface LiveQuest {
  quest_id: string; version: number; template: string; target: number; period: Period; period_limit: number | null;
  each_item: string | null; points: number | null; steps: Rule['steps']; trust_needed: Trust; quest_line: string;
  evidence: string | null;
}

/**
 * Progress: turns one activity entry into progress on every live quest that watches it,
 * and pays the quests that complete. An entry delivered twice is read once.
 */
export async function takeEntry(db: Db, identity: IdentityPlug, entry: ActivityEntry): Promise<EntryResult> {
  const result: EntryResult = { entry: entry.entryId, awards: [], notAwarded: [] };

  if (!(await identity.allows(entry.kiungoId, READER))) {
    result.notAwarded.push({ quest: null, reason: 'no_permission' });
    return result; // nothing is read without permission, not even a reference
  }
  const person = await identity.lookup(entry.kiungoId);
  if (!person) {
    result.notAwarded.push({ quest: null, reason: 'unknown_person' });
    return result;
  }

  return db.tx(async (tx) => {
    const fresh = await tx.query(
      `INSERT INTO entries_read (entry_id, kiungo_id, kind, occurred_at, carriage)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (entry_id) DO NOTHING RETURNING entry_id`,
      [entry.entryId, entry.kiungoId, entry.kind, entry.occurredAt, entry.carriage],
    );
    if (fresh.length === 0) return earned(tx, entry.entryId); // already read: same answer again

    if (NEVER_EARNS.test(entry.kind)) {
      await tx.query("UPDATE entries_read SET outcome = 'never_earns' WHERE entry_id = $1", [entry.entryId]);
      result.notAwarded.push({ quest: null, reason: 'never_earns' });
      return result;
    }

    // The version in force when the entry happened, then only those that watch its kind.
    const quests = await tx.query<LiveQuest>(
      `SELECT * FROM (
         SELECT DISTINCT ON (v.quest_id) v.quest_id, v.version, q.template, v.watches, v.target, v.period, v.period_limit,
                v.each_item, v.points, v.steps, v.trust_needed, v.evidence, q.quest_line
           FROM quest_versions v JOIN quests q ON q.id = v.quest_id
          WHERE q.status = 'live' AND v.valid_from <= $2
          ORDER BY v.quest_id, v.version DESC) inforce
        WHERE $1 = ANY(inforce.watches)
        ORDER BY quest_id`,
      [entry.kind, entry.occurredAt],
    );
    // An entry missing the item its own quest needs is not counted anywhere else either.
    const missingItem = entry.item === undefined && quests.some((q) => q.each_item);

    const write = (q: LiveQuest, points: number, step: string | null, reason: string | null) => tx.query(
      `INSERT INTO awards (entry_id, kiungo_id, quest_id, quest_version, points, quest_line, step, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entry.entryId, entry.kiungoId, q.quest_id, q.version, points, q.quest_line, step, reason],
    );
    const notPaid = async (q: LiveQuest, reason: string) => {
      await write(q, 0, null, reason); // kept, so a redelivered entry gets the same answer
      result.notAwarded.push({ quest: q.quest_id, reason });
    };

    for (const q of quests) {
      if (TRUST_ORDER.indexOf(person.trust) < TRUST_ORDER.indexOf(q.trust_needed)) {
        await notPaid(q, `needs_${q.trust_needed}`);
        continue;
      }
      if (missingItem && q.template !== 'repeat') continue;
      if (q.evidence && !entry.evidence) {
        await notPaid(q, 'missing_evidence');
        continue;
      }
      if (q.each_item === 'ever') {
        // "Once per item, ever" reads other periods' rows, so lock the whole quest for this member.
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1 || '/' || $2))", [entry.kiungoId, q.quest_id]);
      }
      const key = q.template === 'repeat' ? periodKey(entry.occurredAt, q.period, person.timezone) : 'once';
      // Make sure the row exists, then lock it, so two entries can't both take the last place.
      await tx.query(
        'INSERT INTO quest_progress (kiungo_id, quest_id, period_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [entry.kiungoId, q.quest_id, key],
      );
      const [row] = await tx.query<Progress>(
        `SELECT count, completions, counted FROM quest_progress
          WHERE kiungo_id = $1 AND quest_id = $2 AND period_key = $3 FOR UPDATE`,
        [entry.kiungoId, q.quest_id, key],
      );
      const itemPaidBefore = q.each_item === 'ever' && entry.item !== undefined && (await tx.query(
        'SELECT 1 FROM quest_progress WHERE kiungo_id = $1 AND quest_id = $2 AND period_key <> $3 AND $4 = ANY(counted)',
        [entry.kiungoId, q.quest_id, key, entry.item],
      )).length > 0;

      const d = decide(
        { template: q.template, period: q.period, target: q.target, limit: q.period_limit, eachItem: q.each_item, points: q.points, steps: q.steps },
        row!,
        { kind: entry.kind, item: entry.item, itemPaidBefore, week: periodKey(entry.occurredAt, 'weekly', person.timezone),
          weekNo: periodOrdinal(entry.occurredAt, 'weekly', person.timezone) },
      );
      if (d.progress !== row) {
        await tx.query(
          `UPDATE quest_progress SET count = $4, completions = $5, counted = $6
            WHERE kiungo_id = $1 AND quest_id = $2 AND period_key = $3`,
          [entry.kiungoId, q.quest_id, key, d.progress.count, d.progress.completions, d.progress.counted],
        );
      }
      if (d.award) {
        await write(q, d.award.points, d.award.step ?? null, null);
        result.awards.push({ quest: q.quest_id, points: d.award.points, ...(d.award.step ? { step: d.award.step } : {}) });
      } else if (d.reason) {
        await notPaid(q, d.reason);
      }
    }
    return result;
  });
}

/** What an entry already earned, from the notebook. */
export async function earned(db: Db, entryId: string): Promise<EntryResult> {
  const rows = await db.query<{ quest_id: string; points: number; step: string | null; reason: string | null }>(
    'SELECT quest_id, points, step, reason FROM awards WHERE entry_id = $1 ORDER BY id', [entryId],
  );
  const result: EntryResult = { entry: entryId, awards: [], notAwarded: [] };
  const [read] = await db.query<{ outcome: string | null }>('SELECT outcome FROM entries_read WHERE entry_id = $1', [entryId]);
  if (read?.outcome) result.notAwarded.push({ quest: null, reason: read.outcome });
  for (const r of rows) {
    if (r.points === 0 && r.reason) result.notAwarded.push({ quest: r.quest_id, reason: r.reason });
    else result.awards.push({ quest: r.quest_id, points: r.points, ...(r.step ? { step: r.step } : {}) });
  }
  return result;
}

/**
 * A member's progress on each quest they have touched, in its latest period: how far they are,
 * out of what (null when there is no limit, such as one survey after another).
 */
export async function questProgress(db: Db, kiungoId: string, timezone: string, now = new Date()) {
  const rows = await db.query<{ quest: string; period: string; template: string; completions: number; counted: string[];
    target: number; limit: number | null; each_item: string | null; steps: { kind: string }[] | null; every: Period }>(
    `SELECT DISTINCT ON (p.quest_id) p.quest_id AS quest, p.period_key AS period, q.template, p.completions, p.counted,
            v.target, v.period_limit AS "limit", v.each_item, v.steps, v.period AS every
       FROM quest_progress p JOIN quests q ON q.id = p.quest_id
       JOIN LATERAL (SELECT * FROM quest_versions WHERE quest_id = p.quest_id AND valid_from <= $2
                      ORDER BY version DESC LIMIT 1) v ON true
      WHERE p.kiungo_id = $1
      ORDER BY p.quest_id, p.period_key DESC`,
    [kiungoId, now.toISOString()],
  );
  return rows.map((r) => {
    if (r.template === 'collect') return { quest: r.quest, period: r.period, progress: r.counted.length, target: r.target };
    if (r.template === 'streak') {
      const { weeks, runs } = readStreak(r.counted);
      // The run is broken once two weeks have passed with nothing said.
      const thisWeek = periodOrdinal(now.toISOString(), 'weekly', timezone);
      const current = weeks.length && thisWeek - weeks.at(-1)! <= 2 ? runs.at(-1)!.length : 0;
      const next = (r.steps as unknown as { weeks: number }[]).find((m) => m.weeks > current)?.weeks ?? null;
      return { quest: r.quest, period: r.period, progress: current, best: Math.max(0, ...runs.map((run) => run.length)), target: next };
    }
    if (r.template === 'steps') {
      const reached = r.steps!.filter((s) => r.counted.some((c) => c === s.kind || c.startsWith(`${s.kind}@`))).length;
      return { quest: r.quest, period: r.period, progress: reached, target: r.steps!.length };
    }
    // A repeating quest shows this period: nothing done yet if its latest row is from an earlier one.
    const current = periodKey(now.toISOString(), r.every, timezone);
    return { quest: r.quest, period: current, progress: current === r.period ? r.completions : 0, target: r.limit ?? (r.each_item ? null : 1) };
  });
}
