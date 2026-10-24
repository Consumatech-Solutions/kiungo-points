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

/**
 * Drafts a quest, or a new version of one, noting the member who proposed it (null for the admin).
 * Nothing changes on the board until it is put live.
 */
export async function draftQuest(db: Db, d: QuestDraft, proposedBy: string | null = null): Promise<DraftResult> {
  const compiled = compileQuest(d);
  if ('reason' in compiled) return compiled;
  const v = compiled.version;
  return db.tx(async (tx) => {
    if (v.after_quest) {
      const reason = await followable(tx, v.after_quest);
      if (reason) return { reason };
    }
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
      `INSERT INTO quest_versions (quest_id, version, title, watches, target, period, period_limit, each_item, points, steps, trust_needed, evidence, after_quest, proposed_by)
       SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13 FROM quest_versions WHERE quest_id = $1
       RETURNING version`,
      [d.id, d.title, v.watches, v.target, v.period, v.period_limit, v.each_item, v.points,
        v.steps === null ? null : JSON.stringify(v.steps), d.trustNeeded, d.evidence ?? null, v.after_quest, proposedBy],
    );
    return { quest: d.id, version: row!.version, status: q!.status };
  });
}

type VersionView = {
  version: number; title: string; watches: string[]; target: number; period: string; limit: number | null; eachItem: string | null;
  points: number | null; steps: unknown; trustNeeded: string; evidence: string | null; after: string | null; proposedBy: string | null;
};
export type UnitDraft = { quest: string; template: string; status: string; in: number; live: VersionView | null; pending: VersionView[] };

/**
 * A unit's challenges with versions waiting to be put live, oldest first, each beside the version live now
 * (null for a challenge never live), and who proposed each one.
 */
export async function unitDrafts(db: Db, unit: string): Promise<UnitDraft[]> {
  const rows = await db.query<VersionView & { quest: string; template: string; status: string; in: number; drafted: boolean }>(
    `SELECT v.quest_id AS quest, q.template, q.status, v.valid_from IS NULL AS drafted,
            (SELECT COUNT(*)::int FROM quest_backers b WHERE b.quest_id = q.id) AS "in",
            v.version, v.title, v.watches, v.target, v.period, v.period_limit AS "limit", v.each_item AS "eachItem", v.points,
            v.steps, v.trust_needed AS "trustNeeded", v.evidence, v.after_quest AS "after", v.proposed_by AS "proposedBy"
       FROM quest_versions v JOIN quests q ON q.id = v.quest_id
      WHERE q.unit = $1 AND q.status <> 'ended'
        AND EXISTS (SELECT 1 FROM quest_versions p WHERE p.quest_id = q.id AND p.valid_from IS NULL)
      ORDER BY v.quest_id, v.version`,
    [unit],
  );
  const drafts: UnitDraft[] = [];
  for (const { quest, template, status, in: n, drafted, ...version } of rows) {
    if (drafts.at(-1)?.quest !== quest) drafts.push({ quest, template, status, in: n, live: null, pending: [] });
    const d = drafts.at(-1)!;
    if (drafted) d.pending.push(version);
    else d.live = version; // versions come in order, so the last one in force is the live one
  }
  return drafts;
}

const NEXT: Record<'live' | 'pause' | 'end', { to: string; from: string[] }> = {
  live: { to: 'live', from: ['draft', 'live', 'paused'] },
  pause: { to: 'paused', from: ['live'] },
  end: { to: 'ended', from: ['draft', 'live', 'paused'] },
};

/** Why a quest can't be followed (it doesn't exist, or isn't paid once per item), or null if it can. */
export async function followable(db: Db, id: string): Promise<string | null> {
  const [v] = await db.query<{ each_item: string | null }>(
    'SELECT each_item FROM quest_versions WHERE quest_id = $1 AND valid_from IS NOT NULL ORDER BY version DESC LIMIT 1', [id],
  );
  if (!v) return `There is no quest ${id} to follow.`;
  if (!v.each_item) return `${id} isn't paid once per item, so a quest can't follow it.`;
  return null;
}

/** How many of the unit's members must tap "I'm in" before a member's suggested challenge can go live. */
export const MEMBERS_NEEDED = 10; // shortcut: a fixed 10 the founder set; "a fifth of the unit" needs the identity rail to count a unit's members (T-12).

// The member who suggested a challenge (its first version's proposer), or null for a mission or an admin's draft.
async function suggester(tx: Db, id: string, template: string): Promise<string | null> {
  if (template === 'mission') return null;
  const [v] = await tx.query<{ proposed_by: string | null }>('SELECT proposed_by FROM quest_versions WHERE quest_id = $1 AND version = 1', [id]);
  return v?.proposed_by ?? null;
}

const backers = async (tx: Db, id: string) =>
  (await tx.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM quest_backers WHERE quest_id = $1', [id]))[0]!.n;

/**
 * A member taps "I'm in" on a suggested challenge, or takes it back. Open only while the suggestion is a draft;
 * the suggester can't back their own. Returns how many are in, never who.
 */
export async function setIn(db: Db, quest: string, kiungoId: string, step: 'in' | 'out') {
  return db.tx(async (tx) => {
    // The same lock as setStatus, so a withdrawal can't race an approval.
    const [q] = await tx.query<{ status: string; template: string }>('SELECT status, template FROM quests WHERE id = $1 FOR UPDATE', [quest]);
    if (!q) return { error: 'unknown_quest' as const };
    const by = await suggester(tx, quest, q.template);
    if (q.status !== 'draft' || !by) return { error: 'not_open' as const };
    if (by === kiungoId) return { error: 'own_suggestion' as const };
    await tx.query(step === 'in'
      ? 'INSERT INTO quest_backers (quest_id, kiungo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING'
      : 'DELETE FROM quest_backers WHERE quest_id = $1 AND kiungo_id = $2', [quest, kiungoId]);
    return { quest, in: await backers(tx, quest), needed: MEMBERS_NEEDED };
  });
}

/** A unit's open suggestions (members' challenges not yet live), oldest first, with how many are in and whether this member is. */
export async function suggestions(db: Db, unit: string, kiungoId: string) {
  const rows = await db.query<{ quest: string; title: string; template: string; steps: unknown; watches: string[]; points: number | null; in: number; youAreIn: boolean }>(
    `SELECT DISTINCT ON (q.id) q.id AS quest, v.title, q.template, v.steps, v.watches, v.points,
            (SELECT COUNT(*)::int FROM quest_backers b WHERE b.quest_id = q.id) AS "in",
            EXISTS (SELECT 1 FROM quest_backers b WHERE b.quest_id = q.id AND b.kiungo_id = $2) AS "youAreIn"
       FROM quests q JOIN quest_versions v ON v.quest_id = q.id
      WHERE q.unit = $1 AND q.status = 'draft' AND q.template <> 'mission'
        AND EXISTS (SELECT 1 FROM quest_versions f WHERE f.quest_id = q.id AND f.version = 1 AND f.proposed_by IS NOT NULL)
      ORDER BY q.id, v.version DESC`,
    [unit, kiungoId],
  );
  return rows.map((r) => ({ ...r, needed: MEMBERS_NEEDED }));
}

/** The unit a quest belongs to (null for a core quest), or undefined if there is no such quest. */
export async function questUnit(db: Db, id: string): Promise<string | null | undefined> {
  const [q] = await db.query<{ unit: string | null }>('SELECT unit FROM quests WHERE id = $1', [id]);
  return q ? q.unit : undefined;
}

/**
 * Puts a quest live, pauses it or ends it. Putting live (or resuming a paused quest) also puts
 * every drafted version in force from now. Ending is for good. A member's suggestion goes live only once
 * MEMBERS_NEEDED are in; putting one live returns its suggester (suggestedBy), to be paid.
 */
export async function setStatus(db: Db, id: string, step: keyof typeof NEXT) {
  return db.tx(async (tx) => {
    const [q] = await tx.query<{ status: string; template: string }>('SELECT status, template FROM quests WHERE id = $1 FOR UPDATE', [id]);
    if (!q) return { error: 'unknown_quest' as const };
    if (!NEXT[step].from.includes(q.status)) return { error: q.status === 'ended' ? 'quest_ended' as const : 'not_allowed' as const };
    const suggestedBy = step === 'live' ? await suggester(tx, id, q.template) : null;
    if (suggestedBy && q.status === 'draft') {
      const n = await backers(tx, id);
      if (n < MEMBERS_NEEDED) return { error: 'needs_more_members' as const, in: n, needed: MEMBERS_NEEDED };
    }
    if (step === 'live') {
      await tx.query('UPDATE quest_versions SET valid_from = now() WHERE quest_id = $1 AND valid_from IS NULL', [id]);
    }
    await tx.query('UPDATE quests SET status = $2 WHERE id = $1', [id, NEXT[step].to]);
    return { quest: id, status: NEXT[step].to, suggestedBy };
  });
}
