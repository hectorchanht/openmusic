# Quick Task 260615-gcy: Now-playing cover full 4-direction gestures - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Task Boundary

Make the now-playing **cover** respond to all four swipe directions, reusing the existing gesture machinery (do NOT add a competing system):

- **Left / Right** — prev / next. ALREADY DONE via `coverSwipe.ts` (polished in 260615-fva). No change.
- **Down** — collapse/close the now-playing page (reveal what's behind). Already wired via the `.np-top` drag machine (`dragY > 120 → player.collapse()`), but its precedence must become layered (see decisions).
- **Up** — NEW. Expand the sheet exactly like the grip handle. The cover's vertical drag is currently clamped downward-only (`dragY = Math.max(0, dy)` in NowPlaying.svelte ~line 499), so up does nothing today.

Also deliver an explicit **gesture-coverage audit** of every now-playing surface so "is any gesture left undone?" has a documented answer.
</domain>

<decisions>
## Implementation Decisions

### Up-swipe behavior (cover)
- **Mirror the grip 1:1.** The cover up-drag must drive the SAME 3-state snap machine the grip/subnav already use (`sheetState` closed/half/full; `gripDown`/`gripMove`/`gripUp`; `offsetFor`; `measureOffsets`; `gripVel` flick at `FLICK_V=0.5`; nearest-by-position fallback). Live finger-follow during the drag, flick-steps-one-state, nearest-snap on release — identical feel to dragging the grip. Reuse those handlers/state; do not fork a parallel snap implementation.

### Down precedence (cover) — layered
- When the sheet is OPEN (half/full), a down-drag on the cover first steps the sheet back toward closed (full→half→closed) via the same snap machine. Only when the sheet is already `closed` does a further down-drag collapse the whole now-playing page (`player.collapse()`). Symmetric with the up gesture.
- When the sheet is already `closed`, down behaves as today (collapse the page past the ~120px threshold).

### Disambiguation / axis-lock (cover)
- Keep the existing slop-threshold capture invariants: a sub-slop tap must still reach the cover `onclick`; pointerdown only records start (no capture/preventDefault until threshold).
- Axis-lock on the dominant direction at threshold: horizontal-dominant → `coverSwipe` owns prev/next (unchanged — it already falls through on horizontal). Vertical-dominant → the new up/down sheet+collapse logic owns the gesture. A drag must commit to one axis and not flip mid-gesture.

### Reduced-motion
- Honor `settings.reduceMotion` consistent with the rest of NowPlaying (the snap machine's transition is gated; reduced-motion makes the snap instant, no live-follow easing artifacts).

### Claude's Discretion
- Exact wiring approach (extend the existing `.np-top` pointer handlers to delegate vertical-up/down into the grip snap machine, vs. a small shared helper) — planner/executor's call, as long as it reuses the existing snap machine and coverSwipe, keeps all current invariants, and adds no parallel gesture system.
- Velocity/threshold constants for the cover vertical gesture — reuse the grip's where sensible.
</decisions>

<specifics>
## Specific Ideas

- Source of truth for the sheet machine: `src/lib/components/NowPlaying.svelte` ~lines 462-640 — `.np-top` drag-down (`dragY`, threshold 120) and the 3-state grip snap machine (`sheetState`, `gripDown/gripMove/gripUp`, `offsetFor`, `measureOffsets`, `gripVel`, `FLICK_V`).
- Horizontal gesture: `src/lib/actions/coverSwipe.ts` (+ `coverSwipe.test.ts`) — left/right commit → `player.prev()/next()`. Keep its test green; prefer NOT modifying coverSwipe.ts unless strictly necessary for axis-lock coordination.
- `src/lib/actions/dragClose.ts` exists — evaluate whether it already models the vertical close gesture and can be reused.

## Audit deliverable (REQUIRED in SUMMARY)
Enumerate, per now-playing surface, which directions are wired after this task:
- **Cover** (up / down / left / right)
- **`.np-top` wrapper** (meta/prog/transport region)
- **Grip handle** (up / down)
- **Subnav row** (drives sheet + tab switch)
- **Sheet / panel** (lyrics / up-next)
- **Lyrics area** (tap-to-seek; any swipe?)
- **Back-gesture** (browser/edge back → collapse)
State explicitly which directions per surface are wired vs intentionally-unmapped vs left-undone.
</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements fully captured in the decisions above. Phase 20 (Now-Playing Surface & Gestures, shipped 2026-06-11) and quick task 260615-fva (cover-swipe transition polish) are the immediate lineage.
</canonical_refs>
