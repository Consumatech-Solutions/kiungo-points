import type { Db } from '../db';
import type { Person } from '../plugs';
import type { Award } from './progress';

/** The day the network is switched on. Everyone who joined before it is a Founding member. */
export const SWITCH_ON = Date.UTC(2030, 0, 1);

// shortcut: language firsts count for a member's first three languages; the founder may set another number.
const MAX_LANGUAGE_FIRSTS = 3;

const FIRSTS = [
  { quest: 'first.unit', mark: 'first_in_unit', of: (p: Person) => p.units },
  { quest: 'first.country', mark: 'first_in_country', of: (p: Person) => (p.country ? [p.country] : []) },
  { quest: 'first.language', mark: 'first_in_language', of: (p: Person) => p.languages.slice(0, MAX_LANGUAGE_FIRSTS) },
];

/**
 * When an entry is read: every first (unit, country, language) nobody holds yet, each paid by its quest's version
 * in force, while that quest is live. The database lets only one person hold each first.
 */
export async function giveMarks(tx: Db, person: Person, entryId: string, occurredAt: string): Promise<Award[]> {
  const live = await tx.query<{ quest_id: string; version: number; points: number; quest_line: string }>(
    `SELECT DISTINCT ON (v.quest_id) v.quest_id, v.version, v.points, q.quest_line
       FROM quest_versions v JOIN quests q ON q.id = v.quest_id
      WHERE q.quest_line = 'firsts' AND q.status = 'live' AND v.valid_from <= $1
      ORDER BY v.quest_id, v.version DESC`,
    [occurredAt],
  );
  const awards: Award[] = [];
  for (const f of FIRSTS) {
    const q = live.find((l) => l.quest_id === f.quest);
    if (!q) continue;
    for (const what of [...f.of(person)].sort()) { // always in the same order, so two members can't lock each other out
      const [given] = await tx.query(
        'INSERT INTO marks (kiungo_id, mark) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING mark', [person.kiungoId, `${f.mark}:${what}`],
      );
      if (!given) continue;
      await tx.query(
        `INSERT INTO awards (entry_id, kiungo_id, quest_id, quest_version, points, quest_line, step)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [entryId, person.kiungoId, q.quest_id, q.version, q.points, q.quest_line, what],
      );
      awards.push({ quest: q.quest_id, points: q.points, step: what });
    }
  }
  return awards;
}

/**
 * When a first's award is corrected: the member loses that first, and the next member seen there can take it.
 * They can never take it back themselves (one row per member and mark). Any other quest is left alone.
 */
export async function freeFirst(tx: Db, kiungoId: string, questId: string, step: string | null): Promise<void> {
  const f = FIRSTS.find((x) => x.quest === questId);
  if (!f || step === null) return;
  await tx.query('UPDATE marks SET freed_at = now() WHERE kiungo_id = $1 AND mark = $2 AND freed_at IS NULL', [kiungoId, `${f.mark}:${step}`]);
}

/**
 * A member's marks: Founding member, worked out from their join date (never stored), then the firsts they hold,
 * in the order they were given.
 */
export async function marksOf(db: Db, person: Person | null, kiungoId: string): Promise<{ mark: string; givenAt: string }[]> {
  const founding = person && Date.parse(person.joinedAt) < SWITCH_ON ? [{ mark: 'founding_member', givenAt: person.joinedAt }] : [];
  const rows = await db.query<{ mark: string; given_at: Date | string }>(
    'SELECT mark, given_at FROM marks WHERE kiungo_id = $1 AND freed_at IS NULL ORDER BY id', [kiungoId],
  );
  return [...founding, ...rows.map((r) => ({ mark: r.mark, givenAt: new Date(r.given_at).toISOString() }))];
}
