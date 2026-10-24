# Plan: T-15 academy lessons (issue #29)

**Goal:** "Complete an academy lesson": 5 points, up to 10 a week, once per lesson, joined; an academy course counts as a building activity for Fruit (founder, decision 1 of 2026-10-24). Course, on time and franchise unchanged.

## Steps

1. Test first (`test/academy.test.ts`): ten lessons in a week pay 5 each and the eleventh gets "weekly limit"; the same lesson pays once; a vouched member at 1,500 whose building activity is a completed course reaches Fruit; course, on-time and franchise points unchanged.
2. A new quest file, `quests/business.lesson_completed.json`, in force from 24 October 2026.
3. `quests/business.course_completed.json`: `building: true`. The loader now lets the building flag change (by pull request, like any change); quest line and template still can't.

## Test seams

`POST /standin/activity`, `GET /v1/people/:id/standing`, `GET /v1/quests`.
