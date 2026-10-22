// What one entry does to one quest. Adapted from the AMU engine's applyEvent (packages/core/src/rules.ts, ADR-002),
// shaped to Kiungo's templates and limits. Pure: no database, no clock.

export interface Rule {
  template: string;
  period: string;
  target: number;
  limit: number | null;
  eachItem: string | null;
  points: number | null;
  steps: { kind: string; points: number; upTo: number; period: 'once' | 'weekly' }[] | null;
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
  week: string; // the week the entry falls in, for weekly steps
}

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

  if (rule.template === 'steps') {
    const steps = rule.steps!;
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
