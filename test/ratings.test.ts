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

  const paidComments = async (id = 'k-amina') =>
    ((await t.call('GET', `/v1/people/${id}/awards`)).json.data as { quest: string; points: number; entry: string }[]).filter((l) => l.quest === COMMENT && l.points > 0);

  it('pays a comment that arrived before its rating as soon as the rating pays', async () => {
    const early = await comment('sale-881', 'c1');
    expect(early.notAwarded).toEqual([{ quest: COMMENT, reason: 'needs_earlier_quest' }]);
    const rated = await rate('sale-881', 'r1');
    expect(rated.awards).toEqual([{ quest: RATE, points: 5 }]);
    expect(rated.total).toBe(10);
    expect((await paidComments()).map((l) => ({ points: l.points, entry: l.entry }))).toEqual([{ points: 5, entry: early.entry }]);
  });

  it('pays the waiting comment once, even if it is sent again', async () => {
    await comment('sale-881', 'c1');
    await rate('sale-881', 'r1');
    expect((await comment('sale-881', 'c2')).notAwarded).toEqual([{ quest: COMMENT, reason: 'already_done' }]);
    const again = await comment('sale-881', 'c1'); // the same entry delivered again
    expect(again.awards).toEqual([{ quest: COMMENT, points: 5 }]);
    expect(again.notAwarded).toEqual([]);
    expect(again.total).toBe(10);
  });

  it('pays only one of two comments waiting on the same sale code', async () => {
    await comment('sale-881', 'c1');
    await comment('sale-881', 'c2');
    expect((await rate('sale-881', 'r1')).total).toBe(10);
    expect(await paidComments()).toHaveLength(1);
  });

  it("never pays another member's waiting comment", async () => {
    await t.person('k-kofi');
    await t.act('k-kofi', COMMENT, AT, 'k-c1', { item: 'sale-881', evidence: 'sale-881' });
    await rate('sale-881', 'r1');
    expect(await paidComments('k-kofi')).toEqual([]);
  });

  it('keeps a comment waiting when its rating earns nothing', async () => {
    for (let i = 0; i < 5; i++) await rate(`sale-${i}`, `r${i}`);
    await comment('sale-5', 'c5');
    expect((await rate('sale-5', 'r5')).notAwarded).toEqual([{ quest: RATE, reason: 'weekly_limit' }]);
    expect(await paidComments()).toEqual([]);
  });

  // A smoke test: PGlite runs one transaction at a time, so this can't race; on PostgreSQL the shared lock decides.
  it('pays a comment and its rating arriving at once (smoke test)', async () => {
    await Promise.all([comment('sale-881', 'c1'), rate('sale-881', 'r1')]);
    expect((await t.call('GET', '/v1/people/k-amina/standing')).json.data.total).toBe(10);
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
