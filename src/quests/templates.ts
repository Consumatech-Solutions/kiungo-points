// Quest templates and their checks. Adapted from the AMU engine's compiler (packages/core/src/compile.ts, ADR-002).
import { z } from 'zod';
import { NEVER_EARNS } from '../points/rules';

const KIND = z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/, 'Use lower-case words joined by dots, e.g. need.shopping_list.');
const positive = (label: string) => z.number().int().refine((n) => n > 0, `${label} must be a positive number.`)
  .refine((n) => n <= 1000, `${label} can be at most 1000.`);

const common = {
  id: KIND,
  title: z.string().min(1).max(120),
  questLine: z.enum(['picture', 'needs', 'offers', 'business', 'invites', 'sharing', 'building', 'local']),
  trustNeeded: z.enum(['joined', 'vouched', 'verified']),
  building: z.boolean().default(false),
  evidence: z.enum(['sale_code', 'photo']).optional(),
};

const step = z.object({
  kind: KIND,
  points: positive('Every step\'s points'),
  upTo: positive('upTo').default(1),
  period: z.enum(['once', 'weekly']).default('once'),
}).strict();

/** What an admin sends to draft a quest. Unknown fields are refused. */
export const QuestDraft = z.discriminatedUnion('template', [
  z.object({
    ...common,
    template: z.literal('repeat'),
    watches: z.array(KIND).min(1),
    target: positive('target'),
    period: z.enum(['once', 'daily', 'weekly', 'monthly', 'quarterly']),
    limit: positive('limit').optional(),
    eachItem: z.enum(['ever', 'per_period']).optional(),
    points: positive('points'),
  }).strict(),
  z.object({
    ...common,
    template: z.literal('collect'),
    watches: z.array(KIND).min(1),
    target: positive('target'),
    points: positive('points'),
  }).strict(),
  z.object({ ...common, template: z.literal('steps'), steps: z.array(step).min(1) }).strict(),
  z.object({
    ...common,
    template: z.literal('streak'),
    watches: z.array(KIND).min(1),
    milestones: z.array(z.object({ weeks: positive('weeks'), points: positive('Every milestone\'s points') }).strict()).min(1),
  }).strict(),
  z.object({ ...common, template: z.literal('mission') }).strict(),
]);
export type QuestDraft = z.infer<typeof QuestDraft>;

/** The quest as stored in one version row. */
export interface QuestVersion {
  watches: string[]; target: number; period: string; period_limit: number | null;
  each_item: string | null; points: number | null; steps: unknown;
}

/**
 * Checks a draft makes sense and turns it into a version row. Returns a reason, in words
 * the author can act on, when it doesn't.
 */
export function compileQuest(d: QuestDraft): { version: QuestVersion } | { reason: string } {
  const unique = (xs: string[]) => xs.find((x, i) => xs.indexOf(x) !== i);
  const watched = 'watches' in d ? d.watches as string[] : 'steps' in d ? (d.steps as { kind: string }[]).map((s) => s.kind) : [];
  const unpaid = watched.find((k) => NEVER_EARNS.test(k));
  if (unpaid) return { reason: `${unpaid} never earns points: vouching, paying and buying are never rewarded.` };
  switch (d.template) {
    case 'repeat': {
      if (unique(d.watches)) return { reason: `${unique(d.watches)} is watched twice.` };
      if (d.period === 'once' && d.limit) return { reason: 'A once-only quest has no limit per period.' };
      if (d.eachItem === 'per_period' && d.period === 'once') return { reason: 'Once per item per period needs a repeating period.' };
      if (d.eachItem && d.target > 1) return { reason: 'A quest paid once per item has a target of 1.' };
      return { version: {
        watches: d.watches, target: d.target, period: d.period,
        // a repeating quest with no limit pays once per period, unless each item pays on its own
        period_limit: d.period === 'once' ? null : d.limit ?? (d.eachItem ? null : 1),
        each_item: d.eachItem ?? null, points: d.points, steps: null,
      } };
    }
    case 'collect': {
      if (unique(d.watches)) return { reason: `${unique(d.watches)} is watched twice.` };
      if (d.target > d.watches.length) {
        return { reason: `The target is ${d.target}, but the quest only watches ${d.watches.length} different things.` };
      }
      return { version: { watches: d.watches, target: d.target, period: 'once', period_limit: null, each_item: null, points: d.points, steps: null } };
    }
    case 'steps': {
      const kinds = d.steps.map((s) => s.kind);
      if (unique(kinds)) return { reason: `The step ${unique(kinds)} appears twice.` };
      const repeated = d.steps.find((s) => s.upTo > 1 && s.period !== 'weekly');
      if (repeated) return { reason: `The step ${repeated.kind} can repeat only as a weekly step.` };
      return { version: { watches: kinds, target: d.steps.length, period: 'once', period_limit: null, each_item: null, points: null, steps: d.steps } };
    }
    case 'streak': {
      const weeks = d.milestones.map((m) => m.weeks);
      if (weeks.some((w, i) => i > 0 && w <= weeks[i - 1]!)) return { reason: 'Milestones must go up, each longer than the last.' };
      return { version: {
        watches: d.watches, target: weeks.at(-1)!, period: 'once', period_limit: null, each_item: null, points: null, steps: d.milestones,
      } };
    }
    case 'mission':
      return { reason: 'The mission template is not yet available.' };
  }
}
