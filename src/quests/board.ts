import type { Db } from '../db';
import { compileQuest, type QuestDraft } from './templates';

/** The latest live version of each live quest, in the words carriages show. */
export async function liveQuests(db: Db) {
  return db.query(
    `SELECT DISTINCT ON (v.quest_id) v.quest_id AS quest, v.title, q.quest_line AS "questLine", q.template,
            v.version, v.watches, v.target, v.period, v.period_limit AS "limit", v.each_item AS "eachItem",
            v.points, v.steps, v.trust_needed AS "trustNeeded", v.evidence, v.after_quest AS "after"
       FROM quest_versions v JOIN quests q ON q.id = v.quest_id
      WHERE q.status = 'live' AND v.valid_from <= now() AND q.unit IS NULL
      ORDER BY v.quest_id, v.version DESC`,
  );
}

/**
 * A unit's live quests and missions. A mission shows its stage this period (0 to 4 quarters of the way,
 * 4 when done), never the raw count, until the founder switches the live count on (activities.md §8).
 */
export async function unitStanding(db: Db, unit: string, at: Date, periodOf: (period: string) => string) {
  const quests = await db.query<{ quest: string; title: string; template: string; target: number; period: string; points: number | null }>(
    `SELECT DISTINCT ON (v.quest_id) v.quest_id AS quest, v.title, q.template, v.target, v.period, v.points
       FROM quest_versions v JOIN quests q ON q.id = v.quest_id
      WHERE q.status = 'live' AND v.valid_from <= $2 AND q.unit = $1
      ORDER BY v.quest_id, v.version DESC`,
    [unit, at.toISOString()],
  );
  const missions = await db.query<{ quest_id: string; period_key: string; count: number; paid_at: Date | null }>(
    'SELECT quest_id, period_key, count, paid_at FROM mission_progress WHERE unit = $1', [unit],
  );
  return quests.map(({ target, ...q }) => {
    if (q.template !== 'mission') return { ...q, stage: null, done: null };
    const period = periodOf(q.period);
    const m = missions.find((r) => r.quest_id === q.quest && r.period_key === period);
    const done = !!m?.paid_at;
    return { ...q, period, stage: done ? 4 : Math.min(3, Math.floor((4 * (m?.count ?? 0)) / target)), done };
  });
}

export type DraftResult = { quest: string; version: number; status: string } | { reason: string };

/** Drafts a quest, or a new version of one. Nothing changes on the board until it is put live. */
export async function draftQuest(db: Db, d: QuestDraft): Promise<DraftResult> {
  const compiled = compileQuest(d);
  if ('reason' in compiled) return compiled;
  const v = compiled.version;
  return db.tx(async (tx) => {
    const [q] = await tx.query<{ status: string; template: string; quest_line: string; building: boolean; unit: string | null }>(
      `INSERT INTO quests (id, quest_line, status, template, building, unit) VALUES ($1, $2, 'draft', $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id RETURNING status, template, quest_line, building, unit`,
      [d.id, d.questLine, d.template, d.building, d.unit ?? null],
    );
    if (q!.status === 'ended') return { reason: 'This quest has ended. Draft it under a new id.' };
    if (q!.template !== d.template) return { reason: `This quest is a ${q!.template} quest; a new version keeps its template.` };
    if (q!.quest_line !== d.questLine || q!.building !== d.building || q!.unit !== (d.unit ?? null)) {
      return { reason: 'A new version keeps the quest line, its unit and whether it counts as building. Draft a new quest to change them.' };
    }
    const [row] = await tx.query<{ version: number }>(
      `INSERT INTO quest_versions (quest_id, version, title, watches, target, period, period_limit, each_item, points, steps, trust_needed, evidence, after_quest)
       SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12 FROM quest_versions WHERE quest_id = $1
       RETURNING version`,
      [d.id, d.title, v.watches, v.target, v.period, v.period_limit, v.each_item, v.points,
        v.steps === null ? null : JSON.stringify(v.steps), d.trustNeeded, d.evidence ?? null, v.after_quest],
    );
    return { quest: d.id, version: row!.version, status: q!.status };
  });
}

const NEXT: Record<'live' | 'pause' | 'end', { to: string; from: string[] }> = {
  live: { to: 'live', from: ['draft', 'live', 'paused'] },
  pause: { to: 'paused', from: ['live'] },
  end: { to: 'ended', from: ['draft', 'live', 'paused'] },
};

/** The unit a quest belongs to (null for a core quest), or undefined if there is no such quest. */
export async function questUnit(db: Db, id: string): Promise<string | null | undefined> {
  const [q] = await db.query<{ unit: string | null }>('SELECT unit FROM quests WHERE id = $1', [id]);
  return q ? q.unit : undefined;
}

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
