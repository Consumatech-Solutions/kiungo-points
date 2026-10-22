import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Db } from './db';
import type { IdentityPlug } from './plugs';
import { isValidTimezone } from './points/periods';
import { earned, questProgress, takeEntry } from './points/progress';
import { standing } from './points/standing';
import { draftQuest, liveQuests, setStatus } from './quests/board';
import { QuestDraft } from './quests/templates';
import { carriageFor, setCarriage } from './readers';
import { mayWrite, writeEntry } from './standin/rails';

export interface Deps {
  db: Db;
  identity: IdentityPlug;
  adminKey: string;
  /** False when a carriage has used up its calls for now (Cloudflare's rate limiter in production). */
  limit: (carriage: string) => Promise<boolean>;
}

const KIUNGO_ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const CARRIAGE_NAME = z.string().regex(/^[a-z0-9.-]{1,64}$/);

const error = (code: string, message: string) => ({ error: { code, message } });

export function createApp({ db, identity, adminKey, limit }: Deps) {
  const app = new Hono();
  const bearer = (h: string | undefined) => h?.match(/^Bearer (.+)$/)?.[1] ?? '';

  app.onError((err, c) => {
    console.error(err);
    return c.json(error('server_error', 'Something went wrong on our side. Try again.'), 500);
  });

  const admin = (h: string | undefined) => adminKey.length > 0 && bearer(h) === adminKey;

  // The public quest board (transparency, ADR-001).
  app.get('/v1/quests', async (c) => c.json({ data: await liveQuests(db) }));

  app.post('/v1/quests', async (c) => {
    if (!admin(c.req.header('authorization'))) return c.json(error('not_allowed', 'Admin key needed.'), 401);
    const body = QuestDraft.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_quest', body.error.issues.map((i) => `${i.path.join('.') || 'quest'}: ${i.message}`).join(' ')), 400);
    const result = await draftQuest(db, body.data);
    if ('reason' in result) return c.json(error('invalid_quest', result.reason), 400);
    return c.json({ data: result }, 201);
  });

  app.post('/v1/quests/:id/:step{live|pause|end}', async (c) => {
    if (!admin(c.req.header('authorization'))) return c.json(error('not_allowed', 'Admin key needed.'), 401);
    const result = await setStatus(db, c.req.param('id'), c.req.param('step') as 'live' | 'pause' | 'end');
    if ('error' in result) {
      if (result.error === 'unknown_quest') return c.json(error('unknown_quest', 'No quest with this id.'), 404);
      if (result.error === 'quest_ended') return c.json(error('quest_ended', 'This quest has ended for good.'), 409);
      return c.json(error('not_allowed', 'Only a live quest can be paused.'), 409);
    }
    return c.json({ data: result });
  });

  // A carriage, by its key, within its rate limit; or the answer refusing it.
  const carriageOf = async (c: Context): Promise<string | Response> => {
    const name = await carriageFor(db, bearer(c.req.header('authorization')));
    if (!name) return c.json(error('unknown_carriage', 'This key is not a known carriage.'), 401);
    if (!(await limit(name))) {
      c.header('retry-after', '60');
      return c.json(error('rate_limited', 'Too many calls from this carriage. Try again in a minute.'), 429);
    }
    return name;
  };

  // A member's points, for a carriage the member has allowed to read them.
  const memberFor = async (c: Context): Promise<{ id: string; carriage: string } | Response> => {
    const id = KIUNGO_ID.safeParse(c.req.param('kiungoId'));
    if (!id.success) return c.json(error('invalid_kiungo_id', 'Use letters, digits, - and _, up to 64.'), 400);
    const carriage = await carriageOf(c);
    if (carriage instanceof Response) return carriage;
    if (!(await identity.allows(id.data, carriage))) {
      return c.json(error('not_allowed_by_member', 'This member has not allowed this carriage to see their points.'), 403);
    }
    return { id: id.data, carriage };
  };

  app.post('/v1/carriages', async (c) => {
    if (!admin(c.req.header('authorization'))) return c.json(error('not_allowed', 'Admin key needed.'), 401);
    const body = z.object({ name: CARRIAGE_NAME, key: z.string().min(24).max(200), active: z.boolean().default(true) })
      .strict().safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_request', 'Send a name (lower case), a key of 24 characters or more, and optionally active.'), 400);
    await setCarriage(db, body.data.name, body.data.key, body.data.active);
    return c.json({ data: { name: body.data.name, active: body.data.active } }, 201);
  });

  app.get('/v1/people/:kiungoId/standing', async (c) => {
    const m = await memberFor(c);
    if (m instanceof Response) return m;
    return c.json({ data: await standing(db, identity, m.id) });
  });

  app.get('/v1/people/:kiungoId/quests', async (c) => {
    const m = await memberFor(c);
    if (m instanceof Response) return m;
    const person = await identity.lookup(m.id);
    if (!person) return c.json(error('unknown_person', 'No person with this Kiungo ID.'), 404);
    return c.json({ data: await questProgress(db, m.id, person.timezone) });
  });

  app.get('/v1/people/:kiungoId/awards', async (c) => {
    const m = await memberFor(c);
    if (m instanceof Response) return m;
    const entry = c.req.query('entry');
    if (!entry) return c.json(error('entry_required', 'Add ?entry=<entry id>. The full history arrives in T-07.'), 400);
    const result = await earned(db, entry, m.id);
    return c.json({ data: { ...result, ...(await standing(db, identity, m.id)) } });
  });

  // ---- Stand-in rails (ADR-003). Removed in T-12. ----

  app.post('/standin/people', async (c) => {
    if (!admin(c.req.header('authorization'))) return c.json(error('not_allowed', 'Admin key needed.'), 401);
    const body = z.object({
      kiungoId: KIUNGO_ID,
      trust: z.enum(['joined', 'vouched', 'verified']),
      timezone: z.string().refine(isValidTimezone, 'Use a time zone name such as Africa/Kinshasa.'),
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
    const body = z.object({ name: CARRIAGE_NAME, key: z.string().min(24).max(200), mayWrite: z.array(z.string()).min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_request', body.error.message), 400);
    await setCarriage(db, body.data.name, body.data.key);
    await db.query(
      `INSERT INTO standin_carriages (name, may_write) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET may_write = EXCLUDED.may_write`,
      [body.data.name, body.data.mayWrite],
    );
    return c.json({ data: { name: body.data.name } }, 201);
  });

  app.post('/standin/permissions', async (c) => {
    if (!admin(c.req.header('authorization'))) return c.json(error('not_allowed', 'Admin key needed.'), 401);
    const body = z.object({ kiungoId: KIUNGO_ID, reader: z.string().min(1).max(64), allowed: z.boolean() })
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
      kind: z.string().min(1),
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
    const result = await takeEntry(db, identity, entry);
    // The writing carriage sees the member's standing only if the member lets it read their points.
    const canRead = await identity.allows(entry.kiungoId, carriage.name);
    return c.json({ data: { ...result, ...(canRead ? await standing(db, identity, entry.kiungoId) : {}) } }, 201);
  });

  return app;
}
