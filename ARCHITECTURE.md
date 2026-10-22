# Architecture: kiungo-points

Full detail: the TRD in [`kiungo-africa-site/docs/gamification/engine/trd.md`](https://github.com/Consumatech-Solutions/kiungo-africa-site/blob/main/docs/gamification/engine/trd.md).

## Modules

| Module | What it does | Interface | Hides | Where |
|---|---|---|---|---|
| Quests | The board of quests, every version kept | `liveQuests`, `draftQuest`, `setStatus` | versioning, drafts, the template checks | `src/quests/` |
| Progress | Turns an activity entry into progress and awards | `takeEntry` | already-read check, permission, trust, limits, locking, the notebook | `src/points/progress.ts` |
| Standing | Where a person stands | `standing`, `earned` | counting rules, levels | `src/points/standing.ts` |
| Identity and Activity plugs | The way to the rail | `IdentityPlug`, `ActivityEntry` | where answers come from | `src/plugs.ts` |
| Stand-in rails | Temporary rails until T-12 | `/standin/*` | | `src/standin/` |

## Stack

Cloudflare Workers + Hono, PostgreSQL through Hyperdrive (postgres.js), Zod, Vitest with PGlite.

## Decisions

ADR-001 to ADR-005 in the blueprint folder.
