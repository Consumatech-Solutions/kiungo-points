import { beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers';

// Week n counts back from this week (week 20), so the latest run is current today.
const NOW = Date.now();
const week = (n: number) => new Date(NOW - (20 - n) * 7 * 86_400_000).toISOString();
const STREAK = 'streak.need_weekly';
const streakAwards = (r: any) => r.awards.filter((a: any) => a.quest === STREAK);

describe('T-03b weekly streaks', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
    await t.person('k-amina');
  });

  const list = (n: number, key = `w${n}`) => t.act('k-amina', 'need.shopping_list', week(n), key);
  const streak = async () => ((await t.call('GET', '/v1/people/k-amina/quests')).json.data as any[]).find((q) => q.quest === STREAK);

  it('pays +20 after four weeks running', async () => {
    for (const n of [10, 11, 12]) expect(streakAwards(await list(n))).toEqual([]);
    expect(streakAwards(await list(13))).toEqual([{ quest: STREAK, points: 20, step: '4 weeks' }]);
    expect(await streak()).toMatchObject({ progress: 0, best: 4, target: 4 }); // weeks 10 to 13 are long gone
  });

  it('shows the run still going when the last week said is recent', async () => {
    for (const n of [17, 18, 19]) await list(n);
    expect(await streak()).toMatchObject({ progress: 3, best: 3, target: 4 });
  });

  it('forgives one missed week: the run carries on', async () => {
    for (const n of [10, 11, 12]) await list(n);
    expect(streakAwards(await list(14))).toEqual([{ quest: STREAK, points: 20, step: '4 weeks' }]); // week 13 missed
    expect(await streak()).toMatchObject({ best: 4 });
  });

  it('starts again after two missed weeks, takes nothing away, and keeps the best run', async () => {
    for (const n of [10, 11, 12, 13]) await list(n);
    const before = (await t.call('GET', '/v1/people/k-amina/standing')).json.data.total;
    const after = await list(16); // weeks 14 and 15 missed
    expect(streakAwards(after)).toEqual([]);
    expect(after.total).toBe(before + 10); // the shopping list only; nothing taken away
    expect(await streak()).toMatchObject({ best: 4 });
    expect((await list(19)).awards).toHaveLength(1); // weeks 16, (17, 18 missed) 19: a new run of 1 again
    expect(await streak()).toMatchObject({ progress: 1, best: 4 });
  });

  it('counts a week once, whatever is said in it', async () => {
    await list(18);
    await t.act('k-amina', 'need.bought_week', week(18), 'b18');
    for (const n of [19, 20]) await list(n);
    expect(await streak()).toMatchObject({ progress: 3, best: 3 });
  });

  it('pays each milestone once per run, even when a late entry joins two runs', async () => {
    for (const n of [10, 11, 12, 13]) await list(n); // +20 at week 13
    for (const n of [17, 18, 19, 20]) await list(n); // a second run: +20 again at week 20
    const late = await list(15, 'late'); // week 15 joins both runs into one of 9 weeks
    expect(streakAwards(late)).toEqual([]);
    expect(await streak()).toMatchObject({ progress: 9, best: 9 });
  });

  it('gives a redelivered streak entry the same answer', async () => {
    for (const n of [10, 11, 12]) await list(n);
    const first = await list(13);
    expect(await list(13)).toEqual(first);
  });

  it('does not count a survey refused for a missing reference', async () => {
    await t.act('k-amina', 'need.survey', week(20), 'v-no-item');
    expect(await streak()).toBeUndefined();
  });

  it('pays the next milestone when a late week joins two runs into one', async () => {
    for (let n = 1; n <= 5; n++) await list(n);      // a run of 5: +20
    for (let n = 8; n <= 14; n++) await list(n);     // weeks 6 and 7 missed: a new run of 7, +20
    const late = await list(7, 'late');              // joins them: 13 weeks, so +50 now; 4 weeks is not paid again
    expect(streakAwards(late)).toEqual([{ quest: STREAK, points: 50, step: '12 weeks' }]);
  });

  it('pays +50 at twelve weeks', async () => {
    let last: any;
    for (let n = 2; n <= 13; n++) last = await list(n);
    expect(streakAwards(last)).toEqual([{ quest: STREAK, points: 50, step: '12 weeks' }]);
  });
});
