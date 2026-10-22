# Plan: T-06 carriages and permissions (issue #7)

**Goal:** one key per carriage; each carriage writes to the stand-in rail only the kinds of activity it may; a carriage reads a member's standing, progress and awards only if the member allows that carriage; a member can withdraw Kiungo's permission (new entries earn nothing, past awards stay); rate limits per carriage key; key rotation.

**Requirements:** issue #7; TRD §4 (Readers), §5 (who may call what), §7 (security); ADR-005.

## Steps

1. Test first (`test/carriages.test.ts`): my.kiungo.africa can't write a kasiPOS-only activity; Testify can't read Amina's level until she allows it (standing, progress and awards alike); withdrawing Kiungo's permission stops new points and keeps past awards; unknown, missing or switched-off keys are refused; a rotated key works and the old one doesn't; past the rate limit a carriage gets 429; a writing carriage gets the standing back only if the member allows it to read.
2. Migration `0007_readers.sql`: `readers` (carriage, hashed key, active). The stand-in rail keeps only `may_write`.
3. `src/readers.ts`: `setCarriage` (set or rotate a key, switch off), `carriageFor` (key → carriage).
4. Routes: `POST /v1/carriages` (admin); `/v1/people/:id/*` need a carriage key and the member's permission; `POST /standin/permissions` (allow or withdraw); rate limit on every carriage call.
5. Rate limits: a `limit(key)` dependency. Production uses Cloudflare's Rate Limiting binding (declared in `wrangler.jsonc`, created when the founder deploys); tests use a counter.

## Test seams

The HTTP routes, with a fake rate limiter (a true boundary: Cloudflare's binding).

## Out of scope

The member's own download (T-07).
