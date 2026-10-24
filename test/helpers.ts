import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { createApp } from '../src/app';
import { loadQuests, QuestFile } from '../src/quests/files';
import type { Db } from '../src/db';
import { standinIdentity } from '../src/standin/rails';

function fromPglite(pg: PGlite | Transaction): Db {
  return {
    query: async (text, params = []) => (await pg.query(text, params)).rows as never,
    tx: (fn) => (pg as PGlite).transaction((t) => fn(fromPglite(t))),
  };
}

export const ADMIN = 'test-admin-key-0000000000000000';
export const CARRIAGE_KEY = 'my-kiungo-test-key-000000000000';
/** A test carriage that may write every kind of activity on the board, and a few that are not. */
export const ANY_KEY = 'any-kind-test-key-0000000000000';
const EXTRA_KINDS = ['vouch.given', 'payment.sent', 'purchase.made', 'tomato.planted', 'tomato.checked_in', 'tomato.harvested', 'peppers.planted', 'peppers.harvested'];

/** A fresh database with every migration applied, and the app on top of it. */
export async function setup({ limit = Infinity } = {}) {
  let clock: Date | null = null; // null: the real time
  const pg = new PGlite();
  for (const f of readdirSync('migrations').sort()) await pg.exec(readFileSync(`migrations/${f}`, 'utf8'));
  const db = fromPglite(pg);
  await loadQuests(db, readdirSync('quests').filter((f) => f.endsWith('.json')).sort()
    .map((f) => QuestFile.parse(JSON.parse(readFileSync(`quests/${f}`, 'utf8')))));
  const calls = new Map<string, number>(); // a stand-in for Cloudflare's rate limiter
  const limiter = async (carriage: string) => {
    calls.set(carriage, (calls.get(carriage) ?? 0) + 1);
    return calls.get(carriage)! <= limit;
  };
  const app = createApp({ db, identity: standinIdentity(db), adminKey: ADMIN, limit: limiter, now: () => clock ?? new Date() });

  // A member's points are read as the test carriage unless a test names a key ('' for none).
  const call = async (method: string, path: string, body?: unknown, key = /^\/v1\/(people|units)\//.test(path) ? ANY_KEY : undefined) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, headers: Object.fromEntries(res.headers), json: (await res.json()) as any };
  };

  await call('POST', '/standin/carriages',
    { name: 'my.kiungo.africa', key: CARRIAGE_KEY, mayWrite: ['identity.phone_confirmed'] }, ADMIN);

  const kinds = await db.query<{ k: string }>('SELECT DISTINCT unnest(watches) AS k FROM quest_versions');
  await call('POST', '/standin/carriages',
    { name: 'kiungo.test', key: ANY_KEY, mayWrite: [...kinds.map((r) => r.k), ...EXTRA_KINDS] }, ADMIN);

  /** A carriage writes one entry; returns what it earned and the standing. */
  const act = async (kiungoId: string, kind: string, occurredAt: string, key: string, extra: { item?: string; evidence?: string } = {}) =>
    (await call('POST', '/standin/activity', { kiungoId, kind, occurredAt, key, ...extra }, ANY_KEY)).json.data;

  const person = (kiungoId: string, trust = 'joined', timezone = 'Africa/Kinshasa', allows = ['kiungo-points', 'kiungo.test'], units: string[] = []) =>
    call('POST', '/standin/people', { kiungoId, trust, timezone, allows, units }, ADMIN);

  // Sets the time the points system reads entries at (null for the real time).
  const setNow = (at: string | null) => { clock = at === null ? null : new Date(at); };

  return { pg, db, call, act, person, setNow };
}
