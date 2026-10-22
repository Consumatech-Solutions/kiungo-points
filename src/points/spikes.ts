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
  const [{ n }] = await tx.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM entries_read
      WHERE kiungo_id = $1 AND kind = $2 AND occurred_at > $3::timestamptz - make_interval(mins => $4) AND occurred_at <= $3`,
    [entry.kiungoId, entry.kind, entry.occurredAt, s.minutes],
  ) as [{ n: number }];
  if (n < s.count) return;
  await tx.query(
    `INSERT INTO spike_flags (kiungo_id, kind, count, at)
     SELECT $1, $2, $3, $4 WHERE NOT EXISTS (
       SELECT 1 FROM spike_flags WHERE kiungo_id = $1 AND kind = $2 AND at > $4::timestamptz - make_interval(mins => $5))`,
    [entry.kiungoId, entry.kind, n, entry.occurredAt, s.minutes],
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

/** Flags, newest first; only the open ones if asked. Admin only. */
export async function flags(db: Db, openOnly: boolean) {
  const rows = await db.query<{ id: string | number; kiungo_id: string; kind: string; count: number; at: Date | string;
    flagged_at: Date | string; reviewed_at: Date | string | null; note: string | null }>(
    `SELECT * FROM spike_flags WHERE NOT $1 OR reviewed_at IS NULL ORDER BY id DESC LIMIT 200`, [openOnly],
  );
  const iso = (d: Date | string) => new Date(d).toISOString();
  return rows.map((r) => ({
    id: Number(r.id), kiungoId: r.kiungo_id, kind: r.kind, count: r.count, at: iso(r.at), flaggedAt: iso(r.flagged_at),
    reviewedAt: r.reviewed_at ? iso(r.reviewed_at) : null, note: r.note,
  }));
}

/** Marks a flag as reviewed, with what the reviewer found. Nothing else changes. */
export async function reviewFlag(db: Db, id: number, note: string): Promise<boolean> {
  const rows = await db.query('UPDATE spike_flags SET reviewed_at = now(), note = $2 WHERE id = $1 RETURNING id', [id, note]);
  return rows.length > 0;
}
