# Plan: T-02 the quest board and templates (issue #2)

**Goal:** quests become versioned data, written from templates that check them; drafts go live only on a separate step; every core activity in `activities.md` (quest lines 1 to 7) is on the board; `GET /v1/quests` shows it.

**Requirements:** issue #2; TRD §4 (Quests), §5, §6; ADR-002 (AMU's template checks reused); `activities.md` lines 1–7.

## Steps

1. Test first (`test/quests.test.ts`): the board equals a table typed out by hand from `activities.md` (quest, points, how often, limit, trust); a draft with target 0 is refused; a draft is not on the board until it is put live; a new version of a live quest leaves the old one in force until it goes live; pause and end; admin key needed.
2. Migration `0002_quest_board.sql`:
   - `quests`: add `template` (repeat, collect, steps, streak, mission) and `building` (counts as a building activity for Fruit, used in T-05).
   - `quest_versions`: add `title`; `watches` becomes a list; add `each_item` (`ever` or `per_period`), `period_limit`, `steps` (steps or milestones, as JSON); add the `quarterly` period ("once every 3 months"); `points` may be empty for templates whose steps carry the points; `valid_from` may be empty (a drafted version not yet live).
   - Seed the 45 core quests.
3. `src/quests/templates.ts`: one Zod shape per template, plus the checks AMU's compiler makes (positive targets, a Collect target no bigger than what it watches, unique steps, ascending milestones). Mission says "not yet available" until T-08.
4. `src/quests/board.ts`: `liveQuests`, `draftQuest`, `setStatus` (live, pause, end).
5. Routes: `GET /v1/quests` (camelCase fields), `POST /v1/quests`, `POST /v1/quests/:id/live|pause|end` (admin key).

## Test seams

`GET /v1/quests` and `POST /v1/quests…` (the Quests interface in TRD §4). Catches: board contents, the template checks, draft-to-live. Misses: progress against the new rules (T-03).

## Out of scope

Progress for periods, items, Collect and Steps (T-03); the Streak quest itself (T-03b); evidence (T-04); local quests and the 50-point limit (T-09); "get a quest as it was at a moment" (no caller yet).
