# kiungo-points: hand-over

Read this first, every session, after `CLAUDE.md`. Update it at the end of every session: state, decisions, next step. It was rebuilt on 2026-10-24 from the earlier side-session note, which the app no longer keeps.

## State (2026-10-24)

Nothing is deployed and nothing runs for real members. main is green: 174 tests on PGlite, typecheck clean.

| Done | What | PRs |
|---|---|---|
| T-01 to T-07 | Walking skeleton; quest board and templates (repeat, collect, steps, streak, mission); progress and limits in the member's time zone; weekly streaks; trust and never-earns; levels (with the invite and local caps); carriage keys, permissions and rate limits; history, download and corrections | #15–#22 |
| Founder decisions of 2026-10-22 | Streaks count only entries read within 14 days (`too_late`); entries dated over an hour ahead don't count (`too_early`) | #23 |
| T-08 to T-11 | Unit missions; local quests (Fruit proposes, Seedkeeper puts live, 50-point limit); marks (Founding member, firsts); spike flags | #24–#27 |
| T-14 to T-16 | Quests as public files (`quests/*.json`, `npm run load-quests`); academy lessons; +5 for a written comment on a verified rating (the general `after` rule) | #32–#34 |
| T-20 | A first whose award is corrected is freed for the next member seen there; the member who lost it can't take it back | #39 |
| T-21 | A rating comment read before its rating waits, and earns as soon as the rating earns | #40 |
| T-19 | Each version of a unit's challenge records who proposed it; the Seedkeeper (or admin) lists the drafts waiting beside the live version | #41 |
| T-17 | Members tap "I'm in" on a member's suggested challenge; at 10 a Seedkeeper (or the admin) can put it live, and the suggester earns `build.idea_taken_up` (50), once. Suggesting and "I'm in" earn nothing but are noted for spike flags | this PR (#31) |

Each PR has a plan in `docs/plans/`, an Assumptions section and an independent QA review comment.

## Open

| Issue | What | Status |
|---|---|---|
| #35 | T-18 photo proof for the tomato challenge, confirmed by another vouched member (who earns nothing) | Blocked: the carriages' confirmation flow has to be designed first |
| #13 | T-12 the real identity and activity rails; removes `src/standin/` | Blocked until those rails exist |
| #14 | T-13 bring in kiungo.africa's first members | After T-12 and members' consent |

## Next steps

1. **Before any real members: the staging check.** Run the "two entries at the same moment" protections once against a real PostgreSQL on staging, because PGlite runs one transaction at a time:
   - limits;
   - missions;
   - firsts, including a freed first;
   - spike flags;
   - once-per-item;
   - a comment and its rating at the same moment.

   Ask the founder before touching any live or staging database.
2. **Blueprint follow-ups**, in kiungo-africa-site, `docs/gamification/engine/trd.md` §5. Don't edit that repository without asking.
   - Add `GET /v1/units/:unitId/drafts?by=` and `GET /v1/quests/drafts?unit=` (T-19).
   - Add `POST /v1/units/:unitId/quests/:id/in|out` and `GET /v1/units/:unitId/suggestions?by=`, and the `needs_more_members` answer on both `live` routes (T-17).

## Founder steps after merging

- Run the files in `migrations/` in order on the database (now up to `0015`). Then run `npm run load-quests` (README, `quests/README.md`). No database exists yet, so nothing is due now.

## Founder decisions (all built)

**2026-10-22 (milestone 1)**
- 12 picture sections.
- Building activities, for Fruit:
  - count: translating, reviewing, consultation, idea taken up, fixed mistake, opening a business, local challenges;
  - don't count: ratings, Telegram.
- Tomato harvest allowed after one check-in.
- Rate limit: 1,000 calls a minute per carriage.
- A forgiven streak week doesn't add to the run.

**2026-10-24 (all as recommended)**
1. Language firsts count for a member's first three languages (#26).
2. "First" means the first member the points system sees there, not the earliest join date (#26).
3. Every activity counts towards a unit mission, even past the member's own limit (#24).
4. Until a unit has a Seedkeeper, Consumatech's admin puts its challenges live (#25).
5. A rating comment earns only on a rating that itself earned (#34).
6. A comment keeps its 5 when its rating is corrected later (#40).

## Assumptions in merged PRs (not yet questioned)

**T-20 (#39)**
- A freed first goes to the next qualifying member *whose entry is read*.
- The freed mark's row is kept with `freed_at`.
- If the first's quest is paused when it is freed, nobody takes it until the quest is live again.

**T-21 (#40)**
- There's no time limit on a waiting comment.
- The comment's 5 shows in history and the total, not in the rating's reply.
- If the comment's quest is paused when the rating pays, only a new comment entry can earn later.

**T-19 (#41)**
- Only the unit's Seedkeeper (or the admin) sees its drafts.
- The admin's view is an admin-only route, and the admin can see a unit's drafts at any time.
- Who put a version live isn't recorded.

**T-17 (#31)** [INFERRED]
- `MEMBERS_NEEDED` is a fixed 10; "a fifth of the unit" waits for the identity rail to count a unit's members (T-12).
- A suggestion is a challenge whose first version a member proposed, while it is still a draft. Missions, admin-drafted challenges and new versions of a live one need nobody in and pay nobody.
- The admin's `live` route holds suggestions to the same 10 and pays the same 50.
- The suggester can't be in on their own suggestion; any member of the unit can, at any level.
- Every successful `live` of a suggested challenge re-reads the one entry `kiungo-points:idea:<quest>`, so a payment lost to a crash is made on the next approval, and never twice.
- Suggestions are listed by quest id (there is no drafted-at time to sort by).

## Notes for the next session

- **Pull requests:** one branch and one PR per ticket, worked in its own git worktree (a separate folder next to the repository). Remove the worktree after merge.
- **Stacked PRs:** keep them in step by merging each branch into the next. Never force-push.
- **Activity kinds:** defined in `migrations/0002` and the quest files. Never-earns kinds are `vouch.*`, `payment.*` and `purchase.*`.
- **Tests:** about 2.5 minutes for the whole suite.
- **Local Worker runtime:** Cloudflare's runtime (`wrangler dev`) is blocked on this computer by Smart App Control.
- **The `after` rule:**
  - a quest may follow only one paid once per item;
  - every such quest takes a member/quest lock, and a follower takes the same lock on the quest it follows;
  - waiting entries are paid by `payWaiting` in `src/points/progress.ts`.
- **`marks`:** not the notebook, so a freed first is an update (`freed_at`). `awards` stays insert only.
- **Tidy-up:** the shortcut comment on `MAX_LANGUAGE_FIRSTS` in `src/points/marks.ts` says the founder may set another number. He confirmed 3; tidy the wording when that file is next touched.
