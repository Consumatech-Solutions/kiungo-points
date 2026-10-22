# Plan: T-10 marks (issue #11)

**Goal:** the *Founding member* mark for everyone who joined before 1 January 2030, and the firsts: first member in a unit, in a country, speaking a language (a mark and 25 points each).

**Requirements:** issue #11; `activities.md` §9 (firsts and marks); TRD §4 (Standing: marks), §6 (`marks`).

## Steps

1. Test first (`test/marks.test.ts`): a member who joined before 1 January 2030 has the Founding member mark, one who joined after doesn't; the first member seen in Matete gets "first in unit" and 25 points, the second doesn't; the same for a country and a language; marks are in the standing with the date given; firsts are given once even if two arrive at once.
2. Migration `0010_marks.sql`: `marks` (Kiungo ID, mark, given at), with each first held by one person only; the quests `first.unit`, `first.country`, `first.language` (25 points, quest line `firsts`); stand-in people get a country and languages, and a join date can be set.
3. Identity plug: a person's join date, country and languages.
4. `src/points/marks.ts`: `giveMarks` (when an entry is read: founding member, and any first still free, paid 25); the standing lists marks.

## Test seams

`POST /standin/activity`, `GET /v1/people/:id/standing`.

## Out of scope

Importing early members' real join dates (T-13).
