import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, CARRIAGE_KEY, setup } from './helpers';

const PHONE = 'identity.phone_confirmed';
const at = '2026-10-22T10:14:00+01:00';

describe('T-01 walking skeleton', () => {
  let t: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    t = await setup();
    await t.call('POST', '/standin/people',
      { kiungoId: 'k-amina', trust: 'joined', timezone: 'Africa/Kinshasa', allows: ['kiungo-points'] }, ADMIN);
    await t.call('POST', '/standin/people',
      { kiungoId: 'k-kofi', trust: 'joined', timezone: 'Africa/Accra', allows: [] }, ADMIN);
  });

  it('pays 10 points and Seed when a person who allows Kiungo confirms their phone', async () => {
    const res = await t.call('POST', '/standin/activity', { kiungoId: 'k-amina', kind: PHONE, occurredAt: at, key: 'p1' }, CARRIAGE_KEY);
    expect(res.status).toBe(201);
    expect(res.json.data.awards).toEqual([{ quest: PHONE, points: 10 }]);
    expect(res.json.data.total).toBe(10);
    expect(res.json.data.level).toBe('Seed');
    expect(res.json.data.next).toEqual({ level: 'Sprout', pointsToGo: 90 });

    const standing = await t.call('GET', '/v1/people/k-amina/standing');
    expect(standing.json.data).toMatchObject({ total: 10, level: 'Seed' });
  });

  it('never pays twice for the same entry delivered twice', async () => {
    const body = { kiungoId: 'k-amina', kind: PHONE, occurredAt: at, key: 'p1' };
    await t.call('POST', '/standin/activity', body, CARRIAGE_KEY);
    const again = await t.call('POST', '/standin/activity', body, CARRIAGE_KEY);
    expect(again.json.data.awards).toEqual([{ quest: PHONE, points: 10 }]); // the first answer, given again
    expect(again.json.data.total).toBe(10);
  });

  it('pays a once-only quest once, even for a second, different entry', async () => {
    await t.call('POST', '/standin/activity', { kiungoId: 'k-amina', kind: PHONE, occurredAt: at, key: 'p1' }, CARRIAGE_KEY);
    const second = await t.call('POST', '/standin/activity', { kiungoId: 'k-amina', kind: PHONE, occurredAt: at, key: 'p2' }, CARRIAGE_KEY);
    expect(second.json.data.awards).toEqual([]);
    expect(second.json.data.notAwarded).toEqual([{ quest: PHONE, reason: 'already_done' }]);
    expect(second.json.data.total).toBe(10);
  });

  it('pays nothing, and keeps no reference, when the person has not allowed Kiungo', async () => {
    const res = await t.call('POST', '/standin/activity', { kiungoId: 'k-kofi', kind: PHONE, occurredAt: at, key: 'p1' }, CARRIAGE_KEY);
    expect(res.json.data.awards).toEqual([]);
    expect(res.json.data.notAwarded).toEqual([{ quest: null, reason: 'no_permission' }]);
    expect(res.json.data.total).toBe(0);
    expect(await t.db.query('SELECT 1 FROM entries_read WHERE kiungo_id = $1', ['k-kofi'])).toEqual([]);
  });

  it('refuses an unknown carriage key', async () => {
    const res = await t.call('POST', '/standin/activity', { kiungoId: 'k-amina', kind: PHONE, occurredAt: at, key: 'p1' }, 'wrong-key');
    expect(res.status).toBe(401);
  });

  it('refuses a kind of activity the carriage may not write', async () => {
    const res = await t.call('POST', '/standin/activity', { kiungoId: 'k-amina', kind: 'sale.recorded', occurredAt: at, key: 'p1' }, CARRIAGE_KEY);
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('not_allowed_for_carriage');
  });

  it('keeps the notebook insert-only', async () => {
    await t.call('POST', '/standin/activity', { kiungoId: 'k-amina', kind: PHONE, occurredAt: at, key: 'p1' }, CARRIAGE_KEY);
    await expect(t.db.query('UPDATE awards SET points = 1000')).rejects.toThrow(/insert only/);
    await expect(t.db.query('DELETE FROM awards')).rejects.toThrow(/insert only/);
  });

  it('publishes the quest board', async () => {
    const res = await t.call('GET', '/v1/quests');
    expect(res.json.data).toEqual(expect.arrayContaining([expect.objectContaining({ quest: PHONE, points: 10, period: 'once', trustNeeded: 'joined' })]));
  });

  it('needs the admin key to set up stand-in people', async () => {
    const res = await t.call('POST', '/standin/people', { kiungoId: 'k-x', trust: 'verified', timezone: 'UTC' }, 'not-admin');
    expect(res.status).toBe(401);
  });
});
