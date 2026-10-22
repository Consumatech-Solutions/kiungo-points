// What one entry does to one quest. Adapted from the AMU engine's applyEvent (packages/core/src/rules.ts, ADR-002),
// shaped to Kiungo's templates and limits. Pure: no database, no clock.

export interface Rule {
  template: string;
  period: string;
  target: number;
  limit: number | null;
  eachItem: string | null;
  points: number | null;
  // Steps: the stages. Streak: the milestones.
  steps: { kind: string; points: number; upTo: number; period: 'once' | 'weekly' }[] | { weeks: number; points: number }[] | null;
}

// One quest's progress in one period. `counted` holds items paid, sections collected or steps reached.
export interface Progress { count: number; completions: number; counted: string[] }

export interface Decision {
  progress: Progress;
  award: { points: number; step?: string } | null;
  // Why the quest didn't pay. Null with no award means the entry only moved progress.
  reason: string | null;
}

export interface Seen {
  kind: string;
  item?: string;
  itemPaidBefore: boolean; // for eachItem 'ever': already paid in an earlier period
  week: string; // the week the entry falls in, for weekly steps (2026-W43)
  weekNo: number; // the same week as a number, for streaks
}

/** Vouching, paying money and buying anything never earn points (activities.md, rules across every quest line). */
export const NEVER_EARNS = /^(vouch|payment|purchase)\./;

const LIMIT_REASON: Record<string, string> = {
  once: 'already_done', daily: 'daily_limit', weekly: 'weekly_limit', monthly: 'monthly_limit', quarterly: 'quarterly_limit',
};

/** Decides what one entry does to one quest, given the quest's progress so far. Never changes `p`. */
export function decide(rule: Rule, p: Progress, seen: Seen): Decision {
  const stay = (reason: string | null): Decision => ({ progress: p, award: null, reason });

  if (rule.template === 'collect') {
    if (p.counted.includes(seen.kind)) return stay(null); // already collected; nothing new
    if (p.completions > 0) return stay('already_done');
    const counted = [...p.counted, seen.kind].sort();
    const done = counted.length >= rule.target;
    return {
      progress: { count: counted.length, completions: done ? 1 : 0, counted },
      award: done ? { points: rule.points! } : null,
      reason: null,
    };
  }

  if (rule.template === 'streak') return streak(rule, p, seen.weekNo);

  if (rule.template === 'steps') {
    const steps = rule.steps as { kind: string; points: number; upTo: number; period: 'once' | 'weekly' }[];
    const at = steps.findIndex((s) => s.kind === seen.kind);
    const step = steps[at]!;
    const marks = (kind: string) => p.counted.filter((c) => c === kind || c.startsWith(`${kind}@`));
    if (at > 0 && marks(steps[at - 1]!.kind).length === 0) return stay('needs_earlier_step');
    const mine = marks(step.kind);
    if (mine.length >= step.upTo) return stay('already_done');
    const mark = step.period === 'weekly' ? `${step.kind}@${seen.week}` : step.kind;
    if (mine.includes(mark)) return stay('weekly_limit'); // only weekly steps get here: a once step has upTo 1
    return {
      progress: { count: p.count + 1, completions: p.completions, counted: [...p.counted, mark] },
      award: { points: step.points, step: step.kind },
      reason: null,
    };
  }

  // Repeat
  if (rule.eachItem) {
    if (!seen.item) return stay('missing_item');
    if (seen.itemPaidBefore || p.counted.includes(seen.item)) return stay('already_done');
  }
  const limit = rule.limit ?? (rule.period === 'once' && !rule.eachItem ? 1 : Infinity);
  if (p.completions >= limit) return stay(LIMIT_REASON[rule.period]!);
  const count = p.count + 1;
  if (count < rule.target) return { progress: { ...p, count }, award: null, reason: null };
  return {
    progress: { count: 0, completions: p.completions + 1, counted: seen.item && rule.eachItem ? [...p.counted, seen.item] : p.counted },
    award: { points: rule.points! },
    reason: null,
  };
}

/** A streak's weeks (`w:<week number>`) and the milestones paid (`paid:<week that reached it>:<weeks>`). */
export function readStreak(counted: string[]) {
  const weeks = counted.filter((c) => c.startsWith('w:')).map((c) => Number(c.slice(2))).sort((a, b) => a - b);
  const paid = counted.filter((c) => c.startsWith('paid:')).map((c) => c.split(':').slice(1).map(Number) as [number, number]);
  return { weeks, paid, runs: runs(weeks) };
}

// Splits sorted weeks into runs: weeks at most two apart, so one missed week doesn't break a run.
function runs(weeks: number[]): number[][] {
  const out: number[][] = [];
  for (const w of weeks) {
    const last = out.at(-1);
    if (last && w - last.at(-1)! <= 2) last.push(w);
    else out.push([w]);
  }
  return out;
}

// Changed from AMU (ADR-002): weekly, one missed week forgiven, milestones only ever add points.
function streak(rule: Rule, p: Progress, weekNo: number): Decision {
  if (p.counted.includes(`w:${weekNo}`)) return { progress: p, award: null, reason: null };
  const counted = [...p.counted, `w:${weekNo}`];
  const { paid, runs: all } = readStreak(counted);
  const run = all.find((r) => r.includes(weekNo))!;
  // A milestone counts as paid for this run if any week inside the run already reached it.
  const due = (rule.steps as { weeks: number; points: number }[])
    .filter((m) => run.length >= m.weeks && !paid.some(([w, weeks]) => weeks === m.weeks && run.includes(w)));
  for (const m of due) counted.push(`paid:${weekNo}:${m.weeks}`);
  const top = due.at(-1);
  return {
    progress: { count: p.count, completions: p.completions + due.length, counted }, // runs are read from `counted`
    award: top ? { points: due.reduce((sum, m) => sum + m.points, 0), step: `${top.weeks} weeks` } : null,
    reason: null,
  };
}
