// The quest board as files (quests/*.json): every change to a quest is a reviewed, dated pull request (T-14).
import { z } from 'zod';
import type { Db } from '../db';
import { compileQuest, QuestDraft } from './templates';

const Version = z.object({
  version: z.number().int().positive(),
  validFrom: z.string().datetime({ offset: true }),
  title: z.string().min(1).max(120),
  watches: z.array(z.string()),
  target: z.number().int().positive(),
  period: z.enum(['once', 'daily', 'weekly', 'monthly', 'quarterly']),
  limit: z.number().int().positive().nullable(),
  eachItem: z.enum(['ever', 'per_period']).nullable(),
  points: z.number().int().positive().nullable(),
  steps: z.array(z.record(z.string(), z.unknown())).nullable(),
  trustNeeded: z.enum(['joined', 'vouched', 'verified']),
  evidence: z.enum(['sale_code']).nullable(),
}).strict();

/** One quest file: the quest, and every version it has had, oldest first. */
export const QuestFile = z.object({
  id: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/),
  questLine: z.enum(['picture', 'needs', 'offers', 'business', 'invites', 'sharing', 'building', 'firsts']),
  template: z.enum(['repeat', 'collect', 'steps', 'streak']),
  building: z.boolean(),
  status: z.enum(['live', 'paused', 'ended']),
  versions: z.array(Version).min(1),
}).strict();
export type QuestFile = z.infer<typeof QuestFile>;

/**
 * Checks a quest file: versions numbered 1, 2, 3… with dates in order, and each version passing the same
 * template checks as a drafted quest. Returns a reason when it doesn't.
 */
export function checkQuestFile(f: QuestFile): string | null {
  for (const [i, v] of f.versions.entries()) {
    if (v.version !== i + 1) return `${f.id}: versions must be numbered 1, 2, 3… in order.`;
    if (i > 0 && Date.parse(v.validFrom) <= Date.parse(f.versions[i - 1]!.validFrom)) return `${f.id}: each version starts after the one before.`;
    if (f.questLine === 'firsts') continue; // given by the points system itself (T-10), not by watching activity
    const draft = QuestDraft.safeParse({
      id: f.id, title: v.title, questLine: f.questLine, template: f.template, building: f.building, trustNeeded: v.trustNeeded,
      ...(v.evidence ? { evidence: v.evidence } : {}),
      ...(f.template === 'steps' ? { steps: v.steps }
        : f.template === 'streak' ? { watches: v.watches, milestones: v.steps }
        : f.template === 'collect' ? { watches: v.watches, target: v.target, points: v.points }
        : { watches: v.watches, target: v.target, period: v.period, points: v.points,
            ...(v.limit !== null && v.period !== 'once' ? { limit: v.limit } : {}), ...(v.eachItem ? { eachItem: v.eachItem } : {}) }),
    });
    if (!draft.success) return `${f.id} v${v.version}: ${draft.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join(' ')}`;
    const compiled = compileQuest(draft.data);
    if ('reason' in compiled) return `${f.id} v${v.version}: ${compiled.reason}`;
  }
  return null;
}

// What a stored version must equal, field by field, for a file to count as unchanged.
const same = (v: z.infer<typeof Version>, row: Record<string, unknown>) =>
  JSON.stringify([v.title, v.watches, v.target, v.period, v.limit, v.eachItem, v.points, v.steps, v.trustNeeded, v.evidence,
    Date.parse(v.validFrom)]) ===
  JSON.stringify([row.title, row.watches, row.target, row.period, row.period_limit, row.each_item, row.points, row.steps,
    row.trust_needed, row.evidence, new Date(row.valid_from as string).getTime()]);

/**
 * Loads quest files into the database, all or nothing. New quests and new versions are added; a status change
 * is applied; a version already published that differs from its file is refused, because a change is always
 * a new version. Returns the versions added.
 */
export async function loadQuests(db: Db, files: QuestFile[]): Promise<string[]> {
  for (const f of files) {
    const reason = checkQuestFile(f);
    if (reason) throw new Error(reason);
  }
  return db.tx(async (tx) => {
    const added: string[] = [];
    for (const f of files) {
      const [q] = await tx.query<{ quest_line: string; template: string; building: boolean; unit: string | null }>(
        `INSERT INTO quests (id, quest_line, status, template, building) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status RETURNING quest_line, template, building, unit`,
        [f.id, f.questLine, f.status, f.template, f.building],
      );
      if (q!.quest_line !== f.questLine || q!.template !== f.template || q!.building !== f.building || q!.unit !== null) {
        throw new Error(`${f.id}: its quest line, template and building flag can't change; make a new quest instead.`);
      }
      for (const v of f.versions) {
        const [row] = await tx.query('SELECT * FROM quest_versions WHERE quest_id = $1 AND version = $2', [f.id, v.version]);
        if (row) {
          if (!same(v, row)) throw new Error(`${f.id} v${v.version} differs from what was published; add a new version instead.`);
          continue;
        }
        await tx.query(
          `INSERT INTO quest_versions (quest_id, version, title, watches, target, period, period_limit, each_item, points, steps,
                                       trust_needed, evidence, valid_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [f.id, v.version, v.title, v.watches, v.target, v.period, v.limit, v.eachItem, v.points,
            v.steps === null ? null : JSON.stringify(v.steps), v.trustNeeded, v.evidence, v.validFrom],
        );
        added.push(`${f.id} v${v.version}`);
      }
    }
    return added;
  });
}
