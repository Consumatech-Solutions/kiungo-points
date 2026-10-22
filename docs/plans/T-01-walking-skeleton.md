# Plan: T-01 walking skeleton (issue #1)

**Goal:** the thinnest slice that works end to end. A carriage writes "phone confirmed" to a stand-in person's activity record; the points system reads it through the activity plug, checks permission through the identity plug, pays the one quest (10 points, once) and shows the standing.

**Requirements:** issue #1; the blueprint in `kiungo-africa-site/docs/gamification/engine/` (TRD §3–§6, ADR-003, ADR-005).

## Steps

1. Project: `package.json` (Hono, Drizzle, postgres.js, Zod; Vitest, PGlite, TypeScript, Wrangler), `tsconfig.json`, `wrangler.jsonc` (Hyperdrive binding, no ids), `.gitignore`, CI workflow (type check and tests).
2. Migration `0001_skeleton.sql`: the points tables (`quests`, `quest_versions`, `entries_read`, `quest_progress`, `awards`) and the stand-in tables (`standin_people`, `standin_permissions`, `standin_carriages`, `standin_entries`); seed the quest `identity.phone_confirmed` (once, 10 points, joined).
3. Plugs (`src/plugs`): the identity plug (look up a person, check a permission) and the activity plug (an entry's shape; delivery to the points system).
4. Points (`src/points`): **Progress** `takeEntry(entry)` (already read? permission? trust? live quests watching this kind; once-only; award; all in one transaction) and **Standing** (total, level by points).
5. Stand-ins (`src/standin`): people and permissions (admin), carriages with hashed keys, activity entries (idempotent per carriage key), delivering each new entry to Progress.
6. Routes (`src/app.ts`): `POST /standin/people`, `POST /standin/carriages`, `POST /standin/activity`, `GET /v1/people/:id/standing`, `GET /v1/people/:id/awards?entry=`, `GET /v1/quests`.
7. Tests (through the routes, against PGlite): the three checks in issue #1, plus a refused key and a kind the carriage may not write.

## Test seams

Through the HTTP routes only (TRD §4: take an entry, get standing). PGlite is the local stand-in for PostgreSQL.

## Out of scope (later tickets)

The full quest board and templates (T-02), limits and periods (T-03), streaks (T-03b), trust and never-earns beyond "joined" (T-04), the level rules (T-05), reader permissions and rate limits (T-06), history download and corrections (T-07).
