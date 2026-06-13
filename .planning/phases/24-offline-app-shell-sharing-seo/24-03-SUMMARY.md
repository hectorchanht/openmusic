---
phase: 24-offline-app-shell-sharing-seo
plan: 03
subsystem: infra
tags: [service-worker, sveltekit, offline, pwa, caching, capacitor]

# Dependency graph
requires:
  - phase: 24-01
    provides: "Pure sw-cache.ts core (shouldBypass, cacheNameFor) — node-tested bypass + cache-name logic"
provides:
  - "Native service worker (src/service-worker.ts) — version-keyed precache, activate eviction, bypass-delegating fetch handler (OFFL-01)"
  - "svelte.config.js serviceWorker.register guard so the Capacitor native build never auto-registers the web SW (D-03)"
affects: [24-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin SW wrapper over a node-tested pure core ($service-worker + sw-cache.ts), mirroring sleepTimer.svelte.ts → sleep-timer.ts"
    - "Build-target-conditional SvelteKit config (kit.serviceWorker.register = !native)"

key-files:
  created:
    - src/service-worker.ts
  modified:
    - svelte.config.js

key-decisions:
  - "SW is a thin caller: the entire bypass contract is the single shouldBypass early-return — no /api/ branch is duplicated in the runtime file"
  - "fetch strategy is cache-first for known shell ASSETS, network-then-cache (200 only) otherwise, with cache-match fallback on network failure"
  - "Reused the existing native flag (BUILD_TARGET === 'native'); no static-check introduced"

patterns-established:
  - "Service worker delegates all security-load-bearing decisions to the unit-tested pure core; runtime file holds only the SW event plumbing"

requirements-completed: [OFFL-01]

# Metrics
duration: 8min
completed: 2026-06-14
---

# Phase 24 Plan 03: Native Service Worker Summary

**SvelteKit service worker that precaches the app shell into a version-keyed cache, evicts non-matching caches on activate, and delegates all bypass decisions (`/api/*`, cross-origin audio, range, non-GET) to the node-tested `shouldBypass` core — with the Capacitor native build guarded against auto-registering the web SW.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-14T00:38Z
- **Completed:** 2026-06-14T00:41Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 edited)

## Accomplishments
- `src/service-worker.ts`: install precaches `[...build, ...files]` into `cache-${version}`; activate deletes every cache whose name != the current version cache (OFFL-01 stale-shell eviction on deploy).
- fetch handler delegates the bypass decision entirely to `shouldBypass(url, request, sw.location.origin)` — a single early return, no duplicated bypass branches; cache-first for shell assets, network→cache (200) otherwise, cache-match fallback when offline.
- `svelte.config.js`: added `kit.serviceWorker.register = !native` so the Capacitor static build never auto-registers the web SW while the Cloudflare build keeps `register: true` (D-03 / Pitfall 1).

## Task Commits

Each task was committed atomically:

1. **Task 1: Native service-worker.ts (precache + activate eviction + bypass fetch)** - `21b0f67` (feat)
2. **Task 2: Guard native build against SW auto-registration** - `8d23655` (chore)

## Files Created/Modified
- `src/service-worker.ts` (created) - Thin SW wrapper over `sw-cache.ts`: version-keyed precache, activate eviction loop, bypass-delegating fetch handler.
- `svelte.config.js` (modified) - Added `serviceWorker: { register: !native }` to the `kit` config.

## Decisions Made
- The runtime SW casts `globalThis.self` to a local `sw` (not shadowing `self`) and passes `sw.location.origin` to `shouldBypass`, matching the merged 3-arg signature in `sw-cache.ts`.
- No new dependencies added (native SvelteKit `$service-worker`; no vite-pwa, per locked decision).

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
- The worktree had no `node_modules`; ran `pnpm install --frozen-lockfile` so `pnpm check` / `pnpm test` could run. Not a code change.

## Threat Surface
No new trust boundaries introduced beyond the plan's `<threat_model>`. Mitigations applied as specified: T-24-01 (bypass via tested `shouldBypass`), T-24-02 (version-keyed cache + activate eviction), T-24-06 (native register guard). No new packages (T-24-SC).

## Verification
- `pnpm check` (svelte-check): 0 errors, 0 warnings (4275 files).
- `pnpm test` (vitest): 830 passed / 62 files — includes the Plan-01 sw-cache unit tests.
- Grep acceptance: `shouldBypass`/`cacheNameFor` present; `startsWith('/api/')` count = 0 (no duplication); `caches.keys`/`caches.delete` eviction loop present; `register: !native` present; no `'static'` check.
- Full `pnpm build && pnpm build:native` smoke gate is owned by Plan 05.

## Next Phase Readiness
- OFFL-01 SW + native register guard ready. Plan 05's build-smoke gate must confirm both `pnpm build` and `pnpm build:native` still succeed with the SW present.

## Self-Check: PASSED

---
*Phase: 24-offline-app-shell-sharing-seo*
*Completed: 2026-06-14*
