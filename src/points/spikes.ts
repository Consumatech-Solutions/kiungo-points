import type { Db } from '../db';
import type { ActivityEntry } from '../plugs';

export interface SpikeSetting { kind: string; count: number; minutes: number }

/**
 * After an entry is read: if this person now has at least the set number of entries of this kind within the
 * set minutes, flag it for a person to review, once per window. A flag changes nothing else.
 */
export async function checkSpike(tx: Db, entry: ActivityEntry): Promise<void> {
  const [s] = await tx.query<SpikeSetting>('SELECT kind, count, minutes FROM spike_settings WHERE kind = $1', [entry.kind]);
  if (!s) return;
  // One check at a time per person and kind, so two entries at once make one flag.
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('spike/' || $1 || '/' || $2))", [entry.kiungoId, entry.kind]);
  // The busiest window this entry falls in: those ending at it or at any later entry less than a window after it,
  // so entries delivered out of order (an offline phone catching up) are still seen together.
  const [row] = await tx.query<{ n: number }>(
    `SELECT COALESCE(MAX(w.n), 0)::int AS n FROM entries_read e, LATERAL (
       SELECT COUNT(*) AS n FROM entries_read x
        WHERE x.kiungo_id = e.kiungo_id AND x.kind = e.kind
          AND x.occurred_at > e.occurred_at - make_interval(mins => $4) AND x.occurred_at <= e.occurred_at) w
      WHERE e.kiungo_id = $1 AND e.kind = $2
        AND e.occurred_at >= $3::timestamptz AND e.occurred_at < $3::timestamptz + make_interval(mins => $4)`,
    [entry.kiungoId, entry.kind, entry.occurredAt, s.minutes],
  );
  if (row!.n < s.count) return;
  // One flag per window: none if another flag sits within a window either side of this entry.
  await tx.query(
    `INSERT INTO spike_flags (kiungo_id, kind, count, at)
     SELECT $1, $2, $3, $4 WHERE NOT EXISTS (
       SELECT 1 FROM spike_flags WHERE kiungo_id = $1 AND kind = $2
          AND at > $4::timestamptz - make_interval(mins => $5) AND at < $4::timestamptz + make_interval(mins => $5))`,
    [entry.kiungoId, entry.kind, row!.n, entry.occurredAt, s.minutes],
  );
}

/** Replaces the spike settings. Admin only. */
export async function setSpikeSettings(db: Db, settings: SpikeSetting[]): Promise<void> {
  await db.tx(async (tx) => {
    await tx.query('DELETE FROM spike_settings');
    for (const s of settings) {
      await tx.query('INSERT INTO spike_settings (kind, count, minutes) VALUES ($1, $2, $3)', [s.kind, s.count, s.minutes]);
    }
  });
}

/** The spike settings. Admin only. */
export async function spikeSettings(db: Db): Promise<SpikeSetting[]> {
  return db.query<SpikeSetting>('SELECT kind, count, minutes FROM spike_settings ORDER BY kind');
}

/** Flags: the open ones oldest first (the queue to review), or all of them newest first. Admin only. */
export async function flags(db: Db, openOnly: boolean) {
  const rows = await db.query<{ id: string | number; kiungo_id: string; kind: string; count: number; at: Date | string;
    flagged_at: Date | string; reviewed_at: Date | string | null; note: string | null }>(
    `SELECT id, kiungo_id, kind, count, at, flagged_at, reviewed_at, note FROM spike_flags
      WHERE NOT $1 OR reviewed_at IS NULL ORDER BY CASE WHEN $1 THEN id ELSE -id END LIMIT 200`, [openOnly],
  );
  const iso = (d: Date | string) => new Date(d).toISOString();
  return rows.map((r) => ({
    id: Number(r.id), kiungoId: r.kiungo_id, kind: r.kind, count: r.count, at: iso(r.at), flaggedAt: iso(r.flagged_at),
    reviewedAt: r.reviewed_at ? iso(r.reviewed_at) : null, note: r.note,
  }));
}

/** Marks a flag as reviewed, once, with what the reviewer found. Nothing else changes. */
export async function reviewFlag(db: Db, id: number, note: string): Promise<'reviewed' | 'unknown' | 'already_reviewed'> {
  const rows = await db.query('UPDATE spike_flags SET reviewed_at = now(), note = $2 WHERE id = $1 AND reviewed_at IS NULL RETURNING id', [id, note]);
  if (rows.length > 0) return 'reviewed';
  return (await db.query('SELECT 1 FROM spike_flags WHERE id = $1', [id])).length > 0 ? 'already_reviewed' : 'unknown';
}
