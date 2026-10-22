import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, setup } from './helpers';

const AT = '2026-10-20T09:00:00Z';
const LATER = '2099-04-01T09:00:00Z'; // after the challenge goes live
const peppers = (points = 20) => ({
  proposedBy: 'k-zawadi', id: 'matete.peppers', title: 'Grow peppers', template: 'steps', trustNeeded: 'joined',
  steps: [{ kind: 'peppers.planted', points }, { kind: 'peppers.harvested', points: 50 }],
});

describe('T-09 local quests', () => {
  let t: Awaited<ReturnType<typeof setup>>;

  // Builds a member to a level through ordinary activity: Fruit needs 1,500, vouched and building; Seedkeeper 5,000 and three quest lines.
  const grow = async (id: string, units: string[], to: 'Fruit' | 'Seedkeeper') => {
    await t.person(id, 'vouched', 'Africa/Kinshasa', ['kiungo-points', 'kiungo.test'], units);
    const franchises = to === 'Fruit' ? 8 : 25;
    for (let i = 0; i < franchises; i++) await t.act(id, 'business.franchise_launched', AT, `${id}-fr${i}`, { item: `fr-${i}` });
    await t.act(id, 'build.translation_approved', AT, `${id}-tr`, { item: 'piece-1' });
    if (to === 'Seedkeeper') await t.act(id, 'picture.look', AT, `${id}-look`);
    expect((await t.call('GET', `/v1/people/${id}/standing`)).json.data.level).toBe(to);
  };
  const draft = (body: object) => t.call('POST', '/v1/units/matete/quests', body);
  const live = (by: string) => t.call('POST', '/v1/units/matete/quests/matete.peppers/live', { by });
  const list = async (unit: string) => ((await t.call('GET', `/v1/units/${unit}/standing`)).json.data.quests as any[]).map((q) => q.quest);

  beforeEach(async () => {
    t = await setup();
    await grow('k-zawadi', ['matete'], 'Fruit');
  });

  it('lets Matete add "grow peppers", on Matete\'s list only, once a Seedkeeper puts it live', async () => {
    const res = await draft(peppers());
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ quest: 'matete.peppers', status: 'draft' });
    expect(await list('matete')).toEqual([]);

    expect((await live('k-zawadi')).status).toBe(403); // a Fruit member proposes; a Seedkeeper decides
    await grow('k-mzee', ['matete'], 'Seedkeeper');
    expect((await live('k-mzee')).status).toBe(200);

    expect(await list('matete')).toEqual(['matete.peppers']);
    expect(await list('kisenso')).toEqual([]);
    expect(((await t.call('GET', '/v1/quests')).json.data as any[]).some((q) => q.quest === 'matete.peppers')).toBe(false);
  });

  it('refuses a 60-point local step', async () => {
    const res = await draft(peppers(60));
    expect(res.status).toBe(400);
    expect(res.json.error.message).toMatch(/50 points/);
  });

  it('refuses a draft from a member below Fruit, or from another unit', async () => {
    await t.person('k-new', 'joined', 'Africa/Kinshasa', ['kiungo-points', 'kiungo.test'], ['matete']);
    expect((await draft({ ...peppers(), proposedBy: 'k-new' })).status).toBe(403);
    await grow('k-kisenso', ['kisenso'], 'Fruit');
    expect((await draft({ ...peppers(), proposedBy: 'k-kisenso' })).status).toBe(403);
  });

  it('leaves the unit\'s missions to its Seedkeepers', async () => {
    const mission = { proposedBy: 'k-zawadi', id: 'matete.lists', title: '100 lists', template: 'mission', watches: ['need.shopping_list'], target: 100, period: 'monthly', points: 20, trustNeeded: 'joined' };
    expect((await draft(mission)).status).toBe(403);
    await grow('k-mzee', ['matete'], 'Seedkeeper');
    expect((await draft({ ...mission, proposedBy: 'k-mzee' })).status).toBe(201);
  });

  it('keeps a unit to its own quests: ids start with the unit, and core quests stay core', async () => {
    expect((await draft({ ...peppers(), id: 'kisenso.peppers' })).status).toBe(400);
    expect((await draft({ ...peppers(), id: 'need.shopping_list' })).status).toBe(400);
  });

  it('pays only Matete\'s members', async () => {
    await draft(peppers());
    await grow('k-mzee', ['matete'], 'Seedkeeper');
    await live('k-mzee');
    await t.person('k-amina', 'joined', 'Africa/Kinshasa', undefined, ['matete']);
    await t.person('k-kofi', 'joined', 'Africa/Kinshasa', undefined, ['kisenso']);
    expect((await t.act('k-amina', 'peppers.planted', LATER, 'a1')).awards).toEqual([{ quest: 'matete.peppers', points: 20, step: 'peppers.planted' }]);
    expect((await t.act('k-kofi', 'peppers.planted', LATER, 'k1')).awards).toEqual([]);
  });

  it('holds admin-drafted local quests to the same 50-point limit', async () => {
    const res = await t.call('POST', '/v1/quests', {
      id: 'local.big', title: 'Too big', questLine: 'local', template: 'repeat', watches: ['peppers.planted'],
      target: 1, period: 'once', points: 60, trustNeeded: 'joined',
    }, ADMIN);
    expect(res.status).toBe(400);
  });
});
