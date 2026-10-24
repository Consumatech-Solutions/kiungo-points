# Plan: T-14 quests as public files (issue #28)

**Goal:** the quest board lives in files in this public repository, one per quest with every version and its date, loaded into the database by a loader. Every change to a quest is a reviewed, dated pull request (founder, decision 3 of 2026-10-24).

## Steps

1. Generate `quests/*.json` from today's board (49 core quests), so the files match exactly.
2. Test first (`test/quest-files.test.ts`): a file for every quest on the board; loading into a fresh database adds nothing new; a new version takes effect from its date; a changed published version is refused and nothing changes; a file breaking the template checks or skipping a version number is refused; a file can pause a quest.
3. `src/quests/files.ts`: the file format (Zod), `checkQuestFile` (numbering, dates, the same template checks as drafting), `loadQuests` (all or nothing).
4. `scripts/load-quests.ts` and `npm run load-quests` (founder, with `DATABASE_URL`); the tests load the files into every test database.
5. `quests/README.md` (how to change a quest), README set-up step, CLAUDE.md rule.

## Test seams

`loadQuests` (the Quests interface for files) and `GET /v1/quests`.

## Out of scope

The quest builder screen in my.kiungo.africa for units and Seedkeepers (later, per the founder's decision).
