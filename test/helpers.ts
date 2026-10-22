import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { createApp } from '../src/app';
import type { Db } from '../src/db';
import { standinIdentity } from '../src/standin/rails';

function fromPglite(pg: PGlite | Transaction): Db {
  return {
    query: async (text, params = []) => (await pg.query(text, params)).rows as never,
    tx: (fn) => (pg as PGlite).transaction((t) => fn(fromPglite(t))),
  };
}

export const ADMIN = 'test-admin-key';
export const CARRIAGE_KEY = 'my-kiungo-test-key-000000000000';

/** A fresh database with every migration applied, and the app on top of it. */
export async function setup() {
  const pg = new PGlite();
  for (const f of readdirSync('migrations').sort()) await pg.exec(readFileSync(`migrations/${f}`, 'utf8'));
  const db = fromPglite(pg);
  const app = createApp({ db, identity: standinIdentity(db), adminKey: ADMIN });

  const call = async (method: string, path: string, body?: unknown, key?: string) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };

  await call('POST', '/standin/carriages',
    { name: 'my.kiungo.africa', key: CARRIAGE_KEY, mayWrite: ['identity.phone_confirmed'] }, ADMIN);

  return { pg, db, call };
}
