// The quest board as files (quests/*.json): every change to a quest is a reviewed, dated pull request (T-14).
import { z } from 'zod';
import type { Db } from '../db';
import { compileQuest, MONEY_WORDS, QuestDraft, type QuestVersion } from './templates';

const Version = z.object({
  version: z.number().int().positive(),
  validFrom: z.string().datetime({ offset: true }),
  title: z.string().min(1).max(120),
  watches: z.array(z.string()),
  target: z.number().int().positive(),
  period: z.enum(['once', 'daily', 'weekly', 'monthly', 'quarterly']),
  limit: z.number().int().positive().nullable(),
  eachItem: z.enum(['ever', 'per_period']).nullable(),
  points: z.number().int().min(1).max(1000).nullable(),
  steps: z.array(z.record(z.string(), z.unknown())).nullable(),
  trustNeeded: z.enum(['joined', 'vouched', 'verified']),
  evidence: z.enum(['sale_code']).nullable(),
}).strict();
type Version = z.infer<typeof Version>;

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

// JSON with object keys sorted, so two equal values compare equal whatever order the database keeps keys in.
const canon = (x: unknown): string => JSON.stringify(x, (_k, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

// What a version means once compiled: the exact row the engine runs on.
const asRow = (v: Version): QuestVersion => ({
  watches: v.watches, target: v.target, period: v.period, period_limit: v.limit, each_item: v.eachItem, points: v.points, steps: v.steps,
});

/**
 * Checks a quest file: versions numbered 1, 2, 3… with dates in order, and each version passing the same template
 * checks as a drafted quest and written out in full, exactly as the engine will run it (no defaults left implied).
 * Returns a reason when it doesn't.
 */
export function checkQuestFile(f: QuestFile): string | null {
  for (const [i, v] of f.versions.entries()) {
    if (v.version !== i + 1) return `${f.id}: versions must be numbered 1, 2, 3… in order.`;
    if (i > 0 && Date.parse(v.validFrom) <= Date.parse(f.versions[i - 1]!.validFrom)) return `${f.id}: each version starts after the one before.`;
    if (MONEY_WORDS.test(v.title)) return `${f.id} v${v.version}: the title hints that points are worth money; points have no cash value.`;
    if (f.questLine === 'firsts') {
      // given by the points system itself (T-10), never by watching activity
      if (v.watches.length || v.points === null || v.period !== 'once') return `${f.id} v${v.version}: a first watches nothing, pays once, and has points.`;
      continue;
    }
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
    if (canon(asRow(v)) !== canon(compiled.version)) {
      return `${f.id} v${v.version}: write it out as it runs: ${canon(compiled.version)}`;
    }
  }
  return null;
}

/**
 * Loads quest files into the database, all or nothing. New quests and new versions are added; a status change is
 * applied, except that an ended quest stays ended. Refused: a version already published that differs from its file
 * (a change is always a new version), and a new version dated before activity already read for the quest (the past
 * is never rewritten). Returns what changed, in words.
 */
export async function loadQuests(db: Db, files: QuestFile[]): Promise<string[]> {
  for (const f of files) {
    const reason = checkQuestFile(f);
    if (reason) throw new Error(reason);
  }
  return db.tx(async (tx) => {
    const changed: string[] = [];
    for (const f of files) {
      const [before] = await tx.query<{ status: string }>('SELECT status FROM quests WHERE id = $1', [f.id]);
      if (before?.status === 'ended' && f.status !== 'ended') throw new Error(`${f.id} has ended, and an ended quest stays ended.`);
      const [q] = await tx.query<{ quest_line: string; template: string; building: boolean; unit: string | null }>(
        `INSERT INTO quests (id, quest_line, status, template, building) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status RETURNING quest_line, template, building, unit`,
        [f.id, f.questLine, f.status, f.template, f.building],
      );
      if (q!.quest_line !== f.questLine || q!.template !== f.template || q!.building !== f.building || q!.unit !== null) {
        throw new Error(`${f.id}: its quest line, template and building flag can't change; make a new quest instead.`);
      }
      if (before && before.status !== f.status) changed.push(`${f.id} is now ${f.status}`);
      for (const v of f.versions) {
        const [row] = await tx.query<{ same: boolean; valid_from: Date | null }>(
          `SELECT valid_from, (title, watches, target, period, period_limit, each_item, points, trust_needed, evidence)
                    IS NOT DISTINCT FROM ($3, $4::text[], $5::int, $6, $7::int, $8, $9::int, $10, $11)
                  AND steps IS NOT DISTINCT FROM $12::jsonb AND valid_from IS NOT DISTINCT FROM $13::timestamptz AS same
             FROM quest_versions WHERE quest_id = $1 AND version = $2`,
          [f.id, v.version, v.title, v.watches, v.target, v.period, v.limit, v.eachItem, v.points, v.trustNeeded, v.evidence,
            v.steps === null ? null : JSON.stringify(v.steps), v.validFrom],
        );
        if (row) {
          if (row.valid_from === null) throw new Error(`${f.id} v${v.version} is a draft made through the admin API; core quests change by file only.`);
          if (!row.same) throw new Error(`${f.id} v${v.version} differs from what was published; add a new version instead.`);
          continue;
        }
        // Activity already read from that date on was judged by the old rules; a new version can't reach back over it.
        const [touched] = await tx.query(
          `SELECT 1 WHERE EXISTS (SELECT 1 FROM entries_read e JOIN quest_versions p ON p.quest_id = $1
                                   WHERE e.kind = ANY(p.watches || $2::text[]) AND e.occurred_at >= $3)
                       OR EXISTS (SELECT 1 FROM awards a JOIN entries_read e ON e.entry_id = a.entry_id
                                   WHERE a.quest_id = $1 AND e.occurred_at >= $3)`,
          [f.id, v.watches, v.validFrom],
        );
        if (touched) throw new Error(`${f.id} v${v.version} starts ${v.validFrom}, but activity from then on has already been read; give it a date from now on.`);
        await tx.query(
          `INSERT INTO quest_versions (quest_id, version, title, watches, target, period, period_limit, each_item, points, steps,
                                       trust_needed, evidence, valid_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [f.id, v.version, v.title, v.watches, v.target, v.period, v.limit, v.eachItem, v.points,
            v.steps === null ? null : JSON.stringify(v.steps), v.trustNeeded, v.evidence, v.validFrom],
        );
        changed.push(`${f.id} v${v.version} added, in force from ${v.validFrom}`);
      }
    }
    return changed;
  });
}
