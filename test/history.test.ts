import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, CARRIAGE_KEY, setup } from './helpers';

const AT = '2026-10-20T09:00:00Z';

describe('T-07 history, download and corrections', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
    await t.person('k-amina');
    await t.act('k-amina', 'picture.look', AT, 'look');
    await t.act('k-amina', 'build.idea_taken_up', AT, 'idea', { item: 'idea-1' });
  });

  const history = async (q = '') => (await t.call('GET', `/v1/people/k-amina/awards${q}`)).json;
  const fifty = async () => (await history()).data.find((a: any) => a.points === 50);

  it('shows a wrongly given 50 as +50 then −50 "correction: duplicate photo", and the total drops by 50', async () => {
    const award = await fifty();
    expect(award).toMatchObject({ quest: 'build.idea_taken_up', points: 50, entry: 'kiungo.test:idea', reason: null });

    const res = await t.call('POST', '/v1/corrections', { award: award.id, reason: 'duplicate photo' }, ADMIN);
    expect(res.status).toBe(201);

    const lines = (await history()).data;
    expect(lines.slice(0, 2)).toMatchObject([
      { quest: 'build.idea_taken_up', points: -50, reason: 'correction: duplicate photo', corrects: award.id, entry: null },
      { quest: 'build.idea_taken_up', points: 50, id: award.id },
    ]);
    expect((await t.call('GET', '/v1/people/k-amina/standing')).json.data.total).toBe(10);
  });

  it('cancels an award once, and never a correction', async () => {
    const award = await fifty();
    const first = await t.call('POST', '/v1/corrections', { award: award.id, reason: 'duplicate photo' }, ADMIN);
    const again = await t.call('POST', '/v1/corrections', { award: award.id, reason: 'duplicate photo' }, ADMIN);
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('already_corrected');
    const ofCorrection = await t.call('POST', '/v1/corrections', { award: first.json.data.id, reason: 'oops' }, ADMIN);
    expect(ofCorrection.status).toBe(409);
    expect((await t.call('POST', '/v1/corrections', { award: 999999, reason: 'x' }, ADMIN)).status).toBe(404);
  });

  it('needs the admin key and a reason to correct', async () => {
    const award = await fifty();
    expect((await t.call('POST', '/v1/corrections', { award: award.id, reason: 'duplicate photo' }, CARRIAGE_KEY)).status).toBe(401);
    expect((await t.call('POST', '/v1/corrections', { award: award.id, reason: '' }, ADMIN)).status).toBe(400);
  });

  it('pages the history, newest first', async () => {
    const page = await history('?limit=1');
    expect(page.data).toHaveLength(1);
    expect(page.data[0].quest).toBe('build.idea_taken_up');
    const next = await history(`?limit=1&before=${page.meta.next}`);
    expect(next.data[0].quest).toBe('picture.look');
    expect(next.meta.next).toBeNull();
  });

  it('downloads the whole points record, every award in it', async () => {
    const award = await fifty();
    await t.call('POST', '/v1/corrections', { award: award.id, reason: 'duplicate photo' }, ADMIN);
    const res = await t.call('GET', '/v1/people/k-amina/export');
    expect(res.status).toBe(200);
    expect(res.json.data.awards.map((a: any) => a.points)).toEqual([10, 50, -50]);
    expect(res.json.data.standing).toMatchObject({ kiungoId: 'k-amina', total: 10 });
    expect(res.json.data.note).toMatch(/no cash value/);
  });

  it('shows the history and the download only to a carriage the member allows', async () => {
    expect((await t.call('GET', '/v1/people/k-amina/awards', undefined, CARRIAGE_KEY)).status).toBe(403);
    expect((await t.call('GET', '/v1/people/k-amina/export', undefined, CARRIAGE_KEY)).status).toBe(403);
  });
});
