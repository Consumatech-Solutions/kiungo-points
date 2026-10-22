// Readers: which carriages may call the points system, by one hashed key each (TRD §4).
import type { Db } from './db';

/** SHA-256 of a key, in hex. Keys are only ever kept hashed. */
export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sets a carriage's one key, replacing the old one (rotation), and optionally switches it on or off
 * (left as it is when not given). False if another carriage already has this key.
 */
export async function setCarriage(db: Db, name: string, key: string, active?: boolean): Promise<boolean> {
  const hash = await sha256(key);
  const taken = await db.query('SELECT 1 FROM readers WHERE key_hash = $1 AND name <> $2', [hash, name]);
  if (taken.length > 0) return false;
  await db.query(
    `INSERT INTO readers (name, key_hash, active) VALUES ($1, $2, COALESCE($3, true))
     ON CONFLICT (name) DO UPDATE SET key_hash = EXCLUDED.key_hash, active = COALESCE($3, readers.active), changed_at = now()`,
    [name, hash, active ?? null],
  );
  return true;
}

/** The carriage a key belongs to, or null for an unknown or switched-off key. */
export async function carriageFor(db: Db, key: string): Promise<string | null> {
  if (!key) return null;
  const [r] = await db.query<{ name: string }>(
    'SELECT name FROM readers WHERE key_hash = $1 AND active', [await sha256(key)],
  );
  return r?.name ?? null;
}
