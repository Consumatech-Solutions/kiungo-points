# Plan: T-16 rating with a written comment (issue #30)

**Goal:** a verified rating with the sale code stays 5; a written comment on that same rating adds 5, once per sale code, the same whether the feedback is good or bad (founder, decision 6 of 2026-10-24). Buying never earns.

## Steps

1. Test first (`test/ratings.test.ts`): rating with comment pays 10 (5 + 5); without, 5; a comment on a sale code with no paid rating, or a second comment, pays nothing; a later comment still pays; the comment needs the sale code; buying never earns.
2. Migration `0012_after_quest.sql`: `quest_versions.after_quest`, a quest that pays for an item only once another quest has paid for the same item.
3. `templates.ts`, `files.ts`, `board.ts`: the optional `after` on Repeat quests (paid once per item, following a different quest); shown on the board.
4. `rules.ts`, `progress.ts`: `needs_earlier_quest` until the quest it follows has paid for that item.
5. A new quest file, `quests/rating.commented.json`, following `rating.verified`.

## Test seams

`POST /standin/activity`, `GET /v1/quests`.
