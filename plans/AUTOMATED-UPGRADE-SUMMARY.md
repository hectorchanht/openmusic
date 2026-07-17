# Automated Upgrade Summary — OpenMusic Mobile UI Motion Pass

**Mode:** Autonomous Senior Design Engineer
**Date:** 2026-07-18
**Quality gate:** `pnpm check` → **0 errors, 0 warnings** · `pnpm test` → **1332 passed / 79 files** ·
dev server boots with **zero console errors**.
**Design lens:** Apple HIG native feel + Emil Kowalski interruptible-motion mechanics.

---

## Phase-by-phase

- **Phase 1 — Audit:** `plans/000-autonomous-audit.md` (5 domains + cross-cutting, severity-ranked).
- **Phase 2 — Plans:** `plans/001`…`plans/006` (one per HIGH/MEDIUM item; LOW folded into 006).
- **Phase 3 — Execution:** all six plans applied (below).
- **Phase 4 — Verification:** typecheck + full unit suite + clean boot; this document.

---

## Bugs fixed & motion polished

### HIGH — Live drag scrubber (Domain 2) — `plan 002`
- **Before:** the seek bar was `onclick={seek}` only — no press-and-drag, no pointer-down
  feedback, value jumped only on release; the `.knob` had zero pointer handlers.
- **After:** new **`src/lib/actions/scrub.ts`** (`use:scrub`) — captures on pointerdown,
  emits a live `onPreview(frac)` 1:1 with the finger, commits the single `player.seekFraction`
  on release; a pure tap still seeks. While dragging, the UI shows a **preview** position
  (`scrubbing`/`scrubFrac`/`displayFrac`/`displayTime` runes) so audio never stutters mid-drag.
  Knob grows (`scale(1.7)`) on grab; fill/knob glide via `--dur-base` between timeupdate ticks
  when idle. Keyboard `role="slider"` + arrow seeking + `aria-valuenow` preserved (now reflect
  the live preview). `stopPropagation` on pointerdown keeps the sheet-collapse drag from arming.

### HIGH — Cover crossfade on non-swipe track change (Domain 4) — `plan 003`
- **Before:** the current cover cell hard-swapped `background-image` on auto-advance / queue tap /
  prev-next / late resolve (only the swipe path animated).
- **After:** the `.cur` cell renders a `{#key effectiveCover}` stack of `.cover-img` layers that
  cross-dissolve (`in:/out:fade`, `xfadeMs`, → 0 under reduce-motion). Contained entirely inside
  `.cur`; the `coverSwipe` strip transform is byte-unaffected.

### MEDIUM — Contextual pause/play cover scale (Domain 4) — `plan 003`
- **New:** a real `svelte/motion` **`Spring`** (`coverScale`, stiffness 0.16 / damping 0.62) drives
  the hero art to `scale(0.93)` when paused and `scale(1)` when playing — interruptible, retargets
  mid-flight on rapid toggles. Gated to the closed-sheet square hero (pinned to 1 in the half/full
  banner). `{ instant: true }` under app-flag **or** OS reduced-motion.

### MEDIUM — Play/Pause glyph morph (Domain 1) — `plan 004`
- **Before:** `{#if player.playing}<Pause/>{:else}<Play/>{/if}` — instant destroy/recreate snap.
- **After:** shared global `.play-glyph` — both glyphs always mounted, stacked in one grid cell
  (grid-area 1/1), cross-dissolve + scale on `.is-playing`. **Zero layout shift.** Applied to both
  the NowPlaying `.play` transport button and the Nowbar `.np-btn`.

### MEDIUM — Sheet page-collapse flick velocity (Domain 3) — `plan 005`
- **Before:** whole-overlay drag-down dismissed on **distance only** (`dragY > 120`); a fast short
  flick did nothing — inconsistent with every other gesture.
- **After:** a `createVelocityTracker` (`collapseVel`) seeded in `npTopDown`, sampled in
  `npTopMove`, read in `npTopUp` → collapse on `dragY > 120` **OR** downward flick
  (`v > 0.5 px/ms && dragY > 8`). The `dragY > 8` guard preserves the tap contract. The velocity-
  aware internal closed/half/full snap machine was left untouched.

### MEDIUM — Motion vocabulary (cross-cutting) — `plan 001`
- **New** `:root` tokens in `app.css`: `--dur-quick/base/slow`, `--ease-out-quint`,
  `--ease-spring`, `--ease-standard`, `--spring-stiffness`, `--spring-damping`. New work references
  these instead of hardcoded curves. Existing gesture-action inline settles were intentionally left
  as-is (load-bearing 1:1-follow mechanics — forcing them through a spring store would regress the
  Emil-correct direct-transform tracking).

### LOW — Time-readout jitter (Domain 5) — `plan 006`
- `.times` gained `font-variant-numeric: tabular-nums` so the ticking current-time no longer nudges
  its neighbors each second.

---

## New global CSS classes (dictionary)

| Class / token | File | Purpose |
|---------------|------|---------|
| `--dur-quick` / `--dur-base` / `--dur-slow` | `app.css` `:root` | Duration tiers (160/240/320 ms). |
| `--ease-out-quint` | `app.css` `:root` | Named form of the app's existing settle curve. |
| `--ease-spring` | `app.css` `:root` | Gentle-overshoot settle for tactile snaps. |
| `--ease-standard` | `app.css` `:root` | Symmetric material-ish curve. |
| `--spring-stiffness` / `--spring-damping` | `app.css` `:root` | Documented physics values for `Spring`. |
| `.scrubber` (+ `.scrub-fill`, `.scrub-knob`, `.scrubbing`) | `app.css` | Reusable drag-seek slider skin; reads `--scrub-frac`, grows knob while scrubbing, `touch-action:none`. |
| `.play-glyph` (+ `.pg`, `.pg-play`, `.pg-pause`, `.is-playing`) | `app.css` | Grid-stacked cross-dissolve+scale play/pause morph; zero layout shift; used by 2 call sites. |

**New action:** `src/lib/actions/scrub.ts` — `use:scrub` press-and-drag seek.

## Files changed
- `src/app.css` — motion tokens + `.scrubber` + `.play-glyph` globals.
- `src/lib/actions/scrub.ts` — **new**.
- `src/lib/components/NowPlaying.svelte` — scrubber runes+markup, cover crossfade, `Spring`
  pause-scale, glyph morph, collapse velocity, dead `.track/.fill/.knob` CSS removed, tabular-nums.
- `src/lib/components/Nowbar.svelte` — `.np-btn` glyph morph.

## Invariants preserved (verified)
- **Pitfall 7** — no gesture captures on pointerdown *where a child click must survive*; the new
  `scrub` action is a whole-element slider (no child click) so its pointerdown-capture is safe and
  `stopPropagation`s the ancestor collapse-drag.
- `coverSwipe` / `dragClose` / `swipeAction` / `swipeRemove` and all generation-guards / click-
  suppressors are **byte-unchanged** (1332 tests green, incl. their suites).
- `player.svelte.ts`, Media Session, and Capacitor bindings **not touched**.
- Reduce-motion honored on every new path (app flag **and** OS query).
- Runes-only (`$state`/`$derived`/`$effect`), `browser`/SSR-safe.

## Low-severity items deferred to manual review
1. **Error + sleep-timer row insertion shift** (Domain 5). `{#if player.error}` and
   `{#if sleepTimer.active}` insert in normal flow between meta and transport, nudging the transport
   when toggled. Reserving space risks the load-bearing `halfOffset` measurement
   (`transportEl.getBoundingClientRect()`) that the sheet snap depends on — not worth the risk for a
   rare transient shift. Left for a human to weigh.
2. **Overlay open/close `fly` transition** (Domain 3). Kept as the time-based
   `fly({ y:600, duration:320, easing: cubicOut })` — mount/unmount transitions aren't gesture-
   interruptible by nature and `cubicOut` already reads as a soft decel; a spring-store rewrite is
   high-risk / low-gain.

## Verification note
`pnpm check`, `pnpm test` (1332/1332), and a clean dev-server boot with **no console errors** all
pass in-sandbox, confirming the refactor (incl. the `Spring` import + module eval) is sound.
**Playback-dependent drag interactions** (scrub-drag mapping, cover crossfade on real track change,
pause-scale) require a resolvable audio stream; the CN Meting upstreams are unreachable from this
sandbox, so the *visual/tactile* confirmation of those three is left for on-device UAT — the
established verification path for this repo (see project memory `sandbox-no-cn-upstream-network`).
Changes are staged in the working tree; **no commit was made** (not requested).
