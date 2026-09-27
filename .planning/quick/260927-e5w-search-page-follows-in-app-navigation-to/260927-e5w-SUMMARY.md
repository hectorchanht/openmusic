---
phase: quick-260927-e5w
plan: 01
status: complete
subsystem: search
tags: [search, url, deep-link, navigation]
requires: [quick-260927-dh5, quick-260927-dz0]
provides: [search page follows same-page /search?q= navigations]
key-files:
  modified:
    - src/routes/(app)/search/+page.svelte
decisions:
  - "afterNavigate hook guarded to type !== 'enter' with from/to pathname both /search; mounts stay owned by onMount"
  - "Prior = live page state (searched && q), not searchSession; no echo guard because every ?q= write is raw replaceState"
metrics:
  completed: 2026-09-27
  tasks: 1
  files: 1
---

# Quick 260927-e5w: Search page follows in-app navigation to /search?q= Summary

When the search page is already mounted, it now handles a new `/search?q=` from a link, `goto`, or popstate. The new `afterNavigate` hook sends the query through the existing `initialSearch` and `run()`. No new pure function or test was needed.

## What changed

- `import { afterNavigate, goto } from '$app/navigation'`.
- `afterNavigate(({ from, to, type }) => …)` is registered at the top level of the script, right after `onMount` and before `onDestroy`:
  - **Guard:** it returns early if `type === 'enter'`, or if either `from` or `to` has a pathname other than `/search`. First load and arriving from another route belong to `onMount`, so the query never runs twice.
  - **Decision:** it calls `initialSearch(to.url.search, { hasPrior: searched && !!q.trim(), q })`, using the query currently on screen as the prior.
  - `run` sets `q = init.q; run();` and does not wait for it.
  - `restore` only calls `syncTabUrl('q', q.trim(), '')`. It doesn't run, reset, or move focus.
  - `none` does nothing.
- A comment block tagged `quick-260927-e5w` records:
  - Why the guard exists.
  - Why only `pathname` is compared: the raw replaceState leaves the router's `page.url.search` stale.
  - Why it can't loop: every `?q=` write goes through `syncTabUrl`, which is a raw `history.replaceState` and fires neither popstate nor afterNavigate. That is also why no oc6-style echo guard is needed.
  - Why the prior is live state and not `searchSession`.
- The dh5 `ponytail: SPA navigation …` note in `onMount` was replaced with a one-line `quick-260927-e5w` pointer to the hook.

Commit: `f58aff44` feat(quick-260927-e5w): search page follows in-app navigation to /search?q= while mounted (1 file, +33/−3)

## Verification (observed)

- Structural greps: `afterNavigate` import count 1. Non-comment call counts: `afterNavigate(` 1, `initialSearch(` 2, `syncTabUrl('q'` 4. The old `ponytail: SPA navigation` note is gone, and the `quick-260927-e5w` tag is present (2 hits).
- `pnpm check`: `4642 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.
- `pnpm vitest --run src/lib/services/search-url.test.ts`: 1 file, 12/12 passed.
- `pnpm test` (full suite): 166/166 test files, 3676/3676 tests passed.

**Not verified here:** browser E2E (the orchestrator runs it). That means an injected `<a href="/search?q=B">` click while A is on screen, the bare `/search` rail click, and `history.back()` between two in-page links.

## Deviations from Plan

None. The plan was executed as written. The only change is the commit trailer: `Co-Authored-By: Claude Opus 5.5`, as the orchestrator constraints required.

## Notes

- `q` is the text in the search box. If the user types in the box without committing and then taps the bare rail `/search` while results are showing, the restore branch writes that uncommitted text into `?q=`. The plan asked for this live-state prior, so it was kept. A committed-query field is the fix if this ever matters.

## Self-Check: PASSED

- FOUND: src/routes/(app)/search/+page.svelte (modified)
- FOUND: commit f58aff44

## Orchestrator follow-up (amended into the feat commit, f2e1f024)

The executor flagged one edge: the hook's prior was the live box text `q`. So typing without submitting and then tapping the rail's `/search` put the unsubmitted text into `?q=`. It now uses a plain `committedQ` field instead, which is the query the address bar names. `run()` sets it next to the `?q=` write, `resetResults()` clears it, and the onMount restore sets it. The hook uses it as the prior and writes it back in the restore branch. `searchSession.q` was ruled out because it is only persisted once a search settles, so it lags a search that is still loading. Gates re-run after the change: `pnpm check` 0/0, `pnpm test` 166 files / 3676 tests.

## Browser E2E (orchestrator, dev server 5173, hidden pane → in-page JS)

- `/search?q=Adele Hello` (78 rows), then an injected `<a href="/search?q=周杰倫 晴天">` click: B runs in place. Same input node (no remount), box and URL show B, history +1 (link push), 68 rows.
- A link to C (`Adele Hello`, 77 rows), then `history.back()`: B re-runs in place (68 rows, same node).
- Typing `zzz unsubmitted` and then clicking the rail `a[href="/search"]`: the URL stays `?q=周杰倫+晴天`, the 68 rows stay, and 0 search requests fire.
