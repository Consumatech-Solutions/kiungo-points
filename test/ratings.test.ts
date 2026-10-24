import { beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers';

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

  it('pays 5 for a verified rating without a comment', async () => {
    expect((await rate('sale-882', 'r1')).total).toBe(5);
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

  it('never pays for buying', async () => {
    expect((await t.act('k-amina', 'purchase.made', AT, 'buy1')).notAwarded).toEqual([{ quest: null, reason: 'never_earns' }]);
  });
});
