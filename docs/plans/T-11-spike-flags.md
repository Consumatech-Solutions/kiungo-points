# Plan: T-11 spike flags (issue #12)

**Goal:** unusual patterns (many entries of one kind from one person in a short time) create a flag for a person at Consumatech to review. The settings are private; flags never take points away or block anything.

**Requirements:** issue #12; TRD §7 (spotting abuse: flagged for a person to review, never punished automatically; how they're spotted stays private, the rules are public); `design.md` §6 rule 10 (open rules, private fraud detection).

## Steps

1. Test first (`test/spikes.test.ts`): with a setting of 20 invites an hour, twenty invites in an hour create one flag, and a twenty-first doesn't create another; nineteen create none; no points are taken away; a person reviews a flag and it closes; settings and flags need the admin key, and nothing about them shows in a member's standing or an entry's answer.
2. Migration `0011_spike_flags.sql`: `spike_settings` (kind, how many, in how many minutes); `spike_flags` (who, which setting, when, count, reviewed, note); an index on entries read by person, kind and time. No settings are seeded: the code is public, the settings aren't.
3. `src/points/spikes.ts`: after an entry is read, count that person's entries of the same kind in the window; at the threshold, one flag per window.
4. Admin routes: `PUT /v1/admin/spike-settings`, `GET /v1/admin/flags`, `POST /v1/admin/flags/:id/review`.

## Test seams

The HTTP routes.

## Out of scope

Patterns across devices or confirmers (the same confirmer again and again): the stand-in rail carries no device or confirmer yet.
