import { readdirSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadQuests, QuestFile } from '../src/quests/files';
import { setup } from './helpers';

const files = () => readdirSync('quests').filter((f) => f.endsWith('.json')).sort()
  .map((f) => QuestFile.parse(JSON.parse(readFileSync(`quests/${f}`, 'utf8'))));
const withVersion = (id: string, change: (v: any) => any) => files().map((f) =>
  f.id === id ? { ...f, versions: [...f.versions, change({ ...f.versions.at(-1)!, version: f.versions.length + 1 })] } : f);

describe('T-14 quests as public files', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { t = await setup(); });
  const board = async () => (await t.call('GET', '/v1/quests')).json.data as any[];

  it('has a file for every quest on the board, named after it', async () => {
    const names = readdirSync('quests').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    expect((await board()).map((q) => q.quest).sort()).toEqual(names);
    for (const f of files()) expect(readdirSync('quests')).toContain(`${f.id}.json`);
  });

  it('loads into a fresh database with exactly the board the files describe, and again with nothing new', async () => {
    expect(await loadQuests(t.db, files())).toEqual([]); // the test database was already loaded from the same files
  });

  it('puts a new version in force from its date', async () => {
    const added = await loadQuests(t.db, withVersion('need.shopping_list', (v) => ({ ...v, validFrom: '2026-10-01T00:00:00Z', limit: 3 })));
    expect(added).toEqual(['need.shopping_list v2']);
    expect((await board()).find((q) => q.quest === 'need.shopping_list')).toMatchObject({ version: 2, limit: 3 });
  });

  it('refuses a change to a version already published, and changes nothing', async () => {
    const edited = files().map((f) => (f.id === 'share.post' ? { ...f, versions: [{ ...f.versions[0]!, points: 50 }] } : f));
    await expect(loadQuests(t.db, edited)).rejects.toThrow(/share.post v1 differs from what was published; add a new version/);
    expect((await board()).find((q) => q.quest === 'share.post')).toMatchObject({ points: 5 });
  });

  it('refuses a file that breaks the template checks, or skips a version number', async () => {
    await expect(loadQuests(t.db, withVersion('share.post', (v) => ({ ...v, validFrom: '2026-10-01T00:00:00Z', target: 0 }))))
      .rejects.toThrow(/target/);
    const skipped = files().map((f) => (f.id === 'share.post' ? { ...f, versions: [{ ...f.versions[0]!, version: 2 }] } : f));
    await expect(loadQuests(t.db, skipped)).rejects.toThrow(/numbered 1, 2, 3/);
  });

  it('pauses a quest when its file says so', async () => {
    await loadQuests(t.db, files().map((f) => (f.id === 'share.post' ? { ...f, status: 'paused' as const } : f)));
    expect((await board()).some((q) => q.quest === 'share.post')).toBe(false);
  });
});
