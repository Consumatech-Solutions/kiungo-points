import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, setup } from './helpers';

const AT = '2026-10-20T09:00:00Z';

describe('T-10 marks', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { t = await setup(); });

  const join = (kiungoId: string, joinedAt: string, extra: object = {}) => t.call('POST', '/standin/people',
    { kiungoId, trust: 'joined', timezone: 'Africa/Kinshasa', allows: ['kiungo-points', 'kiungo.test'], joinedAt, ...extra }, ADMIN);
  const marks = async (id: string) => ((await t.call('GET', `/v1/people/${id}/standing`)).json.data.marks as any[]).map((m) => m.mark);

  it('gives everyone who joined before 1 January 2030 the Founding member mark', async () => {
    await join('k-early', '2027-01-15T08:00:00Z');
    await join('k-eve', '2029-12-31T23:59:59Z');
    await join('k-late', '2030-01-01T00:00:00Z');
    for (const id of ['k-early', 'k-eve', 'k-late']) await t.act(id, 'picture.look', AT, `${id}-look`);
    expect(await marks('k-early')).toContain('founding_member');
    expect(await marks('k-eve')).toContain('founding_member');
    expect(await marks('k-late')).not.toContain('founding_member');
  });

  it('shows the Founding member mark even before the member\'s first activity is read', async () => {
    await join('k-quiet', '2027-01-15T08:00:00Z');
    expect(await marks('k-quiet')).toEqual(['founding_member']);
  });

  it('gives the first member seen in a unit, a country and a language a mark and 25 points each, once', async () => {
    await join('k-amina', '2027-01-15T08:00:00Z', { units: ['matete'], country: 'CD', languages: ['ln', 'fr'] });
    await join('k-baraka', '2027-01-16T08:00:00Z', { units: ['matete'], country: 'CD', languages: ['ln', 'sw'] });

    const first = await t.act('k-amina', 'picture.look', AT, 'a-look');
    expect(first.awards).toEqual(expect.arrayContaining([
      { quest: 'first.unit', points: 25, step: 'matete' },
      { quest: 'first.country', points: 25, step: 'CD' },
      { quest: 'first.language', points: 25, step: 'ln' },
      { quest: 'first.language', points: 25, step: 'fr' },
    ]));
    expect(first.total).toBe(10 + 100);
    expect(await marks('k-amina')).toEqual(expect.arrayContaining(['first_in_unit:matete', 'first_in_country:CD', 'first_in_language:ln', 'first_in_language:fr']));

    const second = await t.act('k-baraka', 'picture.look', AT, 'b-look');
    expect(second.awards).toEqual([{ quest: 'picture.look', points: 10 }, { quest: 'first.language', points: 25, step: 'sw' }]);
    expect(await marks('k-baraka')).toEqual(['founding_member', 'first_in_language:sw']);

    expect((await t.act('k-amina', 'picture.name', AT, 'a-name')).awards).toEqual([{ quest: 'picture.name', points: 5 }]); // given once
  });

  // A smoke test: PGlite runs one transaction at a time, so this can't race; on PostgreSQL the unique mark decides who is first.
  it('gives a first to one member only when two arrive at once (smoke test)', async () => {
    await join('k-amina', '2027-01-15T08:00:00Z', { country: 'GH' });
    await join('k-kofi', '2027-01-15T08:00:00Z', { country: 'GH' });
    await Promise.all([t.act('k-amina', 'picture.look', AT, 'a'), t.act('k-kofi', 'picture.look', AT, 'k')]);
    const holders = [...await marks('k-amina'), ...await marks('k-kofi')].filter((m) => m === 'first_in_country:GH');
    expect(holders).toHaveLength(1);
  });

  it('dates the Founding member mark from the day the member joined', async () => {
    await join('k-amina', '2027-01-15T08:00:00Z');
    expect((await t.call('GET', '/v1/people/k-amina/standing')).json.data.marks).toEqual([{ mark: 'founding_member', givenAt: '2027-01-15T08:00:00.000Z' }]);
  });

  it('stores nothing about a member who has not allowed Kiungo, even when a carriage reads their standing', async () => {
    await t.call('POST', '/standin/people', { kiungoId: 'k-kofi', trust: 'joined', timezone: 'Africa/Accra', allows: ['kiungo.test'], joinedAt: '2027-01-15T08:00:00Z', country: 'GH' }, ADMIN);
    await t.call('GET', '/v1/people/k-kofi/standing');
    expect(await t.db.query('SELECT 1 FROM marks WHERE kiungo_id = $1', ['k-kofi'])).toEqual([]);
  });

  it('stops paying a first while its quest is paused', async () => {
    await t.call('POST', '/v1/quests/first.country/pause', undefined, ADMIN);
    await join('k-amina', '2027-01-15T08:00:00Z', { country: 'CD' });
    expect((await t.act('k-amina', 'picture.look', AT, 'a')).awards).toEqual([{ quest: 'picture.look', points: 10 }]);
  });

  it('counts language firsts for the first three languages a member speaks', async () => {
    await join('k-polyglot', '2027-01-15T08:00:00Z', { languages: ['ln', 'fr', 'sw', 'en', 'yo'] });
    const res = await t.act('k-polyglot', 'picture.look', AT, 'p');
    expect(res.awards.filter((a: any) => a.quest === 'first.language').map((a: any) => a.step)).toEqual(['fr', 'ln', 'sw']);
  });

  describe('T-20 a corrected first is freed', () => {
    const correctLatest = async (kiungoId: string, quest: string) => {
      const [a] = await t.db.query<{ id: string }>(
        'SELECT id FROM awards WHERE kiungo_id = $1 AND quest_id = $2 AND corrects IS NULL ORDER BY id DESC LIMIT 1', [kiungoId, quest]);
      const res = await t.call('POST', '/v1/corrections', { award: Number(a!.id), reason: 'test' }, ADMIN);
      expect(res.status).toBe(201);
    };
    const firstGH = (res: any) => res.awards.filter((a: any) => a.quest === 'first.country');

    beforeEach(async () => {
      for (const id of ['k-amina', 'k-kofi', 'k-ama']) await join(id, '2027-01-15T08:00:00Z', { country: 'GH' });
      await t.act('k-amina', 'picture.look', AT, 'a-look');
    });

    it('frees a first when its award is corrected, for the next member whose entry is read', async () => {
      await correctLatest('k-amina', 'first.country');
      expect(firstGH(await t.act('k-kofi', 'picture.look', AT, 'k-look'))).toEqual([{ quest: 'first.country', points: 25, step: 'GH' }]);
      expect(await marks('k-kofi')).toContain('first_in_country:GH');
      expect(await marks('k-amina')).not.toContain('first_in_country:GH');
      expect(await marks('k-amina')).toContain('founding_member');
    });

    it('frees a language first the same way', async () => {
      for (const id of ['k-lena', 'k-moise']) await join(id, '2027-01-15T08:00:00Z', { languages: ['ln'] });
      await t.act('k-lena', 'picture.look', AT, 'l-look');
      await correctLatest('k-lena', 'first.language');
      const res = await t.act('k-moise', 'picture.look', AT, 'mo-look');
      expect(res.awards.filter((a: any) => a.quest === 'first.language')).toEqual([{ quest: 'first.language', points: 25, step: 'ln' }]);
      expect(await marks('k-lena')).not.toContain('first_in_language:ln');
    });

    it('never gives a corrected member back the first they lost', async () => {
      await correctLatest('k-amina', 'first.country');
      expect(firstGH(await t.act('k-amina', 'picture.name', AT, 'a-name'))).toEqual([]);
      expect(await marks('k-amina')).not.toContain('first_in_country:GH');
    });

    it('frees a first again when its second award is corrected', async () => {
      await correctLatest('k-amina', 'first.country');
      await t.act('k-kofi', 'picture.look', AT, 'k-look');
      await correctLatest('k-kofi', 'first.country');
      expect(firstGH(await t.act('k-ama', 'picture.look', AT, 'm-look'))).toEqual([{ quest: 'first.country', points: 25, step: 'GH' }]);
    });

    it('keeps the record that a first was given and freed', async () => {
      await correctLatest('k-amina', 'first.country');
      const rows = await t.db.query<{ freed_at: unknown }>(
        "SELECT freed_at FROM marks WHERE kiungo_id = 'k-amina' AND mark = 'first_in_country:GH'");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.freed_at).not.toBeNull();
    });

    it('leaves marks alone when another kind of award is corrected', async () => {
      await correctLatest('k-amina', 'picture.look');
      expect(await marks('k-amina')).toContain('first_in_country:GH');
      expect(firstGH(await t.act('k-kofi', 'picture.look', AT, 'k-look'))).toEqual([]);
    });

    // A smoke test: PGlite runs one transaction at a time, so this can't race; on PostgreSQL the unique mark decides.
    it('gives a freed first to one member only when two arrive at once (smoke test)', async () => {
      await correctLatest('k-amina', 'first.country');
      await Promise.all([t.act('k-kofi', 'picture.look', AT, 'k'), t.act('k-ama', 'picture.look', AT, 'm')]);
      const holders = [...await marks('k-kofi'), ...await marks('k-ama')].filter((m) => m === 'first_in_country:GH');
      expect(holders).toHaveLength(1);
    });
  });
});
