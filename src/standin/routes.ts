// The stand-in rails' own routes (ADR-003). Removed in T-12, with this folder.
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db';
import { CARRIAGE_NAME, error, KIUNGO_ID, UNIT } from '../http';
import type { IdentityPlug } from '../plugs';
import { isValidTimezone } from '../points/periods';
import { takeEntry } from '../points/progress';
import { standing } from '../points/standing';
import { setCarriage } from '../readers';
import { mayWrite, writeEntry } from './rails';

const KIND = z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/).max(64);

/** Mounts `/standin/*`: people, permissions, carriages, and carriages writing activity. */
export function standinRoutes(app: Hono, { db, identity, admin, carriageOf, now }: {
  db: Db;
  identity: IdentityPlug;
  admin: (c: Context) => Promise<true | Response>;
  carriageOf: (c: Context) => Promise<string | Response>;
  now: () => Date;
}) {
  app.post('/standin/people', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    const body = z.object({
      kiungoId: KIUNGO_ID,
      trust: z.enum(['joined', 'vouched', 'verified']),
      timezone: z.string().refine(isValidTimezone, 'Use a time zone name such as Africa/Kinshasa.'),
      allows: z.array(z.union([CARRIAGE_NAME, z.literal('kiungo-points')])).default([]),
      units: z.array(UNIT).default([]),
    }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_request', body.error.message), 400);
    const p = body.data;
    await db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO standin_people (kiungo_id, trust, timezone, units) VALUES ($1, $2, $3, $4)
         ON CONFLICT (kiungo_id) DO UPDATE SET trust = EXCLUDED.trust, timezone = EXCLUDED.timezone, units = EXCLUDED.units`,
        [p.kiungoId, p.trust, p.timezone, p.units],
      );
      await tx.query('DELETE FROM standin_permissions WHERE kiungo_id = $1', [p.kiungoId]);
      for (const reader of p.allows) {
        await tx.query('INSERT INTO standin_permissions (kiungo_id, reader) VALUES ($1, $2)', [p.kiungoId, reader]);
      }
    });
    return c.json({ data: { kiungoId: p.kiungoId } }, 201);
  });

  app.post('/standin/carriages', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    const body = z.object({ name: CARRIAGE_NAME, key: z.string().min(24).max(200), mayWrite: z.array(KIND).min(1) })
      .strict().safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_request', body.error.message), 400);
    const set = await db.tx(async (tx) => {
      // keeps a switched-off carriage switched off
      if (!(await setCarriage(tx, body.data.name, body.data.key))) return false;
      await tx.query(
        `INSERT INTO standin_carriages (name, may_write) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET may_write = EXCLUDED.may_write`,
        [body.data.name, body.data.mayWrite],
      );
      return true;
    });
    if (!set) return c.json(error('key_in_use', 'Another carriage has this key. Choose a new one.'), 409);
    return c.json({ data: { name: body.data.name } }, 201);
  });

  app.post('/standin/permissions', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    const body = z.object({ kiungoId: KIUNGO_ID, reader: z.union([CARRIAGE_NAME, z.literal('kiungo-points')]), allowed: z.boolean() })
      .strict().safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_request', body.error.message), 400);
    const p = body.data;
    if (!(await identity.lookup(p.kiungoId))) return c.json(error('unknown_person', 'No person with this Kiungo ID.'), 404);
    await db.query(
      p.allowed
        ? 'INSERT INTO standin_permissions (kiungo_id, reader) VALUES ($1, $2) ON CONFLICT DO NOTHING'
        : 'DELETE FROM standin_permissions WHERE kiungo_id = $1 AND reader = $2',
      [p.kiungoId, p.reader],
    );
    return c.json({ data: p });
  });

  // A carriage writes to a person's activity record; the rail then delivers it to the points system.
  app.post('/standin/activity', async (c) => {
    const name = await carriageOf(c);
    if (name instanceof Response) return name;
    const carriage = { name, may_write: await mayWrite(db, name) };
    const body = z.object({
      kiungoId: KIUNGO_ID,
      kind: KIND,
      occurredAt: z.string().datetime({ offset: true }),
      key: z.string().min(1).max(200),
      item: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/, 'An item is a reference such as survey-12, never a name or number.').optional(),
      evidence: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/, 'Evidence is a reference such as a sale code.').optional(),
    }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_request', body.error.message), 400);
    if (!carriage.may_write.includes(body.data.kind)) {
      return c.json(error('not_allowed_for_carriage', `${carriage.name} may not write ${body.data.kind}.`), 403);
    }
    if (!(await identity.lookup(body.data.kiungoId))) {
      return c.json(error('unknown_person', 'No person with this Kiungo ID.'), 404);
    }
    const entry = await writeEntry(db, carriage.name, body.data);
    const result = await takeEntry(db, identity, entry, now());
    // The writing carriage sees what the entry earned only if the member lets it read their points.
    if (!(await identity.allows(entry.kiungoId, carriage.name))) return c.json({ data: { entry: entry.entryId } }, 201);
    return c.json({ data: { ...result, ...(await standing(db, identity, entry.kiungoId)) } }, 201);
  });
}
