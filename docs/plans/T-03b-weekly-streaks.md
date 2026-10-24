# Plan: T-03b weekly streaks (issue #4)

**Goal:** the *Streak* template. *Keep it up* counts weeks running in which a member said what they need (any quest line 2 activity), pays +20 at 4 weeks, +50 at 12 and +100 at 26, only ever adds points, forgives one missed week, and keeps the best run.

**Requirements:** issue #4; `activities.md` §8b; ADR-002 (streaks weekly, bonus only, one missed week forgiven, best run kept); AMU's streak run (`longestConsecutiveRun`), changed for the grace week.

## Steps

1. Test first (`test/streaks.test.ts`): four weeks of shopping lists pay +20 on the fourth; three weeks, one missed, then one more pays +20 (the run continues); four weeks, two missed, then one more: the run is 1, nothing taken away, best stays 4; two entries in one week count once; a late entry for an earlier week joins the run without paying a milestone twice.
2. Migration `0004_streaks.sql`: seed `streak.need_weekly` (Streak, quest line `needs`, watches the seven quest line 2 kinds, milestones 4/12/26 → 20/50/100).
3. `rules.ts`: the Streak branch. Weeks are kept as week numbers in the progress row's `counted`; a run is weeks no more than two apart (one missed week between them); a milestone is paid once per run, remembered by the week that reached it.
4. `progress.ts`: let Streak quests through; pass the week number. `questProgress` shows the current run, the best run and the next milestone.

## Test seams

`POST /standin/activity` and `GET /v1/people/:id/quests`.

## Out of scope

The best streak in the full standing answer (T-05 builds the full standing).

## Later change (founder, 2026-10-22)

An entry counts towards a streak only if it is read within 14 days of when it happened (`too_late` otherwise), so nobody can build a run after the fact. Other quests are unaffected. Tests read entries on a test clock (`setNow`).
