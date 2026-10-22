# Plan: T-07 history, download and corrections (issue #8)

**Goal:** a member's own award history, with the reason and the entry behind each line; a download of their whole points record; admin corrections as new, opposite awards.

**Requirements:** issue #8; TRD §4 (Standing: awards, download; Progress: correct an award), §5 (`GET …/awards`, `GET …/export`, `POST /v1/corrections`), §6 (`awards.corrects`); ADR-004 (insert only, corrections are new lines).

## Steps

1. Test first (`test/history.test.ts`): a wrongly given 50 shows as +50 then −50 "correction: duplicate photo", and the total drops by 50; an award can't be corrected twice, and a correction can't be corrected; the download holds every award; the history comes in pages, newest first; only an allowed carriage reads either; corrections need the admin key.
2. Migration `0008_corrections.sql`: `awards.corrects` (the award it cancels), unique, so each award is cancelled at most once.
3. `src/points/history.ts`: `history` (pages, newest first), `exportRecord` (every line plus the standing), `correct` (a new opposite line with the reason).
4. Routes: `GET /v1/people/:id/awards` (history; `?entry=` keeps the T-01 answer), `GET /v1/people/:id/export` (a JSON file to download), `POST /v1/corrections` (admin).

## Test seams

The HTTP routes.

## Out of scope

Giving back a limit place when an award is corrected (the progress stays as it was; a new entry next period pays as normal).
