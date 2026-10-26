import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Db } from './db';
import { READER, type IdentityPlug } from './plugs';
import { allAwards, correct, history } from './points/history';
import { periodKey, type Period } from './points/periods';
import { earned, noteEntry, questProgress, takeEntry } from './points/progress';
import { flags, reviewFlag, setSpikeSettings, spikeSettings } from './points/spikes';
import { standing } from './points/standing';
import { draftQuest, liveQuests, questUnit, setIn, setStatus, suggestions, unitDrafts, unitStanding } from './quests/board';
import { compileQuest, QuestDraft } from './quests/templates';
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
      if (result.error === 'needs_more_members') return c.json(error('needs_more_members', `${result.in} of ${result.needed} members are in.`), 409);
      return c.json(error('not_allowed', 'Only a live quest can be paused.'), 409);
    }
    const { suggestedBy: _, ...data } = result;
    return c.json({ data });
  };
  // Both live routes: once a member's suggestion is live, its suggester earns "An idea of yours is taken up".
  // If paying fails after the quest is live, approving again re-reads the same entry id, so it pays at most once.
  const changeStatus = async (c: Context, id: string, step: 'live' | 'pause' | 'end') => {
    const result = await setStatus(db, id, step);
    if (!('error' in result) && result.suggestedBy) {
      await takeEntry(db, identity, {
        entryId: `kiungo-points:idea:${id}`, kiungoId: result.suggestedBy, kind: 'build.idea_taken_up',
        occurredAt: now().toISOString(), carriage: READER, item: id,
      }, now());
    }
    return statusAnswer(c, result);
  };
  // Suggesting and "I'm in" earn nothing, but are noted so spike flags can watch them; nothing is read without permission.
  const note = async (kiungoId: string, kind: string, carriage: string) => {
    if (!(await identity.allows(kiungoId, READER))) return;
    await noteEntry(db, { entryId: `kiungo-points:${crypto.randomUUID()}`, kiungoId, kind, occurredAt: now().toISOString(), carriage });
  };
  const draftAnswer = async (c: Context, raw: unknown, proposedBy: string | null = null) => {
    const body = QuestDraft.safeParse(raw);
    if (!body.success) return c.json(error('invalid_quest', body.error.issues.map((i) => `${i.path.join('.') || 'quest'}: ${i.message}`).join(' ')), 400);
    const compiled = compileQuest(body.data);
    if ('reason' in compiled) return c.json(error('invalid_quest', compiled.reason), 400);
    // Core quests are public files (quests/, T-14): changed only by a reviewed pull request, never through the API.
    if (body.data.questLine !== 'local' && !body.data.unit) {
      return c.json(error('core_quest_by_file', 'Core quests change by file, in a pull request (see quests/README.md).'), 400);
    }
    const result = await draftQuest(db, body.data, proposedBy);
    if ('error' in result) return c.json(error('not_your_suggestion', 'Only the member who suggested this challenge can change it before it goes live.'), 409);
    if ('reason' in result) return c.json(error('invalid_quest', result.reason), 400);
    return c.json({ data: result }, 201);
  };

  app.post('/v1/quests', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    return draftAnswer(c, await c.req.json().catch(() => null));
  });

  // A unit's drafts waiting, for the admin, who puts a unit's challenges live until it has a Seedkeeper.
  app.get('/v1/quests/drafts', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    const unit = UNIT.safeParse(c.req.query('unit'));
    if (!unit.success) return c.json(error('invalid_unit', 'Say which unit: ?unit= lower-case letters, digits, - and _.'), 400);
    return c.json({ data: { unit: unit.data, drafts: await unitDrafts(db, unit.data) } });
  });

  app.post('/v1/quests/:id/:step{live|pause|end}', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    return changeStatus(c, c.req.param('id'), c.req.param('step') as 'live' | 'pause' | 'end');
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

  // A member of the unit, acting through a carriage they allow, at the level the rulebook asks for (design.md §5; null: any member).
  const unitMember = async (c: Context, unit: string, kiungoId: unknown, level: 'Fruit' | 'Seedkeeper' | null) => {
    const carriage = await carriageOf(c);
    if (carriage instanceof Response) return carriage;
    const id = KIUNGO_ID.safeParse(kiungoId);
    if (!id.success) return c.json(error('invalid_kiungo_id', 'Say which member is acting, by Kiungo ID: "proposedBy" or "by" in the body, or ?by= when reading.'), 400);
    const person = await identity.lookup(id.data);
    if (!person || !person.units.includes(unit) || !(await identity.allows(id.data, carriage))) {
      return c.json(error('not_allowed', `Only a member of ${unit}, through a carriage they allow, can do this.`), 403);
    }
    if (level && !(await standing(db, identity, id.data)).levels.some((l) => l.level === level)) {
      return c.json(error('not_allowed', `This needs a member of ${unit} at ${level} or above.`), 403);
    }
    return { id: id.data, carriage };
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
    if (member instanceof Response) return member;
    if (typeof quest.id !== 'string' || !quest.id.startsWith(`${unit.data}.`)) {
      return c.json(error('invalid_quest', `A ${unit.data} quest's id starts with "${unit.data}.".`), 400);
    }
    const res = await draftAnswer(c, { ...quest, questLine: 'local', unit: unit.data }, member.id);
    if (res.status === 201 && quest.template !== 'mission') await note(member.id, 'suggestion.made', member.carriage);
    return res;
  });

  // The unit's drafts waiting, for its Seedkeeper to decide.
  app.get('/v1/units/:unitId/drafts', async (c) => {
    const unit = UNIT.safeParse(c.req.param('unitId'));
    if (!unit.success) return c.json(error('invalid_unit', 'A unit id is lower-case letters, digits, - and _.'), 400);
    const member = await unitMember(c, unit.data, c.req.query('by'), 'Seedkeeper');
    if (member instanceof Response) return member;
    return c.json({ data: { unit: unit.data, drafts: await unitDrafts(db, unit.data) } });
  });

  // The unit's open suggestions, for any of its members: how many are in, never who (TRD §5).
  app.get('/v1/units/:unitId/suggestions', async (c) => {
    const unit = UNIT.safeParse(c.req.param('unitId'));
    if (!unit.success) return c.json(error('invalid_unit', 'A unit id is lower-case letters, digits, - and _.'), 400);
    const member = await unitMember(c, unit.data, c.req.query('by'), null);
    if (member instanceof Response) return member;
    return c.json({ data: { unit: unit.data, suggestions: await suggestions(db, unit.data, member.id) } });
  });

  // "I'm in" on a suggestion, or taking it back, by any member of the unit until it is approved.
  app.post('/v1/units/:unitId/quests/:id/:step{in|out}', async (c) => {
    const unit = UNIT.safeParse(c.req.param('unitId'));
    if (!unit.success) return c.json(error('invalid_unit', 'A unit id is lower-case letters, digits, - and _.'), 400);
    const body = await c.req.json().catch(() => null) as { by?: unknown } | null;
    const member = await unitMember(c, unit.data, body?.by, null);
    if (member instanceof Response) return member;
    if ((await questUnit(db, c.req.param('id'))) !== unit.data) return c.json(error('unknown_quest', `No ${unit.data} quest with this id.`), 404);
    const step = c.req.param('step') as 'in' | 'out';
    const result = await setIn(db, c.req.param('id'), member.id, step);
    if ('error' in result) {
      if (result.error === 'unknown_quest') return c.json(error('unknown_quest', 'No quest with this id.'), 404);
      if (result.error === 'own_suggestion') return c.json(error('own_suggestion', 'This is your own suggestion; other members tap "I\'m in".'), 409);
      return c.json(error('not_open', 'This suggestion is no longer open: it is live or was declined.'), 409);
    }
    if (step === 'in') await note(member.id, 'suggestion.im_in', member.carriage);
    return c.json({ data: result });
  });

  app.post('/v1/units/:unitId/quests/:id/:step{live|pause|end}', async (c) => {
    const unit = UNIT.safeParse(c.req.param('unitId'));
    if (!unit.success) return c.json(error('invalid_unit', 'A unit id is lower-case letters, digits, - and _.'), 400);
    const body = await c.req.json().catch(() => null) as { by?: unknown } | null;
    const member = await unitMember(c, unit.data, body?.by, 'Seedkeeper');
    if (member instanceof Response) return member;
    if ((await questUnit(db, c.req.param('id'))) !== unit.data) return c.json(error('unknown_quest', `No ${unit.data} quest with this id.`), 404);
    return changeStatus(c, c.req.param('id'), c.req.param('step') as 'live' | 'pause' | 'end');
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

  // Spike settings and flags: private, admin only (TRD §7). A flag is for a person to look at, never a penalty.
  app.put('/v1/admin/spike-settings', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    const body = z.array(z.object({
      kind: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/).max(64),
      count: z.number().int().min(2).max(10000),
      minutes: z.number().int().min(1).max(10080),
    }).strict()).max(100).refine((xs) => new Set(xs.map((x) => x.kind)).size === xs.length, 'Each kind once.')
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(error('invalid_request', 'Send a list of { kind, count (2 or more), minutes (1 to 10080) }, each kind once.'), 400);
    await setSpikeSettings(db, body.data);
    return c.json({ data: body.data });
  });

  app.get('/v1/admin/spike-settings', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    return c.json({ data: await spikeSettings(db) });
  });

  app.get('/v1/admin/flags', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    return c.json({ data: await flags(db, c.req.query('open') === 'true') });
  });

  app.post('/v1/admin/flags/:id/review', async (c) => {
    const ok = await admin(c);
    if (ok !== true) return ok;
    const id = z.coerce.number().int().positive().safeParse(c.req.param('id'));
    const body = z.object({ note: z.string().trim().min(1).max(500) }).strict().safeParse(await c.req.json().catch(() => null));
    if (!id.success || !body.success) return c.json(error('invalid_request', 'Say what you found, in a note.'), 400);
    const result = await reviewFlag(db, id.data, body.data.note);
    if (result === 'unknown') return c.json(error('unknown_flag', 'No flag with this id.'), 404);
    if (result === 'already_reviewed') return c.json(error('already_reviewed', 'This flag has already been reviewed.'), 409);
    return c.json({ data: { id: id.data, reviewed: true } });
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
