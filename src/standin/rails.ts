// Stand-in identity and activity rails (ADR-003). Removed in T-12, when the real rails exist.
import type { Db } from '../db';
import type { ActivityEntry, IdentityPlug, Person, Trust } from '../plugs';

export function standinIdentity(db: Db): IdentityPlug {
  return {
    async lookup(kiungoId) {
      const [p] = await db.query<{ kiungo_id: string; trust: Trust; timezone: string }>(
        'SELECT kiungo_id, trust, timezone FROM standin_people WHERE kiungo_id = $1', [kiungoId],
      );
      return p ? ({ kiungoId: p.kiungo_id, trust: p.trust, timezone: p.timezone } satisfies Person) : null;
    },
    async allows(kiungoId, reader) {
      const rows = await db.query(
        'SELECT 1 FROM standin_permissions WHERE kiungo_id = $1 AND reader = $2', [kiungoId, reader],
      );
      return rows.length > 0;
    },
  };
}

/** What kinds of activity a carriage may write to the stand-in rail. */
export async function mayWrite(db: Db, carriage: string): Promise<string[]> {
  const [c] = await db.query<{ may_write: string[] }>('SELECT may_write FROM standin_carriages WHERE name = $1', [carriage]);
  return c?.may_write ?? [];
}

/**
 * A carriage writes one entry to a person's activity record. Writing the same carriage key twice
 * gives back the same entry, so a resent request never makes a second entry.
 */
export async function writeEntry(
  db: Db, carriage: string, input: { kiungoId: string; kind: string; occurredAt: string; key: string; item?: string; evidence?: string },
): Promise<ActivityEntry> {
  const entryId = `${carriage}:${input.key}`;
  await db.query(
    `INSERT INTO standin_entries (entry_id, carriage, carriage_key, kiungo_id, kind, occurred_at, item, evidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (carriage, carriage_key) DO NOTHING`,
    [entryId, carriage, input.key, input.kiungoId, input.kind, input.occurredAt, input.item ?? null, input.evidence ?? null],
  );
  const [e] = await db.query<{ entry_id: string; kiungo_id: string; kind: string; occurred_at: Date | string; item: string | null; evidence: string | null }>(
    'SELECT entry_id, kiungo_id, kind, occurred_at, item, evidence FROM standin_entries WHERE carriage = $1 AND carriage_key = $2',
    [carriage, input.key],
  );
  if (!e) throw new Error('entry not saved');
  return {
    entryId: e.entry_id, kiungoId: e.kiungo_id, kind: e.kind, carriage,
    occurredAt: new Date(e.occurred_at).toISOString(),
    ...(e.item ? { item: e.item } : {}),
    ...(e.evidence ? { evidence: e.evidence } : {}),
  };
}
