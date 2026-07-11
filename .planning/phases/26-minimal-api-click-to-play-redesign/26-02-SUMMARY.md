---
phase: 26-minimal-api-click-to-play-redesign
plan: 02
subsystem: services/stores
tags: [cover, hot-path, deezer, hq-upgrade, api-call-reduction, fan-out, generation-guard, svelte5, vitest, tdd]

# Dependency graph
requires:
  - src/lib/services/cover-backfill.ts resolveCoverForTrack — the shared Deezer→iTunes→CN miss-recovery chain reused unchanged for coverless sources
  - src/lib/stores/cover-version.svelte.ts writeCoverBoth/bumpCoverVersion — reactive cover-cache bump seam
provides:
  - src/lib/services/cover-backfill.ts resolveDeezerHQ(track,signal?) — Deezer-only single-tier HQ cover upgrade; never touches iTunes/CN; writes both cache layers on SOLID hit; never-throw, AbortSignal-honoring
  - src/lib/stores/player.svelte.ts upgradeCoverAsync(resolved,myGen) — bounded lazy post-paint Deezer HQ upgrade for the now-playing track only; fire-and-forget, generation-guarded
affects: [cover-hot-path, api-call-reduction, click-to-play-cost, media-session-artwork]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline cover on the hot path: play() paints resolvedCover synchronously from track.cover/cache; the full Deezer→iTunes→CN chain (resolveCoverAsync) fires ONLY when !resolvedCover (a coverless source/miss) — unchanged"
    - "Single optional cover call: an else-if gates a bounded Deezer HQ UPGRADE (upgradeCoverAsync→resolveDeezerHQ) when the now-playing track already painted from a SOLID inline cover — at most 1 Deezer call/play, never a per-tile fan-out (T-26-02-01)"
    - "resolveDeezerHQ mirrors resolveCoverForTrack's write posture (real-uid uid layer + always-safe name layer) but issues ONLY the Deezer tier via the shared tier() never-throw wrapper + isSolidCover https guard"
    - "coverVersion() bump stays the CALLER's job (player Site-C pattern) so cover-backfill.ts remains a pure node-testable .ts (no runes-wrapper import) — LOCKED decision preserved"
    - "Generation-guarded, fire-and-forget upgrade: upgradeCoverAsync captures myGen, re-checks playGen after the await, and only commits a SOLID URL that DIFFERS from the current cover (never a downgrade, never a broken image)"

key-files:
  created: []
  modified:
    - src/lib/services/cover-backfill.ts
    - src/lib/services/cover-backfill.test.ts
    - src/lib/stores/player.svelte.ts

key-decisions:
  - "resolveDeezerHQ writes the cache via the SAME pure setters resolveCoverForTrack uses (setCachedCoverByUid real-uid-only + setCachedCover) — NOT writeCoverBoth. Importing the runes writeCoverBoth into cover-backfill.ts would pull a .svelte.ts into the node-testable service (contradicting the LOCKED cover-cache/cover-backfill node-runnable decision). The player caller owns bumpCoverVersion(), exactly as resolveCoverAsync/healCover already do (Site C)."
  - "HQ upgrade is mutually exclusive with the full chain via if(!resolvedCover)…else if(httpsOnly(resolvedCover)): a track is EITHER coverless (full Deezer→iTunes→CN) OR has an inline cover (single Deezer upgrade) — never both, so the ~3-call budget holds."
  - "upgradeCoverAsync commits only when the new URL is SOLID https AND differs from the current cover — a same-URL Deezer answer is a no-op (no needless resolvedCover write / media-metadata churn)."
  - "The offline-blob play path (early-return, no network resolve) is intentionally left without an HQ upgrade — it already carries a known cover and never reaches resolveCoverAsync either; scope is the network click-to-play hot path."
  - "Task 3 tests are regression guards for behavior landed in Tasks 1–2, so they are GREEN on first run by design (the hot path never fans out; the miss path still recovers)."

requirements-completed: [COVER-01]

# Metrics
duration: 7min
completed: 2026-07-11
---

# Phase 26 Plan 02: Cover Off the Click-to-Play Hot Path Summary

**Keeps covers OFF the click-to-play hot path: the now-playing/tile art binds to the source-embedded cover the resolve already returned (kuwo `pic`, qq `album_pic`, netease `pic`) and the expensive Deezer→iTunes→CN chain now runs ONLY for genuinely coverless sources (joox/fivesing) or a true miss. Adds a bounded, lazy, post-paint Deezer-only HQ *upgrade* (`resolveDeezerHQ` + `upgradeCoverAsync`) for the now-playing track — the single optional cover call in the ~3-call budget — and a spy test proving the hot path issues 0 iTunes + 0 CN + ≤1 Deezer call while the miss path still fans all three tiers. Green typecheck + suite (only the pre-existing deferred `searchHistory` SSR-guard failure remains).**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-07-11T10:14:47Z
- **Completed:** 2026-07-11T10:21Z
- **Tasks:** 3 of 3 (Task 1 TDD RED→GREEN; Task 2 autonomous; Task 3 TDD regression proof)
- **Files:** 0 created, 3 modified

## Accomplishments

- **Task 1 (COVER-01 — Deezer-only HQ upgrade helper), TDD:**
  - **RED** (`9431b6c`): 7 new failing tests for `resolveDeezerHQ` — single-tier (0 iTunes / 0 CN), both-cache-layers write on a SOLID hit, empty-uid stub writes name layer only, never-throw + non-https-as-miss + aborted-signal short-circuit.
  - **GREEN** (`4f40c83`): implemented `resolveDeezerHQ(track, signal?)` in `cover-backfill.ts` — reuses the shared `tier()` never-throw wrapper + `isSolidCover` https guard, calls ONLY `deezerSongCover` (never iTunes/CN), writes the cache mirroring `resolveCoverForTrack`'s posture (real-uid uid layer + name layer), honors the AbortSignal, never throws.
  - **REFACTOR:** none needed.
- **Task 2 (player cover seam rework), autonomous** (`cd37188`):
  - Kept the synchronous inline-cover paint (`resolvedCover` from stub/resolved `.cover`, `writeCoverBoth`, `library.adoptCover`) and the existing rule that the FULL chain (`resolveCoverAsync`) fires ONLY when `!this.resolvedCover` — not widened.
  - Added an `else if (httpsOnly(this.resolvedCover))` branch firing `void this.upgradeCoverAsync(resolved, myGen)` — a bounded lazy Deezer HQ upgrade, mutually exclusive with the coverless full-chain path.
  - Added `private upgradeCoverAsync(resolved, myGen)`: awaits `resolveDeezerHQ` off the audio critical path, re-checks `myGen === playGen`, and commits only a SOLID URL that DIFFERS from the current cover — sets `resolvedCover`, bumps `coverVersion()` (Site-C pattern, no double-write), and re-fires a FRESH `MediaMetadata` so the OS lock screen repaints. Self-heal (`healCover`) + media-card fallback (`readCoverByUidOrName`) left intact.
- **Task 3 (prove the hot path issues no fan-out), TDD regression proof** (`043bc51`):
  - Added 2 spy tests: the inline-cover hot path (`resolveDeezerHQ`) issues 0 iTunes + 0 CN `searchAll` + ≤1 Deezer call; the coverless miss path (`resolveCoverForTrack`) still fans Deezer→iTunes→CN. GREEN on first run by design (regression guard for Tasks 1–2 / T-26-02-01).

## Verification

- `pnpm check` — 0 errors, 0 warnings (4312 files).
- `pnpm test -- src/lib/services/cover-backfill.test.ts` — 36 passed (7 resolveDeezerHQ + 2 fan-out proof, on top of the existing 27).
- `pnpm test -- src/lib/services/cover-backfill.test.ts src/lib/services/cover-cache.test.ts` — 87 passed.
- `pnpm test -- src/lib/stores/player.svelte.test.ts` — 178 passed (existing player/cover behavior intact).
- Full `pnpm test` — 1127 passed, 1 failed (the pre-existing deferred `searchHistory.svelte.test.ts` SSR-guard failure only; see Deviations).
- Grep verification: `resolveCoverAsync` full-chain call remains gated on `!this.resolvedCover` (player L2693); the new `upgradeCoverAsync` upgrade fires fire-and-forget + gen-guarded at exactly one call site (L2701), never inside a queue/tile loop.

## TDD Gate Compliance

- Task 1 RED gate: `9431b6c` `test(26-02): add failing tests …` — 7 tests failing with `resolveDeezerHQ is not a function` before any implementation.
- Task 1 GREEN gate: `4f40c83` `feat(26-02): Deezer-only HQ cover upgrade helper …` — all 34 cover-backfill tests green.
- Task 3: regression proof committed as `test(26-02)` (`043bc51`); GREEN on first run because it guards already-landed Task 1–2 behavior (documented — not a masked RED-skip; the proven behavior predates the test by design).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking/architecture] Cache-write seam + `coverVersion()` bump split to keep cover-backfill.ts pure**
- **Found during:** Task 1 (implementation) / Task 2 (wiring).
- **Issue:** Task 1 says write via "the same seam `resolveCoverForTrack` uses" (pure `setCachedCover*` setters) while Task 2's parenthetical says "let `writeCoverBoth` (already done inside resolveDeezerHQ) repaint tiles." `writeCoverBoth` lives in the runes `cover-version.svelte.ts`; importing it into `cover-backfill.ts` would pull a `.svelte.ts` into the node-testable service, contradicting the LOCKED "cover-cache/cover-backfill stay node-runnable" decision.
- **Fix:** `resolveDeezerHQ` writes with the pure setters (mirroring `resolveCoverForTrack`); the player caller (`upgradeCoverAsync`) owns the `bumpCoverVersion()` — the exact Site-C pattern `resolveCoverAsync`/`healCover` already follow. Net behavior (both cache layers written + tiles repaint) is identical.
- **Files modified:** src/lib/services/cover-backfill.ts, src/lib/stores/player.svelte.ts
- **Commit:** 4f40c83, cd37188

**2. [Rule 3 - Blocking] Plan path correction for `cover-version.svelte.ts`**
- **Found during:** Read-first (Task 2).
- **Issue:** The plan lists `src/lib/services/cover-version.svelte.ts`, but the file lives at `src/lib/stores/cover-version.svelte.ts` (already imported by player). No functional change — resolved to the real path.

### Out of Scope (logged, NOT fixed)

**Pre-existing test failure: `searchHistory.svelte.test.ts` SSR guard (Node native `localStorage`)**
- Fails in isolation with zero Phase-26 code involved (Node 22+ exposes `globalThis.localStorage`, so the assertion `typeof globalThis.localStorage === 'undefined'` no longer holds). Already documented/deferred (commit f7f567f). Unrelated to this plan's cover changes — not fixed per the scope boundary.

## Known Stubs

None. `resolveDeezerHQ` is a fully wired single-tier resolver; `upgradeCoverAsync` is a live, gen-guarded player method reached on every network play whose track carries a SOLID inline cover.

## Threat Flags

None. No new render surface: `resolveDeezerHQ` reuses the existing `isSolidCover` https-only guard, and the resolved URL is written through the same cache setters + rendered as `<img src>` exactly as before (T-26-02-02 mitigated). No new dependency (T-26-02-03).

## Notes for Next Plan

- The cover hot path is now zero-network for inline-cover sources (kuwo/qq/netease) + ≤1 optional Deezer upgrade — the cover slice of the phase's ~59→~3 API-call reduction. Remaining phase plans (Up-Next via `track.getSimilar`, version-picker, netease health-gate) can assume covers no longer contribute a per-play fan-out.
- The Deezer HQ upgrade is the ONLY sanctioned cover network call on a successful inline-cover play; do not reintroduce a per-tile cover fan-out on the resolve path.

## Self-Check: PASSED

- All 3 modified files present on disk (`cover-backfill.ts`, `cover-backfill.test.ts`, `player.svelte.ts`).
- All 4 commits present in git history (9431b6c test/RED, 4f40c83 feat/GREEN Task 1, cd37188 feat Task 2, 043bc51 test Task 3).
