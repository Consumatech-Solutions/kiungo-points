import type { Db } from '../db';
import { TRUST_ORDER, type IdentityPlug, type Trust } from '../plugs';
import { marksOf } from './marks';
import { readStreak } from './rules';

/** The levels and what each needs beyond its points (activities.md, design.md §5). */
export const LEVELS = [
  { level: 'Seed', from: 10, trust: 'joined' as Trust },
  { level: 'Sprout', from: 100 },
  { level: 'Root', from: 400, trust: 'vouched' as Trust },
  { level: 'Fruit', from: 1500, building: true },
  { level: 'Seedkeeper', from: 5000, questLines: 3 },
] as const satisfies readonly { level: string; from: number; trust?: Trust; building?: boolean; questLines?: number }[];

export interface Standing {
  kiungoId: string;
  total: number;
  counting: number;
  level: string | null;
  next: { level: string; pointsToGo: number; alsoNeeds: string[] } | null;
  levels: { level: string; reachedAt: string }[];
  bestStreak: number;
  marks: { mark: string; givenAt: string }[];
}

/**
 * Counting points: invites count only up to all other counting points (at most half),
 * and local points only up to a third of the rest (at most a quarter).
 */
export function countingPoints(core: number, invite: number, local: number): number {
  // Both caps at once: local ≤ (core + invites) / 3 and invites ≤ core + local, so local can never pass core.
  const loc = Math.max(0, Math.min(local, core, Math.floor((core + Math.max(0, invite)) / 3)));
  const inv = Math.max(0, Math.min(invite, core + loc));
  return core + inv + loc;
}

/** Standing: worked out from the notebook, never stored by hand. Levels reached are recorded and never go down. */
export async function standing(db: Db, identity: IdentityPlug, kiungoId: string): Promise<Standing> {
  const [sums] = await db.query<{ total: string; core: string; invite: string; local: string; lines: number; building: boolean }>(
    `SELECT COALESCE(SUM(a.points), 0) AS total,
            COALESCE(SUM(a.points) FILTER (WHERE a.quest_line NOT IN ('invites', 'local')), 0) AS core,
            COALESCE(SUM(a.points) FILTER (WHERE a.quest_line = 'invites'), 0) AS invite,
            COALESCE(SUM(a.points) FILTER (WHERE a.quest_line = 'local'), 0) AS local,
            (SELECT COUNT(*)::int FROM (SELECT quest_line FROM awards WHERE kiungo_id = $1
                                         GROUP BY quest_line HAVING SUM(points) > 0) l) AS lines,
            EXISTS (SELECT 1 FROM awards b JOIN quests q ON q.id = b.quest_id
                     WHERE b.kiungo_id = $1 AND (q.building OR b.quest_line = 'local')
                     GROUP BY b.quest_id HAVING SUM(b.points) > 0) AS building
       FROM awards a WHERE a.kiungo_id = $1`,
    [kiungoId],
  );
  const total = Number(sums!.total);
  const counting = countingPoints(Number(sums!.core), Number(sums!.invite), Number(sums!.local));
  const person = await identity.lookup(kiungoId);
  const trust = person?.trust ?? null;

  const missing = (l: (typeof LEVELS)[number]) => [
    ...('trust' in l && (!trust || TRUST_ORDER.indexOf(trust) < TRUST_ORDER.indexOf(l.trust)) ? [l.trust] : []),
    ...('building' in l && !sums!.building ? ['a building activity'] : []),
    ...('questLines' in l && sums!.lines < l.questLines ? [`points from ${l.questLines} quest lines`] : []),
  ];

  const read = () => db.query<{ level: string; reached_at: Date | string }>(
    'SELECT level, reached_at FROM levels_reached WHERE kiungo_id = $1', [kiungoId],
  );
  let reached = await read();
  // Levels already reached stay met, so the climb carries on from there even if trust has dropped.
  const had = LEVELS.filter((l) => reached.some((r) => r.level === l.level)).length;
  let now = had;
  while (now < LEVELS.length && counting >= LEVELS[now]!.from && missing(LEVELS[now]!).length === 0) now++;
  if (now > had) {
    await db.query(
      'INSERT INTO levels_reached (kiungo_id, level) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING',
      [kiungoId, LEVELS.slice(had, now).map((l) => l.level)],
    );
    reached = await read();
  }
  const levels = LEVELS.filter((l) => reached.some((r) => r.level === l.level))
    .map((l) => ({ level: l.level, reachedAt: new Date(reached.find((r) => r.level === l.level)!.reached_at).toISOString() }));
  const nextLevel = LEVELS[levels.length];

  const streaks = await db.query<{ counted: string[] }>(
    `SELECT p.counted FROM quest_progress p JOIN quests q ON q.id = p.quest_id
      WHERE p.kiungo_id = $1 AND q.template = 'streak'`, [kiungoId],
  );
  const bestStreak = Math.max(0, ...streaks.flatMap((s) => readStreak(s.counted).runs.map((r) => r.length)));

  return {
    kiungoId,
    total,
    counting,
    level: levels.at(-1)?.level ?? null,
    next: nextLevel
      ? { level: nextLevel.level, pointsToGo: Math.max(0, nextLevel.from - counting), alsoNeeds: missing(nextLevel) }
      : null,
    levels,
    bestStreak,
    marks: await marksOf(db, person, kiungoId),
  };
}
