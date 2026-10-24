import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, setup } from './helpers';

// A month after the mission goes live; each entry is read as it happens.
const day = (d: number, h = 9) => new Date(Date.UTC(2099, 2, d, h)).toISOString();
const MISSION = 'matete.lists_march';
const PEOPLE = ['k-amina', 'k-baraka', 'k-chausiku', 'k-dede'];

describe('T-08 missions', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
    for (const id of PEOPLE) await t.person(id, 'joined', 'Africa/Kinshasa', ['kiungo-points', 'kiungo.test'], ['matete']);
    await t.person('k-outsider');
    const draft = await t.call('POST', '/v1/quests', {
      id: MISSION, title: '100 shopping lists in Matete this month', questLine: 'local', template: 'mission',
      unit: 'matete', watches: ['need.shopping_list'], target: 100, period: 'monthly', points: 20, trustNeeded: 'joined',
    }, ADMIN);
    expect(draft.status).toBe(201);
    await t.call('POST', `/v1/quests/${MISSION}/live`, undefined, ADMIN);
  });

  // Each person shares `n` lists, one a day from `from`.
  const lists = async (id: string, n: number, from: number) => {
    let last: any;
    for (let i = 0; i < n; i++) {
      t.setNow(day(from + (i % 28)));
      last = await t.act(id, 'need.shopping_list', day(from + (i % 28)), `${id}-${from}-${i}`);
    }
    return last;
  };
  const missionAwards = (r: any) => r.awards.filter((a: any) => a.quest === MISSION);
  // Each person's mission lines, as their own history shows them.
  const linesOf = async (id: string) =>
    ((await t.call('GET', `/v1/people/${id}/awards?limit=100`)).json.data as any[]).filter((l) => l.quest === MISSION);
  const bonuses = async () => (await Promise.all(PEOPLE.map(async (id) => ({ id, points: (await linesOf(id)).map((l) => l.points) })))).filter((b) => b.points.length);
  const unitMission = async () => (await t.call('GET', '/v1/units/matete/standing')).json.data.quests[0];

  it('pays 20 to each contributor when Matete\'s 100th list arrives, once', async () => {
    for (const id of PEOPLE.slice(0, 3)) await lists(id, 25, 1);
    await lists('k-dede', 24, 1);
    const before = await bonuses();
    expect(before).toEqual([]);
    const hundredth = await lists('k-dede', 1, 28);
    expect(missionAwards(hundredth)).toEqual([{ quest: MISSION, points: 20, step: '2099-03' }]);
    expect(await bonuses()).toEqual(PEOPLE.map((id) => ({ id, points: [20] })));
    expect((await linesOf('k-amina'))[0]).toMatchObject({ entry: null, step: '2099-03' }); // no one else's entry shown
    expect((await linesOf('k-dede'))[0].entry).toBe('kiungo.test:k-dede-28-0');
    expect(missionAwards(await lists('k-amina', 1, 28))).toEqual([]); // the 101st pays nothing more
    t.setNow(day(28, 10));
    expect(missionAwards(await t.act('k-dede', 'need.shopping_list', day(28), 'k-dede-28-0'))).toEqual(hundredth.awards.filter((a: any) => a.quest === MISSION)); // redelivered: same answer

    const mission = await unitMission();
    expect(mission).toMatchObject({ quest: MISSION, period: '2099-03', stage: 4, done: true });
    expect(mission.progress).toBeUndefined(); // stages, never the raw count
  });

  it('counts only members of the unit', async () => {
    await lists('k-outsider', 3, 1);
    expect(await unitMission()).toMatchObject({ stage: 0, done: false });
  });

  // PGlite runs one transaction at a time, so this checks the answer; on PostgreSQL the counter's row lock does the work.
  it('pays each contributor once when the last two lists arrive at the same moment', async () => {
    for (const id of PEOPLE) await lists(id, 24, 1); // 96
    await lists('k-amina', 2, 26); // 98
    t.setNow(day(27));
    await Promise.all([
      t.act('k-baraka', 'need.shopping_list', day(27), 'last-a'),
      t.act('k-chausiku', 'need.shopping_list', day(27), 'last-b'),
      t.act('k-dede', 'need.shopping_list', day(27), 'last-c'),
    ]);
    expect(await bonuses()).toEqual(PEOPLE.map((id) => ({ id, points: [20] }))); // everyone, once each
  });

  it('refuses a mission with no unit, or with a target below 2', async () => {
    const base = { id: 'm.test', title: 'Test', questLine: 'local', template: 'mission', watches: ['need.shopping_list'], period: 'monthly', points: 20, trustNeeded: 'joined' };
    expect((await t.call('POST', '/v1/quests', { ...base, target: 100 }, ADMIN)).status).toBe(400);
    expect((await t.call('POST', '/v1/quests', { ...base, unit: 'matete', target: 1 }, ADMIN)).json.error.message).toMatch(/at least 2/);
  });

  it('pays nothing to a member who first contributes after the goal is reached', async () => {
    for (const id of PEOPLE) await lists(id, 25, 1); // 100: paid
    await t.person('k-eve', 'joined', 'Africa/Kinshasa', undefined, ['matete']);
    expect(missionAwards(await lists('k-eve', 1, 28))).toEqual([]);
    expect(await linesOf('k-eve')).toEqual([]);
  });

  it('shows the stage a quarter at a time', async () => {
    await lists('k-amina', 25, 1);
    expect(await unitMission()).toMatchObject({ stage: 1, done: false });
    await lists('k-baraka', 50, 1);
    expect(await unitMission()).toMatchObject({ stage: 3, done: false }); // 75 of 100
  });

  it('counts only entries read within 14 days of when they happened', async () => {
    t.setNow(day(20));
    const late = await t.act('k-amina', 'need.shopping_list', day(5), 'late');
    expect(late.notAwarded).toContainEqual({ quest: MISSION, reason: 'too_late' });
    expect(await unitMission()).toMatchObject({ stage: 0 });
  });

  it('keeps missions local: no other quest line, no building, no evidence', async () => {
    const base = { id: 'matete.m2', title: 'Test', template: 'mission', unit: 'matete', watches: ['need.shopping_list'], target: 10, period: 'monthly', points: 20, trustNeeded: 'joined' };
    expect((await t.call('POST', '/v1/quests', { ...base, questLine: 'needs' }, ADMIN)).status).toBe(400);
    expect((await t.call('POST', '/v1/quests', { ...base, questLine: 'local', building: true }, ADMIN)).status).toBe(400);
    expect((await t.call('POST', '/v1/quests', { ...base, questLine: 'local', evidence: 'sale_code' }, ADMIN)).status).toBe(400);
  });

  it('keeps unit missions off the core board', async () => {
    const board = (await t.call('GET', '/v1/quests')).json.data as any[];
    expect(board.some((q) => q.quest === MISSION)).toBe(false);
  });
});
