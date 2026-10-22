import type { Db } from '../db';
import { compileQuest, type QuestDraft } from './templates';

/** The latest live version of each live quest, in the words carriages show. */
export async function liveQuests(db: Db) {
  return db.query(
    `SELECT DISTINCT ON (v.quest_id) v.quest_id AS quest, v.title, q.quest_line AS "questLine", q.template,
            v.version, v.watches, v.target, v.period, v.period_limit AS "limit", v.each_item AS "eachItem",
            v.points, v.steps, v.trust_needed AS "trustNeeded"
       FROM quest_versions v JOIN quests q ON q.id = v.quest_id
      WHERE q.status = 'live' AND v.valid_from <= now()
      ORDER BY v.quest_id, v.version DESC`,
  );
}

export type DraftResult = { quest: string; version: number; status: string } | { reason: string };

/** Drafts a quest, or a new version of one. Nothing changes on the board until it is put live. */
export async function draftQuest(db: Db, d: QuestDraft): Promise<DraftResult> {
  const compiled = compileQuest(d);
  if ('reason' in compiled) return compiled;
  const v = compiled.version;
  return db.tx(async (tx) => {
    const [q] = await tx.query<{ status: string; template: string; quest_line: string; building: boolean }>(
      `INSERT INTO quests (id, quest_line, status, template, building) VALUES ($1, $2, 'draft', $3, $4)
       ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id RETURNING status, template, quest_line, building`,
      [d.id, d.questLine, d.template, d.building],
    );
    if (q!.status === 'ended') return { reason: 'This quest has ended. Draft it under a new id.' };
    if (q!.template !== d.template) return { reason: `This quest is a ${q!.template} quest; a new version keeps its template.` };
    if (q!.quest_line !== d.questLine || q!.building !== d.building) {
      return { reason: 'A new version keeps the quest line and whether it counts as building. Draft a new quest to change them.' };
    }
    const [row] = await tx.query<{ version: number }>(
      `INSERT INTO quest_versions (quest_id, version, title, watches, target, period, period_limit, each_item, points, steps, trust_needed)
       SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4, $5, $6, $7, $8, $9, $10 FROM quest_versions WHERE quest_id = $1
       RETURNING version`,
      [d.id, d.title, v.watches, v.target, v.period, v.period_limit, v.each_item, v.points,
        v.steps === null ? null : JSON.stringify(v.steps), d.trustNeeded],
    );
    return { quest: d.id, version: row!.version, status: q!.status };
  });
}

const NEXT: Record<'live' | 'pause' | 'end', { to: string; from: string[] }> = {
  live: { to: 'live', from: ['draft', 'live', 'paused'] },
  pause: { to: 'paused', from: ['live'] },
  end: { to: 'ended', from: ['draft', 'live', 'paused'] },
};

/**
 * Puts a quest live, pauses it or ends it. Putting live (or resuming a paused quest) also puts
 * every drafted version in force from now. Ending is for good.
 */
export async function setStatus(db: Db, id: string, step: keyof typeof NEXT) {
  return db.tx(async (tx) => {
    const [q] = await tx.query<{ status: string; template: string }>('SELECT status, template FROM quests WHERE id = $1 FOR UPDATE', [id]);
    if (!q) return { error: 'unknown_quest' as const };
    if (!NEXT[step].from.includes(q.status)) return { error: q.status === 'ended' ? 'quest_ended' as const : 'not_allowed' as const };
    if (step === 'live') {
      await tx.query('UPDATE quest_versions SET valid_from = now() WHERE quest_id = $1 AND valid_from IS NULL', [id]);
    }
    await tx.query('UPDATE quests SET status = $2 WHERE id = $1', [id, NEXT[step].to]);
    return { quest: id, status: NEXT[step].to };
  });
}
