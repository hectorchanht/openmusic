---
phase: quick-260927-dz0
plan: 01
status: complete
subsystem: search
tags: [search, url, deep-link]
requires: [quick-260927-dh5 initialSearch read half, url-tab syncTabUrl/tabHref]
provides: [search page writes committed ?q= to the address bar, clears it on reset, restores it on tab-return]
affects: [src/routes/(app)/search/+page.svelte]
tech-stack:
  added: []
  patterns: [reuse url-tab syncTabUrl (raw history.replaceState) as the only URL writer]
key-files:
  created: []
  modified:
    - src/routes/(app)/search/+page.svelte
    - src/lib/services/search-url.test.ts
decisions:
  - "run() is the only setter of ?q= for a live search, placed after the empty and OFFL-03 short-circuits so the URL always names the query whose results are on screen"
  - "resetResults() is the only clearer (covers the X button and typing back to empty)"
  - "Orchestrator addition: the onMount restore branch also writes ?q= so a tab-return to bare /search is reloadable"
metrics:
  duration: ~5 min
  completed: 2026-09-27
  commits: 1
---

# Quick 260927-dz0: Search page writes the committed ?q= back to the URL

A committed search now writes `?q=<term>` to the address bar through the existing `syncTabUrl` (raw `replaceState`, so no history entry is added). Clearing the search strips it, and a restored session puts it back. This makes a typed search reloadable and shareable, and it agrees with the dh5 `initialSearch` read half.

## What changed

- `src/routes/(app)/search/+page.svelte`
  - `import { syncTabUrl } from '$lib/services/url-tab'` (1 import)
  - `run()`: `syncTabUrl('q', kw, '')` right after `if (!online.isOnline) return;`, before `ac?.abort()`. It has a dz0 comment on the funnel and on why this uses a raw replaceState instead of `goto`/shallow routing.
  - `resetResults()`: `syncTabUrl('q', '', '')` as the last line. This is the one shared clear point for X and for typing back to empty.
  - `onMount` restore branch: `syncTabUrl('q', searchSession.q, '')` (the orchestrator addition). `searchSession.q` is already trimmed by `persistSession()`, so it matches `run()`'s normalized write.
  - The dh5 onMount comment no longer calls the page "READ-ONLY on the URL". The `ponytail: SPA navigation` note is still there.
- `src/lib/services/search-url.test.ts`: new `tabHref → initialSearch round-trip` describe block with two cases: CJK plus space set/read, and clear deletes `?q=` and reads back as `none`.

## Verification (observed)

- `pnpm vitest --run src/lib/services/search-url.test.ts`: 12/12 passed (10 dh5 + 2 dz0). The new cases passed on first run. That is expected, because they pin agreement between two existing pure functions rather than new logic.
- `pnpm check`: `4642 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`
- `pnpm test`: 166 test files passed, 3676 tests passed
- Structural: 3 non-comment `syncTabUrl('q'` call sites (run, resetResults, restore; 3 per the orchestrator's adjustment), 1 url-tab import, "READ-ONLY on the URL" gone, `ponytail: SPA navigation` kept.
- Not verified here: browser E2E (the orchestrator runs it).

## Deviations from Plan

1. **Orchestrator addition:** restore-branch `syncTabUrl('q', searchSession.q, '')`, tagged `quick-260927-dz0`. The plan said not to add a writer there, and the orchestrator overrode that.
2. **Single commit:** the plan asked for a separate test commit. The orchestrator constraint asked for one atomic commit, so test and feature ship together in `dd0ce174`.
3. **Trailer:** used `Co-Authored-By: Claude Opus 5.5` per the orchestrator, not the plan's `Claude Fable 5.1`.
4. **Plan verify-script bug (not fixed; the plan is out of scope):** `grep -c "from '\$lib/services/url-tab'"` returns 0 on macOS BSD grep, because `$` is treated as an anchor. A fixed-string grep (`grep -cF`) returns 1, the true count. The call-site check threshold is also 3, not 2.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/routes/(app)/search/+page.svelte (modified)
- FOUND: src/lib/services/search-url.test.ts (modified)
- FOUND: commit dd0ce174
