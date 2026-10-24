import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, setup } from './helpers';

const AT = '2026-10-20T09:00:00Z';
const IDEA = 'build.idea_taken_up';
const MEMBERS = Array.from({ length: 10 }, (_, i) => `k-m${i}`);
const peppers = {
  proposedBy: 'k-zawadi', id: 'matete.peppers', title: 'Grow peppers', template: 'steps', trustNeeded: 'joined',
  steps: [{ kind: 'peppers.planted', points: 20 }, { kind: 'peppers.harvested', points: 50 }],
};

describe('T-17 members suggest quests', () => {
  let t: Awaited<ReturnType<typeof setup>>;

  // Builds a member to a level through ordinary activity (as in local.test.ts).
  const grow = async (id: string, units: string[], to: 'Fruit' | 'Seedkeeper') => {
    await t.person(id, 'vouched', 'Africa/Kinshasa', ['kiungo-points', 'kiungo.test'], units);
    const franchises = to === 'Fruit' ? 8 : 25;
    for (let i = 0; i < franchises; i++) await t.act(id, 'business.franchise_launched', AT, `${id}-fr${i}`, { item: `fr-${i}` });
    await t.act(id, 'build.translation_approved', AT, `${id}-tr`, { item: 'piece-1' });
    if (to === 'Seedkeeper') await t.act(id, 'picture.look', AT, `${id}-look`);
  };
  const tap = (by: string, step: 'in' | 'out' = 'in', quest = 'matete.peppers') =>
    t.call('POST', `/v1/units/matete/quests/${quest}/${step}`, { by });
  const live = (by = 'k-mzee', quest = 'matete.peppers') => t.call('POST', `/v1/units/matete/quests/${quest}/live`, { by });
  const ideas = async (id: string) =>
    ((await t.call('GET', `/v1/people/${id}/awards?limit=100`)).json.data as any[]).filter((l) => l.quest === IDEA);
  const list = async () => ((await t.call('GET', '/v1/units/matete/standing')).json.data.quests as any[]).map((q) => q.quest);

  beforeEach(async () => {
    t = await setup();
    await grow('k-zawadi', ['matete'], 'Fruit');
    await grow('k-mzee', ['matete'], 'Seedkeeper');
    for (const id of MEMBERS) await t.person(id, 'joined', 'Africa/Kinshasa', undefined, ['matete']);
    expect((await t.call('POST', '/v1/units/matete/quests', peppers)).status).toBe(201);
  });

  it('needs ten members in, then pays the suggester 50 once', async () => {
    for (const id of MEMBERS.slice(0, 9)) expect((await tap(id)).status).toBe(200);
    const early = await live();
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe('needs_more_members');
    expect(early.json.error.message).toMatch(/9 of 10/);
    expect(await list()).toEqual([]);

    expect((await tap(MEMBERS[9]!)).json.data).toEqual({ quest: 'matete.peppers', in: 10, needed: 10 });
    expect((await live()).status).toBe(200);
    expect(await list()).toEqual(['matete.peppers']);
    expect(await ideas('k-zawadi')).toEqual([expect.objectContaining({ quest: IDEA, points: 50 })]);

    expect((await live()).status).toBe(200);
    expect(await ideas('k-zawadi')).toHaveLength(1);
    for (const id of MEMBERS) expect((await t.call('GET', `/v1/people/${id}/standing`)).json.data.total).toBe(0);
  });

  it('counts each member once, and lets them change their mind until approval', async () => {
    await tap('k-m0');
    expect((await tap('k-m0')).json.data.in).toBe(1);
    expect((await tap('k-m0', 'out')).json.data.in).toBe(0);
    for (const id of MEMBERS) await tap(id);
    expect((await live()).status).toBe(200);
    const after = await tap('k-m0', 'out');
    expect(after.status).toBe(409);
    expect(after.json.error.code).toBe('not_open');
  });

  it("doesn't let the suggester, or another unit's member, be in", async () => {
    const own = await tap('k-zawadi');
    expect(own.status).toBe(409);
    expect(own.json.error.code).toBe('own_suggestion');
    await t.person('k-kofi', 'joined', 'Africa/Kinshasa', undefined, ['kisenso']);
    expect((await tap('k-kofi')).status).toBe(403);
    expect((await tap('k-m0', 'in', 'matete.nothing')).status).toBe(404);
  });

  it('pays nobody for a declined suggestion', async () => {
    for (const id of MEMBERS) await tap(id);
    expect((await t.call('POST', '/v1/units/matete/quests/matete.peppers/end', { by: 'k-mzee' })).status).toBe(200);
    expect((await tap('k-m0', 'out')).json.error.code).toBe('not_open');
    expect((await live()).status).toBe(409);
    expect(await ideas('k-zawadi')).toEqual([]);
  });

  it('needs no members in for a mission or an admin-drafted challenge, and pays nobody', async () => {
    const mission = { proposedBy: 'k-mzee', id: 'matete.lists', title: '100 lists', template: 'mission', watches: ['need.shopping_list'], target: 100, period: 'monthly', points: 20, trustNeeded: 'joined' };
    expect((await t.call('POST', '/v1/units/matete/quests', mission)).status).toBe(201);
    expect((await live('k-mzee', 'matete.lists')).status).toBe(200);
    const { proposedBy: _, ...admin } = { ...peppers, id: 'matete.beans', title: 'Grow beans' };
    expect((await t.call('POST', '/v1/quests', { ...admin, questLine: 'local', unit: 'matete' }, ADMIN)).status).toBe(201);
    expect((await t.call('POST', '/v1/quests/matete.beans/live', undefined, ADMIN)).status).toBe(200);
    for (const id of ['k-zawadi', 'k-mzee']) expect(await ideas(id)).toEqual([]);
  });

  it('holds the admin to the same ten members', async () => {
    const early = await t.call('POST', '/v1/quests/matete.peppers/live', undefined, ADMIN);
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe('needs_more_members');
    for (const id of MEMBERS) await tap(id);
    expect((await t.call('POST', '/v1/quests/matete.peppers/live', undefined, ADMIN)).status).toBe(200);
    expect(await ideas('k-zawadi')).toEqual([expect.objectContaining({ quest: IDEA, points: 50 })]);
  });

  it('shows members how many are in, never who', async () => {
    await t.person('k-amina', 'joined', 'Africa/Kinshasa', undefined, ['matete']);
    await tap('k-amina');
    await tap('k-m0');
    const res = await t.call('GET', '/v1/units/matete/suggestions?by=k-amina');
    expect(res.status).toBe(200);
    expect(res.json.data.suggestions).toEqual([expect.objectContaining({ quest: 'matete.peppers', in: 2, needed: 10, youAreIn: true })]);
    expect(JSON.stringify(res.json)).not.toMatch(/k-m0|k-zawadi/);
    await t.person('k-kofi', 'joined', 'Africa/Kinshasa', undefined, ['kisenso']);
    expect((await t.call('GET', '/v1/units/matete/suggestions?by=k-kofi')).status).toBe(403);

    for (const id of MEMBERS) await tap(id);
    await live();
    expect((await t.call('GET', '/v1/units/matete/suggestions?by=k-amina')).json.data.suggestions).toEqual([]);
  });

  it('shows the Seedkeeper how many are in', async () => {
    for (const id of MEMBERS.slice(0, 3)) await tap(id);
    const [d] = (await t.call('GET', '/v1/units/matete/drafts?by=k-mzee')).json.data.drafts;
    expect(d).toMatchObject({ quest: 'matete.peppers', in: 3 });
  });

  it('lets spike flags watch "I\'m in"', async () => {
    expect((await t.call('PUT', '/v1/admin/spike-settings', [{ kind: 'suggestion.im_in', count: 3, minutes: 60 }], ADMIN)).status).toBe(200);
    for (const step of ['in', 'out', 'in', 'out', 'in'] as const) expect((await tap('k-m0', step)).status).toBe(200);
    const flags = (await t.call('GET', '/v1/admin/flags', undefined, ADMIN)).json.data as any[];
    expect(flags.filter((f) => f.kiungoId === 'k-m0' && f.kind === 'suggestion.im_in')).toHaveLength(1);
    expect((await t.call('GET', '/v1/people/k-m0/standing')).json.data.total).toBe(0);
  });

  it("counts a member who hasn't allowed the points system, but notes nothing about them", async () => {
    await t.person('k-private', 'joined', 'Africa/Kinshasa', ['kiungo.test'], ['matete']);
    await t.call('PUT', '/v1/admin/spike-settings', [{ kind: 'suggestion.im_in', count: 2, minutes: 60 }], ADMIN);
    for (const step of ['in', 'out', 'in', 'out', 'in'] as const) expect((await tap('k-private', step)).status).toBe(200);
    expect((await tap('k-m0')).json.data.in).toBe(2);
    const flags = (await t.call('GET', '/v1/admin/flags', undefined, ADMIN)).json.data as any[];
    expect(flags.filter((f) => f.kiungoId === 'k-private')).toEqual([]);
  });

  it('starts the "I\'m in" list again when the suggestion changes', async () => {
    for (const id of MEMBERS) await tap(id);
    expect((await t.call('POST', '/v1/units/matete/quests', { ...peppers, title: 'Grow hot peppers' })).status).toBe(201);
    const [s] = (await t.call('GET', '/v1/units/matete/suggestions?by=k-m0')).json.data.suggestions;
    expect(s).toMatchObject({ quest: 'matete.peppers', title: 'Grow hot peppers', in: 0, youAreIn: false });
    const res = await live();
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('needs_more_members');
  });

  it('refuses a quest that pays for suggesting', async () => {
    const res = await t.call('POST', '/v1/quests', {
      id: 'local.backing', title: 'Back a suggestion', questLine: 'local', template: 'repeat', watches: ['suggestion.im_in'],
      target: 1, period: 'weekly', points: 5, trustNeeded: 'joined',
    }, ADMIN);
    expect(res.status).toBe(400);
    expect(res.json.error.message).toMatch(/Nobody earns for suggesting/);
  });
});
