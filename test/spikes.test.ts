import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, ANY_KEY, setup } from './helpers';

// Twenty invites between 10:00 and 10:57 on one day.
const at = (i: number) => new Date(Date.UTC(2026, 9, 20, 10, i * 3)).toISOString();

describe('T-11 spike flags', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
    t.setNow('2026-10-20T12:00:00Z');
    await t.person('k-amina');
    const set = await t.call('PUT', '/v1/admin/spike-settings', [{ kind: 'invite.joined', count: 20, minutes: 60 }], ADMIN);
    expect(set.status).toBe(200);
  });

  const invites = async (n: number, from = 0) => {
    for (let i = from; i < from + n; i++) await t.act('k-amina', 'invite.joined', at(i), `inv${i}`, { item: `k-new${i}` });
  };
  const flags = async () => (await t.call('GET', '/v1/admin/flags', undefined, ADMIN)).json.data as any[];

  it('flags twenty invites from one person in an hour once, and takes no points away', async () => {
    await invites(19);
    expect(await flags()).toEqual([]);
    const before = (await t.call('GET', '/v1/people/k-amina/standing')).json.data.total;

    const twentieth = await t.act('k-amina', 'invite.joined', at(19), 'inv19', { item: 'k-new19' });
    expect(await flags()).toEqual([expect.objectContaining({ kiungoId: 'k-amina', kind: 'invite.joined', count: 20, reviewedAt: null })]);
    expect(twentieth).not.toHaveProperty('flag');

    await t.act('k-amina', 'invite.joined', at(19), 'inv20', { item: 'k-new20' });
    expect(await flags()).toHaveLength(1); // one flag for the hour, not one per entry

    const after = (await t.call('GET', '/v1/people/k-amina/standing')).json.data;
    expect(after.total).toBe(before); // past the daily limit the invites pay nothing, and the flag takes nothing
    const history = (await t.call('GET', '/v1/people/k-amina/awards?limit=100')).json.data as any[];
    expect(history.every((l) => l.points >= 0)).toBe(true);
    expect(JSON.stringify(after)).not.toMatch(/flag|spike/);
  });

  it('closes a flag once a person has reviewed it', async () => {
    await invites(20);
    const [flag] = await flags();
    const res = await t.call('POST', `/v1/admin/flags/${flag.id}/review`, { note: 'A community meeting: real sign-ups.' }, ADMIN);
    expect(res.status).toBe(200);
    expect((await flags())[0]).toMatchObject({ reviewedAt: expect.any(String), note: 'A community meeting: real sign-ups.' });
    expect((await t.call('GET', '/v1/admin/flags?open=true', undefined, ADMIN)).json.data).toEqual([]);
  });

  it('keeps the settings and the flags to admin', async () => {
    expect((await t.call('GET', '/v1/admin/flags', undefined, ANY_KEY)).status).toBe(401);
    expect((await t.call('PUT', '/v1/admin/spike-settings', [], ANY_KEY)).status).toBe(401);
    expect((await t.call('GET', '/v1/admin/spike-settings', undefined, ADMIN)).json.data).toEqual([{ kind: 'invite.joined', count: 20, minutes: 60 }]);
  });

  it('refuses a setting that makes no sense', async () => {
    expect((await t.call('PUT', '/v1/admin/spike-settings', [{ kind: 'invite.joined', count: 1, minutes: 60 }], ADMIN)).status).toBe(400);
  });
});
