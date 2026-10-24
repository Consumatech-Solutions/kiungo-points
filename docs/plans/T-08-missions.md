# Plan: T-08 missions (issue #9)

**Goal:** the *Mission* template. A unit's shared goal ("100 shopping lists in Matete this month"); when the goal is reached, every member of the unit who contributed that period gets the bonus, once, all or nothing, even when the last two contributions arrive at the same moment.

**Requirements:** issue #9; `activities.md` §8 (community missions); TRD §4 (Standing: paying a mission's bonus once, all or nothing), §6 (`mission_progress`); ADR-002 (AMU's shared counter and single payout).

## Steps

1. Test first (`test/missions.test.ts`): the 100th list in Matete this month pays 20 to each of its contributors, once; the 101st pays nothing more; a member outside Matete doesn't count; two lists arriving at once for the last place pay each contributor once; a mission needs a unit; the unit's missions are readable with their progress.
2. Migration `0009_missions.sql`: `quests.unit` (empty for core quests); `standin_people.units`; `mission_progress` (quest, unit, period, shared count, paid at); `mission_contributors`.
3. Identity plug: a person's units.
4. `templates.ts`: the Mission template (unit, watches, target, period, points) with its checks.
5. `progress.ts`: a mission entry from a unit member locks the unit's counter, notes the contributor, and on the entry that reaches the target pays every contributor in the same transaction.
6. `GET /v1/units/:unitId/standing` (any carriage, TRD §5): the unit's live quests, and each mission's stage this period (0 to 4 quarters, never the raw count: `activities.md` §8 keeps numbers hidden until the founder switches the live count on). The core board stays core quests only.
7. Missions, like streaks, count only entries read within 14 days of when they happened (QA review).

## Test seams

`POST /standin/activity`, `POST /v1/quests`, `GET /v1/units/:unitId/quests`, `GET /v1/people/:id/standing`.

## Out of scope

Units drafting their own quests, and the 50-point limit on local steps (T-09); the full unit standing (stages).
