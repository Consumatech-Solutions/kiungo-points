import { readdirSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadQuests, QuestFile } from '../src/quests/files';
import { ADMIN, setup } from './helpers';

const files = () => readdirSync('quests').filter((f) => f.endsWith('.json')).sort()
  .map((f) => QuestFile.parse(JSON.parse(readFileSync(`quests/${f}`, 'utf8'))));
const withVersion = (id: string, change: (v: any) => any) => files().map((f) =>
  f.id === id ? { ...f, versions: [...f.versions, change({ ...f.versions.at(-1)!, version: f.versions.length + 1 })] } : f);

describe('T-14 quests as public files', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { t = await setup(); });
  const board = async () => (await t.call('GET', '/v1/quests')).json.data as any[];

  it('has a file for every quest on the board, named after it, with every version the database holds', async () => {
    const names = readdirSync('quests').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    expect((await board()).map((q) => q.quest).sort()).toEqual(names);
    const counts = await t.db.query<{ quest_id: string; n: number }>(
      'SELECT v.quest_id, COUNT(*)::int AS n FROM quest_versions v JOIN quests q ON q.id = v.quest_id WHERE q.unit IS NULL GROUP BY v.quest_id');
    expect(Object.fromEntries(counts.map((c) => [c.quest_id, c.n]))).toEqual(Object.fromEntries(files().map((f) => [f.id, f.versions.length])));
  });

  it('loads again with nothing new: the database matches the files', async () => {
    expect(await loadQuests(t.db, files())).toEqual([]);
  });

  it('puts a new version in force from its date, and not before', async () => {
    const soon = withVersion('need.shopping_list', (v) => ({ ...v, validFrom: '2026-10-01T00:00:00Z', limit: 3 }));
    expect(await loadQuests(t.db, soon)).toEqual(['need.shopping_list v2 added, in force from 2026-10-01T00:00:00Z']);
    expect((await board()).find((q) => q.quest === 'need.shopping_list')).toMatchObject({ version: 2, limit: 3 });

    await loadQuests(t.db, withVersion('share.post', (v) => ({ ...v, validFrom: '2099-01-01T00:00:00Z', points: 6 })));
    expect((await board()).find((q) => q.quest === 'share.post')).toMatchObject({ version: 1, points: 5 }); // not yet
  });

  it('refuses a new version dated back over activity already read, so old activity never gets new rules', async () => {
    await t.person('k-amina');
    t.setNow('2026-03-02T00:00:00Z');
    await t.act('k-amina', 'share.post', '2026-03-01T09:00:00Z', 's1');
    await expect(loadQuests(t.db, withVersion('share.post', (v) => ({ ...v, validFrom: '2026-02-01T00:00:00Z', points: 6 }))))
      .rejects.toThrow(/activity from then on has already been read/);
    expect(await loadQuests(t.db, withVersion('share.post', (v) => ({ ...v, validFrom: '2026-03-02T00:00:00Z', points: 6 }))))
      .toHaveLength(1); // from after that activity, it's fine
  });

  it('keeps an ended quest ended', async () => {
    const ended = files().map((f) => (f.id === 'share.post' ? { ...f, status: 'ended' as const } : f));
    expect(await loadQuests(t.db, ended)).toEqual(['share.post is now ended']);
    await expect(loadQuests(t.db, files())).rejects.toThrow(/ended quest stays ended/);
  });

  it('refuses a version that leaves its limit implied, and says what it expected', async () => {
    const implied = withVersion('share.post', (v) => ({ ...v, validFrom: '2099-01-01T00:00:00Z', limit: null }));
    await expect(loadQuests(t.db, implied)).rejects.toThrow(/write it out as it runs.*"period_limit":1/);
  });

  it('loads a challenge in steps again and again, whatever order the database keeps its fields in', async () => {
    const steps = { id: 'build.test_steps', questLine: 'building' as const, template: 'steps' as const, building: false, status: 'live' as const,
      versions: [{ version: 1, validFrom: '2099-01-01T00:00:00Z', title: 'Test', watches: ['a.one', 'a.two'], target: 2, period: 'once' as const,
        limit: null, eachItem: null, points: null, trustNeeded: 'joined' as const, evidence: null,
        steps: [{ kind: 'a.one', points: 20, upTo: 1, period: 'once' }, { kind: 'a.two', points: 5, upTo: 4, period: 'weekly' }] }] };
    await loadQuests(t.db, [steps]);
    expect(await loadQuests(t.db, [steps])).toEqual([]);
  });

  it('refuses a change to a version already published, and changes nothing', async () => {
    const edited = files().map((f) => (f.id === 'share.post' ? { ...f, versions: [{ ...f.versions[0]!, points: 50 }] } : f));
    await expect(loadQuests(t.db, edited)).rejects.toThrow(/share.post v1 differs from what was published; add a new version/);
    expect((await board()).find((q) => q.quest === 'share.post')).toMatchObject({ points: 5 });
  });

  it('refuses a file that breaks the template checks, or skips a version number', async () => {
    await expect(loadQuests(t.db, withVersion('share.post', (v) => ({ ...v, validFrom: '2099-01-01T00:00:00Z', target: 0 }))))
      .rejects.toThrow(/target/);
    const skipped = files().map((f) => (f.id === 'share.post' ? { ...f, versions: [{ ...f.versions[0]!, version: 2 }] } : f));
    await expect(loadQuests(t.db, skipped)).rejects.toThrow(/numbered 1, 2, 3/);
  });

  it('refuses a title that hints points are worth money', async () => {
    await expect(loadQuests(t.db, withVersion('share.post', (v) => ({ ...v, validFrom: '2099-01-01T00:00:00Z', title: 'Share a post, earn tokens' }))))
      .rejects.toThrow(/worth money/);
  });

  it('refuses to draft or change a core quest through the admin API', async () => {
    const res = await t.call('POST', '/v1/quests', {
      id: 'need.shopping_list', title: 'Share your shopping list', questLine: 'needs', template: 'repeat',
      watches: ['need.shopping_list'], target: 1, period: 'weekly', limit: 3, points: 10, trustNeeded: 'joined',
    }, ADMIN);
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('core_quest_by_file');
  });

  it('pauses a quest when its file says so', async () => {
    expect(await loadQuests(t.db, files().map((f) => (f.id === 'share.post' ? { ...f, status: 'paused' as const } : f)))).toEqual(['share.post is now paused']);
    expect((await board()).some((q) => q.quest === 'share.post')).toBe(false);
  });
});
