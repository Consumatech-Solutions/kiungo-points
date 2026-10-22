import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, setup } from './helpers';

// Typed out by hand from activities.md, quest lines 1 to 7: [quest, points, period, limit per period, each item, trust].
const CORE: [string, number, string, number | null, string | null, string][] = [
  // 1. Your picture
  ['identity.phone_confirmed', 10, 'once', null, null, 'joined'],
  ['picture.name', 5, 'once', null, null, 'joined'],
  ['picture.look', 10, 'once', null, null, 'joined'],
  ['picture.privacy', 10, 'once', null, null, 'joined'],
  ['picture.age_range', 5, 'once', null, null, 'joined'],
  ['picture.from', 5, 'once', null, null, 'joined'],
  ['picture.lives', 10, 'once', null, null, 'joined'],
  ['picture.languages', 5, 'once', null, null, 'joined'],
  ['picture.household', 10, 'once', null, null, 'joined'],
  ['picture.work', 5, 'once', null, null, 'joined'],
  ['picture.joining_as', 5, 'once', null, null, 'joined'],
  ['unit.joined', 10, 'once', null, 'ever', 'joined'],
  ['picture.complete', 25, 'once', null, null, 'joined'],
  // 2. What you need
  ['need.shopping_list', 10, 'weekly', 2, null, 'joined'],
  ['need.bought_week', 10, 'weekly', 1, null, 'joined'],
  ['need.bought_month', 20, 'monthly', 1, null, 'joined'],
  ['need.service_rated', 10, 'quarterly', null, 'per_period', 'joined'],
  ['need.survey', 15, 'once', null, 'ever', 'joined'],
  ['need.close_to_home', 10, 'monthly', 1, null, 'joined'],
  ['need.community_question', 15, 'monthly', 1, null, 'joined'],
  // 3. What you can make, grow and supply
  ['offer.saved', 20, 'once', null, null, 'joined'],
  ['offer.updated', 5, 'quarterly', 1, null, 'joined'],
  ['offer.ready_now', 5, 'weekly', 2, null, 'joined'],
  // 4. Your business in Kiungo
  ['business.identity_opened', 100, 'once', null, 'ever', 'vouched'],
  ['business.page_completed', 50, 'once', null, 'ever', 'vouched'],
  ['business.shop_onboarded', 150, 'once', null, 'ever', 'vouched'],
  ['business.agent_active', 150, 'once', null, 'ever', 'verified'],
  ['business.course_completed', 50, 'once', null, 'ever', 'joined'],
  ['business.course_on_time', 25, 'once', null, 'ever', 'joined'],
  ['business.franchise_launched', 200, 'once', null, 'ever', 'vouched'],
  ['business.trading_month', 20, 'monthly', 1, null, 'vouched'],
  // 5. Bringing people in
  ['invite.joined', 10, 'daily', 3, 'ever', 'joined'],
  ['invite.sprout', 10, 'once', null, 'ever', 'joined'],
  ['invite.shop_live', 25, 'once', null, 'ever', 'vouched'],
  // 6. Spreading the word
  ['share.card_first', 20, 'once', null, null, 'joined'],
  ['share.level', 10, 'once', null, 'ever', 'joined'],
  ['share.post', 5, 'weekly', 2, null, 'joined'],
  // 7. Building Kiungo
  ['build.translation_approved', 30, 'once', null, 'ever', 'joined'],
  ['build.translation_reviewed', 15, 'once', null, 'ever', 'vouched'],
  ['build.consultation', 15, 'once', null, 'ever', 'joined'],
  ['build.idea_taken_up', 50, 'once', null, 'ever', 'joined'],
  ['build.mistake_fixed', 10, 'monthly', 5, 'ever', 'joined'],
  ['rating.verified', 5, 'weekly', 5, 'ever', 'joined'],
  ['rating.perception', 2, 'weekly', 10, null, 'joined'],
  ['unit.telegram_joined', 10, 'once', null, 'ever', 'joined'],
];

const tomato = {
  id: 'local.tomato', title: 'The tomato challenge', questLine: 'local', template: 'steps', trustNeeded: 'joined',
  steps: [
    { kind: 'tomato.planted', points: 20 },
    { kind: 'tomato.checked_in', points: 5, upTo: 4, period: 'weekly' },
    { kind: 'tomato.harvested', points: 50 },
  ],
};

describe('T-02 the quest board and templates', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { t = await setup(); });

  const board = async () => (await t.call('GET', '/v1/quests')).json.data as any[];

  it('lists every core quest with the points, limits and trust levels from activities.md', async () => {
    const live = await board();
    const shown = live
      .filter((q) => q.template !== 'streak')
      .map((q) => [q.quest, q.points, q.period, q.limit, q.eachItem, q.trustNeeded]);
    expect(shown).toEqual(expect.arrayContaining(CORE));
    expect(shown).toHaveLength(CORE.length);
  });

  it('counts the picture as complete when all twelve sections are answered', async () => {
    const complete = (await board()).find((q) => q.quest === 'picture.complete');
    expect(complete).toMatchObject({ template: 'collect', target: 12 });
    expect(complete.watches).toHaveLength(12);
  });

  it('refuses a draft with a target of 0', async () => {
    const res = await t.call('POST', '/v1/quests', {
      id: 'need.test', title: 'Test', questLine: 'needs', template: 'repeat', watches: ['need.test'],
      target: 0, period: 'weekly', limit: 1, points: 5, trustNeeded: 'joined',
    }, ADMIN);
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('invalid_quest');
    expect(res.json.error.message).toMatch(/target/);
  });

  it('refuses a Collect quest that asks for more different things than it watches', async () => {
    const res = await t.call('POST', '/v1/quests', {
      id: 'c.test', title: 'Test', questLine: 'picture', template: 'collect', watches: ['a', 'b'],
      target: 3, points: 5, trustNeeded: 'joined',
    }, ADMIN);
    expect(res.status).toBe(400);
    expect(res.json.error.message).toMatch(/2 different/);
  });

  it('refuses a Steps quest that repeats a step', async () => {
    const res = await t.call('POST', '/v1/quests', {
      ...tomato, steps: [{ kind: 'tomato.planted', points: 20 }, { kind: 'tomato.planted', points: 5 }],
    }, ADMIN);
    expect(res.status).toBe(400);
    expect(res.json.error.message).toMatch(/tomato\.planted/);
  });

  it('says the Mission template is not yet available', async () => {
    const res = await t.call('POST', '/v1/quests', {
      id: 'm.test', title: 'Test', questLine: 'local', template: 'mission', trustNeeded: 'joined',
    }, ADMIN);
    expect(res.status).toBe(400);
    expect(res.json.error.message).toMatch(/not yet available/);
  });

  it('keeps a draft off the board until it is put live, then shows it', async () => {
    const drafted = await t.call('POST', '/v1/quests', tomato, ADMIN);
    expect(drafted.status).toBe(201);
    expect(drafted.json.data).toMatchObject({ quest: 'local.tomato', version: 1, status: 'draft' });
    expect((await board()).some((q) => q.quest === 'local.tomato')).toBe(false);

    const live = await t.call('POST', '/v1/quests/local.tomato/live', undefined, ADMIN);
    expect(live.json.data).toMatchObject({ quest: 'local.tomato', status: 'live' });
    expect((await board()).find((q) => q.quest === 'local.tomato')).toMatchObject({ template: 'steps', steps: tomato.steps.map((s) => expect.objectContaining(s)) });
  });

  it('adds a new version without changing the live one until it goes live', async () => {
    const draft = await t.call('POST', '/v1/quests', {
      id: 'need.shopping_list', title: 'Share your shopping list', questLine: 'needs', template: 'repeat',
      watches: ['need.shopping_list'], target: 1, period: 'weekly', limit: 3, points: 10, trustNeeded: 'joined',
    }, ADMIN);
    expect(draft.json.data).toMatchObject({ version: 2, status: 'live' });
    expect((await board()).find((q) => q.quest === 'need.shopping_list')).toMatchObject({ version: 1, limit: 2 });

    await t.call('POST', '/v1/quests/need.shopping_list/live', undefined, ADMIN);
    expect((await board()).find((q) => q.quest === 'need.shopping_list')).toMatchObject({ version: 2, limit: 3 });
  });

  it('takes a paused quest off the board, and an ended quest cannot come back', async () => {
    await t.call('POST', '/v1/quests/share.post/pause', undefined, ADMIN);
    expect((await board()).some((q) => q.quest === 'share.post')).toBe(false);
    await t.call('POST', '/v1/quests/share.post/live', undefined, ADMIN);
    expect((await board()).some((q) => q.quest === 'share.post')).toBe(true);

    await t.call('POST', '/v1/quests/share.post/end', undefined, ADMIN);
    const again = await t.call('POST', '/v1/quests/share.post/live', undefined, ADMIN);
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('quest_ended');
  });

  it('needs the admin key to draft or change a quest', async () => {
    expect((await t.call('POST', '/v1/quests', tomato, 'not-admin')).status).toBe(401);
    expect((await t.call('POST', '/v1/quests/share.post/pause', undefined, 'not-admin')).status).toBe(401);
  });

  it('answers 404 for a quest that does not exist', async () => {
    const res = await t.call('POST', '/v1/quests/nope/live', undefined, ADMIN);
    expect(res.status).toBe(404);
  });
});
