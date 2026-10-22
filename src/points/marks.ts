import type { Db } from '../db';
import type { Person } from '../plugs';
import type { Award } from './progress';

/** The day the network is switched on. Everyone who joined before it is a Founding member. */
export const SWITCH_ON = Date.UTC(2030, 0, 1);

const FIRSTS = [
  { quest: 'first.unit', mark: 'first_in_unit', of: (p: Person) => p.units },
  { quest: 'first.country', mark: 'first_in_country', of: (p: Person) => (p.country ? [p.country] : []) },
  { quest: 'first.language', mark: 'first_in_language', of: (p: Person) => p.languages },
];

/** Gives the Founding member mark if it is due. Safe to call again: a mark is given once. */
export async function giveFoundingMark(db: Db, person: Person): Promise<void> {
  if (Date.parse(person.joinedAt) < SWITCH_ON) {
    await db.query("INSERT INTO marks (kiungo_id, mark) VALUES ($1, 'founding_member') ON CONFLICT DO NOTHING", [person.kiungoId]);
  }
}

/**
 * When an entry is read: the Founding member mark, and every first (unit, country, language) nobody holds yet,
 * each with 25 points. The database lets only one person hold each first.
 */
export async function giveMarks(tx: Db, person: Person, entryId: string): Promise<Award[]> {
  await giveFoundingMark(tx, person);
  const awards: Award[] = [];
  for (const f of FIRSTS) {
    for (const what of f.of(person)) {
      const [given] = await tx.query(
        'INSERT INTO marks (kiungo_id, mark) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING mark', [person.kiungoId, `${f.mark}:${what}`],
      );
      if (!given) continue;
      await tx.query(
        `INSERT INTO awards (entry_id, kiungo_id, quest_id, quest_version, points, quest_line, step)
         VALUES ($1, $2, $3, 1, 25, 'firsts', $4)`,
        [entryId, person.kiungoId, f.quest, what],
      );
      awards.push({ quest: f.quest, points: 25, step: what });
    }
  }
  return awards;
}

/** A member's marks, in the order they were given. */
export async function marksOf(db: Db, kiungoId: string) {
  const rows = await db.query<{ mark: string; given_at: Date | string }>(
    'SELECT mark, given_at FROM marks WHERE kiungo_id = $1 ORDER BY id', [kiungoId],
  );
  return rows.map((r) => ({ mark: r.mark, givenAt: new Date(r.given_at).toISOString() }));
}
