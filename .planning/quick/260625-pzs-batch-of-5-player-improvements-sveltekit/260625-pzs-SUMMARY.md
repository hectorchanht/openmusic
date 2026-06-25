---
phase: quick-260625-pzs
plan: 01
subsystem: player / now-playing UX
tags: [svelte5, lyrics, translation, swipe, download, playback-resilience, artist-links]
requires:
  - swipeAction (src/lib/actions/swipeAction.ts)
  - translateLinesEx (src/lib/services/translate.ts)
  - reresolveCurrent + hasPlayedSinceSrc (src/lib/stores/player.svelte.ts)
provides:
  - splitArtists pure util (src/lib/util/artist-split.ts)
  - per-artist now-playing links
  - swipe-to-queue on the Related list
  - module-scoped complete-translation cache (no refetch on tab refocus)
  - download isolated from active playback/lyrics
  - no auto-skip of an already-playing track on a transient error
affects:
  - src/lib/components/NowPlaying.svelte
  - src/lib/components/TrackMenu.svelte
  - src/lib/stores/player.svelte.ts
tech-stack:
  added: []
  patterns:
    - "pure node-vitest helper (mirrors match-key.ts) for connector splitting"
    - "module-scoped Map cache surviving component remount (Svelte 5 <script module>)"
    - "reuse the existing internal hasPlayedSinceSrc flag (no new playing-event dependency)"
key-files:
  created:
    - src/lib/util/artist-split.ts
    - src/lib/util/artist-split.test.ts
  modified:
    - src/lib/components/NowPlaying.svelte
    - src/lib/components/TrackMenu.svelte
    - src/lib/stores/player.svelte.ts
decisions:
  - "Task 4 acceptable-quality gate is conservative: reuse the playing track's resolved URL for auto/320/128 download tiers (any 320k/lossless stream meets them); for a 'lossless' download tier reuse ONLY when the current stream is already lossless, otherwise re-resolve."
  - "Task 3 trCache lives in a new <script module> block so it is module-scoped (survives a component remount) rather than per-instance."
metrics:
  duration: ~8 min
  completed: 2026-06-25
---

# Quick 260625-pzs: Batch of 5 Player Improvements (SvelteKit) Summary

Five loosely-coupled, independently-committed MusicSquare-Mobile player improvements in the live SvelteKit tree under `src/`: per-artist now-playing links, swipe-to-queue on Related, a complete-translation cache that stops `/api/translate` refetches on tab refocus, download isolation from active playback/lyrics, and an error-handler guard that no longer auto-skips a track that has already started playing.

## What was built

- **Task 1 — Per-artist links (`feat 45932f5`):** New pure `splitArtists(raw)` util splitting on `, & 、 / feat. ft. x × &amp;` (HTML-entity normalised, trimmed, deduped, order-preserving; embedded `x` like "Maxwell" preserved). 13-case node-vitest suite. NowPlaying renders one tappable link per artist (each navigates to that sole artist via `encodeURIComponent(name)`), joined by an inert ` · ` separator; single-artist songs render exactly one link with no separator. The old `.artist` `<button>` became a `<div>` container keeping `use:marquee` + the in/out fade crossfade; underline/pointer styling moved to a new `.artist-link`.
- **Task 2 — Swipe-to-queue on Related (`feat 3f3b607`):** Applied the existing shared `swipeAction` to Related rows (swipe-right = add to queue, swipe-left = play next), mirroring search/library. Added reveal layers + two handlers (`relatedSwipeQueue`/`relatedSwipeNext`) and `.related-swipe`-scoped CSS (opaque row bg + z-index + reveal colors). The Up-Next list (which uses `swipeRemove`) is untouched. Tap-to-play and long-press menu preserved.
- **Task 3 — Cache complete translations (`fix d8b7f66`):** Added a module-scoped `trCache` (in a new `<script module>` block) keyed by the same `key` string the translate `$effect` already computes. On a tab blur→focus / remount (which resets the per-instance `trKey`) the effect re-runs and now hydrates the cached complete translation synchronously — no untranslated flash, no new `/api/translate`. Switched the call to `translateLinesEx` and cache the stitched output **only** when `complete === true && stitched.length === lines.length`; the all-whitelisted (trivially complete) path also populates the cache. Soft-fail echoes (`complete:false`) are rendered but never frozen.
- **Task 4 — Download isolation (`fix d347e4e`):** When the song being downloaded is the currently-playing track and its audio is already resolved at an acceptable quality, `doDownload` reuses that resolved URL (on a copy) instead of forcing a second concurrent download-quality resolve — removing the duplicate CDN pressure that caused a stale-URL audio error → lyrics wipe on the active track. Non-current songs keep the existing re-resolve. Added an explicit isolation-contract comment: never touch `player.current` / `lrc` / `playGen` / the shared `<audio>` element.
- **Task 5 — No premature skip (`fix 07bee6b`):** In the audio `error` listener, after the seek-window branch and before the cross-source `runFallback` path, added `if (this.hasPlayedSinceSrc) { void this.reresolveCurrent(); return; }`. A track that has already produced audio recovers in place (re-resolves the same song, preserves the seek) instead of cross-source-failing-over / restarting — fixing the "plays ~3s then auto-advances" bug. Reads the same internal flag the stall watchdog (`armStall`) already reads; no new `playing`-event dependency. Pre-playback failures still fail over (never-stop loop-guard intact).

## Deviations from Plan

None — plan executed exactly as written. No deviation rules triggered; no auth gates; no architectural changes.

The one judgment call left open by the plan was Task 4's definition of "acceptable quality" for reusing the current track's URL. Resolved conservatively (see Decisions): `auto`/`320`/`128` download tiers accept any resolved stream; a `lossless` download tier reuses only when the current stream is already lossless, otherwise it re-resolves at download quality. This honors the plan's intent (avoid a duplicate concurrent resolve of the *same* song) without ever downgrading a deliberate lossless download.

## Verification

Per-task `<verify>` ran green BEFORE each commit:

| Task | Verify | Result |
|------|--------|--------|
| 1 | `npm test -- artist-split` + `npm run check` | 13 tests pass; check 0/0 |
| 2 | `npm run check` | check 0/0 |
| 3 | `npm test -- translate` + `npm run check` | 12 tests pass; check 0/0 |
| 4 | `npm run check` | check 0/0 |
| 5 | `npm test -- player` + `npm run check` | 127 tests pass; check 0/0 |

Full suite after all 5 commits: **66 files / 921 tests passing**; `npm run check` clean (0 errors, 0 warnings).

Manual browser verification (per each task's `<done>`) is deferred to a device/browser pass on http://localhost:4321 — the dev server was not started in this headless execution.

## Prior-learning compliance

- **Task 3 (translate soft-fail):** `trCache` stores ONLY a render that is `complete === true` AND length-matched — never a soft-fail echo. Combined with the service-level complete-gating, an incomplete result is never frozen; switching language and back re-attempts.
- **Task 5 (no playing-event UI gating):** The change reads the EXISTING internal `hasPlayedSinceSrc` field exactly as the stall watchdog already does. No new `playing`-event dependency was added to any UI/render path — the reverted player-displayed-defer regression is respected.

## Known Stubs

None.

## Self-Check: PASSED

- Files: all 5 (created `artist-split.ts`, `artist-split.test.ts`; modified `NowPlaying.svelte`, `TrackMenu.svelte`, `player.svelte.ts`) — FOUND.
- Commits: 45932f5, 3f3b607, d8b7f66, d347e4e, 07bee6b — all present in `git log`.
