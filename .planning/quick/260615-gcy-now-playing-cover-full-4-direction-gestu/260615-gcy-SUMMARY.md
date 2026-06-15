---
phase: quick-260615-gcy
plan: 01
subsystem: now-playing-gestures
tags: [gesture, svelte, pointer-events, axis-lock, snap-machine]
requires:
  - "NowPlaying.svelte grip snap machine (sheetState/gripMove/gripUp/offsetFor/measureOffsets/gripVel)"
  - "coverSwipe.ts horizontal carousel action"
provides:
  - "Cover vertical-up/down delegated into the existing grip snap machine"
  - "Layered down precedence (open sheet steps toward closed; only a closed sheet collapses the page)"
affects:
  - "src/lib/components/NowPlaying.svelte (.np-top pointer handlers)"
tech-stack:
  added: []
  patterns:
    - "Cover vertical gesture reuses the grip snap machine 1:1 (no parallel snap impl)"
    - "One-shot axis-lock commit at slop; owner (snap vs page-collapse) chosen by sheetState + initial direction"
key-files:
  created: []
  modified:
    - "src/lib/components/NowPlaying.svelte"
decisions:
  - "Owner selection at commit: sheet OPEN -> snap machine for up AND down; sheet CLOSED -> up to snap machine, down to page-collapse (today's >120px path)"
  - "Closed-state up-vs-down decided by the SIGN of the initial committing dy, not by gripMoved at release, so the gesture commits to one owner and never flips mid-drag"
  - "startGripFromCover() replicates gripDown's start sequence minus stopPropagation/re-capture/subnav-tab read (cover is not a subnav button); gripMoved seeded with the slop already travelled so there is no jump on commit"
metrics:
  duration: ~12 min
  completed: 2026-06-15
---

# Quick Task 260615-gcy: Now-playing cover full 4-direction gestures — Summary

Wired the now-playing cover's vertical-up/down drag into the EXISTING grip snap machine
(mirror grip 1:1) with layered down precedence — an open sheet steps toward closed first, and
only a closed sheet collapses the page past the existing ~120px threshold. No parallel snap
system was introduced and `coverSwipe.ts` (the horizontal carousel) was left byte-untouched.

## What changed

`src/lib/components/NowPlaying.svelte` — the `.np-top` pointer handler set (`npTopDown` /
`npTopMove` / `npTopUp`, plus a new `startGripFromCover` helper):

- **Slop threshold flipped to absolute dy.** Was `dy > DRAG_SLOP` (downward-only — the reason
  up did nothing). Now `Math.abs(dy) > DRAG_SLOP && Math.abs(dy) > Math.abs(dx)`, so an upward
  drag also commits the vertical axis. The horizontal-dominant fall-through (no capture →
  coverSwipe owns X) is preserved verbatim.
- **Removed the downward-only `dragY = Math.max(0, dy)` clamp from the snap path.** `dragY`
  survives ONLY for the closed-state page-collapse branch (`.np` translateY).
- **One-shot owner commit at the slop threshold** (`npTopDeleg: 'none' | 'snap' | 'collapse'`),
  decided by `sheetState` captured at commit + the initial direction:
  - Sheet OPEN (`half`/`full`) → `snap` for the WHOLE gesture (up OR down).
  - Sheet `closed` + initial `dy < 0` (up) → `snap` (closed→half→full).
  - Sheet `closed` + initial `dy >= 0` (down) → `collapse` (today's `dragY > 120 →
    player.collapse()`).
  The latch (`if (npTopDeleg === 'none')` one-shot) keeps the gesture from flipping axis/owner
  mid-drag, exactly like the old `if (!dragging)` latch.
- **`startGripFromCover(e)`** replicates `gripDown`'s start sequence — `gripActive = true`,
  `gripVel.reset()` + sample, `measureOffsets()`, `sheetDragging = true`,
  `sheetDragY = offsetFor(sheetState)`, clear `snapTimer` — but does NOT `stopPropagation` /
  re-`setPointerCapture` (npTopMove already captured on `.np-top`) and does NOT read a subnav tab
  (the cover is not a subnav button). `gripMoved` is seeded with the slop already travelled so
  the cover does not jump on commit. Each subsequent move feeds the machine exactly as
  `gripMove` does: `gripVel.sample`, `gripMoved = clientY - gripStartY` (allowed NEGATIVE — the
  fix), `sheetDragY = Math.max(0, Math.min(closedOffset, offsetFor(sheetState) + gripMoved))`.
  Because `.np-top` already renders `translateY(${gripMoved}px)` when `sheetDragging`, the cover
  region follows the finger 1:1 with zero new transform code.
- **`npTopUp`** dispatches by `npTopDeleg`: `snap` → `gripUp()` (FLICK steps one state via
  `gripVel`/`FLICK_V`; else nearest-snap with the same directional bias; `snapTimer` commits
  `sheetState`, clears `sheetDragging`/`sheetDragY`, `applyHalfInset()` on half).
  `collapse` → `dragY > 120 ? player.collapse() : snap-back`, then resets. `none` → tap path
  (cover `onclick` = `tapCoverCollapse` fires).

### Invariants preserved (Pitfall 7)

- `npTopDown` records start only — NO `setPointerCapture`, NO `preventDefault`, NO
  `dragging`/`gripActive` on pointerdown.
- Capture happens ONLY after slop + vertical dominance, so a sub-slop tap reaches the cover
  `onclick`, and a horizontal-dominant drag still falls through to `coverSwipe` (prev/next).
- Every `npTopUp` exit leaves machine state consistent: `snap` defers cleanup to `gripUp`
  (which always clears via the tap branch or `snapTimer`), `collapse` resets `dragging`/`dragY`,
  `none` touches nothing. No dangling `gripActive`/`sheetDragging` on any branch.
- Reduced-motion: no JS motion added. The snap machine inherits the existing CSS gating
  (`settings.reduceMotion` → `data-reduce-motion` → `transition: none`). The 290ms `snapTimer`
  is a state-commit timer (not visual easing) and keeps running under reduced-motion so
  `sheetState` still commits.
- `coverSwipe.ts` and `coverSwipe.test.ts` UNTOUCHED.

## Verification

- `npm run check` (svelte-check): **0 errors, 0 warnings** (4279 files).
- `npx vitest --run src/lib/actions/coverSwipe`: **23/23 passing** — horizontal gesture
  untouched and green.
- `git status` confirms only `src/lib/components/NowPlaying.svelte` was modified in source.

## Gesture-Coverage Audit

For each now-playing surface, the direction is WIRED (and to what), INTENTIONALLY-UNMAPPED
(and why), or LEFT-UNDONE (and why / follow-up).

| Surface | Up | Down | Left | Right | Tap | Notes |
|---------|----|------|------|-------|-----|-------|
| **Cover (.cover / .cover-strip)** | WIRED → grip snap machine (closed→half→full; flick + nearest-snap, mirrors grip 1:1) | WIRED → LAYERED: open sheet steps full→half→closed via grip machine; closed sheet collapses page past ~120px (`player.collapse()`) | WIRED → `coverSwipe` → `player.prev()` | WIRED → `coverSwipe` → `player.next()` | WIRED → `tapCoverCollapse` (`half` → `closed` only; no-op in closed/full) | This task. `.np-top` (Y) and `.cover-strip` `coverSwipe` (X) arbitrate by axis-dominance at the 8px slop; sub-slop reaches the cover onclick. |
| **`.np-top` wrapper (meta / prog / transport region)** | WIRED → same vertical handlers as the cover (the cover lives inside `.np-top`); a vertical-dominant drag anywhere in the wrapper drives the snap machine / page-collapse | WIRED → same layered down as the cover | INTENTIONALLY-UNMAPPED — only `.cover-strip` carries `coverSwipe`; meta/prog/transport buttons keep their own clicks | INTENTIONALLY-UNMAPPED — same | WIRED (per-control) → artist link, seek slider, transport buttons fire their own onclick (sub-slop never captured) | The wrapper has `touch-action: pan-x` so it yields horizontal pan to `coverSwipe`. Interactive children (seek slider role=slider, transport buttons) still receive taps because nothing captures before slop. |
| **Grip handle** | WIRED → `gripDown/Move/Up` snap machine (closed→half→full; tap = single step) | WIRED → same snap machine (full→half→closed; tap = single step) | n/a | n/a | WIRED → generic single-step toggle (closed→half, half→closed, full→half) + grip click-suppressor | UNCHANGED by this task — the cover path reuses these semantics, the grip's own handlers are byte-unchanged. |
| **Subnav row** | WIRED → `gripDown/Move/Up` (shares the grip handlers; vertical drag drives the sheet) | WIRED → same | n/a (no horizontal nav gesture) | n/a | WIRED → tab select (`data-tab` → `selectTab`, half-open from closed) or plain-button onclick (e.g. Clear) acts alone | UNCHANGED. Tap-vs-drag disambiguated by the grip handlers' 8px `gripMoved` check + `gripStartTab`/`gripStartPlainButton`. |
| **Sheet / panel (up-next / lyrics container)** | INTENTIONALLY-UNMAPPED at the panel body — expansion is driven by grip/subnav/cover, not by dragging the panel content (the panel scrolls). | INTENTIONALLY-UNMAPPED at the panel body — same; collapsing is via grip/subnav/cover. | INTENTIONALLY-UNMAPPED — no horizontal sheet gesture | INTENTIONALLY-UNMAPPED — same | n/a (container) | The queue rows inside DO carry their own gestures (next row). Adding a body-drag here would compete with vertical list scroll — out of scope and undesirable. |
| **Queue rows (inside up-next panel)** | INTENTIONALLY-UNMAPPED | WIRED → reorder via `.grip-handle` (`gripDragDown/Move/Up`, row drag) | WIRED → `swipeRemove` → `player.removeFromQueue` (disabled for the current track) | INTENTIONALLY-UNMAPPED (swipeRemove is single-direction remove) | WIRED → `player.play(track)` onclick; long-press → `openMenu(track)` | UNCHANGED. Listed for completeness — the row reorder uses a SEPARATE drag machine (`gripDrag*`), not the sheet snap machine. |
| **Lyrics area** | INTENTIONALLY-UNMAPPED (vertical = native scroll; `lyricsWheel`/`onscroll` track resume) | INTENTIONALLY-UNMAPPED (native scroll) | INTENTIONALLY-UNMAPPED | INTENTIONALLY-UNMAPPED | WIRED → tap-to-seek (LYR-01 / D-01: each lyric line seeks to its timestamp via `lineSeekFraction`) | UNCHANGED. A vertical drag here scrolls the lyrics; it does not drive the sheet (the lyrics container is inside `.panel`, below the grip/subnav). |
| **Back-gesture (browser / edge back)** | n/a | n/a | INTENTIONALLY-UNMAPPED — no custom edge-back handler in NowPlaying; the OS/browser back gesture is not intercepted here | INTENTIONALLY-UNMAPPED — same | n/a | The explicit collapse affordances are the header ChevronDown, the embedded Nowbar tap (in `full`), the cover down-drag (this task), and `tapCoverCollapse`. Hardware/edge back is left to the platform; not in scope for this task. |

**Answer to "is any gesture left undone?":** No gesture is LEFT-UNDONE. The cover's four
directions are all wired (up = expand, down = layered collapse, left/right = prev/next, tap =
half→closed). Every other surface's unmapped directions are INTENTIONALLY-UNMAPPED with the
reason stated (native scroll, single-purpose actions, or platform-owned back).

## Deviations from Plan

None — plan executed as written. Closed-state up-vs-down is decided by the SIGN of the initial
committing `dy` (per the plan's "decide closed-state down vs up by the sign of gripMoved at
release" intent), resolved at commit rather than at release so the gesture commits to one owner
and cannot flip mid-drag — this is the stronger reading of the locked one-shot axis-lock
invariant and matches the plan's "must NOT flip to horizontal mid-drag" requirement extended to
the vertical owner choice.

## Checkpoint — PENDING HUMAN VISUAL VERIFICATION

Task 2 (`checkpoint:human-verify`, gate=blocking) is a device/touch-emulation visual check that
cannot be performed headlessly. It is **pending human visual verification**. On a touch device
(or devtools touch emulation), open a track to now-playing and confirm:

1. From `closed`, drag UP on the cover → sheet follows the finger and snaps to half, then full
   on a longer/flicked up-drag — feel identical to dragging the grip handle (incl. flick +
   nearest-snap).
2. From `full`, drag DOWN on the cover → sheet steps full→half→closed; the PAGE must NOT
   collapse while the sheet is still open (layered down).
3. From `closed`, drag DOWN on the cover past ~120px → the now-playing page collapses to the
   nowbar (today's behavior).
4. Flick UP and flick DOWN → each steps exactly one state in the flick direction.
5. Drag LEFT / RIGHT on the cover → next / prev track (unchanged, no sheet movement).
6. A quick TAP on the cover in `half` → collapses the sheet to closed (`tapCoverCollapse`).
7. Toggle reduced-motion in settings → snaps are instant, no easing artifacts, state still
   commits correctly.

Resume signal: type "approved" or describe issues.

## Commits

- `b13dda2` feat(quick-260615-gcy): wire cover vertical drag into grip snap machine

## Self-Check: PASSED

- `src/lib/components/NowPlaying.svelte` exists with `startGripFromCover` + `npTopDeleg`.
- SUMMARY.md exists.
- Commit `b13dda2` exists in git log.
