import { beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers';

// Week 2026-W44: Monday 26 October to Sunday 1 November, after lessons started earning (24 October 2026).
const day = (d: number, h = 9) => new Date(Date.UTC(2026, 9, 26 + d, h)).toISOString();
const LESSON = 'business.lesson_completed';

describe('T-15 academy lessons', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
    t.setNow('2026-11-02T12:00:00Z');
  });

  it('pays 5 for each lesson, up to ten a week, then 0 with "weekly limit"', async () => {
    await t.person('k-amina');
    for (let i = 0; i < 10; i++) {
      expect((await t.act('k-amina', LESSON, day(i % 6), `l${i}`, { item: `lesson-${i}` })).awards).toEqual([{ quest: LESSON, points: 5 }]);
    }
    const eleventh = await t.act('k-amina', LESSON, day(6), 'l10', { item: 'lesson-10' });
    expect(eleventh.notAwarded).toEqual([{ quest: LESSON, reason: 'weekly_limit' }]);
    expect(eleventh.total).toBe(50);
  });

  it('pays a lesson once, however often it is done', async () => {
    await t.person('k-amina');
    await t.act('k-amina', LESSON, day(0), 'l1', { item: 'lesson-7' });
    t.setNow('2026-11-10T12:00:00Z');
    const again = await t.act('k-amina', LESSON, '2026-11-09T09:00:00Z', 'l2', { item: 'lesson-7' }); // a week later
    expect(again.notAwarded).toEqual([{ quest: LESSON, reason: 'already_done' }]);
  });

  it('counts a completed academy course as a building activity for Fruit', async () => {
    await t.person('k-kofi', 'vouched');
    for (let i = 0; i < 8; i++) await t.act('k-kofi', 'business.franchise_launched', day(0), `fr${i}`, { item: `fr-${i}` });
    expect((await t.call('GET', '/v1/people/k-kofi/standing')).json.data).toMatchObject({ level: 'Root', next: { alsoNeeds: ['a building activity'] } });
    const course = await t.act('k-kofi', 'business.course_completed', day(1), 'c1', { item: 'course-1' });
    expect(course.awards).toEqual([{ quest: 'business.course_completed', points: 50 }]); // unchanged
    expect(course.level).toBe('Fruit');
  });

  it('keeps the course, on-time and franchise points as they were', async () => {
    const board = (await t.call('GET', '/v1/quests')).json.data as any[];
    const points = Object.fromEntries(board.map((q) => [q.quest, q.points]));
    expect([points['business.course_completed'], points['business.course_on_time'], points['business.franchise_launched'], points[LESSON]])
      .toEqual([50, 25, 200, 5]);
  });
});
