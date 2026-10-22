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

  // PGlite runs one transaction at a time; on PostgreSQL the unique mark decides who is first.
  it('gives a first to one member only when two arrive at once', async () => {
    await join('k-amina', '2027-01-15T08:00:00Z', { country: 'GH' });
    await join('k-kofi', '2027-01-15T08:00:00Z', { country: 'GH' });
    await Promise.all([t.act('k-amina', 'picture.look', AT, 'a'), t.act('k-kofi', 'picture.look', AT, 'k')]);
    const holders = [...await marks('k-amina'), ...await marks('k-kofi')].filter((m) => m === 'first_in_country:GH');
    expect(holders).toHaveLength(1);
  });

  it('shows when each mark was given', async () => {
    await join('k-amina', '2027-01-15T08:00:00Z');
    const [m] = (await t.call('GET', '/v1/people/k-amina/standing')).json.data.marks;
    expect(m.mark).toBe('founding_member');
    expect(Date.parse(m.givenAt)).not.toBeNaN();
  });
});
