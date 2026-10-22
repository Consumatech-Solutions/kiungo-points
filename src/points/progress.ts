import type { Db } from '../db';
import { READER, TRUST_ORDER, type ActivityEntry, type IdentityPlug, type Trust } from '../plugs';

export interface Award { quest: string; points: number }
export interface NotAwarded { quest: string | null; reason: string }
export interface EntryResult { entry: string; awards: Award[]; notAwarded: NotAwarded[] }

interface LiveQuest {
  quest_id: string; version: number; target: number; period: string;
  points: number; trust_needed: Trust; quest_line: string;
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

    const quests = await tx.query<LiveQuest>(
      `SELECT DISTINCT ON (v.quest_id) v.quest_id, v.version, v.target, v.period, v.points, v.trust_needed, q.quest_line
         FROM quest_versions v JOIN quests q ON q.id = v.quest_id
        WHERE q.status = 'live' AND $1 = ANY(v.watches) AND v.valid_from <= $2
        ORDER BY v.quest_id, v.version DESC`,
      [entry.kind, entry.occurredAt],
    );

    for (const q of quests) {
      if (TRUST_ORDER.indexOf(person.trust) < TRUST_ORDER.indexOf(q.trust_needed)) {
        result.notAwarded.push({ quest: q.quest_id, reason: `needs_${q.trust_needed}` });
        continue;
      }
      // shortcut: one-off quests only; periods and limits arrive in T-03.
      const periodKey = 'once';
      const [row] = await tx.query<{ count: number; completions: number }>(
        `INSERT INTO quest_progress (kiungo_id, quest_id, period_key, count) VALUES ($1, $2, $3, 1)
         ON CONFLICT (kiungo_id, quest_id, period_key) DO UPDATE SET count = quest_progress.count + 1
         RETURNING count, completions`,
        [entry.kiungoId, q.quest_id, periodKey],
      );
      if (!row || row.completions > 0) {
        result.notAwarded.push({ quest: q.quest_id, reason: 'already_done' });
        continue;
      }
      if (row.count < q.target) continue;

      await tx.query(
        `UPDATE quest_progress SET completions = completions + 1
          WHERE kiungo_id = $1 AND quest_id = $2 AND period_key = $3`,
        [entry.kiungoId, q.quest_id, periodKey],
      );
      await tx.query(
        `INSERT INTO awards (entry_id, kiungo_id, quest_id, quest_version, points, quest_line)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entry.entryId, entry.kiungoId, q.quest_id, q.version, q.points, q.quest_line],
      );
      result.awards.push({ quest: q.quest_id, points: q.points });
    }
    return result;
  });
}

/** What an entry already earned, from the notebook. */
export async function earned(db: Db, entryId: string): Promise<EntryResult> {
  const rows = await db.query<{ quest_id: string; points: number }>(
    'SELECT quest_id, points FROM awards WHERE entry_id = $1 ORDER BY id', [entryId],
  );
  return { entry: entryId, awards: rows.map((r) => ({ quest: r.quest_id, points: r.points })), notAwarded: [] };
}
