import type { Db } from '../db';
import { READER, TRUST_ORDER, type ActivityEntry, type IdentityPlug, type Person, type Trust } from '../plugs';
import { periodKey, periodOrdinal, type Period } from './periods';
import { giveMarks } from './marks';
import { checkSpike } from './spikes';
import { decide, NEVER_EARNS, readStreak, type Progress, type Rule } from './rules';

export { NEVER_EARNS }; // the Quests board refuses to draft quests for these

// Streaks and missions count an entry only if it is read within 14 days of when it happened.
const RECENT_WINDOW_MS = 14 * 86_400_000;
const CLOCK_SLACK_MS = 3_600_000; // a phone's clock may run a little ahead

export interface Award { quest: string; points: number; step?: string }
export interface NotAwarded { quest: string | null; reason: string }
export interface EntryResult { entry: string; awards: Award[]; notAwarded: NotAwarded[] }

interface LiveQuest {
  quest_id: string; version: number; template: string; target: number; period: Period; period_limit: number | null;
  each_item: string | null; points: number | null; steps: Rule['steps']; trust_needed: Trust; quest_line: string;
  evidence: string | null; unit: string | null; after_quest: string | null;
}

/**
 * Progress: turns one activity entry into progress on every live quest that watches it,
 * and pays the quests that complete. An entry delivered twice is read once.
 */
export async function takeEntry(db: Db, identity: IdentityPlug, entry: ActivityEntry, now = new Date()): Promise<EntryResult> {
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
    await checkSpike(tx, entry); // every kind, never-earns included: repeated vouching is a pattern to look at

    if (NEVER_EARNS.test(entry.kind)) {
      await tx.query("UPDATE entries_read SET outcome = 'never_earns' WHERE entry_id = $1", [entry.entryId]);
      result.notAwarded.push({ quest: null, reason: 'never_earns' });
      return result;
    }

    const quests = await questsInForce(tx, entry.occurredAt, entry.kind);
    // An entry missing the item its own quest needs is not counted anywhere else either.
    const missingItem = entry.item === undefined && quests.some((q) => q.each_item);
    for (const q of quests) await applyQuest(tx, person, entry, q, missingItem, now, result);
    result.awards.push(...(await giveMarks(tx, person, entry.entryId, entry.occurredAt)));
    return result;
  });
}

// The version of each live quest in force when the entry happened, then only those that watch its kind.
async function questsInForce(tx: Db, occurredAt: string, kind: string): Promise<LiveQuest[]> {
  return tx.query<LiveQuest>(
    `SELECT * FROM (
       SELECT DISTINCT ON (v.quest_id) v.quest_id, v.version, q.template, v.watches, v.target, v.period, v.period_limit,
              v.each_item, v.points, v.steps, v.trust_needed, v.evidence, q.quest_line, q.unit, v.after_quest
         FROM quest_versions v JOIN quests q ON q.id = v.quest_id
        WHERE q.status = 'live' AND v.valid_from <= $2
        ORDER BY v.quest_id, v.version DESC) inforce
      WHERE $1 = ANY(inforce.watches)
      ORDER BY quest_id`,
    [kind, occurredAt],
  );
}

// What one entry does to one quest: progress, then an award or the reason for none, written to the notebook.
async function applyQuest(tx: Db, person: Person, entry: ActivityEntry, q: LiveQuest, missingItem: boolean, now: Date, result: EntryResult) {
  const write = (q: LiveQuest, points: number, step: string | null, reason: string | null) => tx.query(
    `INSERT INTO awards (entry_id, kiungo_id, quest_id, quest_version, points, quest_line, step, reason, item)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [entry.entryId, entry.kiungoId, q.quest_id, q.version, points, q.quest_line, step, reason, entry.item ?? null],
  );
  const notPaid = async (q: LiveQuest, reason: string) => {
    await write(q, 0, null, reason); // kept, so a redelivered entry gets the same answer
    result.notAwarded.push({ quest: q.quest_id, reason });
  };

  if (q.unit && !person.units.includes(q.unit)) return; // a unit's quests are for its members only
  if (TRUST_ORDER.indexOf(person.trust) < TRUST_ORDER.indexOf(q.trust_needed)) {
    await notPaid(q, `needs_${q.trust_needed}`);
    return;
  }
  if (missingItem && q.template !== 'repeat') return;
  const age = now.getTime() - Date.parse(entry.occurredAt);
  const recentOnly = q.template === 'streak' || q.template === 'mission';
  if (recentOnly && (age > RECENT_WINDOW_MS || age < -CLOCK_SLACK_MS)) {
    await notPaid(q, age > 0 ? 'too_late' : 'too_early'); // nobody builds a run, or fills a mission, after the fact or ahead of it
    return;
  }
  if (q.template === 'mission') {
    const paid = await contribute(tx, q, entry, periodKey(entry.occurredAt, q.period, person.timezone));
    if (paid) result.awards.push({ quest: q.quest_id, points: q.points!, step: paid });
    return;
  }
  if (q.evidence && !entry.evidence) {
    await notPaid(q, 'missing_evidence');
    return;
  }
  if (q.after_quest !== null) {
    // The same lock the quest it follows takes below, so an entry and the one it waits for are read one after the other.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1 || '/' || $2))", [entry.kiungoId, q.after_quest]);
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

  // The quest it follows has paid this member for this item, and that award hasn't been corrected away.
  const afterPaid = q.after_quest !== null && entry.item !== undefined && (await tx.query(
    `SELECT 1 FROM awards a WHERE a.kiungo_id = $1 AND a.quest_id = $2 AND a.item = $3 AND a.points > 0
        AND NOT EXISTS (SELECT 1 FROM awards c WHERE c.corrects = a.id)`,
    [entry.kiungoId, q.after_quest, entry.item],
  )).length > 0;
  const d = decide(
    { template: q.template, period: q.period, target: q.target, limit: q.period_limit, eachItem: q.each_item, points: q.points, steps: q.steps,
      after: q.after_quest },
    row!,
    { kind: entry.kind, item: entry.item, itemPaidBefore, afterPaid, week: periodKey(entry.occurredAt, 'weekly', person.timezone),
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
    if (d.award.points > 0 && entry.item !== undefined) await payWaiting(tx, person, q.quest_id, entry.item, now);
  } else if (d.reason) {
    await notPaid(q, d.reason);
  }
}

// Entries read before the quest they follow had paid for their item (a comment before its rating), not yet
// answered again: each goes through its quest now, as if it had just arrived, at the version in force when it happened.
async function payWaiting(tx: Db, person: Person, paidQuest: string, item: string, now: Date) {
  const waiting = await tx.query<{ entry_id: string; quest_id: string; kind: string; occurred_at: Date | string; carriage: string }>(
    `SELECT a.entry_id, a.quest_id, e.kind, e.occurred_at, e.carriage
       FROM awards a JOIN entries_read e ON e.entry_id = a.entry_id
      WHERE a.kiungo_id = $1 AND a.item = $2 AND a.points = 0 AND a.reason = 'needs_earlier_quest'
        AND EXISTS (SELECT 1 FROM quest_versions v WHERE v.quest_id = a.quest_id AND v.version = a.quest_version AND v.after_quest = $3)
        AND NOT EXISTS (SELECT 1 FROM awards l WHERE l.entry_id = a.entry_id AND l.quest_id = a.quest_id AND l.id > a.id)
      ORDER BY a.id`,
    [person.kiungoId, item, paidQuest],
  );
  for (const w of waiting) {
    const occurredAt = new Date(w.occurred_at).toISOString();
    const q = (await questsInForce(tx, occurredAt, w.kind)).find((x) => x.quest_id === w.quest_id);
    if (!q) continue; // its quest isn't live now
    // It passed the evidence check when it was first read; the evidence itself is never kept.
    const entry: ActivityEntry = { entryId: w.entry_id, kiungoId: person.kiungoId, kind: w.kind, occurredAt, carriage: w.carriage, item, evidence: 'checked' };
    await applyQuest(tx, person, entry, q, false, now, { entry: w.entry_id, awards: [], notAwarded: [] });
  }
}

// One contribution to a unit's mission. The entry that reaches the target pays every contributor this period,
// once, in the same transaction; returns the period paid if this member was paid now.
async function contribute(tx: Db, q: LiveQuest, entry: ActivityEntry, period: string): Promise<string | null> {
  await tx.query(
    'INSERT INTO mission_progress (quest_id, unit, period_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [q.quest_id, q.unit, period],
  );
  // The unit's counter is locked, so two last contributions can't both pay.
  const [m] = await tx.query<{ count: number; paid_at: Date | null }>(
    `UPDATE mission_progress SET count = count + 1 WHERE quest_id = $1 AND unit = $2 AND period_key = $3
     RETURNING count, paid_at`,
    [q.quest_id, q.unit, period],
  );
  await tx.query(
    'INSERT INTO mission_contributors (quest_id, unit, period_key, kiungo_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [q.quest_id, q.unit, period, entry.kiungoId],
  );
  if (m!.paid_at || m!.count < q.target) return null;
  await tx.query('UPDATE mission_progress SET paid_at = now() WHERE quest_id = $1 AND unit = $2 AND period_key = $3', [q.quest_id, q.unit, period]);
  await tx.query(
    `INSERT INTO awards (entry_id, kiungo_id, quest_id, quest_version, points, quest_line, step)
     SELECT CASE WHEN kiungo_id = $6 THEN $5 END, kiungo_id, $1, $4, $7, $8, $3
       FROM mission_contributors WHERE quest_id = $1 AND unit = $2 AND period_key = $3`,
    [q.quest_id, q.unit, period, q.version, entry.entryId, entry.kiungoId, q.points, q.quest_line],
  );
  return period;
}

/** What an entry already earned, from the notebook. */
export async function earned(db: Db, entryId: string, kiungoId?: string): Promise<EntryResult> {
  const rows = await db.query<{ quest_id: string; points: number; step: string | null; reason: string | null }>(
    `SELECT quest_id, points, step, reason FROM awards WHERE entry_id = $1 AND ($2::text IS NULL OR kiungo_id = $2) ORDER BY id`,
    [entryId, kiungoId ?? null],
  );
  const result: EntryResult = { entry: entryId, awards: [], notAwarded: [] };
  const [read] = await db.query<{ outcome: string | null }>(
    'SELECT outcome FROM entries_read WHERE entry_id = $1 AND ($2::text IS NULL OR kiungo_id = $2)', [entryId, kiungoId ?? null],
  );
  if (read?.outcome) result.notAwarded.push({ quest: null, reason: read.outcome });
  for (const [i, r] of rows.entries()) {
    if (r.points === 0 && rows.slice(i + 1).some((l) => l.quest_id === r.quest_id)) continue; // answered again later (it waited)
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
