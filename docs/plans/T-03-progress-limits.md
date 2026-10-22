# Plan: T-03 progress and limits (issue #3)

**Goal:** one activity entry moves every quest it touches, by its template: *Repeat* (once, once per item, limits per day, week, month and quarter in the member's own time zone), *Collect* (N different things) and *Steps* (stages in order); safe when two entries arrive at once; each member's progress readable.

**Requirements:** issue #3; TRD §3 (one activity, end to end), §4 (Progress), §6 (`quest_progress`, `awards`); ADR-002 (AMU's period maths and counting reused).

## Steps

1. Copy AMU's `periods.ts` and its tests to `src/points/periods.ts` / `test/periods.test.ts`, renamed to Kiungo's periods (`once`) and with `quarterly` added.
2. Test first (`test/progress.test.ts`): three shopping lists in one week pay 10, 10, then 0 "weekly limit"; next Monday in Kinshasa pays 10 again; 12 picture sections pay the 25 bonus once; once per item (surveys) and once per item per quarter (services); Steps in order with a weekly check-in; two entries at once with one place left pay once; a redelivered entry gets the same answer; `GET /v1/people/:id/quests`.
3. Migration `0003_progress.sql`: `quest_progress.counted` (the things counted: items, sections, step marks); `awards.step` and `awards.reason`; `standin_entries.item` and `evidence`.
4. `src/points/rules.ts`: the pure decision for one quest and one entry (AMU's `applyEvent`, shaped to Kiungo's templates and limits).
5. `src/points/progress.ts`: per quest, make sure the progress row exists, lock it (`FOR UPDATE`), decide, write. A quest that can't pay writes a 0-point line with its reason, so a redelivered entry gets the same answer from the notebook.
6. The activity plug carries `item` and `evidence` references; the stand-in rail accepts them.
7. `GET /v1/people/:kiungoId/quests`: progress on each quest the member has touched.

## Test seams

`POST /standin/activity` (take an entry, through the stand-in rail) and `GET /v1/people/:id/quests` / `standing`. `periods.ts` keeps AMU's own unit tests (pure logic, copied with them).

## Out of scope

Streaks (T-03b), evidence and never-earns (T-04), reader permission on the progress route (T-06).
