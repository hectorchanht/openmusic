---
phase: quick-260618-t7p
plan: 01
subsystem: player + now-playing UI + lyrics
tags: [player, nowbar, nowplaying, lyrics, ux]
requires:
  - "src/lib/stores/player.svelte.ts (current/playing/restore semantics)"
  - "src/lib/components/Nowbar.svelte / NowPlaying.svelte (now-playing surfaces)"
  - "src/lib/services/lrc.ts (splitParenLines / fromParen)"
provides:
  - "Player.displayed — deferred now-playing surface track that advances on a real `playing` event"
  - "Nowbar/NowPlaying bound to the displayed track for title/artist/cover/lyrics"
  - "data-i-anchored lyric scroll that is filter-aware under lyricsHideParenLines"
  - "active-line translation highlight in below mode"
affects:
  - "Nowbar.svelte, NowPlaying.svelte rendering of the now-playing surfaces"
tech-stack:
  added: []
  patterns:
    - "display-layer field separate from the engine `current` field (defer-until-takeover)"
    - "data-index selection to bridge a full-array index into a filtered render list"
key-files:
  created: []
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/components/Nowbar.svelte
    - src/lib/components/NowPlaying.svelte
decisions:
  - "displayed is session-derived, NOT persisted (restore re-seeds it)."
  - "Cold-start seed uses `displayed ??= track` (null-only) so the first song shows but a load-over-old never overwrites the displayed song."
  - "restore() sets displayed=current directly (reload resume is not a load-over-old swap; no `playing` fires until the user taps play)."
  - "Transport/like/related/enrich stay on `current`; only the displayed SURFACES (title/artist/cover/lyrics + artist-link) read `displayed`."
  - "Nowbar running-line loader animates while `player.loading || current.uid !== displayed.uid` so it spans the whole load window (loading clears when audio.play() settles, before real output)."
  - "Task 2 selects the active lyric line by `data-i` (full-array index) instead of positional `querySelectorAll('p')[idx]`, with a nearest-visible-at-or-before fallback for hidden-paren active lines. Visible-band centring math untouched."
  - "Task 3 highlights the below-mode `.tr` span via `class:active` + `.lyrics .tr.active` using existing tokens (var(--color-text), 700); replace mode already inherits p.active."
metrics:
  duration: ~30 min
  completed: 2026-06-18
---

# Phase quick-260618-t7p Plan 01: Defer now-playing/nowbar UI update + lyrics fixes Summary

Three independent player/lyrics behaviour fixes in the SvelteKit app: (1) a new `Player.displayed` field defers the now-playing/nowbar title/artist/cover/lyrics swap until the newly-clicked song actually fires a real `playing` event (with the now-bar running-line loader animating across the whole load window); (2) the lyric active-line scroll anchor now selects by a stable `data-i` full-array index so it centres correctly when "Hide parenthesised lines" is ON; (3) the active line's `below`-mode translation now highlights in lockstep with the original line.

## What was built

### Task 1 — Defer now-playing/nowbar UI swap (`feat(quick-260618-t7p-01)`, commit `7e6ae4c`)
- **Store (`player.svelte.ts`):** added `displayed = $state<Track | null>(null)`. It advances to `current` ONLY in the `playing` listener (`this.displayed = this.current`, the single swap-commit point). `play()` entry seeds it cold-start-only via `this.displayed ??= track` (never overwrites an existing displayed track). `restore()` sets `this.displayed = this.current` directly. `current` timing, `resolvedCover`, playGen, stall watchdog, loop-guard, prefetch, MediaSession, queue/auto-advance — all unchanged.
- **Nowbar.svelte:** `np = player.displayed ?? player.current ?? player.pendingTrack`; `npKey` keys off the displayed uid so the crossfade fires on the real takeover; a displayed-aware `displayedCover` keeps art on the old song until takeover; the `.np-prog indet` loader runs while `player.loading || swapPending` (where `swapPending` = current uid differs from displayed uid) so the running line animates for the whole click→`playing` window.
- **NowPlaying.svelte:** introduced `shown = player.displayed ?? player.current`. Lyrics `lines`, the translation effect's track, the title/artist `{#key}` + text, the cover-cell `effectiveCover`/fallback, and `openArtist` all read `shown`. Transport, like, related, and enrich effects stay on `player.current`.
- **Tests (A–D + C2):** commit point on `playing`; keep-old when no `playing` fires (real `play(B)`); cold-start synchronous seed; cold-start seed does NOT overwrite an existing displayed track; `restore()` sets displayed. 132/132 pass.

### Task 2 — Lyric over-scroll under "Hide parenthesised lines" (`fix(quick-260618-t7p-02)`, commit `9997f10`)
- Each rendered lyric `<p>` carries `data-i={i}` (its FULL-`lines` index — the same index space as `activeLine`).
- The anchor `$effect` selects the active line via `lyricsEl.querySelector('p[data-i="${idx}"]')`. **Fallback:** when the active line is a hidden paren line (no rendered `<p>` for that idx), it anchors on the nearest rendered line with the largest `data-i` ≤ idx (the previous visible line).
- The visible-band centring math (visTop/visBottom/visHeight, TOP_PAD top-pin, half/full centre, `spacerH`) is byte-unchanged — only the element-selection line changed from positional `[idx]` to the data-index lookup.

### Task 3 — Highlight active line's translation in below mode (`fix(quick-260618-t7p-03)`, commit `f956653`)
- Added `class:active={l.time === activeTime && activeTime >= 0}` to the `below`-mode `<span class="tr">` (mirrors the parent `<p>`'s condition).
- Added `.lyrics .tr.active { color: var(--color-text); font-weight: 700; }` (same tokens as `.lyrics p.active`).
- `replace` mode already inherits `p.active` (the translated text IS the `<p>` body) and is unchanged. Split paren clauses are their own `<p>` lines already highlighted via `p.active`.

## Deviations from Plan

None of substance — the plan was executed as written, with the documented internal binding choices it asked the executor to make:
- **Translation effect re-pointed to `shown`** (Task 1): the plan specified `lines` reads the displayed track; the translation effect's track + trKey were re-pointed to `shown` to match the `lines` source so the translation stays with the displayed lyrics (otherwise the trKey uid would mismatch the rendered lines). Tracked as a documented binding decision, not a behaviour change.
- **`openArtist` re-pointed to `shown`** (Task 1): the artist link follows the visible (displayed) title/artist for consistency; this is display-layer, not transport.
- **Test type-narrowing accessor**: `player.displayed = null` narrows the field to the `null` literal in TS flow analysis, tripping `Property 'uid' does not exist on type 'never'` on reads after an opaque `play()`/`restore()`. Reads in the new suite go through a small `displayed()` accessor typed to the true union. (Rule 3 — auto-fix blocking type issue caused by the new test.)

## Verification

- `npx vitest run src/lib/stores/player.svelte.test.ts` → 132/132 pass (includes the 5 new Task-1 tests A–D + C2).
- `npx vitest run` (full suite) → 909/909 pass across 65 files (no regressions).
- `npx svelte-check --threshold error` → 4289 files, 0 errors, 0 warnings (no new errors in any edited file).
- Manual human-check scenarios (dev server, strictPort 4321) per the plan's `<human-check>` blocks are deferred to device/browser testing.

## Self-Check: PASSED

- Commits found: `7e6ae4c` (Task 1), `9997f10` (Task 2), `f956653` (Task 3).
- Files present: `src/lib/stores/player.svelte.ts`, `src/lib/stores/player.svelte.test.ts`, `src/lib/components/Nowbar.svelte`, `src/lib/components/NowPlaying.svelte`.
- No file deletions in any task commit.
