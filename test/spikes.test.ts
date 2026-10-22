import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, ANY_KEY, setup } from './helpers';

// The settings below are examples for the tests; production settings are set privately.

// Twenty invites between 10:00 and 10:57 on one day.
const at = (i: number) => new Date(Date.UTC(2026, 9, 20, 10, i * 3)).toISOString();

describe('T-11 spike flags', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
    t.setNow('2026-10-20T12:00:00Z');
    await t.person('k-amina');
    const set = await t.call('PUT', '/v1/admin/spike-settings', [{ kind: 'invite.joined', count: 20, minutes: 60 }, { kind: 'vouch.given', count: 5, minutes: 60 }], ADMIN);
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

    await t.act('k-amina', 'invite.joined', at(19), 'inv19', { item: 'k-new19' });
    expect(await flags()).toEqual([expect.objectContaining({ kiungoId: 'k-amina', kind: 'invite.joined', count: 20, reviewedAt: null })]);

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
    expect((await t.call('GET', '/v1/admin/spike-settings', undefined, ADMIN)).json.data).toHaveLength(2);
  });

  it('refuses a setting that makes no sense, or names a kind twice', async () => {
    expect((await t.call('PUT', '/v1/admin/spike-settings', [{ kind: 'invite.joined', count: 1, minutes: 60 }], ADMIN)).status).toBe(400);
    const twice = [{ kind: 'invite.joined', count: 20, minutes: 60 }, { kind: 'invite.joined', count: 30, minutes: 60 }];
    expect((await t.call('PUT', '/v1/admin/spike-settings', twice, ADMIN)).status).toBe(400);
  });

  it('flags twenty invites that arrive newest first, as an offline phone catching up would send them', async () => {
    for (let i = 19; i >= 0; i--) await t.act('k-amina', 'invite.joined', at(i), `inv${i}`, { item: `k-new${i}` });
    expect(await flags()).toHaveLength(1);
  });

  it('flags repeated vouching too, though it never earns', async () => {
    for (let i = 0; i < 5; i++) await t.act('k-amina', 'vouch.given', at(i), `v${i}`, { item: `k-friend${i}` });
    expect(await flags()).toEqual([expect.objectContaining({ kind: 'vouch.given', count: 5 })]);
  });

  it('flags a second busy hour on its own', async () => {
    await invites(20);
    const later = (i: number) => new Date(Date.UTC(2026, 9, 21, 10, i * 3)).toISOString();
    t.setNow('2026-10-21T12:00:00Z');
    for (let i = 0; i < 20; i++) await t.act('k-amina', 'invite.joined', later(i), `next${i}`, { item: `k-next${i}` });
    expect(await flags()).toHaveLength(2);
  });

  it('reviews a flag once', async () => {
    await invites(20);
    const [flag] = await flags();
    await t.call('POST', `/v1/admin/flags/${flag.id}/review`, { note: 'Checked.' }, ADMIN);
    expect((await t.call('POST', `/v1/admin/flags/${flag.id}/review`, { note: 'Again.' }, ADMIN)).status).toBe(409);
    expect((await t.call('POST', '/v1/admin/flags/99999/review', { note: 'x' }, ADMIN)).status).toBe(404);
  });
});
