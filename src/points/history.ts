import type { Db } from '../db';
import { freeFirst } from './marks';

export interface Line {
  id: number; quest: string; points: number; step: string | null; reason: string | null;
  entry: string | null; corrects: number | null; at: string;
}

interface Row { id: string | number; quest: string; points: number; step: string | null; reason: string | null;
  entry: string | null; corrects: string | number | null; at: Date | string }

const line = (r: Row): Line => ({
  id: Number(r.id), quest: r.quest, points: r.points, step: r.step, reason: r.reason, entry: r.entry,
  corrects: r.corrects === null ? null : Number(r.corrects), at: new Date(r.at).toISOString(),
});

const SELECT = `SELECT id, quest_id AS quest, points, step, reason, entry_id AS entry, corrects, awarded_at AS at FROM awards`;

/** A member's award history, newest first, a page at a time. `next` is where the following page starts. */
export async function history(db: Db, kiungoId: string, page: { limit: number; before?: number }) {
  const rows = await db.query<Row>(
    `${SELECT} WHERE kiungo_id = $1 AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $3`,
    [kiungoId, page.before ?? null, page.limit + 1],
  );
  const lines = rows.slice(0, page.limit).map(line);
  return { lines, next: rows.length > page.limit ? lines.at(-1)!.id : null };
}

/** Every line in a member's notebook, oldest first, for them to download. */
// shortcut: loads the whole record at once; stream it in pages once a member's record passes ~10,000 lines.
export async function allAwards(db: Db, kiungoId: string): Promise<Line[]> {
  return (await db.query<Row>(`${SELECT} WHERE kiungo_id = $1 ORDER BY id`, [kiungoId])).map(line);
}

export type Correction = { line: Line } | { error: 'unknown_award' | 'already_corrected' | 'not_correctable' };

/**
 * Cancels an award with a new, opposite one that says why (ADR-004). An award is cancelled at most once;
 * a correction, or a line that paid nothing, can't be corrected. Correcting a first's award frees that first.
 */
export async function correct(db: Db, awardId: number, reason: string): Promise<Correction> {
  return db.tx(async (tx) => {
    const [a] = await tx.query<{ points: number; corrects: string | null; kiungo_id: string; quest_id: string; step: string | null }>(
      'SELECT points, corrects, kiungo_id, quest_id, step FROM awards WHERE id = $1', [awardId],
    ); // two corrections at once are settled by the unique `corrects` column, below
    if (!a) return { error: 'unknown_award' };
    if (a.corrects !== null || a.points <= 0) return { error: 'not_correctable' };
    const [row] = await tx.query<Row>(
      `INSERT INTO awards (entry_id, kiungo_id, quest_id, quest_version, points, quest_line, step, reason, corrects)
       SELECT entry_id, kiungo_id, quest_id, quest_version, -points, quest_line, step, $2, id FROM awards WHERE id = $1
       ON CONFLICT (corrects) DO NOTHING
       RETURNING id, quest_id AS quest, points, step, reason, entry_id AS entry, corrects, awarded_at AS at`,
      [awardId, `correction: ${reason}`],
    );
    if (!row) return { error: 'already_corrected' };
    await freeFirst(tx, a.kiungo_id, a.quest_id, a.step);
    return { line: line(row) };
  });
}
