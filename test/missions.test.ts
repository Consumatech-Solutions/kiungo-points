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
  const total = async (id: string) => (await t.call('GET', `/v1/people/${id}/standing`)).json.data.total;
  const bonuses = () => t.db.query('SELECT kiungo_id, points FROM awards WHERE quest_id = $1 ORDER BY kiungo_id', [MISSION]);

  it('pays 20 to each contributor when Matete\'s 100th list arrives, once', async () => {
    for (const id of PEOPLE.slice(0, 3)) await lists(id, 25, 1);
    await lists('k-dede', 24, 1);
    const before = await bonuses();
    expect(before).toEqual([]);
    const hundredth = await lists('k-dede', 1, 28);
    expect(missionAwards(hundredth)).toEqual([{ quest: MISSION, points: 20, step: '2099-03' }]);
    expect(await bonuses()).toEqual(PEOPLE.map((kiungo_id) => ({ kiungo_id, points: 20 })));
    expect(missionAwards(await lists('k-amina', 1, 28))).toEqual([]); // the 101st pays nothing more

    const unit = (await t.call('GET', '/v1/units/matete/quests')).json.data;
    expect(unit).toEqual([expect.objectContaining({ quest: MISSION, period: '2099-03', progress: 101, target: 100, done: true })]);
  });

  it('counts only members of the unit', async () => {
    await lists('k-outsider', 3, 1);
    const unit = (await t.call('GET', '/v1/units/matete/quests')).json.data;
    expect(unit[0]).toMatchObject({ progress: 0, done: false });
  });

  // PGlite runs one transaction at a time, so this checks the answer; on PostgreSQL the counter's row lock does the work.
  it('pays each contributor once when the last two lists arrive at the same moment', async () => {
    for (const id of PEOPLE) await lists(id, 24, 1); // 96
    await lists('k-amina', 2, 26); // 98
    const before = await Promise.all(PEOPLE.map(total));
    t.setNow(day(27));
    await Promise.all([
      t.act('k-baraka', 'need.shopping_list', day(27), 'last-a'),
      t.act('k-chausiku', 'need.shopping_list', day(27), 'last-b'),
      t.act('k-dede', 'need.shopping_list', day(27), 'last-c'),
    ]);
    const after = await Promise.all(PEOPLE.map(total));
    const gained = after.map((a, i) => a - before[i]!);
    expect(gained.filter((g) => g >= 20)).toHaveLength(4); // everyone got the bonus
    const awards = await t.db.query('SELECT kiungo_id FROM awards WHERE quest_id = $1', [MISSION]);
    expect(awards).toHaveLength(4); // and only once each
  });

  it('refuses a mission with no unit, or with a target below 2', async () => {
    const base = { id: 'm.test', title: 'Test', questLine: 'local', template: 'mission', watches: ['need.shopping_list'], period: 'monthly', points: 20, trustNeeded: 'joined' };
    expect((await t.call('POST', '/v1/quests', { ...base, target: 100 }, ADMIN)).status).toBe(400);
    expect((await t.call('POST', '/v1/quests', { ...base, unit: 'matete', target: 1 }, ADMIN)).json.error.message).toMatch(/at least 2/);
  });

  it('keeps unit missions off the core board', async () => {
    const board = (await t.call('GET', '/v1/quests')).json.data as any[];
    expect(board.some((q) => q.quest === MISSION)).toBe(false);
  });
});
