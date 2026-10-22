import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, setup } from './helpers';

const PICTURE = [
  'identity.phone_confirmed', 'picture.name', 'picture.look', 'picture.privacy', 'picture.age_range', 'picture.from',
  'picture.lives', 'picture.languages', 'picture.household', 'picture.work', 'picture.joining_as', 'unit.joined',
];
const AT = '2026-10-20T09:00:00Z';
const day = (n: number) => new Date(Date.UTC(2026, 6, 1 + n, 9)).toISOString();

describe('T-05 levels', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { t = await setup(); });

  const standing = async (id: string) => (await t.call('GET', `/v1/people/${id}/standing`)).json.data;
  const picture = async (id: string) => { for (const [i, k] of PICTURE.entries()) await t.act(id, k, AT, `pic${i}`, { item: 'unit-1' }); };
  const franchises = async (id: string, n: number) => {
    for (let i = 0; i < n; i++) await t.act(id, 'business.franchise_launched', AT, `fr${i}`, { item: `franchise-${i}` });
  };

  it('gives Sprout for the whole picture, and Root asks for 285 more and vouched', async () => {
    await t.person('k-amina');
    await picture('k-amina');
    const s = await standing('k-amina');
    expect(s).toMatchObject({ total: 115, counting: 115, level: 'Sprout' });
    expect(s.next).toEqual({ level: 'Root', pointsToGo: 285, alsoNeeds: ['vouched'] });
  });

  it('stalls invites before Root, even for a vouched member: invites count up to half', async () => {
    await t.person('k-kofi', 'vouched');
    await picture('k-kofi');
    for (let i = 0; i < 45; i++) await t.act('k-kofi', 'invite.joined', day(Math.floor(i / 3)), `inv${i}`, { item: `k-new${i}` });
    const s = await standing('k-kofi');
    expect(s.total).toBe(565); // 115 + 450
    expect(s.counting).toBe(230); // invites count only up to the other 115
    expect(s.level).toBe('Sprout');
  });

  it('keeps a builder-less member at Root past 1,500; one building activity gives Fruit', async () => {
    await t.person('k-kofi', 'vouched');
    await franchises('k-kofi', 8);
    expect(await standing('k-kofi')).toMatchObject({ counting: 1600, level: 'Root', next: { level: 'Fruit', pointsToGo: 0, alsoNeeds: ['a building activity'] } });
    const built = await t.act('k-kofi', 'build.translation_approved', AT, 'tr1', { item: 'piece-1' });
    expect(built.level).toBe('Fruit');
  });

  it('needs points from three quest lines for Seedkeeper', async () => {
    await t.person('k-kofi', 'vouched');
    await franchises('k-kofi', 25);
    await t.act('k-kofi', 'build.translation_approved', AT, 'tr1', { item: 'piece-1' });
    expect(await standing('k-kofi')).toMatchObject({ level: 'Fruit', next: { level: 'Seedkeeper', pointsToGo: 0, alsoNeeds: ['points from 3 quest lines'] } });
    expect((await t.act('k-kofi', 'picture.look', AT, 'look')).level).toBe('Seedkeeper');
  });

  it('counts local points up to a quarter of what counts', async () => {
    await t.call('POST', '/v1/quests', {
      id: 'local.tomato', title: 'The tomato challenge', questLine: 'local', template: 'steps', trustNeeded: 'joined',
      steps: [{ kind: 'tomato.planted', points: 20 }, { kind: 'tomato.harvested', points: 50 }],
    }, ADMIN);
    await t.call('POST', '/v1/quests/local.tomato/live', undefined, ADMIN);
    await t.person('k-amina');
    await t.act('k-amina', 'offer.saved', AT, 'o1'); // 20 core
    await t.act('k-amina', 'tomato.planted', '2099-01-01T09:00:00Z', 'p1');
    await t.act('k-amina', 'tomato.harvested', '2099-01-02T09:00:00Z', 'h1'); // 70 local
    expect(await standing('k-amina')).toMatchObject({ total: 90, counting: 26 }); // 20 + 6: local ≤ a quarter of 26
  });

  it('counts up to 400 when both caps hold: 100 core, 200 of the invites, 100 of the local points', async () => {
    await t.call('POST', '/v1/quests', {
      id: 'local.tomato', title: 'The tomato challenge', questLine: 'local', template: 'steps', trustNeeded: 'joined',
      steps: [{ kind: 'tomato.planted', points: 20 }, { kind: 'tomato.checked_in', points: 50 }, { kind: 'tomato.harvested', points: 50 }],
    }, ADMIN);
    await t.call('POST', '/v1/quests/local.tomato/live', undefined, ADMIN);
    await t.person('k-kofi', 'vouched');
    for (const [k, extra] of [['offer.saved', {}], ['share.card_first', {}], ['picture.look', {}], ['business.page_completed', { item: 'page-1' }]] as const) {
      await t.act('k-kofi', k, AT, k, extra);
    } // 20 + 20 + 10 + 50 = 100 core
    for (let i = 0; i < 10; i++) await t.act('k-kofi', 'invite.shop_live', AT, `shop${i}`, { item: `shop-${i}` }); // 250 invite
    for (const k of ['tomato.planted', 'tomato.checked_in', 'tomato.harvested']) await t.act('k-kofi', k, '2099-01-01T09:00:00Z', k); // 120 local
    expect(await standing('k-kofi')).toMatchObject({ total: 470, counting: 400, level: 'Root' });
  });

  it('keeps climbing from a level already reached, even after trust drops', async () => {
    await t.person('k-kofi', 'vouched');
    await franchises('k-kofi', 2);
    expect((await standing('k-kofi')).level).toBe('Root');
    await t.person('k-kofi', 'joined');
    for (let i = 0; i < 22; i++) await t.act('k-kofi', 'business.course_completed', AT, `c${i}`, { item: `course-${i}` }); // joined may: 400 + 1,100
    const built = await t.act('k-kofi', 'build.translation_approved', AT, 'tr1', { item: 'piece-1' });
    expect(built.level).toBe('Fruit');
  });

  it('never lowers a level, and shows the date each was first reached', async () => {
    await t.person('k-kofi', 'vouched');
    await franchises('k-kofi', 2);
    const s = await standing('k-kofi');
    expect(s.level).toBe('Root');
    expect(s.levels.map((l: any) => l.level)).toEqual(['Seed', 'Sprout', 'Root']);
    expect(Date.parse(s.levels[2].reachedAt)).not.toBeNaN();

    await t.person('k-kofi', 'joined'); // trust drops
    expect(await standing('k-kofi')).toMatchObject({ level: 'Root', levels: s.levels });
  });

  it('shows the best streak', async () => {
    await t.person('k-amina');
    const week = (n: number) => new Date(Date.now() - (5 - n) * 7 * 86_400_000).toISOString();
    for (const n of [1, 2, 3]) await t.act('k-amina', 'need.shopping_list', week(n), `s${n}`);
    expect(await standing('k-amina')).toMatchObject({ bestStreak: 3 });
  });
});
