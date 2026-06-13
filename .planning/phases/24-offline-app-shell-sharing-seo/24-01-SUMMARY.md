---
phase: 24-offline-app-shell-sharing-seo
plan: 01
subsystem: infra
tags: [service-worker, offline, pwa, svelte5-runes, vitest, ssr]

# Dependency graph
requires: []
provides:
  - "Pure shouldBypass(url, request, selfOrigin) + cacheNameFor(version) helpers (sw-cache.ts) — the node-testable OFFL-01 bypass contract the service worker (Plan 03) wraps"
  - "Reactive online/offline runes singleton (online.svelte.ts, OFFL-03) — SSR-safe default true, init()/teardown listener pair the online-only surfaces (Plan 05) consume"
affects: [24-03-service-worker, 24-05-offline-surfaces]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-core / thin-wrapper seam: branchy security-load-bearing logic lives in a pure node-testable module (sw-cache.ts), the SW runtime is a thin caller — mirrors sleep-timer.ts ← sleepTimer.svelte.ts"
    - "Browser-guarded runes singleton with SSR-safe $state initializer + init()/teardown listener lifecycle — mirrors history.svelte.ts"
    - "Test browser-path coverage in the node project via vi.mock('$app/environment', { browser: true }) + vi.stubGlobal('window'|'navigator') — mirrors player.svelte.test.ts"

key-files:
  created:
    - src/lib/services/sw-cache.ts
    - src/lib/services/sw-cache.test.ts
    - src/lib/stores/online.svelte.ts
    - src/lib/stores/online.svelte.test.ts
  modified: []

key-decisions:
  - "shouldBypass takes structural { method, headers } + an explicit selfOrigin string (never reads location/self) so it stays node-testable; the SW wrapper passes location.origin"
  - "Bypass rule order: non-GET → cross-origin → range header → same-origin /api/* → else false"
  - "online.svelte.ts placed in stores/ (holds $state) per the codebase convention; sw-cache.ts in services/ (pure, no runes)"
  - "online store SSR default is true (entity routes now SSR — must assume online, never flash offline server-side)"

patterns-established:
  - "Pure-core SW helper: a // PURE — no SW runtime, node-testable header + structural inputs + zero $app/environment / $service-worker imports"
  - "online/offline browser-path tested under the node project by mocking $app/environment browser=true and stubbing a listener-recording fake window"

requirements-completed: [OFFL-01, OFFL-03]

# Metrics
duration: ~12min
completed: 2026-06-14
---

# Phase 24 Plan 01: Offline Pure Cores Summary

**Extracted the two node-testable cores the offline half depends on — `sw-cache.ts` (the OFFL-01 SW bypass + version-keyed cache-name contract) and `online.svelte.ts` (the OFFL-03 reactive online/offline runes signal) — both fully unit-tested without a service-worker runtime.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-14T00:30Z
- **Completed:** 2026-06-14T00:34Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4 created

## Accomplishments
- `shouldBypass` locks the OFFL-01 / T-24-01 security contract: bypass (never cache) for non-GET, cross-origin (all audio CDNs), range, and same-origin `/api/*` requests — proven by 9 unit assertions with no SW runtime.
- `cacheNameFor(version)` gives the version-keyed cache name (T-24-02) so a deploy rotates the cache and stale shells can't poison a new build.
- `online` runes singleton mirrors `navigator.onLine`, flips on window `online`/`offline` events, defaults `true` under SSR, and returns a teardown that removes its listeners — 4 unit assertions covering flip, teardown, and the SSR no-op path.
- Full suite green (823 tests / 62 files) and `svelte-check` clean (0 errors) — zero regression, zero new dependencies.

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1 (RED): failing sw-cache tests** - `af8b49e` (test)
2. **Task 1 (GREEN): sw-cache shouldBypass + cacheNameFor** - `b75b740` (feat)
3. **Task 2 (RED): failing online store tests** - `cb300d7` (test)
4. **Task 2 (GREEN): online runes store** - `080b3bc` (feat)

_No REFACTOR commits — both modules were minimal and clean at GREEN._

## Files Created/Modified
- `src/lib/services/sw-cache.ts` - Pure `shouldBypass` + `cacheNameFor`; structural inputs, zero runtime-global imports.
- `src/lib/services/sw-cache.test.ts` - 9 assertions across the four bypass rules + the cacheable case + version-keying.
- `src/lib/stores/online.svelte.ts` - Browser-guarded `Online` runes singleton; `isOnline` `$state`, `init()`/teardown listener pair.
- `src/lib/stores/online.svelte.test.ts` - 4 assertions: listener attach + flip, teardown removal/no-further-flip, SSR default + no-op init.

## Decisions Made
- `shouldBypass` receives `selfOrigin` as an explicit param rather than reading `location`/`self` — keeps the security gate node-testable; the SW wrapper (Plan 03) supplies `location.origin`.
- The online store lives in `src/lib/stores/` (it holds `$state`), resolving the RESEARCH.md `stores/` vs `services/` ambiguity per the PATTERNS.md directory note.
- SSR default `isOnline = true` is load-bearing now (not just convenience): entity routes SSR in this phase, so a server-render must assume online.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed existing dependencies in the worktree**
- **Found during:** Task 1 (running the first RED test)
- **Issue:** `vitest: command not found` — the fresh worktree had no `node_modules`.
- **Fix:** Ran `pnpm install --frozen-lockfile` (existing lockfile only — NO new packages added).
- **Files modified:** None tracked (node_modules is gitignored).
- **Verification:** `pnpm test` runs; full suite green.
- **Committed in:** N/A (no tracked file change).

---

**Total deviations:** 1 auto-fixed (1 blocking — env setup, no package additions).
**Impact on plan:** None on scope. Zero new dependencies, consistent with threat T-24-SC (this plan adds no packages).

## Issues Encountered
- The single node test project (`environment: 'node'`, `browser=false`) cannot dispatch real `window` events to the store's listeners. Resolved using the repo's established `vi.mock('$app/environment', { browser: true })` + `vi.stubGlobal('window'|'navigator')` pattern (from `player.svelte.test.ts`) with a listener-recording fake window, so the browser flip/teardown path executes headless. The SSR-default case uses `vi.resetModules()` + `vi.doMock(browser:false)` to assert the no-op path in isolation.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- OFFL-01 bypass contract and OFFL-03 reactive signal are locked as tested primitives.
- Plan 03 (`src/service-worker.ts`) can import `{ shouldBypass, cacheNameFor }` and pass `location.origin` / `version`.
- Plan 05 (online-only surfaces) can import `{ online }` and read `online.isOnline` (calling `online.init()` from a component `onMount`).
- No blockers.

## Self-Check: PASSED
- FOUND: src/lib/services/sw-cache.ts
- FOUND: src/lib/services/sw-cache.test.ts
- FOUND: src/lib/stores/online.svelte.ts
- FOUND: src/lib/stores/online.svelte.test.ts
- FOUND commit af8b49e (test sw-cache)
- FOUND commit b75b740 (feat sw-cache)
- FOUND commit cb300d7 (test online)
- FOUND commit 080b3bc (feat online)

---
*Phase: 24-offline-app-shell-sharing-seo*
*Completed: 2026-06-14*
