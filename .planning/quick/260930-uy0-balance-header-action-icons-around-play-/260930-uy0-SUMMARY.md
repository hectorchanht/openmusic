---
phase: quick-260930-uy0
plan: 01
subsystem: album-page
tags: [ui, album, shuffle, layout]
requires: [services/shuffle.ts, player.playStub sameList, player.setListQueue]
provides: [album Shuffle-play button, startAlbum(list, action)]
affects: [src/routes/(app)/album/[name]/+page.svelte]
tech-stack:
  added: []
  patterns: [shuffled COPY via shuffle() (quick-260915-vb9 precedent), never player.toggleShuffle()]
key-files:
  created: []
  modified: [src/routes/(app)/album/[name]/+page.svelte]
decisions:
  - "Album Shuffle-play = startAlbum(shuffle(tracks), 'shuffle') through the SAME playStub(sameList) + setListQueue('album', heroImg) path as Play; no second shuffle mechanism"
  - "Album action-row gap is clamp(12px, 3.2vw, 16px) so 7 buttons fit one row at 375px; unchanged from ~500px up"
metrics:
  duration: ~10min
  completed: 2026-09-30
  tasks: 2
  files: 1
---

# Quick 260930-uy0: Balance album header action icons around Play — Summary

The album header row now reads [Download, Heart, ListPlus] PLAY [Shuffle, ListEnd, Share2]. The new Shuffle button starts the album from a shuffled copy of the tracklist, using the same install path as Play.

## Changes (commit ce2e377c)

- `Shuffle` icon + `import { shuffle } from '$lib/services/shuffle'`.
- `AlbumAction` gains `'shuffle'`, so only the button that is running greys out (the ii6 per-button disable).
- `albumQueue(at, real, list = tracks)`: one new defaulted param. Existing callers are unchanged.
- `playAlbum()`'s body moved into `startAlbum(list, action)`, keeping all its decision-record comments. `playAlbum` passes `tracks` and `shuffleAlbum` passes `shuffle(tracks)`. Both use `playStub(list[0], …, 'album', { sameList: true })`, then `setListQueue(albumQueue(0, first, list), 'album', heroImg)`.
- Shuffle button sits right after `.act.play`, with `aria-label={t('nowplaying.shuffle')}` (an existing key; no i18n edits). Fixed the ListEnd comment/button over-indentation.
- `.album-actions` gap `16px` → `clamp(12px, 3.2vw, 16px)`.
- Artist page, library pill row and i18n files are untouched. The commit diff covers only the album page.

## Verification (observed)

- `pnpm check`: 0 errors, 12 warnings. All are pre-existing unused-CSS-selector warnings; the album ones are `.note`, `.info` and `.info .sk-info`, none touched here.
- `pnpm test`: 171 files / 3858 tests passed.
- CDP on dev server 5173, `Emulation.setDeviceMetricsOverride` mobile:
  - 375px: viewport 375, document scrollWidth 375 (no overflow), gap 12px. Buttons span x=22 to 354, all at the same top except the larger Play circle, which sits centred at 160 to 216.
  - 390px: gap 12.48px, buttons span x=28 to 362, single row.
  - Order by aria-label: Download, Like, Add to playlist, Play/pause, Shuffle, Add to queue, Share.
- Shuffle behaviour (live player store imported via its exact `?t=` module URL):
  - Album order: 愛在西元前, 爸 我回來了, 簡單愛, 忍者, 開不了口, 上海一九四三, 對不起, 威廉古堡, 雙截棍, 安靜
  - Run 1 queue: 爱在西元前, 雙截棍, 開不了口, 安靜, 對不起, 爸 我回來了, 忍者, 威廉古堡, 簡單愛, 上海一九四三. queueContext `album`, current = queue[0], index 0. Slot 0 matches album track 1 (a 1-in-10 event), but the rest is reordered.
  - Run 2 queue: 威廉古堡, 雙截棍, 爸 我回來了, 愛在西元前, 忍者, 安靜, 開不了口, 上海一九四三, 對不起, 簡單愛. queueContext `album`, current 威廉古堡 = queue[0].
  - Both runs: all 10 album titles present (a permutation; slot 0 is the resolved real track, so its title can come back in simplified script), and not in album order.
- Screenshots: `/private/tmp/claude-501/-Users-laichan-code-tung-openmusic/b3813084-0071-47c0-b3df-530ff9268cf2/scratchpad/uy0-album-375.png` (and `uy0-album-390.png`).

## Deviations from Plan

- **[Rule 3 - Blocking] Screenshot method.** A plain `--headless=new --window-size=375,812 --screenshot` render came out ~500px wide, cropped to 375, which made the whole page look clipped. That is headless Chrome's minimum window width, not a layout bug. A command-line render with `--virtual-time-budget` also hung. Took both screenshots through CDP device-metrics emulation instead, in the same script as the behaviour check.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/routes/(app)/album/[name]/+page.svelte (shuffleAlbum, services/shuffle, nowplaying.shuffle)
- FOUND: commit ce2e377c
- FOUND: scratchpad/uy0-album-375.png
