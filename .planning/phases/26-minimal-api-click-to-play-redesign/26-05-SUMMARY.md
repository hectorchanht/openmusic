---
phase: 26-minimal-api-click-to-play-redesign
plan: 05
subsystem: services/sources
tags: [netease, health-gate, dry-spell, search-fan-out, resilience, never-throw, in-memory, edge-safe, vitest, tdd]

# Dependency graph
requires:
  - src/lib/sources/netease.ts search() — the apiFetch + Array.isArray contract-drift throw + empty-array mapping (gate wired in front of the upstream call)
  - src/lib/services/api-base.ts apiFetch + __resetGovernor — the governed fetch seam netease.search() calls (test isolation)
provides:
  - src/lib/services/netease-health.ts neteaseHealth — pure in-memory dry-spell tracker (recordDry/recordOk/isGated + test-only __reset); DRY_THRESHOLD + GATE_WINDOW_MS module constants
  - src/lib/sources/netease.ts search() — consults neteaseHealth: short-circuit to [] while gated; record dry/ok after a live search
affects: [search-fan-out, netease-availability, api-call-reduction]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-memory session-scoped health tracker: a consecutive-dry counter + a trip timestamp, mirroring cover-backfill's negative-miss cache (missAt/MISS_TTL_MS) and ttl-cache's __clearSearchCache reset-for-tests idiom — no window/localStorage, never-throws, edge/SSR-safe"
    - "Bounded self-recovering gate: DRY_THRESHOLD consecutive drys trip a GATE_WINDOW_MS window; isGated() auto-opens on window expiry for exactly ONE probe whose outcome re-decides; recordOk() clears the streak + trip instantly (instant recovery on a real hit)"
    - "Adapter short-circuit: netease.search() returns [] before apiFetch while gated (no wasted upstream call, fan-out unblocked); records dry([])/ok(non-empty) only after a LIVE call so a probe re-decides"
    - "Contract-drift preserved: a non-array body still THROWS (typed per-source error for catalog's allSettled) and is NEVER recorded as dry — drift is a distinct signal from a dry spell"

key-files:
  created:
    - src/lib/services/netease-health.ts
    - src/lib/services/netease-health.test.ts
  modified:
    - src/lib/sources/netease.ts
    - src/lib/sources/netease.test.ts

key-decisions:
  - "The dry-vs-drift split is load-bearing: an EMPTY array is a valid 'dry' response → recordDry() (drives the gate); a NON-array body is contract drift → THROW (unchanged) and is never recorded as dry. Only reordered so the throw happens before any record, and the record happens only after a real upstream call."
  - "consecutiveDry is deliberately NOT reset when the window expires — it stays at/above the threshold so the FIRST dry probe after the window re-trips immediately. Result: exactly ONE wasted /api/netease/search per window during a persistent outage, not DRY_THRESHOLD calls."
  - "recordDry() trips only on the transition (gateTrippedAt === 0) so a still-dry probe arms a FRESH window rather than extending a stale timestamp."
  - "Gated short-circuit returns [] (never-throw) rather than an AbortError — an empty result is the same benign 'dry' outcome the fan-out already handles, and no async work means nothing to abort. AbortSignal is honored on the live path (threaded to apiFetch, unchanged)."
  - "Kept as a pure .ts singleton (not .svelte.ts): nothing reactive reads it; the netease adapter calls it imperatively. Node-testable under the single Vitest server project + edge/SSR-safe (no window/localStorage)."

requirements-completed: [NETEASE-01]

# Metrics
duration: 7min
completed: 2026-07-11
---

# Phase 26 Plan 05: Netease Dry-Spell Health-Gate Summary

**Stops the intermittently-dead netease upstream (`api.qijieya.cn/meting/`, which returns `[]` for a RUN of queries then recovers — spikes 001/004) from silently degrading live search. A new pure, in-memory, never-throw `neteaseHealth` tracker trips a bounded gate after `DRY_THRESHOLD` consecutive dry (`[]`) responses; while gated, `netease.search()` returns `[]` immediately WITHOUT issuing the wasted `/api/netease/search`, so a dead netease neither slows nor strands the search fan-out (kuwo-first resolve unaffected). The gate auto-opens after `GATE_WINDOW_MS` (~60s) for exactly one probe whose outcome re-decides it, and a real hit (`recordOk()`) clears it instantly — so netease is never hidden permanently. The non-array contract-drift THROW is preserved and never counted as dry. Green typecheck + target suites (only the pre-existing deferred `searchHistory` SSR-guard failure remains, unrelated).**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-07-11T11:07:15Z
- **Completed:** 2026-07-11T11:14Z
- **Tasks:** 2 of 2 (Task 1 TDD RED→GREEN; Task 2 autonomous)
- **Files:** 2 created, 2 modified

## Accomplishments

- **Task 1 (NETEASE-01 — pure netease health tracker), TDD:**
  - **RED** (`9108b0c`): 8 failing tests for `neteaseHealth` — threshold consecutive `recordDry()` → `isGated()` true; `recordOk()` clears the gate + streak immediately; mid-streak `recordOk()` resets; gate auto-expires after `GATE_WINDOW_MS` (fake timers) so a probe is allowed; a still-dry probe re-trips; a successful probe recovers permanently; never-throws.
  - **GREEN** (`a75399f`): implemented `src/lib/services/netease-health.ts` — a module-scope singleton with a consecutive-dry counter + a trip timestamp, exported `DRY_THRESHOLD` (3) + `GATE_WINDOW_MS` (60_000), and `recordDry` / `recordOk` / `isGated` / `__reset`. Pure `.ts`, no `window`/`localStorage`, never-throws (edge/SSR-safe). Mirrors cover-backfill's in-memory negative-miss idiom.
  - **REFACTOR:** none needed (module was clean + fully documented on GREEN).
- **Task 2 (wire the gate into the netease adapter), autonomous** (`23a1389`):
  - `netease.search()` now calls `neteaseHealth.isGated()` BEFORE `apiFetch` — returns `[]` immediately when gated (skips the wasted upstream call; fan-out still gets the healthy sources).
  - After a LIVE search it records the outcome: an empty array → `recordDry()`, a non-empty result → `recordOk()` (instant recovery).
  - PRESERVED the `if (!Array.isArray(json)) throw` contract-drift path (reordered comment only) — a non-array body still throws for catalog's `allSettled` and is never recorded as dry.
  - Extended `netease.test.ts`: added `neteaseHealth.__reset()` + `__resetGovernor()` to `beforeEach`/`afterEach` (prevents module-state leak across cases), and a new describe block with 3 tests (gated no-fetch short-circuit, ok-clears-streak recovery, drift-throw-not-dry).

## Verification

- `pnpm test -- src/lib/services/netease-health.test.ts` — 8 passed.
- `pnpm test -- src/lib/sources/netease.test.ts` — 19 passed (16 existing + 3 new gate tests).
- `pnpm check` — 0 errors, 0 warnings (4314 files).
- Grep: `netease-health.ts` holds no runtime `window.`/`localStorage` reference (all matches are comment prose).
- Full `pnpm test` — 1138 passed, 1 failed (only the pre-existing deferred `searchHistory.svelte.test.ts` SSR-guard failure; see Deviations).

## TDD Gate Compliance

- Task 1 RED gate: `9108b0c` `test(26-05): add failing tests …` — suite failed with `Cannot find module './netease-health'` before any implementation.
- Task 1 GREEN gate: `a75399f` `feat(26-05): pure in-memory netease dry-spell health gate` — all 8 tests green.
- Task 2 is `type="auto"` (not a TDD plan-level gate) but was still test-backed: the adapter tests were extended alongside the wiring and pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test isolation: reset module-scope state in netease.test.ts beforeEach**
- **Found during:** Task 2 (extending the adapter tests).
- **Issue:** `neteaseHealth` (and the api-base fetch governor) are module-scope singletons. Without a reset, a test that trips the gate would leak state into later `it` blocks (a subsequent `search()` would short-circuit to `[]`, or a tripped circuit breaker would fast-reject), causing order-dependent flakes.
- **Fix:** added `neteaseHealth.__reset()` + `__resetGovernor()` to the file's `beforeEach`/`afterEach` (the established reset-for-tests idiom). No production behavior change.
- **Files modified:** src/lib/sources/netease.test.ts
- **Commit:** 23a1389

### Out of Scope (logged, NOT fixed)

**Pre-existing test failure: `searchHistory.svelte.test.ts` SSR guard (Node native `localStorage`)**
- Fails in isolation with zero Plan-26-05 code in its import graph. The runtime is Node **v25.9.0**, which ships a built-in Web Storage API, so `globalThis.localStorage` is now defined and the test's `expect(typeof globalThis.localStorage).toBe('undefined')` no longer holds. The file was last modified in Phase 14 (`188b495`) and is untouched here. Already known/deferred (documented in 26-02-SUMMARY / commit `f7f567f`). Logged to `.planning/phases/26-minimal-api-click-to-play-redesign/deferred-items.md`; NOT fixed per the scope boundary.

## Known Stubs

None. `neteaseHealth` is a fully wired tracker and the netease adapter consults it on every search; there are no hardcoded/placeholder values.

## Threat Flags

None. No new render or network surface. The gate REDUCES outbound calls (T-26-05-01: skips wasted dry-window `/api/netease/search`), guarantees recovery via `GATE_WINDOW_MS` expiry + `recordOk()` (T-26-05-02: no permanent hide), adds no dependency (T-26-05-03), and preserves the existing contract-drift throw. The tracker is in-memory only (no persistence, no secret, no PII).

## Notes for Next Plan

- netease is now self-healing on the SEARCH side: a dry spell short-circuits (no wasted call, no stranded fan-out) and auto-re-probes. Combined with 26-01's kuwo-first RESOLVE reorder, netease's intermittent deadness no longer degrades either search or play.
- The gate is per-session in-memory (resets on reload) and threshold/window are module constants (`DRY_THRESHOLD`, `GATE_WINDOW_MS`) — tune there if the qijieya outage cadence changes; no config plumbing was added.

## Self-Check: PASSED

- All 4 files present on disk (`netease-health.ts`, `netease-health.test.ts`, `netease.ts`, `netease.test.ts`).
- All 3 commits present in git history (`9108b0c` test/RED, `a75399f` feat/GREEN Task 1, `23a1389` feat Task 2).
