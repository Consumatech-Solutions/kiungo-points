# T-19 Who proposed a local challenge, and the drafts waiting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every version of a local challenge records the Kiungo ID of the member who proposed it. A unit's Seedkeeper, or Consumatech's admin until the unit has one, can list the drafts waiting in that unit, each shown beside the version that is live now.

**Architecture:**
- A new column, `quest_versions.proposed_by`, records the proposer. It is null for the admin and for core quests.
- The unit draft route already knows the proposing member: `unitMember` returns their Kiungo ID. It passes that ID to `draftQuest`, which stores it.
- A new board function, `unitDrafts(db, unit)`, lists the unit's quests that have a version not yet in force (`valid_from IS NULL`). It returns each one's live version, or null for a brand-new challenge, and its pending versions with `proposedBy`.
- Two read routes call it:
  - `GET /v1/units/:unitId/drafts?by=<Kiungo ID>`, through a carriage, for a Seedkeeper of the unit. It reuses `unitMember`.
  - `GET /v1/quests/drafts?unit=<unit>`, for the admin key.
- Putting a version live is unchanged. It sets `valid_from` and keeps `proposed_by`.

**Tech Stack:** TypeScript, Hono, zod, plain SQL through `Db`, PGlite in tests (vitest).

**Spec:** GitHub issue #36 (T-19). T-09 local quests (#25). The founder's decision of 2026-10-24: until a unit has a Seedkeeper, Consumatech's admin puts its challenges live.

## Global Constraints

- Only Kiungo IDs are stored. Never names.
- Migrations are numbered SQL files: this one is `migrations/0014_proposed_by.sql`.
- A published version never changes. `proposed_by` is written once, when the version is drafted.
- Another unit's Seedkeeper sees nothing of this unit's drafts (403, like every unit route).
- Points have no cash value: no money words.

## Review Focus

1. A Seedkeeper of another unit asks for Matete's drafts: refused. Tested.
2. A Fruit member (not a Seedkeeper) asks for the drafts: refused. Drafts are the Seedkeeper's to decide. Tested.
3. A brand-new challenge (never live) shows `live: null` with its draft. Tested.
4. After the Seedkeeper puts a draft live, it leaves the drafts list, and the proposer is still recorded on the live version. Tested.
5. The admin's view, for a unit with no Seedkeeper yet: the same answer through the admin route. Without the admin key, refused. Tested.

---

### Task 1: Record the proposer and list the drafts

**Files:**
- Create: `migrations/0014_proposed_by.sql`
- Modify: `src/quests/board.ts` (`draftQuest`, new `unitDrafts`)
- Modify: `src/app.ts` (unit draft route passes the member; two new GET routes)
- Test: `test/local.test.ts`

**Interfaces:**
- `draftQuest(db: Db, d: QuestDraft, proposedBy: string | null = null): Promise<DraftResult>`. It writes `proposed_by` on the new version.
- `unitDrafts(db: Db, unit: string): Promise<UnitDraft[]>`, exported from `board.ts`:
  ```ts
  type VersionView = { version: number; title: string; watches: string[]; target: number; period: string; limit: number | null;
    eachItem: string | null; points: number | null; steps: unknown; trustNeeded: string; evidence: string | null;
    after: string | null; proposedBy: string | null };
  type UnitDraft = { quest: string; template: string; status: string; live: VersionView | null; pending: VersionView[] };
  ```
  - `live` is the latest version with `valid_from` set.
  - `pending` is every version with `valid_from IS NULL`, oldest first.
  - Quests are ordered by id. Only quests with at least one pending version appear.
  - Ended quests are left out.
- Routes return `{ data: { unit, drafts: UnitDraft[] } }`.

- [ ] **Step 1: Write the failing tests** in `test/local.test.ts`, in the T-09 describe block, using the existing `grow`, `draft`, `live` and `peppers` helpers. Add `const drafts = (by: string, unit = 'matete') => t.call('GET', `/v1/units/${unit}/drafts?by=${by}`)`. The carriage key comes from `t.call`'s default, the same as `draft`.

  - `shows the Seedkeeper a new challenge waiting, and who proposed it`:
    1. Zawadi drafts `peppers()`.
    2. Grow `k-mzee` to Seedkeeper in Matete.
    3. `drafts('k-mzee')` → status 200. `data.drafts` is one item: `{ quest: 'matete.peppers', status: 'draft', live: null }`, and `pending` is one version with `{ version: 1, title: 'Grow peppers', proposedBy: 'k-zawadi' }`.
  - `shows a new version beside the live one`:
    1. Zawadi drafts `peppers()`; Mzee puts it live.
    2. Zawadi drafts `{ ...peppers(), title: 'Grow more peppers' }`.
    3. `drafts('k-mzee')` → `live` has `{ version: 1, title: 'Grow peppers', proposedBy: 'k-zawadi' }`; `pending` is `[{ version: 2, title: 'Grow more peppers', proposedBy: 'k-zawadi' }]` (`toMatchObject`).
  - `keeps who proposed a version once it is live`:
    1. Continuing as above, Mzee puts version 2 live.
    2. `drafts('k-mzee')` → `data.drafts` is `[]`.
    3. `SELECT proposed_by FROM quest_versions WHERE quest_id = 'matete.peppers' AND version = 2` returns `k-zawadi`.
  - `shows the drafts only to a Seedkeeper of the unit`:
    1. Zawadi drafts.
    2. `drafts('k-zawadi')` → 403 (she is Fruit, not a Seedkeeper).
    3. Grow `k-kisenso-sk` to Seedkeeper in `kisenso`: `drafts('k-kisenso-sk')` → 403.
  - `shows the admin a unit's drafts while it has no Seedkeeper`:
    1. Zawadi drafts.
    2. `t.call('GET', '/v1/quests/drafts?unit=matete', undefined, ADMIN)` → 200, the same `drafts` as above.
    3. Without the admin key → 401.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run test/local.test.ts`
  Expected: the new tests fail (404 on the routes); the T-09 tests pass.

- [ ] **Step 3: Write `migrations/0014_proposed_by.sql`**

  ```sql
  -- T-19: the member who proposed each version of a unit's challenge (a Kiungo ID; null for the admin and core quests).
  ALTER TABLE quest_versions ADD COLUMN proposed_by text;
  ```

- [ ] **Step 4: Store the proposer.** Add `proposedBy` to `draftQuest` and its `INSERT`. In `app.ts`, `draftAnswer(c, raw, proposedBy?)` passes it through. The unit route passes `member`; the admin route passes nothing.

- [ ] **Step 5: Add `unitDrafts` and the two routes.**
  - `GET /v1/units/:unitId/drafts`: validate the unit (`UNIT`), then `unitMember(c, unit, c.req.query('by'), 'Seedkeeper')`.
  - `GET /v1/quests/drafts`: `admin(c)`, then validate `unit` from the query.
  - Both answer `{ data: { unit, drafts: await unitDrafts(db, unit) } }`.

- [ ] **Step 6: Run the tests and see them pass**

  Run: `npx vitest run test/local.test.ts`, then `npm test` and `npm run typecheck`
  Expected: all pass (169 + 5).

- [ ] **Step 7: Commit**

  ```bash
  git add migrations/0014_proposed_by.sql src/quests/board.ts src/app.ts test/local.test.ts docs/plans/T-19-local-drafts.md
  git commit -m "[BE] T-19: record who proposed each version of a unit's challenge; show the Seedkeeper the drafts waiting"
  ```

### After the task

- ARCHITECTURE.md: add `unitDrafts` to the Quests row. TRD §5 (in kiungo-africa-site) lists routes. Note the two new routes in the PR as a blueprint follow-up, and don't edit the other repo.
- PR "Closes #36", with test seams (the HTTP routes above) and Assumptions:
  - [INFERRED] Only a Seedkeeper of the unit (or the admin) sees its drafts, not the Fruit members who propose them. A proposer sees the result once it's live.
  - [INFERRED] The admin's view is its own admin-only route (`GET /v1/quests/drafts?unit=`), so carriages never send the admin key.
  - [INFERRED] Versions drafted before this change, and versions the admin drafts, show `proposedBy: null`.
  - [INFERRED] Who put a version live isn't recorded. The ticket asks only for who proposed it.
- Independent consumatech-qa review (Spec and Standards), fix what it finds, and post the review as a PR comment.
