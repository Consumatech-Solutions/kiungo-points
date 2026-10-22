# Plan: T-04 trust and never-earns (issue #5)

**Goal:** quests that need *vouched* or *verified* pay only people at that trust level; vouching, payments and purchases never earn; quests that need evidence pay only when the entry carries it.

**Requirements:** issue #5; `activities.md` ("Rules that hold across every quest line" 1; the Trust and "Checked by" columns); TRD §4 (Progress hides the trust check, the never-earns rules and the evidence check), §5 (`needs_vouched`, `missing_evidence`).

## Steps

1. Test first (`test/trust.test.ts`): a *joined* person reviewing a translation gets 0 "needs vouched", a *vouched* one 15; an agent role needs *verified*; a vouch, a payment and a purchase get 0 "never earns" (and the same answer when delivered again); a Testify rating without a sale code gets 0 "missing evidence", with one 5, and the same sale code twice pays once; a quest can't be drafted to watch a never-earns kind; the board shows the evidence each quest needs.
2. Migration `0005_trust_evidence.sql`: `quest_versions.evidence` (`sale_code` or `photo`); `rating.verified` needs a sale code; `entries_read.outcome` (keeps "never earns" for redelivery, since no quest is involved).
3. `rules.ts`: `NEVER_EARNS` (vouching, payments, purchases).
4. `progress.ts`: never-earns before any quest; evidence after trust.
5. `templates.ts`: optional `evidence`; refuse quests that watch a never-earns kind. Board shows `evidence`.

## Test seams

`POST /standin/activity`, `POST /v1/quests`, `GET /v1/quests`.

## Out of scope

Who confirms a photo (the confirmer must be vouched and earns nothing): local challenges, T-09.
