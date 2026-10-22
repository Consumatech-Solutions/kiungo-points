import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, setup } from './helpers';

const AT = '2026-10-20T09:00:00+01:00';

describe('T-04 trust and never-earns', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
    await t.person('k-amina', 'joined');
    await t.person('k-kofi', 'vouched');
  });

  it('gives a joined person reviewing a translation 0, "needs vouched"; a vouched person 15', async () => {
    const joined = await t.act('k-amina', 'build.translation_reviewed', AT, 'r1', { item: 'piece-7' });
    expect(joined.awards).toEqual([]);
    expect(joined.notAwarded).toEqual([{ quest: 'build.translation_reviewed', reason: 'needs_vouched' }]);
    expect(joined.total).toBe(0);

    const vouched = await t.act('k-kofi', 'build.translation_reviewed', AT, 'r2', { item: 'piece-7' });
    expect(vouched.awards).toEqual([{ quest: 'build.translation_reviewed', points: 15 }]);
  });

  it('needs verified to take up the role of an agent', async () => {
    const res = await t.act('k-kofi', 'business.agent_active', AT, 'a1', { item: 'agent-1' });
    expect(res.notAwarded).toEqual([{ quest: 'business.agent_active', reason: 'needs_verified' }]);
  });

  it('gives a vouch 0, "never earns", and the same answer when delivered again', async () => {
    const vouch = await t.act('k-kofi', 'vouch.given', AT, 'v1', { item: 'k-amina' });
    expect(vouch.awards).toEqual([]);
    expect(vouch.notAwarded).toEqual([{ quest: null, reason: 'never_earns' }]);
    expect(vouch.total).toBe(0);
    expect(await t.act('k-kofi', 'vouch.given', AT, 'v1', { item: 'k-amina' })).toEqual(vouch);
  });

  it('never pays for paying money or buying anything', async () => {
    expect((await t.act('k-amina', 'payment.sent', AT, 'pay1')).notAwarded).toEqual([{ quest: null, reason: 'never_earns' }]);
    expect((await t.act('k-amina', 'purchase.made', AT, 'buy1')).notAwarded).toEqual([{ quest: null, reason: 'never_earns' }]);
  });

  it('leaves no progress behind when trust is too low, so the same piece pays once the member is vouched', async () => {
    await t.act('k-amina', 'build.translation_reviewed', AT, 'r1', { item: 'piece-7' });
    await t.person('k-amina', 'vouched');
    expect((await t.act('k-amina', 'build.translation_reviewed', AT, 'r2', { item: 'piece-7' })).awards)
      .toEqual([{ quest: 'build.translation_reviewed', points: 15 }]);
  });

  it('refuses photo evidence until local challenges can have photos confirmed', async () => {
    const res = await t.call('POST', '/v1/quests', {
      id: 'build.photo', title: 'Test', questLine: 'building', template: 'repeat', watches: ['build.photo'],
      target: 1, period: 'weekly', limit: 1, points: 5, trustNeeded: 'joined', evidence: 'photo',
    }, ADMIN);
    expect(res.status).toBe(400);
  });

  it('refuses a Testify rating without a sale code, pays one with it, once per sale code', async () => {
    const without = await t.act('k-amina', 'rating.verified', AT, 't1', { item: 'sale-881' });
    expect(without.notAwarded).toEqual([{ quest: 'rating.verified', reason: 'missing_evidence' }]);
    expect(without.total).toBe(0);

    const withCode = await t.act('k-amina', 'rating.verified', AT, 't2', { item: 'sale-881', evidence: 'sale-881' });
    expect(withCode.awards).toEqual([{ quest: 'rating.verified', points: 5 }]);
    const again = await t.act('k-amina', 'rating.verified', AT, 't3', { item: 'sale-881', evidence: 'sale-881' });
    expect(again.notAwarded).toEqual([{ quest: 'rating.verified', reason: 'already_done' }]);
  });

  it('refuses to draft a quest that pays for vouching, paying or buying', async () => {
    for (const kind of ['vouch.given', 'payment.sent', 'purchase.made']) {
      const res = await t.call('POST', '/v1/quests', {
        id: 'build.test', title: 'Test', questLine: 'building', template: 'repeat', watches: [kind],
        target: 1, period: 'weekly', limit: 1, points: 5, trustNeeded: 'joined',
      }, ADMIN);
      expect(res.status).toBe(400);
      expect(res.json.error.message).toMatch(/never earns/);
    }
  });

  it('shows on the board which quests need evidence', async () => {
    const board = (await t.call('GET', '/v1/quests')).json.data as any[];
    expect(board.find((q) => q.quest === 'rating.verified')).toMatchObject({ evidence: 'sale_code' });
    expect(board.find((q) => q.quest === 'rating.perception')).toMatchObject({ evidence: null });
  });
});
