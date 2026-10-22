import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, setup } from './helpers';

// Week 2026-W43 runs Monday 19 to Sunday 25 October, in Kinshasa time (UTC+1).
const TUE = '2026-10-20T09:00:00+01:00';
const WED = '2026-10-21T09:00:00+01:00';
const THU = '2026-10-22T09:00:00+01:00';
const SUN_LATE_UTC = '2026-10-25T22:30:00Z'; // 23:30 Sunday in Kinshasa: still W43
const MON_KINSHASA = '2026-10-25T23:30:00Z'; // 00:30 Monday 26 October in Kinshasa: W44

const SECTIONS = [
  'identity.phone_confirmed', 'picture.name', 'picture.look', 'picture.privacy', 'picture.age_range', 'picture.from',
  'picture.lives', 'picture.languages', 'picture.household', 'picture.work', 'picture.joining_as', 'unit.joined',
];

describe('T-03 progress and limits', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
    await t.person('k-amina');
  });

  it('pays two shopping lists a week, then 0 with "weekly limit", and again from Monday in Kinshasa', async () => {
    expect((await t.act('k-amina', 'need.shopping_list', TUE, 's1')).awards).toEqual([{ quest: 'need.shopping_list', points: 10 }]);
    expect((await t.act('k-amina', 'need.shopping_list', WED, 's2')).awards).toEqual([{ quest: 'need.shopping_list', points: 10 }]);
    const third = await t.act('k-amina', 'need.shopping_list', SUN_LATE_UTC, 's3');
    expect(third.awards).toEqual([]);
    expect(third.notAwarded).toEqual([{ quest: 'need.shopping_list', reason: 'weekly_limit' }]);
    expect(third.total).toBe(20);

    const monday = await t.act('k-amina', 'need.shopping_list', MON_KINSHASA, 's4');
    expect(monday.awards).toEqual([{ quest: 'need.shopping_list', points: 10 }]);
    expect(monday.total).toBe(30);
  });

  it('gives a redelivered entry the same answer, limit included', async () => {
    await t.act('k-amina', 'need.bought_week', TUE, 'b1');
    const second = await t.act('k-amina', 'need.bought_week', WED, 'b2');
    const again = await t.act('k-amina', 'need.bought_week', WED, 'b2');
    expect(again.notAwarded).toEqual([{ quest: 'need.bought_week', reason: 'weekly_limit' }]);
    expect(again).toEqual(second);
  });

  it('pays the 25-point bonus once, when all twelve picture sections are filled', async () => {
    let last: any;
    for (const [i, kind] of SECTIONS.entries()) last = await t.act('k-amina', kind, TUE, `p${i}`, { item: 'unit-1' });
    expect(last.awards).toEqual([{ quest: 'unit.joined', points: 10 }, { quest: 'picture.complete', points: 25 }].sort((a, b) => a.quest.localeCompare(b.quest)));
    expect(last.total).toBe(115); // activities.md: "your whole picture is 115"
    expect(last.level).toBe('Sprout');

    const anotherUnit = await t.act('k-amina', 'unit.joined', WED, 'p-again', { item: 'unit-2' });
    expect(anotherUnit.awards).toEqual([{ quest: 'unit.joined', points: 10 }]); // once per unit; no second bonus
    expect(anotherUnit.total).toBe(125);
  });

  it('pays each survey once, and asks for the item when it is missing', async () => {
    expect((await t.act('k-amina', 'need.survey', TUE, 'v1', { item: 'school-term' })).awards).toEqual([{ quest: 'need.survey', points: 15 }]);
    expect((await t.act('k-amina', 'need.survey', WED, 'v2', { item: 'clinic' })).awards).toEqual([{ quest: 'need.survey', points: 15 }]);
    expect((await t.act('k-amina', 'need.survey', THU, 'v3', { item: 'school-term' })).notAwarded)
      .toEqual([{ quest: 'need.survey', reason: 'already_done' }]);
    expect((await t.act('k-amina', 'need.survey', THU, 'v4')).notAwarded).toEqual([{ quest: 'need.survey', reason: 'missing_item' }]);
  });

  it('pays each service once every quarter', async () => {
    const pays = async (key: string, at: string, item: string) => (await t.act('k-amina', 'need.service_rated', at, key, { item })).awards.length;
    expect(await pays('r1', '2026-10-02T09:00:00Z', 'bank')).toBe(1);
    expect(await pays('r2', '2026-10-03T09:00:00Z', 'clinic')).toBe(1);
    expect(await pays('r3', '2026-12-30T09:00:00Z', 'bank')).toBe(0);
    expect(await pays('r4', '2027-01-02T09:00:00Z', 'bank')).toBe(1);
  });

  it('limits invites to three a day, each invited person once', async () => {
    const day = '2026-10-20T';
    for (const n of [1, 2, 3]) expect((await t.act('k-amina', 'invite.joined', `${day}0${n}:00:00Z`, `i${n}`, { item: `k-new${n}` })).awards).toHaveLength(1);
    expect((await t.act('k-amina', 'invite.joined', `${day}05:00:00Z`, 'i4', { item: 'k-new4' })).notAwarded)
      .toEqual([{ quest: 'invite.joined', reason: 'daily_limit' }]);
    expect((await t.act('k-amina', 'invite.joined', '2026-10-21T05:00:00Z', 'i5', { item: 'k-new1' })).notAwarded)
      .toEqual([{ quest: 'invite.joined', reason: 'already_done' }]);
  });

  it('runs a Steps challenge in order, with one check-in a week', async () => {
    await t.call('POST', '/v1/quests', {
      id: 'local.tomato', title: 'The tomato challenge', questLine: 'local', template: 'steps', trustNeeded: 'joined',
      steps: [
        { kind: 'tomato.planted', points: 20 },
        { kind: 'tomato.checked_in', points: 5, upTo: 4, period: 'weekly' },
        { kind: 'tomato.harvested', points: 50 },
      ],
    }, ADMIN);
    await t.call('POST', '/v1/quests/local.tomato/live', undefined, ADMIN);
    const at = new Date(Date.now() + 60_000).toISOString(); // after the quest went live

    expect((await t.act('k-amina', 'tomato.checked_in', at, 'c0')).notAwarded).toEqual([{ quest: 'local.tomato', reason: 'needs_earlier_step' }]);
    expect((await t.act('k-amina', 'tomato.planted', at, 'pl')).awards).toEqual([{ quest: 'local.tomato', points: 20, step: 'tomato.planted' }]);
    expect((await t.act('k-amina', 'tomato.checked_in', at, 'c1')).awards).toEqual([{ quest: 'local.tomato', points: 5, step: 'tomato.checked_in' }]);
    expect((await t.act('k-amina', 'tomato.checked_in', at, 'c2')).notAwarded).toEqual([{ quest: 'local.tomato', reason: 'weekly_limit' }]);
    expect((await t.act('k-amina', 'tomato.harvested', at, 'hv')).awards).toEqual([{ quest: 'local.tomato', points: 50, step: 'tomato.harvested' }]);

    const progress = (await t.call('GET', '/v1/people/k-amina/quests')).json.data;
    expect(progress).toContainEqual(expect.objectContaining({ quest: 'local.tomato', progress: 3, target: 3 }));
  });

  it('pays only one of two entries that arrive at once for the last place', async () => {
    await t.act('k-amina', 'need.shopping_list', TUE, 's1');
    const [a, b] = await Promise.all([
      t.act('k-amina', 'need.shopping_list', WED, 's2'),
      t.act('k-amina', 'need.shopping_list', THU, 's3'),
    ]);
    expect(a.awards.length + b.awards.length).toBe(1);
    expect((await t.call('GET', '/v1/people/k-amina/standing')).json.data.total).toBe(20);
  });

  it('shows the member\'s progress on each quest they have touched', async () => {
    await t.act('k-amina', 'need.shopping_list', TUE, 's1');
    await t.act('k-amina', 'need.shopping_list', WED, 's2');
    await t.act('k-amina', 'picture.look', WED, 'l1');
    const res = await t.call('GET', '/v1/people/k-amina/quests');
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual(expect.arrayContaining([
      { quest: 'need.shopping_list', period: '2026-W43', progress: 2, target: 2 },
      { quest: 'picture.look', period: 'once', progress: 1, target: 1 },
      { quest: 'picture.complete', period: 'once', progress: 1, target: 12 },
    ]));
  });

  it('refuses a stand-in person with a time zone that does not exist', async () => {
    const res = await t.person('k-x', 'joined', 'Mars/Olympus');
    expect(res.status).toBe(400);
  });
});
