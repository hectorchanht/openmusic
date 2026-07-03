---
phase: quick-260704-2xq
plan: 01
subsystem: cover-cache
tags: [localStorage, cache, ttl, lru, cover]
requires: [match-key]
provides: [cover-cache-ttl, cover-cache-lru-cap, cover-entry-shape]
affects:
  - src/lib/services/cover-backfill.ts
  - src/lib/stores/player.svelte.ts
  - src/lib/actions/lazyCover.ts
  - src/lib/stores/library.svelte.ts
tech-stack:
  added: []
  patterns:
    - "Timestamped {u,t} entry shape with legacy bare-string tolerance"
    - "Read-side TTL expiry (pure, no delete-on-read)"
    - "Write-side oldest-write-first LRU cap"
key-files:
  created: []
  modified:
    - src/lib/services/cover-cache.ts
    - src/lib/services/cover-cache.test.ts
decisions:
  - "TTL_MS = 14 days (midpoint of the 7–30d backlog range); read-side only, no eviction on read"
  - "MAX_ENTRIES = 2000 write-time LRU cap; legacy/no-t entries sort as -Infinity (evict-first)"
  - "v1 CACHE_KEY preserved (NOT bumped) to avoid a cold-flush re-resolve storm"
  - "Oldest-write-first eviction, an intentional approximation of access-LRU, to keep reads pure"
metrics:
  duration: 8 min
  completed: 2026-07-04
requirements: [OPT-BACKLOG-2]
---

# Phase quick-260704-2xq Plan 01: Add TTL + LRU cap to cover-cache Summary

Added proactive ~14-day read-side TTL expiry and a ~2000-entry write-time-LRU cap to the pure
`cover-cache.ts` localStorage store by migrating the stored per-entry value from a bare `string`
to a timestamped `{ u: string; t: number }`, with legacy bare-string entries grandfathered
(TTL-exempt, evict-first, lazily upgraded) so no re-resolve storm occurs — every public function
signature is byte-for-byte unchanged, so all consumers are transparently unaffected.

## What Was Built

- **Task 1 (`cover-cache.ts`, commit `146d314`):**
  - New `type CoverEntry = { u: string; t: number }` (u=url, t=write-time ms); persisted record is
    now `Record<string, CoverEntry | string>` — the `string` arm exists ONLY to tolerate legacy
    `v1` values (grandfathering), never to write new bare strings.
  - `TTL_MS = 14 * 24 * 60 * 60 * 1000` (14 days) and `MAX_ENTRIES = 2000`, each with a justifying
    comment.
  - `readRecord()` stays shape-agnostic (returns `{}` on absent/corrupt/unavailable; no
    normalization here).
  - `readKey()` stays PURE via a new `readUrlFromEntry()` helper: legacy string → grandfathered
    TTL-exempt hit; `{u,t}` → null when `Date.now() - t > TTL_MS` (strict `>`, no write
    side-effect) else `u`; anything else → null.
  - `writeKey()` always writes the `{u,t}` shape (lazy-upgrade point), then enforces the cap:
    after insert, if size > `MAX_ENTRIES`, sort by ascending effective-t (`entryTime()` helper
    returns `-Infinity` for legacy/malformed) and delete from the front until at/under the cap.
  - `removeKey()` left as-is (shape-agnostic delete-by-key).
  - Header comment updated to document the new shape, read-side TTL, write-side cap,
    oldest-write-first rationale, and the deliberate `v1` preservation. FIX-A / v7k / D-13 /
    T-rvy-01 notes kept intact.

- **Task 2 (`cover-cache.test.ts`, commit `e31afa4`):**
  - Imported `vi`; added one scoped `describe` block using `vi.useFakeTimers()` /
    `vi.setSystemTime()` (real clock preserved in the existing pure suites). `TTL_MS`/`MAX_ENTRIES`
    pinned locally with a comment (private module constants are not imported).
  - New cases: fresh-write hit; TTL expiry (strictly past → MISS); exact-boundary HIT (pins strict
    `>`); expired-read-does-not-delete (raw-record inspection proves the pure-read contract);
    cap eviction (write MAX_ENTRIES+5, oldest gone / newest kept / record trimmed); legacy
    grandfather HIT far past TTL; legacy lazy upgrade to `{u,t}` on next write; legacy-evicts-first
    at the cap; three-family coexistence under the timestamped shape; write-into-corrupt-storage
    recovers; setItem-throws-mid-cap-eviction is swallowed.

## Verification (actual results)

- `pnpm vitest run src/lib/services/cover-cache.test.ts src/lib/services/cover-backfill.test.ts src/lib/stores/player.svelte.test.ts`
  → **3 test files passed, 230 tests passed** (0 failed). `cover-backfill.test.ts` and
  `player.svelte.test.ts` passed UNCHANGED (public API transparent — proof the internal shape
  change is invisible to consumers).
- `pnpm check` → **0 errors / 0 warnings** (svelte-check, 4297 files).
- Grep sanity: `TTL_MS` / `MAX_ENTRIES` / `CoverEntry` present; `openmusic:cover-cache:v2` count
  = 0 (v1 not bumped); `bumpCoverVersion|$state|$derived` count = 0 (no rune/bump leaked).

## Guardrail Compliance

- Public function signatures in `cover-cache.ts` unchanged (callers still pass/receive plain URL
  strings).
- `CACHE_KEY = 'openmusic:cover-cache:v1'` preserved (NOT bumped).
- Legacy bare-string entries grandfathered as valid non-expired hits (no re-resolve storm).
- Module stays pure + never-throw; TTL is read-side-null-only (no delete-on-read); no rune, no
  `bumpCoverVersion`, no new npm dep, no new file.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: `src/lib/services/cover-cache.ts`
- FOUND: `src/lib/services/cover-cache.test.ts`
- FOUND: `.planning/quick/260704-2xq-add-ttl-lru-cap-to-cover-cache-to-expire/260704-2xq-SUMMARY.md`
- FOUND commit: `146d314` (Task 1 — cover-cache.ts)
- FOUND commit: `e31afa4` (Task 2 — cover-cache.test.ts)
