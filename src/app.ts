import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Db } from './db';
import type { IdentityPlug } from './plugs';
import { allAwards, correct, history } from './points/history';
import { periodKey, type Period } from './points/periods';
import { earned, questProgress } from './points/progress';
import { standing } from './points/standing';
import { draftQuest, liveQuests, questUnit, setStatus, unitStanding } from './quests/board';
import { QuestDraft } from './quests/templates';
import { bearer, CARRIAGE_NAME, error, KIUNGO_ID, UNIT } from './http';
import { carriageFor, sha256, setCarriage } from './readers';
import { standinRoutes } from './standin/routes';

export interface Deps {
  db: Db;
  identity: IdentityPlug;
  adminKey: string;
  limit: (key: string) => Promise<boolean>; // false once a carriage (or an address) has used up its calls for now
  now?: () => Date; // the clock; tests set it
}

export function createApp({ db, identity, adminKey, limit, now = () => new Date() }: Deps) {
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

  const statusAnswer = (c: Context, result: Awaited<ReturnType<typeof setStatus>>) => {
    if ('error' in result) {
      if (result.error === 'unknown_quest') return c.json(error('unknown_quest', 'No quest with this id.'), 404);
      if (result.error === 'quest_ended') return c.json(error('quest_ended', 'This quest has ended for good.'), 409);
      return c.json(error('not_allowed', 'Only a live quest can be paused.'), 409);
    }
    return c.json({ data: result });
  };
  const draftAnswer = async (c: Context, raw: unknown) => {
    const body = QuestDraft.safeParse(raw);
    if (!body.success) return c.json(error('invalid_quest', body.error.issues.map((i) => `${i.path.join('.') || 'quest'}: ${i.message}`).join(' ')), 400);
    const result = await draftQuest(db, body.data);
    if ('reason' in result) return c.json(error('invalid_quest', result.reason), 400);
    return c.json({ data: result }, 201);
  };

  app.post('/v1/quests', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    return draftAnswer(c, await c.req.json().catch(() => null));
  });

  app.post('/v1/quests/:id/:step{live|pause|end}', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    return statusAnswer(c, await setStatus(db, c.req.param('id'), c.req.param('step') as 'live' | 'pause' | 'end'));
  });

  // A carriage, by its key, within its rate limit; or the answer refusing it.
  const carriageOf = async (c: Context): Promise<string | Response> => {
    const name = await carriageFor(db, bearer(c.req.header('authorization')));
    if (!name) return (await wrongKey(c)) ? tooMany(c) : c.json(error('unknown_carriage', 'This key is not a known carriage.'), 401);
    if (!(await limit(name))) return tooMany(c);
    return name;
  };

  // A member's points, for a carriage the member has allowed to read them. Never cached on the way.
  const memberFor = async (c: Context): Promise<{ id: string; carriage: string } | Response> => {
    c.header('cache-control', 'private, no-store');
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

  // A unit's quests and missions, shown in stages: never who contributed, never the raw count (TRD §5).
  app.get('/v1/units/:unitId/standing', async (c) => {
    const unit = UNIT.safeParse(c.req.param('unitId'));
    if (!unit.success) return c.json(error('invalid_unit', 'A unit id is lower-case letters, digits, - and _.'), 400);
    const carriage = await carriageOf(c);
    if (carriage instanceof Response) return carriage;
    // shortcut: periods use Kinshasa time; a unit's own time zone arrives with the identity rail (T-12).
    const at = now();
    const quests = await unitStanding(db, unit.data, at, (p) => periodKey(at.toISOString(), p as Period, 'Africa/Kinshasa'));
    return c.json({ data: { unit: unit.data, quests } });
  });

  // A member of the unit, acting through a carriage they allow, at the level the rulebook asks for (design.md §5).
  const unitMember = async (c: Context, unit: string, kiungoId: unknown, level: 'Fruit' | 'Seedkeeper') => {
    const carriage = await carriageOf(c);
    if (carriage instanceof Response) return carriage;
    const id = KIUNGO_ID.safeParse(kiungoId);
    if (!id.success) return c.json(error('invalid_kiungo_id', 'Say which member is acting, by Kiungo ID.'), 400);
    const person = await identity.lookup(id.data);
    if (!person || !person.units.includes(unit) || !(await identity.allows(id.data, carriage))) {
      return c.json(error('not_allowed', `Only a member of ${unit}, through a carriage they allow, can do this.`), 403);
    }
    if (!(await standing(db, identity, id.data)).levels.some((l) => l.level === level)) {
      return c.json(error('not_allowed', `This needs a ${level} of ${unit}.`), 403);
    }
    return id.data;
  };

  // A unit's own challenge, proposed by one of its Fruit members. It is a draft until a Seedkeeper puts it live.
  app.post('/v1/units/:unitId/quests', async (c) => {
    const unit = UNIT.safeParse(c.req.param('unitId'));
    if (!unit.success) return c.json(error('invalid_unit', 'A unit id is lower-case letters, digits, - and _.'), 400);
    const raw = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') return c.json(error('invalid_quest', 'Send the quest as JSON.'), 400);
    const { proposedBy, ...quest } = raw;
    // Fruit proposes a challenge; only a Seedkeeper sets the unit's missions (design.md §5).
    const member = await unitMember(c, unit.data, proposedBy, quest.template === 'mission' ? 'Seedkeeper' : 'Fruit');
    if (typeof member !== 'string') return member;
    if (typeof quest.id !== 'string' || !quest.id.startsWith(`${unit.data}.`)) {
      return c.json(error('invalid_quest', `A ${unit.data} quest's id starts with "${unit.data}.".`), 400);
    }
    return draftAnswer(c, { ...quest, questLine: 'local', unit: unit.data });
  });

  app.post('/v1/units/:unitId/quests/:id/:step{live|pause|end}', async (c) => {
    const unit = UNIT.safeParse(c.req.param('unitId'));
    if (!unit.success) return c.json(error('invalid_unit', 'A unit id is lower-case letters, digits, - and _.'), 400);
    const body = await c.req.json().catch(() => null) as { by?: unknown } | null;
    const member = await unitMember(c, unit.data, body?.by, 'Seedkeeper');
    if (typeof member !== 'string') return member;
    if ((await questUnit(db, c.req.param('id'))) !== unit.data) return c.json(error('unknown_quest', `No ${unit.data} quest with this id.`), 404);
    return statusAnswer(c, await setStatus(db, c.req.param('id'), c.req.param('step') as 'live' | 'pause' | 'end'));
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
    return c.json({ data: await questProgress(db, m.id, person.timezone, now()) });
  });

  app.get('/v1/people/:kiungoId/awards', async (c) => {
    const m = await memberFor(c);
    if (m instanceof Response) return m;
    const entry = c.req.query('entry');
    if (entry) {
      const result = await earned(db, entry, m.id);
      return c.json({ data: { ...result, ...(await standing(db, identity, m.id)) } });
    }
    const page = z.object({ limit: z.coerce.number().int().min(1).max(100).default(10), before: z.coerce.number().int().positive().optional() })
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
      exportedAt: now().toISOString(),
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
  standinRoutes(app, { db, identity, admin, carriageOf, now });

  return app;
}
