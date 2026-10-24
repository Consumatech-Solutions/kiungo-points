# Architecture: kiungo-points

Full detail: the TRD in [`kiungo-africa-site/docs/gamification/engine/trd.md`](https://github.com/Consumatech-Solutions/kiungo-africa-site/blob/main/docs/gamification/engine/trd.md).

## Modules

| Module | What it does | Interface | Hides | Where |
|---|---|---|---|---|
| Quests | The board of quests, every version kept | `liveQuests`, `unitStanding`, `unitDrafts`, `draftQuest`, `setStatus`, `setIn`, `suggestions`, `loadQuests` (core quests from `quests/*.json`) | versioning, drafts and who proposed each version, "I'm in" on a member's suggestion and its threshold (`MEMBERS_NEEDED`), the template checks (including no quest for a never-earns or `suggestion.*` kind) | `src/quests/` |
| Progress | Turns an activity entry into progress and awards; corrects an award | `takeEntry`, `noteEntry` (an entry that earns nothing, seen by spike flags), `questProgress`, `NEVER_EARNS`, `correct` | already-read check, permission, trust, never-earns, evidence, periods and limits (`periods.ts`), the per-template decision (`rules.ts`), paying entries that waited for the quest they follow, locking, the notebook | `src/points/` |
| Standing | Where a person stands, and their record | `standing`, `earned`, `history`, `allAwards` (in `history.ts`) | counting points (the invite and local caps), the extra needs per level, levels never going down | `src/points/standing.ts` |
| Marks | Founding member and the firsts | `giveMarks`, `marksOf`, `freeFirst` | one holder per first (freed when its award is corrected), the quest board's version in force | `src/points/marks.ts` |
| Spikes | Unusual patterns flagged for a person to review; never a penalty | `checkSpike`, `flags`, `reviewFlag` | the private settings, one flag per window | `src/points/spikes.ts` |
| Readers | Which carriages may call, by one hashed key each | `setCarriage`, `carriageFor` | hashed keys, rotation, switching a carriage off (the member's permission is asked through the identity plug; rate limits through the `limit` dependency) | `src/readers.ts` |
| Identity and Activity plugs | The way to the rail | `IdentityPlug`, `ActivityEntry` | where answers come from | `src/plugs.ts` |
| Stand-in rails | Temporary rails until T-12 | `/standin/*` (`standinRoutes`) | | `src/standin/` |

## Stack

Cloudflare Workers + Hono, PostgreSQL through Hyperdrive (postgres.js), Zod, Vitest with PGlite.

## Decisions

ADR-001 to ADR-005 in the blueprint folder.
