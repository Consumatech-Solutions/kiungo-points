# Plan: T-05 levels (issue #6)

**Goal:** levels by the rulebook. Counting points (invites count up to half of what counts, local points up to a quarter), the extra needs per level, levels that never go down with the date each was first reached, and the full standing answer.

**Requirements:** issue #6; `activities.md` (the levels, the pace tables, rules 5–7); `design.md` §5–6; TRD §4 (Standing), §5 (the standing answer with `alsoNeeds`).

## Steps

1. Test first (`test/levels.test.ts`): the whole picture (115) gives Sprout, and Root asks for 285 more and *vouched*; invites alone stall before Root even for a vouched member; 1,500 counting points without building stay at Root, and one building activity gives Fruit; 5,000 from two quest lines stays at Fruit, a third gives Seedkeeper; local points count up to a quarter; a level reached stays when the trust level drops; each level shows the date it was first reached; the standing shows the best streak.
2. Migration `0006_levels.sql`: `levels_reached` (Kiungo ID, level, first reached at).
3. `src/points/standing.ts`: totals by kind (core, invite, local) from the notebook; counting points with the two caps; the level ladder with its extra needs (trust from the identity plug; building from `quests.building` or quest line `local`; quest lines with points); record new levels; level shown is the higher of what is recorded and what is worked out.
4. Callers pass the identity plug to `standing`.

## Test seams

`POST /standin/activity` (the entry answer carries the standing) and `GET /v1/people/:id/standing`.

## Out of scope

Marks (T-10); corrections lowering totals (T-07, already handled by summing the notebook).
