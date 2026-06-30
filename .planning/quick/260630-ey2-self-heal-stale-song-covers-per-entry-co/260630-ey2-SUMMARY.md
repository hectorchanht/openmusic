---
phase: quick-260630-ey2
plan: 01
subsystem: cover-cache
tags: [cover, cache, self-heal, lazyCover, eviction]
requires:
  - src/lib/services/cover-cache.ts (readRecord/writeKey shape)
  - src/lib/stores/cover-version.svelte.ts (writeCoverBoth pattern)
  - src/lib/actions/lazyCover.ts (probeImage, resolveCoverForRow)
  - src/lib/services/cover-backfill.ts (resolveCoverForTrack chain)
provides:
  - "cover-cache.ts: pure per-entry removers removeCachedCoverByUid / removeCachedCover / removeCachedArtistCover"
  - "cover-version.svelte.ts: reactive removeCoverBoth(uid, artist, title) — evict both layers + bump"
  - "lazyCover.ts: self-heal — probe the cache-HIT url; dead → evict + re-resolve a fresh cover"
affects:
  - any list/discovery surface using use:lazyCover (search rows, charts, tags, countries)
tech-stack:
  added: []
  patterns:
    - "Pure remover delegates to a private removeKey() (skip-write on absent key = true no-op)"
    - "Reactive evictor mirrors writeCoverBoth: pure layer evicts + bumpCoverVersion in the .svelte.ts wrapper"
    - "Cache-HIT probe via the EXISTING probeImage(): load = fast path, error = evict + fall through"
key-files:
  created: []
  modified:
    - src/lib/services/cover-cache.ts
    - src/lib/services/cover-cache.test.ts
    - src/lib/stores/cover-version.svelte.ts
    - src/lib/actions/lazyCover.ts
    - src/lib/actions/lazyCover.test.ts
decisions:
  - "cover-cache.ts stays node-pure: removers take NO rune/bump import (LOCKED decision #2); the bump lives only in cover-version.svelte.ts removeCoverBoth."
  - "Empty-uid eviction touches the name layer ONLY — removeCoverBoth guards the uid layer behind `if (uid)`, mirroring writeCoverBoth's charts-tags-same-cover guard."
  - "removeKey skips the write when the key is absent so a remove-missing is a genuine no-op (no needless localStorage churn)."
metrics:
  duration: ~6m
  completed: 2026-06-30
  tasks: 3
  files: 5
---

# Phase quick-260630-ey2 Plan 01: Self-heal stale song covers (per-entry cover-cache eviction) Summary

Dead-CDN song covers now SELF-HEAL on next scroll-into-view instead of being painted from localStorage forever: lazyCover probes the cache-HIT url via the existing `probeImage()` — a good load keeps the zero-network fast path, a dead url evicts BOTH cache layers (`removeCoverBoth` → pure removers + bump) and falls through to the existing `resolveCoverForTrack` chain to re-resolve and re-cache a fresh cover.

## What was built

- **cover-cache.ts (pure, node-runnable):** a private `removeKey(key)` helper (read record → `delete` one key → write back; skip-write when the key is absent; swallow corrupt/quota/unavailable; never throws), plus three exported removers: `removeCachedCoverByUid(uid)`, `removeCachedCover(artist, title)`, `removeCachedArtistCover(artist)`. Each deletes EXACTLY its one record entry (never `removeItem(CACHE_KEY)` — that stays `clearCoverCache`'s job) and keys via the same `uidCoverCacheKey` / `coverCacheKey` / `artistCoverCacheKey` as the matching setters (Pitfall-7 colon uid verbatim; matchKey folding parity). NO rune/bump import — the file stays `.ts`-pure.
- **cover-version.svelte.ts (reactive wrapper):** `removeCoverBoth(uid, artist, title)` directly below `writeCoverBoth`, mirroring it — evicts the uid layer ONLY for a truthy uid (the empty-stub guard the read/write paths already honor), always evicts the per-song name layer, then `bumpCoverVersion()` so the affected tile repaints once the fresh cover lands.
- **lazyCover.ts (self-heal):** the cache-HIT branch in `resolveCoverForRow` now PROBES the cached url with the existing `probeImage()`. Load OK → `onResolved(uid, cached); return;` (fast path, zero network). Error → `removeCoverBoth(track.uid, track.artist, track.title)` then FALL THROUGH (no early return) to step 2/3 so the chain re-resolves. Steps 2/3, the in-flight Set, and the empty-uid read guards are unchanged. Doc comment updated.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Pure per-entry removers + unit tests (TDD) | `f92e159` | src/lib/services/cover-cache.ts, src/lib/services/cover-cache.test.ts |
| 2 | removeCoverBoth + lazyCover self-heal | `b900ea1` | src/lib/stores/cover-version.svelte.ts, src/lib/actions/lazyCover.ts |
| 3 | lazyCover self-heal test cases (TDD) | `0f62ade` | src/lib/actions/lazyCover.test.ts |

## Verification

- Targeted: `npx vitest --run src/lib/actions/lazyCover.test.ts src/lib/services/cover-cache.test.ts` → **2 files passed, 46 tests passed**.
- Full suite: `npx vitest --run` → **66 files passed, 960 tests passed**.
- `pnpm check` → **0 errors, 0 warnings** (4291 files).
- Purity guard: `cover-cache.ts` only imports `matchKey` from `./match-key`; the 4 grep hits for `.svelte`/`bumpCoverVersion` are JSDoc comments, not imports.

## Deviations from Plan

None — plan executed exactly as written. clearCoverCache, the Settings "Clear cover cache" button, and `settings.clearCoverCacheHint` (efr) are untouched.

## Self-Check: PASSED

- Commits FOUND: f92e159, b900ea1, 0f62ade
- Files FOUND: cover-cache.ts, cover-cache.test.ts, cover-version.svelte.ts, lazyCover.ts, lazyCover.test.ts
- cover-cache.ts purity: only `import { matchKey } from './match-key'` (node-pure, no rune/bump)
- No untracked code files (only .planning/ artifacts remain unstaged, as expected)
