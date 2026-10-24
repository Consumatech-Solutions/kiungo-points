# Plan: T-09 local quests (issue #10)

**Goal:** a unit drafts its own challenge from a template, within the limits (no local activity or step worth more than 50 points), and puts it live. It appears on that unit's list only, and only the unit's members earn from it.

**Requirements:** issue #10; `activities.md` §8 and rule 7 (core and local); `design.md` §5 (Fruit proposes a challenge for the unit; Seedkeeper sets the unit's missions); TRD §4 (Quests: a unit drafts its local quests within limits; a draft never goes live by itself).

## Steps

1. Test first (`test/local.test.ts`): a Fruit member of Matete drafts "grow peppers"; it is on nobody's list until a Matete Seedkeeper puts it live; then it is on Matete's list only, not Kisenso's or the core board; a 60-point step is refused; a member below Fruit, or from another unit, can't draft for Matete; a Fruit member can't put it live; only Matete's members earn from it.
2. `templates.ts`: the local limit (50 points per activity or step, missions included; no local streaks); any template can carry a unit.
3. Routes: `POST /v1/units/:unitId/quests` (a carriage, for a member who allows it: Fruit or above, in the unit; the quest id starts with the unit's id) and `POST /v1/units/:unitId/quests/:id/live|pause|end` (a Seedkeeper of the unit). Admin keeps its own routes.

## Test seams

The HTTP routes.

## Out of scope

Photo evidence confirmed by another vouched member (the tomato challenge's "checked by"): needs a confirmation flow from the carriages; flagged as a follow-up. Unit votes on challenges (Root) are not in the ticket.
