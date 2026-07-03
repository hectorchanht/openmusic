---
phase: quick-260704-3ov
plan: 01
subsystem: player-persistence
tags: [refactor, god-object-split, persistence, localStorage, pure-module, optimization-backlog-7]
requires:
  - src/lib/stores/player.svelte.ts (the extraction seam — persist/restore method bodies)
  - src/lib/sources/types.ts (Track type — type-only import)
provides:
  - src/lib/stores/player-persist.ts (pure serialize/parse codec: STATE_KEY, serializeTrack, serializePlayerState, parsePlayerState)
affects:
  - src/lib/stores/player.svelte.ts (persist()/restore() now thin wrappers over the codec)
tech-stack:
  added: []          # zero new deps
  patterns:
    - "extract-a-pure-helper-module-the-runes-store-thinly-wraps (media-session.ts / sleep-timer.ts precedent)"
    - "never-throw localStorage codec with a single null sentinel (cover-cache.ts discipline)"
key-files:
  created:
    - src/lib/stores/player-persist.ts
    - src/lib/stores/player-persist.test.ts
  modified:
    - src/lib/stores/player.svelte.ts
decisions:
  - "The pure codec references player.svelte.ts ONLY in its banner comment (documenting the wrap precedent, mirroring media-session.ts); the sole import is the type-only Track — no runtime/circular import."
  - "restore()'s three historical early-returns (!raw / JSON.parse-catch / !current.uid) collapse into one `if (!parsed) return;` because parsePlayerState returns null for all three — observable behavior identical."
  - "The test-file no-overlap comparison ('off' === 'one' clever construct) was replaced with a literal expectation (Rule 1) so `pnpm check` stays 0/0."
metrics:
  duration: 6 min
  completed: 2026-07-04
  tasks: 2
  files: 3
  tests_added: 27
---

# Phase quick-260704-3ov Plan 01: Extract Pure Persistence Logic from Player Summary

API-preserving extraction of the pure serialize/parse slice out of the 3017-line `player.svelte.ts` god-object into a colocated, node-tested, never-throw `player-persist.ts` — zero behavior change, byte-identical persisted shape, full 161-case player suite still green.

## What Was Done

**Task 1 — pure codec + colocated tests (commit `d03db26`)**
- New `src/lib/stores/player-persist.ts` (145 lines): a PURE module — no runes, no `$app/environment`, never throws. Type-only `Track` import; the only mentions of `player.svelte.ts` are in the banner comment (documenting the wrap precedent, mirroring `media-session.ts` / `sleep-timer.ts`).
- Exports: `STATE_KEY` (`'openmusic:player:v1'`, moved verbatim), `serializeTrack` (11-field whitelist), `serializePlayerState` (the `v:1` envelope, byte-shape-identical to the old persist() payload), `parsePlayerState` (JSON.parse-in-try/catch → null on any failure, the `!current.uid` null gate, seek clamp, D-11 repeatMode migration). `reshape` is module-internal (exercised through parsePlayerState), matching cover-cache's private-helper pattern.
- New `src/lib/stores/player-persist.test.ts` (27 cases): whitelist strip (incl. Last.fm/source extras), serialize→parse round-trip (volatile fields return nulled/false), a hand-written legacy-shape blob (the exact `seedState` payload from `player.svelte.test.ts` L1160), null/empty/corrupt/no-uid/null-current/missing-current → null, reshape defaults, seek clamp (negative/NaN-string/undefined → 0; 61 preserved), repeatMode migration ('one' kept; 'all'/missing/garbage → 'off').

**Task 2 — delegate persist()/restore() (commit `b8831fb`)**
- Removed the dead `private static STATE_KEY` and `private serializeTrack` from the class; added `import { STATE_KEY, serializePlayerState, parsePlayerState } from '$lib/stores/player-persist'`.
- `persist()` keeps the Player-owned shell (`if (!browser) return`, the no-current `removeItem` branch, the try/catch) and delegates only the string build to `serializePlayerState(...)`. Persisted bytes unchanged.
- `restore()`'s inline payload read + JSON.parse + `!raw`/`!current.uid` gates + inline `reshape` + seek/queue/shuffle/repeatMode assignments were replaced with `const parsed = parsePlayerState(localStorage.getItem(STATE_KEY)); if (!parsed) return;` then plain assignments. Everything from `this.loading = true;` onward (offline-blob branch, `ensureTrackDetails`, `audio.src`, `pendingSeek` application, `fillLyricsOffline`, finally block) is byte-for-byte unchanged.
- `flushPersist` / `persistThrottled` / `pendingSeek` / `pendingSeekFrac` and all 18 `this.persist()` call sites untouched.
- Net: `player.svelte.ts` shrank 23 insertions / 68 deletions (−45 lines: 3017 → 2972).

## Verification (actual results)

- `pnpm check` → **0 errors / 0 warnings** across 4297 files (svelte-check). One transient error was surfaced and fixed during Task 2 (a `'off' === 'one'` no-overlap comparison in the new test) — final run is clean.
- `pnpm vitest run src/lib/stores/player-persist.test.ts src/lib/stores/player.svelte.test.ts` → **2 files passed, 188 tests passed** (161 player safety-net + 27 new pure codec). Zero player-suite edits — the byte-shape assertions (L2199 / L2767 / L3018 on `openmusic:player:v1`.`currentTime`/`current.uid`, the seedState repeat-migration block) stay green, proving the persisted shape is byte-identical.
- No circular import: `player-persist.ts`'s only import is `import type { Track }`; the `player.svelte` string appears only in comments (verified by grep).
- `this.persist()` call-site count unchanged (18 before and after); `private serializeTrack` / `private static STATE_KEY` removed from the class (grep-confirmed).
- No file deletions in either commit; no stray untracked code files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed an invalid no-overlap comparison in the new test**
- **Found during:** Task 2 (`pnpm check`)
- **Issue:** The Task-1 test used `repeatMode: 'off' === 'one' ? 'off' : 'one'` as a cute "passed through unchanged" note; svelte-check (strict TS) rejected it — the literal types `'off'` and `'one'` have no overlap — failing the 0/0 requirement.
- **Fix:** Replaced with the literal expectation `repeatMode: 'one'` plus a clarifying comment (serializePlayerState does no migration).
- **Files modified:** `src/lib/stores/player-persist.test.ts`
- **Commit:** `b8831fb`

## Guardrail Compliance

- Persisted localStorage shape byte-identical: same key `openmusic:player:v1`, same `v:1` envelope, same 11-field serializeTrack whitelist — an existing user's saved state still restores.
- Public Player API + behavior unchanged: no `this.persist()` call site touched; `flushPersist`/`persistThrottled`/`pendingSeek`/`pendingSeekFrac` and all background-audio/failover/prefetch/attach/play/next/runFallback logic untouched — only `persist()`/`restore()` bodies changed (to delegate) plus the 2 new files.
- `player-persist.ts` is PURE, never-throw, runes-free, and does NOT import `player.svelte.ts` (no circular import).
- No new npm dependency, no new i18n key.

## Commits

- `d03db26` feat(quick-260704-3ov): add pure player-persist codec + colocated tests
- `b8831fb` refactor(quick-260704-3ov): delegate Player persist()/restore() to the pure codec

## Self-Check: PASSED

- FOUND: src/lib/stores/player-persist.ts
- FOUND: src/lib/stores/player-persist.test.ts
- FOUND: src/lib/stores/player.svelte.ts (modified)
- FOUND commit: d03db26
- FOUND commit: b8831fb
