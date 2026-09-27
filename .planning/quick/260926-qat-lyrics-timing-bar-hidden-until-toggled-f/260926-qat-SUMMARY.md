---
phase: quick-260926-qat
plan: 01
status: complete
subsystem: lyrics / now-playing
tags: [lyrics, offset, track-menu, i18n]
requires: [quick-260926-mis, quick-260926-mzn]
provides: [lyricSyncOpen, setLyricSyncOpen, toggleLyricSyncOpen, lyricSyncRequest]
affects: [NpLyrics, TrackMenu, NowPlaying]
tech-stack:
  added: []
  patterns: [module $state flag + monotonic request counter, effect-on-counter with untrack]
key-files:
  created: []
  modified:
    - src/lib/stores/lyric-offset.svelte.ts
    - src/lib/stores/lyric-offset.svelte.test.ts
    - src/lib/components/NpLyrics.svelte
    - src/lib/components/TrackMenu.svelte
    - src/lib/components/NowPlaying.svelte
    - src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - "Timing row open flag is in-memory and session-only; stays open across track changes"
  - "Menu row only for the currently playing track with lyrics (readLyrics(player.current))"
  - "Hold-to-sync gated on the row being shown; tap-to-seek unchanged"
metrics:
  duration: ~5min
  completed: 2026-09-26
---

# Quick 260926-qat: Lyrics timing row hidden until toggled Summary

The lyrics pane's -0.5s / readout / +0.5s row is now hidden by default. You open it from the track menu of the currently playing track ("Adjust lyrics timing" / "Hide lyrics timing") and close it with the ✕ in the row. Offsets still apply whether or not the row is shown.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 RED | ae604799 | test(quick-260926-qat): failing tests for the lyric timing row open flag |
| 1 GREEN | 5c2b4f58 | feat(quick-260926-qat): session-only open flag for the lyrics timing row |
| 2 | c50d66f7 | feat(quick-260926-qat): lyrics timing row hidden until toggled from the track menu |

## What changed

- `lyric-offset.svelte.ts`: `_bar = $state({ open: false, req: 0 })` plus 4 exports. Opening bumps `req`, closing does not. Nothing is written to localStorage.
- `NpLyrics.svelte`: `.sync` is wrapped in `{#if lyricSyncOpen()}` and has an `X` close button. `syncToLine` returns early while the row is hidden. `anchorActiveLine` reads `lyricSyncOpen()` before its early return, so it re-anchors when the row toggles.
- `TrackMenu.svelte`: a `Timer` row directly after Fix lyrics. It only appears when `player.current?.uid === track.uid && readLyrics(player.current)`, uses `class:on` + `aria-pressed` + a label that swaps with state, and closes the menu on tap.
- `NowPlaying.svelte`: `seenSyncReq` is a plain field set at mount. An `$effect` reads only `lyricSyncRequest()` and calls `selectTab('lyrics')` inside `untrack` (narrow layout only).
- i18n: `menu.lyricsTiming` / `menu.lyricsTimingHide` added in all 15 locales, double-quoted, after `menu.fixLyrics`.

## Verification (observed)

- Task 1 verify: `pnpm vitest run src/lib/stores/lyric-offset.svelte.test.ts` → RED first (6 failed / 17 passed, `setLyricSyncOpen is not a function`), then GREEN 23/23. Export-count gate = 4 and no-persist gate = 0 both passed.
- Task 2 verify: all 9 grep gates passed.
- `pnpm test` → 164 files, 3635 tests passed.
- `pnpm check` → 4635 files, 0 errors, 0 warnings.
- Not run here: browser E2E (the orchestrator runs it).

## Deviations from Plan

**1. [Rule 1 - Layout] ✕ placed before the hint, not as the row's last child**
- **Found during:** Task 2
- **Issue:** `.sync .hint` has `flex-basis: 100%`. With the ✕ as the last child it would wrap onto a third line by itself, which makes the sticky row taller and leaves the ✕ stranded.
- **Fix:** the ✕ goes after the `shared` label and before the hint, so it stays on the button line. The template comment records why.
- **Files modified:** src/lib/components/NpLyrics.svelte
- **Commit:** c50d66f7

**2. Test for "no other key in MemStorage"**: a `vi.spyOn(store, 'setItem')` checks that nothing was written, plus `getItem(KEY)` is null. This avoids adding an enumeration API to the test stub.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/stores/lyric-offset.svelte.ts (4 exports), src/lib/components/{NpLyrics,TrackMenu,NowPlaying}.svelte edits
- FOUND commits: ae604799, 5c2b4f58, c50d66f7

## Orchestrator browser E2E (dev server, 375x812)

Hidden by default (no `.sync` in the lyrics pane); holding a line with the bar hidden leaves `openmusic:lyric-offset:v1` unchanged. Track menu (⋮ in Now Playing) shows "Adjust lyrics timing" after Fix lyrics; tapping it from the Comments tab switches to Lyrics and shows the bar; +0.5s → `+0.5s`, readout tap → `+0.0s`; reopening the menu shows "Hide lyrics timing" and it hides the bar; re-open works; ✕ closes it; tabs stay clickable. No code changes needed.

Environment note: in the hidden Browser pane the menu's `transition:fly` outro never finishes, which leaves the app unresponsive to clicks after ANY menu close (reproduced with the untouched "Repeat" row). The probe forced `document.getAnimations().forEach(a => a.finish())` after each close to emulate a real device; recorded in memory `browser-pane-raf-frozen`.
