---
phase: quick-260927-dh5
plan: 01
status: complete
subsystem: search
tags: [search, url, deep-link]
requires: []
provides:
  - "initialSearch(search, prior) pure run/restore/none decision + MAX_URL_QUERY (200 code points)"
  - "/search?q=<term> runs <term> on mount via the existing run()"
affects:
  - "src/routes/(app)/search/+page.svelte onMount"
tech-stack:
  added: []
  patterns: ["pure .ts decision helper, runes page as thin caller"]
key-files:
  created:
    - src/lib/services/search-url.ts
    - src/lib/services/search-url.test.ts
  modified:
    - "src/routes/(app)/search/+page.svelte"
decisions:
  - "A ?q= matching the prior in-memory session restores (no refetch) so back-nav keeps instant restore + scroll"
  - "?q= is trimmed and capped at 200 code points (spread-then-slice, surrogate-safe) before reaching run()"
  - "Page is read-only on the URL: never writes ?q= back"
metrics:
  duration: "~4 min"
  completed: 2026-09-27
  tasks: 2
  files: 3
---

# Quick 260927-dh5: Search page runs the query from a ?q= URL — Summary

`/search?q=<term>` now fills the box and runs `<term>` through the existing `run()` on mount, so history recording, partial streaming and the offline short-circuit all work exactly as they do for a typed submit. The run / restore / none decision lives in a pure, node-tested `initialSearch()` helper.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1. Pure `initialSearch` helper + vitest cases (TDD) | `0579d972` | `src/lib/services/search-url.ts`, `src/lib/services/search-url.test.ts` |
| 2. Wire `onMount` to `initialSearch` | `dfcbc631` | `src/routes/(app)/search/+page.svelte` |

## Verification (observed)

- RED: `pnpm vitest --run src/lib/services/search-url.test.ts` failed on the missing module before the helper existed.
- GREEN: the same command gave 10/10 passed.
- `pnpm check` after each commit: `COMPLETED 4642 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.
- `pnpm test` (full suite, final tree): Test Files 166 passed (166), Tests 3674 passed (3674).
- Structural greps: `initialSearch(location.search, searchSession)` x1, `q = init.q` x1, no `$app/state` import. `git status -- src` is clean, and the last 2 commits are both tagged `quick-260927-dh5`.
- Not verified here: the browser E2E (fresh `?q=` run, focus not stolen, same-q restore, bare `/search` focus). The orchestrator runs it.

## Skipped (out of scope)

- **Writing `?q=` back to the address bar** on type/submit (reload and share-back of a typed search). The page is read-only on the URL.
- **In-place SPA navigation** to `/search?q=X` while already mounted on `/search`. It does not remount, so the new q is ignored. This is marked with a `ponytail:` comment: add an `afterNavigate` hook if an in-app link ever targets `/search?q=`.

## Deviations from Plan

None in the code. One plan-verify note: Task 2's `<verify>` chain runs `pnpm check 2>&1 | tail -3 | grep -q '0 errors'`, but svelte-check here prints the uppercase `0 ERRORS`, so that step fails on case alone. The check itself was 0 errors / 0 warnings. With `grep -qi` the step passes, and every other step in the chain passed as written.

## Threat Flags

None beyond the plan's threat model. T-dh5-01 is mitigated by the 200-code-point cap plus trim in `search-url.ts`.

## Self-Check: PASSED

- FOUND: src/lib/services/search-url.ts
- FOUND: src/lib/services/search-url.test.ts
- FOUND: 0579d972
- FOUND: dfcbc631
