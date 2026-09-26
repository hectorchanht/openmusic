---
phase: quick-260926-mis
plan: 01
status: complete
subsystem: lyrics
tags: [lyrics, lrc, offset, longpress, i18n, localStorage]
requires: [quick-260926-m72]
provides:
  - per-uid lyric time offset (openmusic:lyric-offset:v1)
  - hold-to-sync lyric gesture + offset control row
affects: [NpLyrics.svelte, Nowbar.svelte, lrc.ts]
tech-stack:
  added: []
  patterns: [runes version-counter store with synchronous bump, single tested sign convention in lrc.ts]
key-files:
  created:
    - src/lib/stores/lyric-offset.svelte.ts
    - src/lib/stores/lyric-offset.svelte.test.ts
  modified:
    - src/lib/services/lrc.ts
    - src/lib/services/lrc.test.ts
    - src/lib/components/NpLyrics.svelte
    - src/lib/components/Nowbar.svelte
    - src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - "Lyric offset sign: positive = lyrics shifted LATER; lyric clock = now - offset, line sung at line.time + offset (defined once in lrc.ts, applied only inside activeLineAt / lineSeekFraction)"
  - "Offset keyed by track uid, not by name: a live and a studio version realign independently"
  - "Lyric-offset version bump is synchronous (no rAF): writes only happen on user gestures and the highlight must repaint on the same tick"
  - "The sticky .sync row shrinks the anchor's visible band, so a low settings.lyricsAnchor never parks the active line under it"
metrics:
  duration: ~6 min
  completed: 2026-09-26
  tasks: 3
  files: 21
---

# Quick 260926-mis: Per-song lyrics time realign offset Summary

Hold a lyric line to make it the active line right now. This stores a per-uid offset (`currentTime - line.time`) in `openmusic:lyric-offset:v1`. A sticky row lets you nudge it by ±0.5s and tap the readout to reset it. The offset reaches the pane highlight, the Nowbar line and tap-to-seek through a single sign convention in `lrc.ts`, which has tests.

## Tasks

| # | Task | Commit(s) |
|---|------|-----------|
| 1 | Offset maths in lrc.ts + reactive per-uid store (TDD) | e87b0a93 (RED test), 05db9eb3 (GREEN feat) |
| 2 | Four `lyrics.offset*` keys in all 15 locales | 344a8d64 |
| 3 | NpLyrics hold-to-sync, control row, offset-aware seek; Nowbar line | 63a7fc16 |

## What was built

- `lrc.ts`: `LYRIC_OFFSET_MAX = 600`, `normalizeLyricOffset` (non-finite → 0, clamp ±600, round 0.1, -0 → 0), `formatLyricOffset` (`+0.0s` / `−2.3s`, U+2212). `activeLineAt(lines, now, offsetSec = 0)` scans `now - offsetSec` and still returns the line's own time. `lineSeekFraction(time, duration, offsetSec = 0)` returns `max(0, time + offsetSec) / duration`, and the duration guard still runs first.
- `lyric-offset.svelte.ts`: `getLyricOffset(uid)` is a reactive read that normalizes on read (T-mis-01). `setLyricOffset(uid, sec)` normalizes, deletes the entry at 0, catches storage errors, and bumps the version synchronously on every call. An empty uid is a no-op.
- `NpLyrics.svelte`: `lyricOffset` $derived feeds `activeLineAt(lines, player.currentTime, lyricOffset)` and `lineSeekFraction(..., lyricOffset)`. Holding a lyric `<p>` (`use:longpress`) calls `syncToLine`, which sets the offset and fires a haptic `tick()`. The longpress action's trailing-click guard stops the hold from also seeking. The sticky `.sync` row (−0.5s / readout-reset / +0.5s / hint) sits outside `.lyrics`, so tapping it never pauses auto-scroll. It only renders when lyrics exist.
- `Nowbar.svelte`: `activeLineAt(lyricLines, player.currentTime, lyricOffset)` uses the same store.
- i18n: `lyrics.offsetHint`, `lyrics.offsetEarlier`, `lyrics.offsetLater`, `lyrics.offsetReset` (keeps the `{value}` token) in all 15 locales, double-quoted, placed after `nowplaying.noLyrics`.

## Verification (observed)

- Task 1 RED: new tests failed (7 failed / 50 passed, `normalizeLyricOffset is not a function`, store module missing). GREEN: `lrc.test.ts` + `lyric-offset.svelte.test.ts` 65/65 passed.
- Task 2: `i18n.test.ts` 33/33 passed; per-file grep shows exactly 4 `"lyrics.offset` keys in all 15 locales.
- Final `pnpm test`: **155 files, 3466 tests passed**.
- Final `pnpm check`: **0 errors, 1 warning**. The warning is an existing unused selector `.subnav.heads span` in NowPlaying.svelte, not touched by this plan.
- Plan greps: `activeLineAt(lines, player.currentTime, lyricOffset)` = 1, `activeLineAt(lyricLines, player.currentTime, lyricOffset)` = 1, `use:longpress` in NpLyrics = 1.
- Dev servers (4321 and 5173) both serve the transformed NpLyrics.svelte, Nowbar.svelte and lyric-offset.svelte.ts with HTTP 200.
- **NOT verified:** the Task 3 browser smoke. This executor has no browser tool, so these were not checked interactively: hold realigns the highlight, the hold does not seek, the ±0.5s and reset buttons work, the Nowbar matches the pane, the offset persists across reload per song, and the sticky row looks right over the cover. The orchestrator should run it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Sticky offset row would cover the active line at a low lyrics anchor**
- **Found during:** Task 3
- **Issue:** The plan made `.sync` `position: sticky; top: 0` inside the `.panel` scroller. It reasoned only about the row's normal-flow shift. But a sticky first child permanently covers the scroller's top ~40px. With `settings.lyricsAnchor` near 0 (added in m72: line top on the band top), `anchorActiveLine` would park the active line under the opaque row.
- **Fix:** In `anchorActiveLine`, the visible band now starts below the row: `visTop = Math.max(cRect.top + syncH, 0)`, with `syncH` read from `container.querySelector('.sync')?.offsetHeight`. This is a plain DOM read, so the pass still writes no $state and adds no reactive dependency (T-mis-03 holds). Side effect: at the default 50% the centre now sits in the uncovered band, about half a row lower. Head padding grows by the row height, but the head and tail lines can still reach the anchor.
- **Files modified:** src/lib/components/NpLyrics.svelte
- **Commit:** 63a7fc16

## Assumption Drift (advisory)

- **Found during:** Task 3. **Planned:** "Leave `anchorActiveLine` and its `$effect` untouched." **Actual:** two lines were added inside `anchorActiveLine` (the band offset above). The `$effect` itself is unchanged and nothing writes $state. **Why:** the "untouched" rule exists to prevent a self-invalidating effect, and a DOM read cannot cause one. Leaving the band alone would ship a hidden active line.

## Known Stubs

None.

## Threat Flags

None. No new surface beyond the plan's threat model. T-mis-01 (normalize on read and write), T-mis-02 (seek floored at 0) and T-mis-03 (no $state writes in the anchor pass) are implemented, and T-mis-01/02 have tests.

## Self-Check: PASSED

- FOUND: src/lib/stores/lyric-offset.svelte.ts
- FOUND: src/lib/stores/lyric-offset.svelte.test.ts
- FOUND commits: e87b0a93, 05db9eb3, 344a8d64, 63a7fc16
