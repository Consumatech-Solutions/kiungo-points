# T-21 Accept a rating comment that arrives before its rating — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A comment read before its rating waits, and earns its 5 points as soon as that rating earns. Nobody has to send it again.

**Architecture:** Today a comment read too early writes a 0-point line with reason `needs_earlier_quest`. That line already says "this entry is waiting": it holds the member, the quest and the item (the sale code). When a quest pays for an item, Progress looks for waiting lines of quests that follow it (`after_quest`), for the same member and item, and runs each waiting entry through that one quest again, exactly as if it had just arrived. All the usual rules apply (the version in force when the comment happened, once per item, trust). The waiting 0-point line stays, because the notebook is insert only. The new paid line carries the comment's own entry id. The rule is general (`after`), not special to ratings.

**Tech Stack:** TypeScript, plain SQL through `Db`, PGlite in tests (vitest).

**Spec:** GitHub issue #38 (T-21). T-16 (#30, #34): the `after` rule. Founder's decision of 2026-10-24: a comment earns only on a rating that itself earned.

## Global Constraints

- The notebook (`awards`) is insert only. The waiting 0-point line is never changed. Payment is a new line.
- The points system never sees the comment's words. Only the entry id, the item (sale code) and the fact that it had evidence.
- No migration is needed: the waiting line and `entries_read` already hold what's needed.
- Points have no cash value: no money words.

## Review Focus

1. A waiting comment and a later resend of the same comment: only one 5 (once per sale code). Tested in Task 1.
2. Two different waiting comments on the same sale code: only one pays. Tested in Task 1.
3. Another member's waiting comment on the same sale code is not paid by this member's rating. Tested in Task 1.
4. The rating earns nothing (past the 5-a-week limit): the comment keeps waiting and earns nothing. Tested in Task 1.
5. A comment and its rating arriving at the same moment in two transactions: neither can miss the other. Both take the same lock (below). PGlite can't race, so this is a smoke test here, and part of the staging check against real PostgreSQL.

---

### Task 1: Pay waiting comments when their rating pays

**Files:**
- Modify: `src/points/progress.ts`
- Test: `test/ratings.test.ts`

**Interfaces:**
- Internal to `progress.ts` (not exported):
  - `questsInForce(tx: Db, occurredAt: string, kind: string): Promise<LiveQuest[]>`: the existing in-force SELECT, moved out of `takeEntry` unchanged.
  - `applyQuest(tx: Db, person: Person, entry: ActivityEntry, q: LiveQuest, now: Date, result: EntryResult): Promise<void>`: the existing body of the `for (const q of quests)` loop, moved out unchanged (with `write` and `notPaid`). It returns `void`; `continue` becomes `return`.
  - `payWaiting(tx: Db, person: Person, paidQuest: string, item: string, now: Date): Promise<void>`: called from `applyQuest` right after a paid award (`d.award` with points > 0) for an entry that has an item.

- [ ] **Step 1: Write the failing tests** in `test/ratings.test.ts`, in the T-16 describe block, using the existing `rate` and `comment` helpers and `GET /v1/people/k-amina/awards` for history lines (`quest`, `points`, `entry`).

  - Replace `pays nothing for a comment that arrives before its rating` with `pays a comment that arrived before its rating as soon as the rating pays`: `comment('sale-881','c1')` → `notAwarded` `[{ quest: COMMENT, reason: 'needs_earlier_quest' }]`. Then `rate('sale-881','r1')` → `awards` `[{ quest: RATE, points: 5 }]` and `total` 10. History has one `COMMENT` line with `points: 5, entry: 'c1'`.
  - `pays the waiting comment once, even if it is sent again`: c1, r1, then `comment('sale-881','c2')` → `notAwarded` `[{ quest: COMMENT, reason: 'already_done' }]`. Redelivering c1 (`comment('sale-881','c1')` again) → `awards` `[{ quest: COMMENT, points: 5 }]`, `notAwarded` `[]`.
  - `pays only one of two comments waiting on the same sale code`: c1, c2, then r1 → exactly one `COMMENT` line with points 5 in history; `total` 10.
  - `never pays another member's waiting comment`: `t.person('k-kofi')`; Kofi comments on sale-881 (entry `k-c1`); Amina rates sale-881 → Kofi's history has no paid `COMMENT` line.
  - `keeps a comment waiting when its rating earns nothing`: rate sale-0 … sale-4; `comment('sale-5','c5')`; `rate('sale-5','r5')` → `weekly_limit`; history has no paid `COMMENT` line.
  - `pays a comment and its rating arriving at once (smoke test)`: `Promise.all([comment('sale-881','c1'), rate('sale-881','r1')])`, then the total from `GET /v1/people/k-amina/standing` is 10. Comment it as a smoke test, like the ones in `marks.test.ts`.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run test/ratings.test.ts`
  Expected: the new tests fail (no `COMMENT` line pays); the other T-16 tests pass.

- [ ] **Step 3: Move the loop body out of `takeEntry`**

  Move the in-force SELECT into `questsInForce` and the loop body into `applyQuest`. No change in behaviour. Run `npx vitest run test/ratings.test.ts test/progress.test.ts`: the same tests pass as before.

- [ ] **Step 4: The shared lock**

  In `applyQuest`, for a quest with `after_quest`, take `pg_advisory_xact_lock(hashtext(kiungoId || '/' || after_quest))` before reading `afterPaid`. That is the same key the followed quest already takes (it's paid once per item, `each_item = 'ever'`, and T-16 refuses `after` on any other kind). So a comment and its rating for one member are read one after the other, never side by side.

- [ ] **Step 5: Implement `payWaiting`**

  1. Find the waiting entries, oldest first: `awards` lines for this member and item with `points = 0` and `reason = 'needs_earlier_quest'`, whose quest has `after_quest = paidQuest` in its version in force; joined to `entries_read` for `kind` and `occurred_at`.
  2. For each one: load its quest with `questsInForce(tx, occurred_at, kind)`, filtered to that quest id. Skip it if that quest is no longer live. Then call `applyQuest` with `entry = { entryId, kiungoId, kind, occurredAt, item, evidence: 'checked' }`. It passed the evidence check when it was first read; the evidence itself is never stored. Use a throwaway `EntryResult`.
  3. `applyQuest`'s own once-per-item check makes the second waiting comment `already_done`. Its line is written as usual.

- [ ] **Step 6: `earned()` shows the latest answer**

  In `earned()`, leave out a 0-point line of a quest when the same entry has a later paid line for that quest. Redelivering a comment that waited then shows only its 5.

- [ ] **Step 7: Run the tests and see them pass**

  Run: `npx vitest run test/ratings.test.ts`, then `npm test` and `npm run typecheck`
  Expected: all pass (164, less 1 replaced, plus 6).

- [ ] **Step 8: Commit**

  ```bash
  git add src/points/progress.ts test/ratings.test.ts docs/plans/T-21-early-comments.md
  git commit -m "[BE] T-21: a comment read before its rating earns once the rating does"
  ```

### After the task

- ARCHITECTURE.md: in the Progress row, note that a following quest's waiting entries are paid when the quest they follow pays. GLOSSARY.md only if it defines `after`.
- PR "Closes #38", with test seams (`POST /standin/activity`, `GET /v1/people/:id/awards`, `GET /v1/people/:id/standing`) and Assumptions:
  - [INFERRED] There's no time limit on waiting: a comment waits however long its rating takes. It is still once per sale code.
  - [INFERRED] The paid line belongs to the comment's own entry, not the rating's. The rating's reply shows only the rating's 5. The member's total and history show both.
  - [INFERRED] If the comment's quest is paused when the rating pays, the comment isn't paid then. It can still be paid if sent again once the quest is live.
  - [INFERRED] Correcting a rating after its comment was paid doesn't correct the comment. That's today's rule for comments sent after their rating too.
- Independent consumatech-qa review (Spec and Standards), fix what it finds, and post the review as a PR comment.
