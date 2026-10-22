import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from './db';
import type { IdentityPlug } from './plugs';
import { earned, takeEntry } from './points/progress';
import { standing } from './points/standing';
import { carriageFor, sha256, writeEntry } from './standin/rails';

export interface Deps { db: Db; identity: IdentityPlug; adminKey: string }

const KIUNGO_ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const error = (code: string, message: string) => ({ error: { code, message } });

export function createApp({ db, identity, adminKey }: Deps) {
  const app = new Hono();
  const bearer = (h: string | undefined) => h?.match(/^Bearer (.+)$/)?.[1] ?? '';

  app.onError((err, c) => {
    console.error(err);
    return c.json(error('server_error', 'Something went wrong on our side. Try again.'), 500);
  });

  // The public quest board (transparency, ADR-001).
  app.get('/v1/quests', async (c) => {
    const rows = await db.query(
      `SELECT DISTINCT ON (v.quest_id) v.quest_id AS quest, q.quest_line, v.version, v.watches,
              v.target, v.period, v.points, v.trust_needed
         FROM quest_versions v JOIN quests q ON q.id = v.quest_id
        WHERE q.status = 'live' ORDER BY v.quest_id, v.version DESC`,
    );
    return c.json({ data: rows });
  });

  // shortcut: reading a member's points needs no reader key yet; T-06 adds keys and the member's permission.
  app.get('/v1/people/:kiungoId/standing', async (c) => {
    const id = KIUNGO_ID.safeParse(c.req.param('kiungoId'));
    if (!id.success) return c.json(error('invalid_kiungo_id', 'Use letters, digits, - and _, up to 64.'), 400);
    return c.json({ data: await standing(db, id.data) });
  });

  app.get('/v1/people/:kiungoId/awards', async (c) => {
    const entry = c.req.query('entry');
    if (!entry) return c.json(error('entry_required', 'Add ?entry=<entry id>. The full history arrives in T-07.'), 400);
    const result = await earned(db, entry);
    return c.json({ data: { ...result, ...(await standing(db, c.req.param('kiungoId'))) } });
  });

  // ---- Stand-in rails (ADR-003). Removed in T-12. ----

  const admin = (h: string | undefined) => adminKey.length > 0 && bearer(h) === adminKey;

  app.post('/standin/people', async (c) => {
    if (!admin(c.req.header('authorization'))) return c.json(error('not_allowed', 'Admin key needed.'), 401);
    const body = z.object({
      kiungoId: KIUNGO_ID,
      trust: z.enum(['joined', 'vouched', 'verified']),
      timezone: z.string().min(1),
      allows: z.array(z.string()).default([]),
    }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_request', body.error.message), 400);
    const p = body.data;
    await db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO standin_people (kiungo_id, trust, timezone) VALUES ($1, $2, $3)
         ON CONFLICT (kiungo_id) DO UPDATE SET trust = EXCLUDED.trust, timezone = EXCLUDED.timezone`,
        [p.kiungoId, p.trust, p.timezone],
      );
      await tx.query('DELETE FROM standin_permissions WHERE kiungo_id = $1', [p.kiungoId]);
      for (const reader of p.allows) {
        await tx.query('INSERT INTO standin_permissions (kiungo_id, reader) VALUES ($1, $2)', [p.kiungoId, reader]);
      }
    });
    return c.json({ data: { kiungoId: p.kiungoId } }, 201);
  });

  app.post('/standin/carriages', async (c) => {
    if (!admin(c.req.header('authorization'))) return c.json(error('not_allowed', 'Admin key needed.'), 401);
    const body = z.object({ name: z.string().min(1), key: z.string().min(24), mayWrite: z.array(z.string()).min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_request', body.error.message), 400);
    await db.query(
      `INSERT INTO standin_carriages (name, key_hash, may_write) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET key_hash = EXCLUDED.key_hash, may_write = EXCLUDED.may_write`,
      [body.data.name, await sha256(body.data.key), body.data.mayWrite],
    );
    return c.json({ data: { name: body.data.name } }, 201);
  });

  // A carriage writes to a person's activity record; the rail then delivers it to the points system.
  app.post('/standin/activity', async (c) => {
    const carriage = await carriageFor(db, bearer(c.req.header('authorization')));
    if (!carriage) return c.json(error('unknown_carriage', 'This key is not a known carriage.'), 401);
    const body = z.object({
      kiungoId: KIUNGO_ID,
      kind: z.string().min(1),
      occurredAt: z.string().datetime({ offset: true }),
      key: z.string().min(1).max(200),
    }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_request', body.error.message), 400);
    if (!carriage.may_write.includes(body.data.kind)) {
      return c.json(error('not_allowed_for_carriage', `${carriage.name} may not write ${body.data.kind}.`), 403);
    }
    if (!(await identity.lookup(body.data.kiungoId))) {
      return c.json(error('unknown_person', 'No person with this Kiungo ID.'), 404);
    }
    const entry = await writeEntry(db, carriage.name, body.data);
    const result = await takeEntry(db, identity, entry);
    return c.json({ data: { ...result, ...(await standing(db, entry.kiungoId)) } }, 201);
  });

  return app;
}
