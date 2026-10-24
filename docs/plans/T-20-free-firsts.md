# T-20 Free a first when its award is corrected — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the award for a first (unit, country, language) is corrected, the first becomes free, and the next qualifying member whose entry is read earns it.

**Architecture:** The `marks` row stays (the record that it was once given), but gets a `freed_at` time. The "one holder per first" unique index only counts marks that aren't freed. `correct()` frees the mark in the same transaction as the opposite award. `giveMarks()` needs no change: its `INSERT … ON CONFLICT DO NOTHING` already lets a new member in once the index no longer counts the freed row, and the `(kiungo_id, mark)` primary key already stops the corrected member from taking the same first again. `marksOf()` hides freed marks.

**Tech Stack:** TypeScript, Hono, plain SQL through `Db`, PGlite in tests (vitest).

**Spec:** GitHub issue #37 (T-20). Founder's decisions of 2026-10-24: "first" means the first member the points system sees there (#26).

## Global Constraints

- The notebook (`awards`) is insert only. Corrections are new, opposite awards. `marks` is not the notebook and may be updated.
- Only Kiungo IDs and references to entries are stored. No names.
- Migrations are numbered SQL files: this one is `migrations/0013_free_firsts.sql`.
- Founding member is worked out from the join date and is never stored, so it is untouched.
- Points have no cash value: no money words anywhere.

## Review Focus

1. A corrected member's *next* entry must not re-take the first they lost (primary key holds this; tested in Task 1).
2. Correcting a non-first award (e.g. `picture.look`) must not touch marks (tested in Task 1).
3. A first freed and then re-given, whose new award is corrected too, must free again and pass to a third member (tested in Task 1).
4. The freed member's standing must stop showing the mark, while the database keeps the row (tested in Task 1).
5. Two members qualifying at the same moment after a first is freed: one holder only. PGlite can't race, so this is a smoke test here and part of the staging check against real PostgreSQL.

---

### Task 1: Free a first on correction

**Files:**
- Create: `migrations/0013_free_firsts.sql`
- Modify: `src/points/history.ts` (`correct`)
- Modify: `src/points/marks.ts` (`marksOf`; new exported `freeFirst`)
- Test: `test/marks.test.ts`

**Interfaces:**
- Produces: `freeFirst(tx: Db, kiungoId: string, questId: string, step: string | null): Promise<void>` in `src/points/marks.ts`. It does nothing unless `questId` is one of the `FIRSTS` quests. It sets `freed_at = now()` on the mark `${mark}:${step}` for that member, where `mark` comes from the matching `FIRSTS` entry (`first.unit` → `first_in_unit`, and so on).

- [ ] **Step 1: Write the failing tests** in `test/marks.test.ts`, in the T-10 describe block, using the existing `join`, `marks` and `t.act` helpers. To find the award to correct, look it up with `t.db.query("SELECT id FROM awards WHERE kiungo_id = $1 AND quest_id = $2 AND corrects IS NULL ORDER BY id DESC LIMIT 1", [...])`, then call `t.call('POST', '/v1/corrections', { award: id, reason: 'test' }, ADMIN)`.

  - `frees a first when its award is corrected, for the next member whose entry is read`: k-amina and k-kofi both `country: 'GH'`. Amina acts first and gets `first.country` GH. Correct that award. Kofi acts: his awards include `{ quest: 'first.country', points: 25, step: 'GH' }`; `marks('k-kofi')` contains `first_in_country:GH`; `marks('k-amina')` does not.
  - `never gives a corrected member back the first they lost`: Amina gets GH and it is corrected. Amina acts again: no `first.country` award, no mark.
  - `frees a first again when its second award is corrected`: Amina → corrected → Kofi gets it → corrected → a third member k-ama (`country: 'GH'`) acts and gets it.
  - `keeps the record that a first was given and freed`: after the correction, `SELECT freed_at FROM marks WHERE kiungo_id = 'k-amina' AND mark = 'first_in_country:GH'` returns one row with a non-null `freed_at`.
  - `leaves marks alone when another kind of award is corrected`: Amina acts (`picture.look` + GH). Correct the `picture.look` award. `marks('k-amina')` still contains `first_in_country:GH`.
  - `gives a freed first to one member only when two arrive at once (smoke test)`: free Amina's GH, then `Promise.all` acts for k-kofi and k-ama; exactly one of them holds `first_in_country:GH`. Comment it as a smoke test, like the existing one.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run test/marks.test.ts`
  Expected: the new tests fail (Kofi gets no `first.country`; no `freed_at` column). The existing marks tests still pass.

- [ ] **Step 3: Write `migrations/0013_free_firsts.sql`**

  ```sql
  -- T-20: a first whose award is corrected is freed for the next member; the row stays as the record.
  ALTER TABLE marks ADD COLUMN freed_at timestamptz;
  DROP INDEX one_holder_per_first;
  CREATE UNIQUE INDEX one_holder_per_first ON marks (mark) WHERE mark LIKE 'first\_%' AND freed_at IS NULL;
  ```

- [ ] **Step 4: Add `freeFirst` and call it from `correct()`**

  In `correct()`, widen the first `SELECT` to also read `kiungo_id, quest_id, step`. After the opposite award is inserted (only when `row` came back), call `freeFirst(tx, a.kiungo_id, a.quest_id, a.step)`. In `marksOf()`, add `AND freed_at IS NULL` to the query.

- [ ] **Step 5: Run the tests and see them pass**

  Run: `npx vitest run test/marks.test.ts`, then `npm test` and `npm run typecheck`
  Expected: all pass (157 + 6).

- [ ] **Step 6: Commit**

  ```bash
  git add migrations/0013_free_firsts.sql src/points/history.ts src/points/marks.ts test/marks.test.ts docs/plans/T-20-free-firsts.md
  git commit -m "[BE] T-20: a corrected first is freed for the next member seen there"
  ```

### After the task

- Update `ARCHITECTURE.md` / `GLOSSARY.md` only if they describe firsts as never changing hands (check with a grep for "first").
- PR "Closes #37", with a test-seams section and an Assumptions section:
  - [INFERRED] The first passes to the next qualifying member *whose entry is read* after the correction, not to the member who was runner-up earlier.
  - [INFERRED] The freed mark's row is kept with `freed_at`, not deleted, so there is a record that it was once given.
  - [INFERRED] The member who lost the first can never take that same first again.
- Independent consumatech-qa review (Spec and Standards), fix what it finds, and post the review as a PR comment.
