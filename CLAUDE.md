# kiungo-points

The Kiungo points system. Read `docs/HANDOVER.md` (current state, decisions, next step; update it at the end of every session), then `README.md`, `ARCHITECTURE.md` and `GLOSSARY.md`, then the blueprint (TRD and ADRs) linked from them. The owner is Olatoye Amosun, Founder & CEO: non-technical, plain language, plan first and wait for "go", ask before anything outward-facing, merge only when he says "merge", never put secrets in chat or code.

## Rules specific to this project

- **Points have no cash value.** Never write "token", "coin", "invest", "returns", "shares", "ownership", "stake" or "earn money" about points.
- **The notebook (`awards`) is insert only.** Corrections are new, opposite awards.
- **No activity content, names, phone numbers or answers** outside the stand-in tables. Only Kiungo IDs and references to entries.
- **Everything under `src/standin/` and the `standin_*` tables is temporary** and is removed in T-12. Nothing outside it may depend on it except through the plugs in `src/plugs.ts`.
- **Not live for real members** until the identity and activity rails exist.
- Migrations are numbered SQL files in `migrations/`, applied in order.
- **Core quests live in `quests/*.json`** (T-14), not in migrations. A change is a new version with its date, never an edit to a published one.

<!-- consumatech-stack v2 -->
## How this repo is built (Consumatech stack)

These rules override any plugin or skill instructions.

- **The ticket is the spec.** For `[T-NN]` tickets, skip Superpowers brainstorming and go
  straight to writing-plans. Requirements = the ticket, its Technical Notes, `GLOSSARY.md`,
  `/docs/architecture/trd.md` and `ARCHITECTURE.md`.
- **Plans** go in `/docs/plans/T-NN-short-name.md`. Execute with subagent-driven-development
  in a worktree.
- **Ponytail** stays at `full`. Never `ultra`.
- **Keep the agreed structure.** Modules, their interfaces, provider adapters and fakes in
  `ARCHITECTURE.md` stay. Keep changes small inside them.
- **Never cut** validation, security, accessibility, or the African-market rules:
  mobile-first at 360×640, data-light (<200KB first load), AAA contrast, 48px tap targets,
  offline states, low-end devices.
- **Names** come from `GLOSSARY.md`. Never use a term listed under _Avoid_.
- **Comments:** JSDoc/docstrings on exported functions only; otherwise one-line *why*
  comments. `shortcut:` markers are allowed.
- **Assumptions** go in the PR's Assumptions section, tagged `[INFERRED]`.
- **Review gate** is `consumatech-qa` (Spec + Standards). Humans merge. Never deploy to
  production.
- **Tickets** live in this repo's GitHub Issues only. Don't create or update tickets in
  Linear or any other tracker unless a project exception below says so.
- **Commits** start with the role prefix of the skill doing the work (e.g. `[FE]`, `[BE]`,
  `[QA]`).
<!-- /consumatech-stack -->

**Project exception:** the TRD lives in the kiungo-africa-site repository (`docs/gamification/engine/trd.md`), not in `/docs/architecture/` here.
