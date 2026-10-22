# Architecture: kiungo-points

Full detail: the TRD in [`kiungo-africa-site/docs/gamification/engine/trd.md`](https://github.com/Consumatech-Solutions/kiungo-africa-site/blob/main/docs/gamification/engine/trd.md).

## Modules

| Module | What it does | Interface | Hides | Where |
|---|---|---|---|---|
| Quests | The board of quests, every version kept | `liveQuests`, `draftQuest`, `setStatus` | versioning, drafts, the template checks (including no quest for a never-earns kind) | `src/quests/` |
| Progress | Turns an activity entry into progress and awards | `takeEntry`, `questProgress`, `NEVER_EARNS` | already-read check, permission, trust, never-earns, evidence, periods and limits (`periods.ts`), the per-template decision (`rules.ts`), locking, the notebook | `src/points/` |
| Standing | Where a person stands | `standing`, `earned` | counting points (the invite and local caps), the extra needs per level, levels never going down | `src/points/standing.ts` |
| Readers | Which carriages may call, by one hashed key each | `setCarriage`, `carriageFor` | hashed keys, rotation, switching a carriage off (the member's permission is asked through the identity plug; rate limits through the `limit` dependency) | `src/readers.ts` |
| Identity and Activity plugs | The way to the rail | `IdentityPlug`, `ActivityEntry` | where answers come from | `src/plugs.ts` |
| Stand-in rails | Temporary rails until T-12 | `/standin/*` | | `src/standin/` |

## Stack

Cloudflare Workers + Hono, PostgreSQL through Hyperdrive (postgres.js), Zod, Vitest with PGlite.

## Decisions

ADR-001 to ADR-005 in the blueprint folder.
