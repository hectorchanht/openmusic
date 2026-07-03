---
quick_id: 260704-3ac
slug: delete-orphan-spike-route-dead-phase-1-a
status: complete
completed: 2026-07-04
commits:
  - 83e3de3
files_modified:
  - src/routes/spike/+page.svelte (deleted)
  - src/routes/+layout.svelte (comment trimmed)
---

# Quick Task 260704-3ac Summary: Delete orphan `/spike` route

Removed the dead `/spike` Phase-1 egress-spike test harness (277 lines) — optimization
backlog item #6.

## What changed

- **Deleted** `src/routes/spike/+page.svelte` via `git rm -r src/routes/spike/`. It was
  unreachable dead code: not linked from any nav/router, no `href`, no test, no import —
  reachable only by manually typing `/spike`.
- **Trimmed** the `(incl. into /spike)` clause from the single-`<audio>`-persistence comment
  in `src/routes/+layout.svelte`. The comment's actual point (the root-layout audio element
  survives client-side navigation across route groups) is unchanged.

## Verification (actual results)

- `pnpm check` (svelte-check): **0 errors / 0 warnings** — 4295 files (was 4297; the two
  `/spike` generated route types are gone). No dangling import/reference.

## Commit

| Task | Commit | Files |
| ---- | ------ | ----- |
| 1 | `83e3de3` | `src/routes/spike/` (deleted), `src/routes/+layout.svelte` |

## Notes

- Backlog #4 (rewrite the 74 stale `index.html` refs in `CLAUDE.md` / `AGENTS.md`) is being
  handled separately via `/gsd:docs-update` — those are GSD-managed generated files
  (`<!-- GSD:*-start source:... -->` delimited blocks) regenerated from the freshly-remapped
  `.planning/codebase/` docs, not hand-edited.
