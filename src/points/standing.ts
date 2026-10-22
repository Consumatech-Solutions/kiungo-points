import type { Db } from '../db';

/** Level thresholds from activities.md. shortcut: points only; the extra needs per level arrive in T-05. */
export const LEVELS = [
  { level: 'Seed', from: 10 },
  { level: 'Sprout', from: 100 },
  { level: 'Root', from: 400 },
  { level: 'Fruit', from: 1500 },
  { level: 'Seedkeeper', from: 5000 },
] as const;

export interface Standing {
  kiungoId: string;
  total: number;
  level: string | null;
  next: { level: string; pointsToGo: number } | null;
}

/** Standing: worked out from the notebook, never stored by hand. */
export async function standing(db: Db, kiungoId: string): Promise<Standing> {
  const [row] = await db.query<{ total: string | number }>(
    'SELECT COALESCE(SUM(points), 0) AS total FROM awards WHERE kiungo_id = $1', [kiungoId],
  );
  const total = Number(row?.total ?? 0);
  const reached = LEVELS.filter((l) => total >= l.from);
  const nextLevel = LEVELS.find((l) => total < l.from);
  return {
    kiungoId,
    total,
    level: reached.at(-1)?.level ?? null,
    next: nextLevel ? { level: nextLevel.level, pointsToGo: nextLevel.from - total } : null,
  };
}
