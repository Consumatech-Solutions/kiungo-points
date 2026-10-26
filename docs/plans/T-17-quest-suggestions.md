# T-17 Members suggest quests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a Fruit member's challenge for their unit needs enough of the unit's members to tap "I'm in" before a Seedkeeper can put it live; when it goes live the member who suggested it earns 50 points once (`build.idea_taken_up`), and nobody earns for suggesting or "I'm in".

**Architecture:** a suggestion *is* T-09's unit challenge draft (proposed by a member, recorded since T-19), not a new object. T-17 adds the "I'm in" list beside it, a threshold check inside `setStatus`'s locked transaction, and, once it is live, one entry the points system writes itself (`kiungo-points:idea:<quest>`, kind `build.idea_taken_up`, item = the quest id), read by `takeEntry` like any other, so the existing once-per-item rule, permission, trust and the notebook all apply. Suggesting and "I'm in" are noted as entries that earn nothing, so spike flags see them.

**Tech Stack:** TypeScript, Hono, Zod, PostgreSQL (PGlite in tests), Vitest.

**Spec:** issue #31 (T-17); `GLOSSARY.md`; `ARCHITECTURE.md`; TRD §4–5 in kiungo-africa-site `docs/gamification/engine/trd.md`; founder decisions of 2026-10-24 (kiungo-africa-site PR #44, #45).

## Global Constraints

- Points have no cash value. Never write "token", "coin", "invest", "returns", "shares", "ownership", "stake" or "earn money".
- `awards` is insert only. `quest_backers` is not the notebook, so withdrawing "I'm in" deletes its row.
- Only Kiungo IDs and references outside `standin_*`. Who is in is never shown to members, only how many (as with missions, TRD §5).
- Names from `GLOSSARY.md`: quest, unit, member, entry, award, Seedkeeper, Fruit. Not "task", "vote", "token".
- Test through the HTTP routes (TRD §4 interfaces), never module insides.
- Threshold: `MEMBERS_NEEDED = 10`, a constant in `src/quests/board.ts` with a `shortcut:` comment (the founder sets it; "a fifth of the unit" needs the identity rail to count a unit's members, T-12).
- Commits start with `[BE]` (build) or `[QA]` (review fixes).

## Rules this plan settles [INFERRED unless the founder says otherwise]

1. **Which drafts need members in:** a unit challenge whose first version was proposed by a member (`proposed_by` not null), not a mission, while its status is `draft` (never live). Admin-drafted challenges, missions and new versions of a live challenge go live as today, and pay nobody.
2. **The admin route** (`POST /v1/quests/:id/live`), which stands in for a unit with no Seedkeeper (decision 4), applies the same threshold and pays the same 50.
3. **The suggester can't tap "I'm in" on their own suggestion** ("other members").
4. **Any member of the unit can tap "I'm in"**, at any level and trust, through a carriage they allow.
5. **Declining is the existing `end` step.** An ended suggestion can't be backed or put live.

## Review Focus

- Two Seedkeepers approve at once, or approval races a withdrawal: the threshold is checked under the quest's row lock, and the 50 is one entry id, so it is paid once.
- Approval succeeds but paying fails (the suggester has withdrawn the points system's permission, or a crash between the two): the quest stays live; approving again re-reads the same entry id, so it pays at most once. A suggester without permission gets nothing, like any other entry.
- "I'm in" tapped twice, or in, out, in: one row; the count never goes above the number of members.
- A member of another unit, or a Seedkeeper of another unit, acting on Matete's suggestion: 403 / 404 as the T-09 routes already answer.
- A quest drafted to watch `suggestion.made` or `suggestion.im_in`, which would pay for suggesting: refused by the template checks.

---

### Task 1: "I'm in", the threshold, and the 50 points

**Files:**
- Create: `migrations/0015_quest_backers.sql`
- Modify: `src/quests/board.ts` (backers, threshold in `setStatus`, `suggestions` view), `src/quests/templates.ts` (refuse `suggestion.*` watches), `src/points/progress.ts` (`noteEntry`), `src/app.ts` (routes), `ARCHITECTURE.md` (interfaces), `docs/HANDOVER.md`
- Test: create `test/suggestions.test.ts`; modify `test/local.test.ts` (tests that put Zawadi's peppers live now first add 10 members in)

**Interfaces:**
- Produces:
  - `MEMBERS_NEEDED = 10` (board.ts).
  - `setIn(db, quest: string, kiungoId: string, step: 'in' | 'out'): Promise<{ quest: string; in: number; needed: number } | { error: 'unknown_quest' | 'not_open' | 'own_suggestion' }>`: locks the quest row; open only while `draft` and a member's suggestion.
  - `setStatus(db, id, step)` returns the new error `{ error: 'needs_more_members', in: number, needed: number }` for `live` on an open suggestion below the threshold, and, on success, `suggestedBy: string | null` (the version-1 proposer when this call took an open suggestion live, else null).
  - `suggestions(db, unit: string, kiungoId: string): Promise<{ quest; title; template; steps; watches; points; in: number; needed: number; youAreIn: boolean }[]>`: open suggestions, oldest first.
  - `noteEntry(db, entry: ActivityEntry): Promise<void>` (progress.ts): records an entry that earns nothing (`outcome = 'earns_nothing'`) and runs `checkSpike`. No quests, no marks.
  - Routes:
    - `POST /v1/units/:unitId/quests/:id/:step{in|out}` body `{ by }`: any member of the unit → 200 `{ quest, in, needed }`; 404 `unknown_quest`; 409 `not_open` / `own_suggestion`. Notes a `suggestion.im_in` entry on `in`.
    - `GET /v1/units/:unitId/suggestions?by=`: any member of the unit → `{ unit, suggestions }`.
    - Unit and admin `live` routes: 409 `needs_more_members`, message "`<in>` of `<needed>` members are in."; after success, when `suggestedBy` is set, `takeEntry(db, identity, { entryId: 'kiungo-points:idea:<quest>', kiungoId: suggestedBy, kind: 'build.idea_taken_up', occurredAt: now(), carriage: READER, item: <quest> })`.
    - `POST /v1/units/:unitId/quests` notes a `suggestion.made` entry for the member (random entry id).
  - `unitMember(c, unit, kiungoId, level)` takes `level: 'Fruit' | 'Seedkeeper' | null` (null: any member).
  - `UnitDraft` gains `in: number` so the Seedkeeper sees how many are in.

- [ ] **Step 1: Write the failing tests** in `test/suggestions.test.ts` (reuse `grow` from `test/local.test.ts` by copying it; members who tap "I'm in" need only `t.person(id, 'joined', 'Africa/Kinshasa', undefined, ['matete'])`):
  - `it('needs ten members in, then pays the suggester 50 once')` — the ticket's Done when: Zawadi suggests `matete.peppers`; 9 members in; Seedkeeper `live` → 409 `needs_more_members`, message matches `/9 of 10/`; the tenth in → `live` 200; `matete.peppers` is on Matete's standing list; Zawadi's awards include exactly one `{ quest: 'build.idea_taken_up', points: 50 }`; `live` again → 200 and still one; each of the ten members' standing `points` is 0.
  - `it('counts each member once, and lets them change their mind until approval')` — in twice → `in: 1`; out → `in: 0`; after `live`, in → 409 `not_open`.
  - `it("doesn't let the suggester, or another unit's member, be in")` — Zawadi in → 409 `own_suggestion`; a Kisenso member → 403.
  - `it('pays nobody for a declined suggestion')` — 10 in, Seedkeeper `end` → 200; in → 409 `not_open`; `live` → 409; Zawadi has no `build.idea_taken_up` award.
  - `it('needs no members in for a mission or an admin-drafted challenge, and pays nobody')` — Seedkeeper's mission draft goes live with 0 in; admin `POST /v1/quests` with `unit: 'matete'` then `/v1/quests/:id/live` → 200; no `build.idea_taken_up` award for anyone.
  - `it('holds the admin to the same ten members')` — Zawadi's suggestion, admin `live` → 409, then 10 in → 200 and Zawadi gets 50.
  - `it('shows members how many are in, never who')` — `GET /v1/units/matete/suggestions?by=k-amina` after Amina and one other are in: `[{ quest: 'matete.peppers', in: 2, needed: 10, youAreIn: true }]`, and the JSON contains no other member's Kiungo ID; a Kisenso member → 403; the live suggestion is no longer listed.
  - `it('lets spike flags watch "I\'m in"')` — admin sets `{ kind: 'suggestion.im_in', count: 3, minutes: 60 }`; one member taps in, out, in, out, in; `GET /v1/admin/flags` has one flag for that member and kind.
  - `it('refuses a quest that pays for suggesting')` — admin drafts a local repeat quest watching `suggestion.im_in` → 400.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/suggestions.test.ts`
Expected: FAIL (404s on the new routes; `live` returns 200 with 0 in).

- [ ] **Step 3: Migration `0015_quest_backers.sql`**: `quest_backers (quest_id text NOT NULL REFERENCES quests(id), kiungo_id text NOT NULL, since timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (quest_id, kiungo_id))`, with a one-line header comment like the others.

- [ ] **Step 4: Implement** `templates.ts` check (reason: "Nobody earns for suggesting a quest or for \"I'm in\"."), `noteEntry`, `setIn`, `suggestions`, the threshold in `setStatus` (same transaction, after the `FOR UPDATE`), `in` on `UnitDraft`, and the routes, using the Interfaces above. The pay call sits in one helper in `app.ts` shared by both `live` routes.

- [ ] **Step 5: Update `test/local.test.ts`**: a helper `allIn()` that adds 10 Matete members in on `matete.peppers`, called before each Seedkeeper `live` of Zawadi's peppers (version 1 only).

- [ ] **Step 6: Run the whole suite and the typecheck**

Run: `npm test` then `npx tsc --noEmit`
Expected: all pass (174 before plus the new ones), no type errors.

- [ ] **Step 7: Docs** — `ARCHITECTURE.md` Quests interface adds `setIn`, `suggestions`; Progress adds `noteEntry`. `docs/HANDOVER.md`: T-17 row, migrations up to `0015`, the TRD §5 follow-up for the three new routes (kiungo-africa-site, ask first), and this PR's assumptions.

- [ ] **Step 8: Commit**

```bash
git add migrations/0015_quest_backers.sql src test docs ARCHITECTURE.md
git commit -m "[BE] T-17: members tap \"I'm in\" on a suggested challenge; at ten a Seedkeeper can put it live and the suggester earns 50, once"
```

### Task 2: Review and PR

- [ ] **Step 1:** `consumatech-qa` review (Spec + Standards) of the branch against issue #31; fix findings in `[QA]` commits.
- [ ] **Step 2:** Open the PR (ask the founder first), with the Assumptions section carrying rules 1–5 above tagged `[INFERRED]`. Humans merge.
