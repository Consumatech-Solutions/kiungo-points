import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, CARRIAGE_KEY, setup } from './helpers';

const KASIPOS = 'kasipos-test-key-00000000000000000';
const TESTIFY = 'testify-test-key-00000000000000000';
const AT = '2026-10-20T09:00:00Z';

describe('T-06 carriages and permissions', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
    await t.call('POST', '/standin/carriages', { name: 'kasipos', key: KASIPOS, mayWrite: ['business.shop_onboarded'] }, ADMIN);
    await t.call('POST', '/standin/carriages', { name: 'testify', key: TESTIFY, mayWrite: ['rating.verified'] }, ADMIN);
    await t.person('k-amina', 'vouched', 'Africa/Kinshasa', ['kiungo-points', 'my.kiungo.africa']);
  });

  const write = (key: string, kind: string, k: string, extra = {}) =>
    t.call('POST', '/standin/activity', { kiungoId: 'k-amina', kind, occurredAt: AT, key: k, ...extra }, key);

  it('stops my.kiungo.africa writing a kasiPOS-only activity', async () => {
    const res = await write(CARRIAGE_KEY, 'business.shop_onboarded', 's1', { item: 'shop-1' });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('not_allowed_for_carriage');
    expect((await write(KASIPOS, 'business.shop_onboarded', 's1', { item: 'shop-1' })).status).toBe(201);
  });

  it('lets Testify read Amina\'s level only once she allows it', async () => {
    await write(CARRIAGE_KEY, 'identity.phone_confirmed', 'p1');
    for (const what of ['standing', 'quests', 'awards?entry=my.kiungo.africa:p1']) {
      const refused = await t.call('GET', `/v1/people/k-amina/${what}`, undefined, TESTIFY);
      expect(refused.status).toBe(403);
      expect(refused.json.error.code).toBe('not_allowed_by_member');
    }
    await t.call('POST', '/standin/permissions', { kiungoId: 'k-amina', reader: 'testify', allowed: true }, ADMIN);
    const allowed = await t.call('GET', '/v1/people/k-amina/standing', undefined, TESTIFY);
    expect(allowed.status).toBe(200);
    expect(allowed.json.data).toMatchObject({ total: 10, level: 'Seed' });
  });

  it('pays nothing once Amina withdraws Kiungo\'s permission, and keeps what she earned', async () => {
    await write(CARRIAGE_KEY, 'identity.phone_confirmed', 'p1');
    await t.call('POST', '/standin/permissions', { kiungoId: 'k-amina', reader: 'kiungo-points', allowed: false }, ADMIN);
    const after = await write(KASIPOS, 'business.shop_onboarded', 's1', { item: 'shop-1' });
    expect(after.json.data.awards).toEqual([]);
    expect(after.json.data.notAwarded).toEqual([{ quest: null, reason: 'no_permission' }]);
    expect((await t.call('GET', '/v1/people/k-amina/standing', undefined, CARRIAGE_KEY)).json.data.total).toBe(10);
  });

  it('answers a writing carriage with the standing only if the member lets it read', async () => {
    const res = await write(KASIPOS, 'business.shop_onboarded', 's1', { item: 'shop-1' });
    expect(res.json.data.awards).toEqual([{ quest: 'business.shop_onboarded', points: 150 }]);
    expect(res.json.data.total).toBeUndefined();
    expect(res.json.data.level).toBeUndefined();
  });

  it('refuses a missing, unknown or switched-off key', async () => {
    expect((await t.call('GET', '/v1/people/k-amina/standing', undefined, '')).status).toBe(401);
    expect((await t.call('GET', '/v1/people/k-amina/standing', undefined, 'nobody-knows-this-key-0000000')).status).toBe(401);
    await t.call('POST', '/v1/carriages', { name: 'my.kiungo.africa', key: CARRIAGE_KEY, active: false }, ADMIN);
    expect((await write(CARRIAGE_KEY, 'identity.phone_confirmed', 'p1')).status).toBe(401);
  });

  it('rotates a key: the new one works, the old one stops', async () => {
    const fresh = 'my-kiungo-rotated-key-0000000000000';
    const rotated = await t.call('POST', '/v1/carriages', { name: 'my.kiungo.africa', key: fresh }, ADMIN);
    expect(rotated.status).toBe(201);
    expect((await t.call('GET', '/v1/people/k-amina/standing', undefined, CARRIAGE_KEY)).status).toBe(401);
    expect((await t.call('GET', '/v1/people/k-amina/standing', undefined, fresh)).status).toBe(200);
  });

  it('needs the admin key to set a carriage key, and refuses a short key', async () => {
    expect((await t.call('POST', '/v1/carriages', { name: 'x', key: 'k'.repeat(32) }, 'not-admin')).status).toBe(401);
    expect((await t.call('POST', '/v1/carriages', { name: 'x', key: 'short' }, ADMIN)).status).toBe(400);
  });

  it('limits each carriage key, and says when to try again', async () => {
    const limited = await setup({ limit: 2 });
    await limited.person('k-amina', 'joined', 'Africa/Kinshasa', ['kiungo-points', 'my.kiungo.africa']);
    const read = () => limited.call('GET', '/v1/people/k-amina/standing', undefined, CARRIAGE_KEY);
    expect((await read()).status).toBe(200);
    expect((await read()).status).toBe(200);
    const third = await read();
    expect(third.status).toBe(429);
    expect(third.json.error.code).toBe('rate_limited');
  });
});
