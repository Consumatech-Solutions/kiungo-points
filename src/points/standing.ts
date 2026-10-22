import type { Db } from '../db';
import { TRUST_ORDER, type IdentityPlug, type Trust } from '../plugs';
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
}

/**
 * Counting points: invites count only up to all other counting points (at most half),
 * and local points only up to a third of the rest (at most a quarter).
 */
export function countingPoints(core: number, invite: number, local: number): number {
  let inv = Math.max(0, Math.min(invite, core));
  let loc = 0;
  for (let i = 0; i < 10; i++) { // each cap raises the other's ceiling; this settles in a few rounds
    const nextLoc = Math.max(0, Math.min(local, Math.floor((core + inv) / 3)));
    const nextInv = Math.max(0, Math.min(invite, core + nextLoc));
    if (nextLoc === loc && nextInv === inv) break;
    loc = nextLoc;
    inv = nextInv;
  }
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
            COALESCE(BOOL_OR(q.building OR a.quest_line = 'local') FILTER (WHERE a.points > 0), false) AS building
       FROM awards a JOIN quests q ON q.id = a.quest_id
      WHERE a.kiungo_id = $1`,
    [kiungoId],
  );
  const total = Number(sums!.total);
  const counting = countingPoints(Number(sums!.core), Number(sums!.invite), Number(sums!.local));
  const trust = (await identity.lookup(kiungoId))?.trust ?? null;

  const missing = (l: (typeof LEVELS)[number]) => [
    ...('trust' in l && (!trust || TRUST_ORDER.indexOf(trust) < TRUST_ORDER.indexOf(l.trust)) ? [l.trust] : []),
    ...('building' in l && !sums!.building ? ['a building activity'] : []),
    ...('questLines' in l && sums!.lines < l.questLines ? [`points from ${l.questLines} quest lines`] : []),
  ];
  let earnedNow = 0; // how many levels, in order, are met today
  while (earnedNow < LEVELS.length && counting >= LEVELS[earnedNow]!.from && missing(LEVELS[earnedNow]!).length === 0) earnedNow++;

  for (const l of LEVELS.slice(0, earnedNow)) {
    await db.query(
      'INSERT INTO levels_reached (kiungo_id, level) VALUES ($1, $2) ON CONFLICT DO NOTHING', [kiungoId, l.level],
    );
  }
  const reached = await db.query<{ level: string; reached_at: Date | string }>(
    'SELECT level, reached_at FROM levels_reached WHERE kiungo_id = $1', [kiungoId],
  );
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
  };
}
