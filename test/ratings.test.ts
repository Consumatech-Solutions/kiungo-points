import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, setup } from './helpers';

const AT = '2026-10-26T09:00:00Z';
const RATE = 'rating.verified';
const COMMENT = 'rating.commented';

describe('T-16 rating with a written comment', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
    t.setNow('2026-10-26T10:00:00Z');
    await t.person('k-amina');
  });

  const rate = (sale: string, key: string) => t.act('k-amina', RATE, AT, key, { item: sale, evidence: sale });
  const comment = (sale: string, key: string) => t.act('k-amina', COMMENT, AT, key, { item: sale, evidence: sale });

  it('pays 10 for a verified rating with a written comment: 5 and 5', async () => {
    expect((await rate('sale-881', 'r1')).awards).toEqual([{ quest: RATE, points: 5 }]);
    const withComment = await comment('sale-881', 'c1');
    expect(withComment.awards).toEqual([{ quest: COMMENT, points: 5 }]);
    expect(withComment.total).toBe(10);
  });


  it('pays nothing for a comment on a sale code with no verified rating, or a second comment on the same one', async () => {
    expect((await comment('sale-999', 'c0')).notAwarded).toEqual([{ quest: COMMENT, reason: 'needs_earlier_quest' }]);
    await rate('sale-881', 'r1');
    await comment('sale-881', 'c1');
    expect((await comment('sale-881', 'c2')).notAwarded).toEqual([{ quest: COMMENT, reason: 'already_done' }]);
  });

  it('pays the comment after a rating that paid, even if it came in a later week', async () => {
    await rate('sale-881', 'r1');
    t.setNow('2026-11-04T10:00:00Z');
    expect((await t.act('k-amina', COMMENT, '2026-11-04T09:00:00Z', 'c1', { item: 'sale-881', evidence: 'sale-881' })).awards)
      .toEqual([{ quest: COMMENT, points: 5 }]);
  });

  it('needs the sale code on the comment, as on the rating', async () => {
    await rate('sale-881', 'r1');
    expect((await t.act('k-amina', COMMENT, AT, 'c1', { item: 'sale-881' })).notAwarded).toEqual([{ quest: COMMENT, reason: 'missing_evidence' }]);
  });

  it('pays nothing for a comment that arrives before its rating', async () => {
    expect((await comment('sale-881', 'c1')).notAwarded).toEqual([{ quest: COMMENT, reason: 'needs_earlier_quest' }]);
    await rate('sale-881', 'r1');
    expect((await comment('sale-881', 'c2')).awards).toEqual([{ quest: COMMENT, points: 5 }]); // sent again after: it pays
  });

  it('pays nothing for the comment on a rating past its weekly limit, which paid nothing', async () => {
    for (let i = 0; i < 5; i++) await rate(`sale-${i}`, `r${i}`);
    expect((await rate('sale-5', 'r5')).notAwarded).toEqual([{ quest: RATE, reason: 'weekly_limit' }]);
    expect((await comment('sale-5', 'c5')).notAwarded).toEqual([{ quest: COMMENT, reason: 'needs_earlier_quest' }]);
  });

  it('pays nothing for a comment on a rating whose points were corrected away', async () => {
    await rate('sale-881', 'r1');
    const [line] = ((await t.call('GET', '/v1/people/k-amina/awards')).json.data as any[]).filter((l) => l.quest === RATE);
    await t.call('POST', '/v1/corrections', { award: line.id, reason: 'fake sale code' }, ADMIN);
    expect((await comment('sale-881', 'c1')).notAwarded).toEqual([{ quest: COMMENT, reason: 'needs_earlier_quest' }]);
  });

  it('refuses a quest that follows one that does not exist, or is not paid once per item', async () => {
    const draft = (after: string) => t.call('POST', '/v1/quests', {
      id: 'local.thanks', title: 'Thank your shop', questLine: 'local', template: 'repeat', watches: ['local.thanks'],
      target: 1, period: 'once', eachItem: 'ever', after, points: 5, trustNeeded: 'joined',
    }, ADMIN);
    expect((await draft('nobody.here')).json.error.message).toMatch(/no quest nobody.here/);
    expect((await draft('need.shopping_list')).json.error.message).toMatch(/isn't paid once per item/);
  });
});
