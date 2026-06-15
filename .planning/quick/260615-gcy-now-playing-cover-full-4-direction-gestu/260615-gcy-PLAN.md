---
phase: quick-260615-gcy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/NowPlaying.svelte
autonomous: false
requirements: [NP-GESTURE-4DIR]
must_haves:
  truths:
    - "A vertical-UP drag started on the cover expands the sheet exactly like dragging the grip (live finger-follow, flick-steps-one-state, nearest-snap)."
    - "A vertical-DOWN drag started on the cover steps the OPEN sheet back toward closed (full→half→closed) before any page collapse."
    - "A vertical-DOWN drag when the sheet is already `closed` collapses the now-playing page past the existing ~120px threshold (unchanged)."
    - "A horizontal-dominant drag on the cover still reaches coverSwipe → player.prev()/next() (unchanged)."
    - "A sub-slop tap on the cover still reaches the cover onclick (tapCoverCollapse)."
    - "The SUMMARY documents a gesture-coverage audit of every now-playing surface."
  artifacts:
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "Cover vertical-up/down delegated into the existing grip snap machine; layered down precedence"
      contains: "npTopMove"
  key_links:
    - from: "npTopDown/npTopMove/npTopUp (.np-top wrapper)"
      to: "gripDown/gripMove/gripUp snap machine state (sheetState, sheetDragY, sheetDragging, gripVel, offsetFor, measureOffsets)"
      via: "vertical-dominant delegation, no parallel snap impl"
      pattern: "measureOffsets|offsetFor|gripVel"
---

<objective>
Make the now-playing COVER fully gesture-capable in all four directions by reusing the
existing grip snap machine and coverSwipe — NO new/parallel gesture system.

- UP on cover = expand the sheet, mirroring the grip 1:1 (drive the SAME closed/half/full
  snap machine: live finger-follow, flick-steps-one-state, nearest-snap).
- DOWN on cover = LAYERED: when the sheet is open (half/full), step it back toward closed
  first; only when the sheet is already `closed` does a further down-drag collapse the page
  (`player.collapse()`).
- LEFT/RIGHT = unchanged (coverSwipe owns the X axis).

Purpose: A single coherent vertical gesture on the cover that feels identical to the grip,
with the page-collapse only as the bottom layer past `closed`.
Output: An updated `.np-top` pointer handler set in NowPlaying.svelte that axis-locks at slop
and delegates vertical-dominant gestures into the grip snap machine; a gesture-coverage audit
in the SUMMARY.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260615-gcy-now-playing-cover-full-4-direction-gestu/260615-gcy-CONTEXT.md
@CLAUDE.md

<interfaces>
<!-- Existing machinery in NowPlaying.svelte the executor MUST reuse. Do NOT fork. -->

The 3-state grip snap machine (NowPlaying.svelte ~L510-697):
- `sheetState: 'closed' | 'half' | 'full'` — current resting state ($state).
- `sheetDragY` ($state) — px in full-coordinates (0 = full, halfOffset = half, closedOffset = closed).
- `sheetDragging` ($state) — forces absolute layout + the wrapper/sheet translateY while a drag/snap is in flight.
- `gripActive` ($state) — true only while a finger is down (transition off).
- `gripMoved` ($state) — running dy of the active grip gesture; BOTH `.np-top` and `.sheet` render `translateY(${gripMoved}px)` when `sheetDragging`. This is the load-bearing link: driving the grip machine moves the cover region for free, giving the 1:1 mirror with zero new transform code.
- `closedOffset` / `halfOffset` — measured offsets.
- `offsetFor(s): number` — translateY for a resting state.
- `measureOffsets()` — measures closed/half offsets from live layout at drag start.
- `gripVel` (createVelocityTracker) + `FLICK_V = 0.5` — flick detection: v>0 = DOWN, v<0 = UP.
- `snapTimer` — 290ms settle timer that commits `sheetState` and clears transient drag state.
- gripUp() snap logic: FLICK steps one state in flick direction (clamped); SLOW DRAG snaps to nearest of {full,half,closed} with a directional 0.12·closedOffset bias.

The current `.np-top` drag-down handlers (NowPlaying.svelte ~L462-508):
- `dragY` ($state), `dragging` ($state), `dragArmed`, `startY`, `startX`, `DRAG_SLOP = 8`.
- `npTopDown`: records start only (no capture).
- `npTopMove`: axis-dominance claim — captures ONLY when `dy > DRAG_SLOP && |dy| > |dx|`; horizontal-dominant falls through (no capture) so coverSwipe owns X; clamps `dragY = Math.max(0, dy)` (DOWNWARD-ONLY — this is why UP does nothing today).
- `npTopUp`: `if (dragY > 120) player.collapse()`.
- The `.np-top` wrapper renders `style:transform={sheetDragging ? translateY(${gripMoved}px) : undefined}` (L877-881).

coverSwipe (src/lib/actions/coverSwipe.ts) — UNCHANGED:
- Arms on pointerdown WITHOUT setPointerCapture; commits + captures in pointermove ONLY after 8px slop AND `|dx| > |dy|`; goes passive (no capture, clears transition) on vertical dominance so the gesture flows to npTopMove. SLOP=8, FLICK_V=0.5. Owns X axis, touch-action: pan-y.

reduced-motion: the sheet/np-top transitions are gated in CSS via `@media (prefers-reduced-motion: reduce)` and `:global(:root[data-reduce-motion])` (app flag `settings.reduceMotion` sets `data-reduce-motion`). Reusing the snap machine inherits this — NO new motion code needed.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Delegate cover vertical-up/down into the grip snap machine with layered down precedence</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
Rework the `.np-top` pointer handlers (`npTopDown`/`npTopMove`/`npTopUp`, ~L462-508) so a
vertical-dominant cover drag drives the EXISTING grip snap machine instead of the
downward-only `dragY` collapse path. Honor CONTEXT decisions exactly:

UP behavior (mirror the grip 1:1, per the locked up-swipe decision): when `npTopMove`
commits the vertical axis at slop (`|dy| > DRAG_SLOP && |dy| > |dx|`), do NOT use the old
`dragY = Math.max(0, dy)` clamp. Instead delegate into the grip machine: at the moment of
vertical commit, run the grip-start sequence (set `gripActive = true`, `gripStartY` =
current clientY, reset `gripVel` + sample, `measureOffsets()`, `sheetDragging = true`,
`sheetDragY = offsetFor(sheetState)`, clear any `snapTimer`), then on each move feed the
machine exactly as gripMove does (sample `gripVel`, `gripMoved = clientY - gripStartY`,
`sheetDragY = Math.max(0, Math.min(closedOffset, offsetFor(sheetState) + gripMoved))`).
Because `.np-top` already renders `translateY(${gripMoved}px)` when `sheetDragging`, the
cover follows the finger 1:1 with no new transform. Allow gripMoved to go NEGATIVE (up) —
this is the fix for the downward-only clamp; the existing `Math.max(0, …)` on `sheetDragY`
keeps it within full-coordinate bounds while the cover region itself translates up via
`gripMoved`. Do NOT fork a parallel snap implementation — reuse the named state/helpers.

DOWN layered precedence (per the locked down-precedence decision): the release decision
depends on `sheetState` AT GESTURE START:
  - If the sheet is OPEN (`half` or `full`) when the vertical gesture commits, the ENTIRE
    gesture (up OR down) is owned by the snap machine — on release run the grip release/snap
    logic (FLICK steps one state via `gripVel`/`FLICK_V`; else nearest-snap with the same
    directional bias; then `snapTimer` commits `sheetState`, clears `sheetDragging`/`sheetDragY`,
    `applyHalfInset()` on half). A down gesture from `full` steps to `half`/`closed`; it does
    NOT collapse the page. Only a SUBSEQUENT down gesture once the sheet has reached `closed`
    can collapse.
  - If the sheet is `closed` when the vertical gesture commits, an UP gesture still feeds the
    snap machine (closed→half→full). A DOWN gesture preserves TODAY's behavior: collapse the
    page when the drag passes the ~120px threshold (`player.collapse()`), snap-back otherwise.
    Decide closed-state down vs up by the sign of `gripMoved` at release: `gripMoved < 0`
    (upward) → snap-machine release; `gripMoved >= 0` (downward) → the closed-state collapse
    path (reuse the `> 120` threshold; you may read `sheetDragY`/`gripMoved` for the distance).
    When taking the collapse path, reset the transient drag state (`gripActive = false`,
    `sheetDragging = false`, `sheetDragY = 0`, `gripMoved = 0`) so the machine is left clean.

Capture / axis-lock invariants (per the locked disambiguation decision — preserve verbatim):
  - `npTopDown` still records start only — NO setPointerCapture, NO preventDefault, NO
    `dragging`/`gripActive` set on pointerdown.
  - `npTopMove` commits + captures (`setPointerCapture`) ONLY after the slop + vertical
    dominance check; a horizontal-dominant drag still falls through with no capture so
    coverSwipe owns prev/next. Once committed to vertical, the gesture must NOT flip to
    horizontal mid-drag (the existing `if (!dragging)` one-shot commit already enforces this —
    keep that latch).
  - A sub-slop tap must still reach the cover `onclick` (`tapCoverCollapse`): the existing
    no-capture-until-threshold path guarantees this; do not add movement that fires before slop.
  - Because the gesture now flows through gripDown-equivalent state, ensure the grip
    trailing-click suppressor concern does not regress: the cover gesture commits via capture
    on `.np-top` (like the old path), and a committed drag does not synthesize a tap — no new
    suppressor needed for the cover path, but do NOT leave `gripActive`/`sheetDragging`
    dangling on any release branch (tap-fallthrough, collapse, snap) — every npTopUp exit must
    leave machine state consistent.

Reduced-motion: rely on the existing CSS gating (`settings.reduceMotion` →
`data-reduce-motion` → `transition: none`); add no JS motion. Confirm the snap still commits
state (the 290ms `snapTimer` is a state-commit timer, not a visual easing — it must keep
running under reduced motion so `sheetState` updates).

Keep `coverSwipe.ts` and `coverSwipe.test.ts` untouched. Keep the grip's own
`gripDown/gripMove/gripUp` handlers byte-unchanged (the cover path reuses their semantics;
if extraction into a tiny shared helper reduces duplication that is fine per Claude's
Discretion, but it MUST NOT change grip behavior or coverSwipe).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm check 2>&1 | tail -5 && pnpm test 2>&1 | tail -15</automated>
  </verify>
  <done>
    `pnpm check` reports 0 errors; `pnpm test` suite green (coverSwipe.test.ts still passes —
    horizontal gesture untouched). The `.np-top` handlers delegate vertical-up and
    open-sheet-down into the grip snap machine (no new snap impl), closed-state-down still
    collapses the page past ~120px, and all capture/tap/axis-lock invariants are preserved in
    code.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
Cover four-direction gestures: UP expands the sheet mirroring the grip; DOWN layers
(step-sheet-toward-closed, then collapse-page); LEFT/RIGHT unchanged (prev/next).
  </what-built>
  <how-to-verify>
On a touch device or devtools touch emulation, open a track to now-playing:
  1. From `closed`, drag UP on the cover → sheet follows the finger and snaps to half, then
     full on a longer/flicked up-drag. Feel should be identical to dragging the grip handle.
  2. From `full`, drag DOWN on the cover → sheet steps full→half→closed; the PAGE must NOT
     collapse while the sheet is still open.
  3. From `closed`, drag DOWN on the cover past ~120px → the now-playing page collapses to the
     nowbar (today's behavior).
  4. Flick UP and flick DOWN → each steps exactly one state in the flick direction.
  5. Drag LEFT / RIGHT on the cover → next / prev track (unchanged, no sheet movement).
  6. A quick TAP on the cover in `half` → collapses the sheet to closed (tapCoverCollapse).
  7. Toggle reduced-motion in settings → snaps are instant, no easing artifacts, state still
     commits correctly.
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
- `pnpm check` 0 errors, `pnpm test` green (coverSwipe.test.ts unchanged + passing).
- No `setPointerCapture` / `preventDefault` on cover pointerdown.
- Vertical-up and open-sheet-down go through the named snap-machine state/helpers
  (`measureOffsets`/`offsetFor`/`gripVel`/`sheetState`/`sheetDragY`/`sheetDragging`), not a new impl.
- Closed-state down still uses the `> 120` collapse threshold.
- SUMMARY contains the required gesture-coverage audit.
</verification>

<success_criteria>
The now-playing cover responds to all four directions: UP mirrors the grip 1:1 into the
closed/half/full snap machine; DOWN is layered (step-sheet-then-collapse-page); LEFT/RIGHT
unchanged via coverSwipe. All Pitfall-7 capture/tap/axis-lock invariants preserved.
settings.reduceMotion honored. No parallel gesture system introduced. coverSwipe test green.
</success_criteria>

<output>
Create `.planning/quick/260615-gcy-now-playing-cover-full-4-direction-gestu/260615-gcy-SUMMARY.md` when done.

The SUMMARY MUST include a **Gesture-Coverage Audit** table enumerating EVERY now-playing
surface and which directions are wired vs intentionally-unmapped vs left-undone:

| Surface | Up | Down | Left | Right | Tap | Notes |
|---------|----|----|------|-------|-----|-------|
| Cover (.cover / .cover-strip) | … | … | … | … | … | … |
| `.np-top` wrapper (meta/prog/transport region) | … | … | … | … | … | … |
| Grip handle | … | … | n/a | n/a | … | … |
| Subnav row | … | … | n/a | n/a | … | … |
| Sheet / panel (up-next / lyrics container) | … | … | … | … | … | … |
| Lyrics area | … | … | … | … | … | … |
| Back-gesture (browser/edge back) | n/a | n/a | … | … | n/a | … |

For each cell state explicitly: WIRED (and to what), INTENTIONALLY-UNMAPPED (and why), or
LEFT-UNDONE (and why / follow-up).
</output>
