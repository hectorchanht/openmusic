---
phase: quick-260910-piz
plan: 01
subsystem: player / covers
tags: [cover, album, queue, player-store]
requires:
  - quick-260831-t2g (single-song attachedCover)
  - Gap 3 / 26-10 (per-tile lazyCover removed — tiles read track.cover only)
provides:
  - list-scoped attachedCover { url, keys }
  - seedCover / buildAttachment pure helpers
affects:
  - src/lib/stores/player.svelte.ts
  - src/routes/(app)/album/[name]/+page.svelte
tech-stack:
  added: []
  patterns: ["runes store thinly wraps a pure, node-tested helper module (player-persist precedent)"]
key-files:
  created:
    - src/lib/stores/attached-cover.ts
    - src/lib/stores/attached-cover.test.ts
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/routes/(app)/album/[name]/+page.svelte
decisions:
  - "Album cover OVERRIDES a track's own cover (t2g contract: siblings must never disagree)"
  - "Seed + attach at the setQueue/setListQueue chokepoint, not in the album page — tiles and hero can never disagree"
  - "Attachment stays a PLAIN class field (no $state, no $effect) — player.svelte.ts is a freeze hotspot"
metrics:
  duration: ~12 min
  completed: 2026-09-10
---

# Quick 260910-piz: Album-scoped attached cover Summary

`player.attachedCover` is now a list-scoped `{ url, keys:Set }` installed at the queue-install seam, so every album track is seeded with the album art AND the hero re-apply fires on every advance instead of only for the one tapped song.

## What Changed

**Task 1 — `src/lib/stores/attached-cover.ts` (new, pure, node-tested)**
- `type AttachedCover = { url: string; keys: Set<string> }` — song-keyed via `matchKey(artist, title)` (inherited from t2g: survives a cross-source fallback that replays the same song under a new uid).
- `seedCover(tracks, cover)` — https-gated override of `track.cover`; returns the SAME array reference on null/non-https/empty (never blanks an existing cover), NEW element objects otherwise.
- `buildAttachment(tracks, cover)` — null on null/non-https; else one key per distinct song.
- 7 node tests (`attached-cover.test.ts`), written RED first.

**Task 2 — `player.svelte.ts` (surgical)**
1. Import of the three new symbols next to `player-persist`.
2. Field type → `AttachedCover | null` (still a plain class field — no `$state`), t2g doc comment kept verbatim with a `quick-260910-piz` LIFECYCLE paragraph appended.
3. `attachedCoverFor` → `a.keys.has(matchKey(...))`.
4. `setQueue(tracks, context = null, cover: string | null = null)` — dedupes `seedCover(tracks, cover)` and sets `this.attachedCover = buildAttachment(this.queue, cover)`.
5. `setListQueue(..., cover = null)` — passes `cover` through the no-current delegate, seeds before `queueWithAnchor`, attaches from the ANCHORED queue.
6. `clearQueue()` clears the attachment.
7. `playStub` no longer writes `attachedCover` directly (setQueue owns installation); it now calls `this.setQueue([tr], context, cover)`.
8. `play()` clears the attachment on a FRESH play of a non-member (the home-shelf `play({fresh})` path, quick-260831-sp9). One line, no new state.
9. The :3083 re-apply block: code unchanged, one explanatory sentence appended.

**`album/[name]/+page.svelte`** — `heroImg` passed as the 3rd arg at both `setListQueue(all, 'album', heroImg)` sites and the `setQueue([first], 'album', heroImg)` fallback. `resolveAll`/`resolveAllCached` untouched.

## Verification (observed, not assumed)

| Gate | Command | Observed |
|------|---------|----------|
| Task 1 RED | `pnpm vitest --run src/lib/stores/attached-cover.test.ts` | FAIL — `Cannot find module './attached-cover'` |
| Task 1 GREEN | same | 1 file, **7 passed** |
| Task 2 RED | `pnpm vitest --run src/lib/stores/player.svelte.test.ts -t "quick-260910-piz"` | **6 failed** (the 6 new cases) |
| Task 2 GREEN | same | **6 passed**, 248 skipped |
| Typecheck | `pnpm check` | `4409 FILES 0 ERRORS 0 WARNINGS` |
| Full suite | `pnpm test` | **103 files, 1943 tests passed** |

Done-criteria greps:
- `grep -n "attachedCover = " player.svelte.ts` → exactly 4: two `buildAttachment(this.queue, cover)` (2213, 2269), the `clearQueue` null (2351), the fresh-play null (2941). None left in `playStub`.
- `grep -c "setListQueue(all, 'album', heroImg)"` on the album page → **2**.
- `git diff --stat` on the commits touched only the 5 planned files (the unrelated dirty working-tree files were never staged).

Backward compatibility of the widened signatures was verified by enumerating every external call site (TrackMenu:279, home +page:507/630/644/697, library:181/186, search:771/810, artist:198/595) — all still 2-arg, `cover` defaults to `null` → `seedCover` pass-through + attachment cleared, which is the intended "starting anything else drops the album art" behaviour. `pnpm check` confirms they compile.

## Deviations from Plan

None — plan executed as written.

## Not Verified

Task 3 (the in-app behavioural checkpoint: Up Next tiles, hero across 3+ advances incl. an auto-advance, zero new `deezer`/`itunes` requests, album swap, search non-inheritance, null-hero regression) was **deliberately skipped per the orchestrator's instruction** — the orchestrator runs the browser verification itself. No dev server was started, no APK build, no push/deploy.

## Self-Check: PASSED

- `src/lib/stores/attached-cover.ts` — FOUND
- `src/lib/stores/attached-cover.test.ts` — FOUND
- `.planning/quick/260910-piz-seed-the-album-cover-onto-every-resolved/260910-piz-SUMMARY.md` — FOUND
- commit `fb2a713` — FOUND
- commit `2c13d14` — FOUND
