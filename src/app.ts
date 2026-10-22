import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Db } from './db';
import type { IdentityPlug } from './plugs';
import { allAwards, correct, history } from './points/history';
import { earned, questProgress } from './points/progress';
import { standing } from './points/standing';
import { draftQuest, liveQuests, setStatus } from './quests/board';
import { QuestDraft } from './quests/templates';
import { bearer, CARRIAGE_NAME, error, KIUNGO_ID } from './http';
import { carriageFor, sha256, setCarriage } from './readers';
import { standinRoutes } from './standin/routes';

export interface Deps {
  db: Db;
  identity: IdentityPlug;
  adminKey: string;
  limit: (key: string) => Promise<boolean>; // false once a carriage (or an address) has used up its calls for now
}

export function createApp({ db, identity, adminKey, limit }: Deps) {
  const app = new Hono();

  app.onError((err, c) => {
    console.error(err);
    return c.json(error('server_error', 'Something went wrong on our side. Try again.'), 500);
  });

  const adminHash = adminKey.length >= 24 ? sha256(adminKey) : null; // a short admin key switches admin off
  const tooMany = (c: Context) => {
    c.header('retry-after', '60');
    return c.json(error('rate_limited', 'Too many calls. Try again in a minute.'), 429);
  };
  // A wrong key is limited by the caller's address, so keys can't be guessed by trying many.
  const wrongKey = async (c: Context) => !(await limit(`ip:${c.req.header('cf-connecting-ip') ?? 'unknown'}`));
  // Compared as hashes, so the time taken says nothing about the key.
  const admin = async (c: Context): Promise<true | Response> => {
    if (adminHash && (await sha256(bearer(c.req.header('authorization')))) === (await adminHash)) return true;
    if (await wrongKey(c)) return tooMany(c);
    return c.json(error('not_allowed', 'Admin key needed.'), 401);
  };

  // The public quest board (transparency, ADR-001).
  app.get('/v1/quests', async (c) => c.json({ data: await liveQuests(db) }));

  app.post('/v1/quests', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    const body = QuestDraft.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_quest', body.error.issues.map((i) => `${i.path.join('.') || 'quest'}: ${i.message}`).join(' ')), 400);
    const result = await draftQuest(db, body.data);
    if ('reason' in result) return c.json(error('invalid_quest', result.reason), 400);
    return c.json({ data: result }, 201);
  });

  app.post('/v1/quests/:id/:step{live|pause|end}', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
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
    if (!name) return (await wrongKey(c)) ? tooMany(c) : c.json(error('unknown_carriage', 'This key is not a known carriage.'), 401);
    if (!(await limit(name))) return tooMany(c);
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
    const ok = await admin(c);
    if (ok !== true) return ok;
    const body = z.object({ name: CARRIAGE_NAME, key: z.string().min(24).max(200), active: z.boolean().default(true) })
      .strict().safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_request', 'Send a name (lower case), a key of 24 characters or more, and optionally active.'), 400);
    if (!(await setCarriage(db, body.data.name, body.data.key, body.data.active))) {
      return c.json(error('key_in_use', 'Another carriage has this key. Choose a new one.'), 409);
    }
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
    if (entry) {
      const result = await earned(db, entry, m.id);
      return c.json({ data: { ...result, ...(await standing(db, identity, m.id)) } });
    }
    const page = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), before: z.coerce.number().int().positive().optional() })
      .safeParse(c.req.query());
    if (!page.success) return c.json(error('invalid_request', 'limit is 1 to 100; before is an award id.'), 400);
    const { lines, next } = await history(db, m.id, page.data);
    return c.json({ data: lines, meta: { next } });
  });

  // The member's whole points record, to keep (TRD §5).
  app.get('/v1/people/:kiungoId/export', async (c) => {
    const m = await memberFor(c);
    if (m instanceof Response) return m;
    c.header('content-disposition', `attachment; filename="kiungo-points-${m.id}.json"`);
    return c.json({ data: {
      note: 'Your Kiungo points record. Points have no cash value.',
      exportedAt: new Date().toISOString(),
      standing: await standing(db, identity, m.id),
      awards: await allAwards(db, m.id),
    } });
  });

  app.post('/v1/corrections', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    const body = z.object({ award: z.number().int().positive(), reason: z.string().trim().min(1).max(200) })
      .strict().safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_request', 'Send the award id and a reason, such as "duplicate photo".'), 400);
    const result = await correct(db, body.data.award, body.data.reason);
    if ('line' in result) return c.json({ data: result.line }, 201);
    if (result.error === 'unknown_award') return c.json(error('unknown_award', 'No award with this id.'), 404);
    if (result.error === 'already_corrected') return c.json(error('already_corrected', 'This award has already been corrected.'), 409);
    return c.json(error('not_correctable', 'Only an award that paid points can be corrected, and only once.'), 409);
  });

  // ---- Stand-in rails (ADR-003). Removed in T-12. ----
  standinRoutes(app, { db, identity, admin, carriageOf });

  return app;
}
