# 000 — Autonomous Design-Engineering Audit (OpenMusic Mobile)

**Auditor:** Senior Design Engineer (autonomous mode)
**Date:** 2026-07-18
**Scope:** `src/routes/**` + `src/lib/components/**` + `src/lib/actions/**` + `src/app.css`
**Lens:** Apple HIG native feel + Emil Kowalski interruptible-motion mechanics.

---

## Executive summary

OpenMusic is already an unusually well-engineered gesture app. The hand-rolled pointer
actions (`coverSwipe`, `dragClose`, `swipeAction`, `swipeRemove`) all follow the correct
Emil pattern: **1:1 finger-follow during drag → cubic-bezier settle on release**, with a
shared `createVelocityTracker` for flick detection and a load-bearing "never
`setPointerCapture` on pointerdown" invariant (ROADMAP Pitfall 7). The sheet snap machine
(closed/half/full) is velocity-aware and fully interruptible.

The friction is concentrated in the **state-driven** (non-gesture) transitions, which snap
instead of animate, plus one genuine functional gap:

| # | Domain | Verdict |
|---|--------|---------|
| 1 | Play/Pause glyphs | Instant `{#if}` swap, no morph/scale. No layout shift (fixed button). **MEDIUM** |
| 2 | Track scrubbing | **Click-to-seek only — no live drag scrubbing exists.** **HIGH** |
| 3 | Now-Playing sheet | Internal snap machine excellent; page-collapse is distance-only, overlay open is a canned fly. **MEDIUM** |
| 4 | Album artwork dynamics | Current cover **hard-swaps** on non-swipe track change; **no pause/play scale**. **HIGH + MEDIUM** |
| 5 | Layout stability | Titles/queues stable (marquee+ellipsis). Time readout jitters (no tabular-nums); error/timer rows shift transport. **LOW** |

There is **no shared motion vocabulary**: `cubic-bezier(.22,1,.36,1)` and magic durations
(`0.28s`/`0.32s`/`290ms`/`320ms`) are duplicated across ~10 sites. Introducing physics
tokens + a real `svelte/motion` `Spring` for state-driven scale is the cross-cutting fix.

---

## Domain 1 — Play/Pause Glyphs — MEDIUM

**Files:** `src/lib/components/NowPlaying.svelte:1302-1304`, `src/lib/components/Nowbar.svelte:179-181`

```svelte
<!-- NowPlaying .play -->
{#if player.playing}<Pause size={26} />{:else}<Play size={26} />{/if}
<!-- Nowbar .np-btn -->
{#if player.playing}<Pause size={18} />{:else}<Play size={18} />{/if}
```

- The glyph is destroyed/recreated on every toggle — an **instant snap**, no cross-dissolve,
  no scale. iOS animates play↔pause as a quick cross-dissolve + subtle scale.
- **No adjacent layout shift** (both glyphs are `place-items:center` inside a fixed-size
  circle — 62px `.play`, 40px `.np-btn`), so this is a *polish* gap, not a jank bug.
- `use:tapBounce` gives press feedback but the icon transition itself is unanimated.
- The Play triangle is not optically centered in the circle (minor).

**Severity MEDIUM** — high-visibility control, no correctness risk.

---

## Domain 2 — Track Scrubbing & Progress — HIGH

**Files:** `src/lib/components/NowPlaying.svelte:134-143` (logic), `:1276-1285` (markup), `:1596-1601` (CSS)

```svelte
<div class="track" onclick={seek} onkeydown={seekKey} role="slider" tabindex="0" ...>
  <div class="fill" style:width={`${frac * 100}%`}></div>
  <div class="knob" style:left={`${frac * 100}%`}></div>
</div>
```

```ts
function seek(e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  player.seekFraction((e.clientX - r.left) / r.width);
}
```

**Findings:**
1. **No live drag.** The bar responds only to a completed `click`. You cannot press-and-drag
   the knob to scrub; the `.knob` element has **zero** pointer handlers. This is the single
   biggest interaction gap in the app and directly fails domain 2 ("immediately interactive on
   pointer-down… map smoothly during fast drag").
2. **No pointer-down feedback.** Nothing happens on press; the value only jumps on release.
3. **`.fill`/`.knob` have no transition**, so between `timeupdate` ticks (~4 Hz) the knob
   *steps* rather than glides. (The Nowbar's own bar correctly uses `transition: width 0.25s
   linear` — the NP scrubber should mirror that when not actively dragging.)
4. Keyboard (`role="slider"` + arrows) and tap-to-seek are correct and **must be preserved**.

**Severity HIGH** — missing core interaction.

---

## Domain 3 — Now-Playing Panel Sheet — MEDIUM

**Files:** `src/lib/components/NowPlaying.svelte:696-781` (page-collapse), `:783-970` (snap machine), `:1140-1148` (overlay transition)

**What's already excellent (do not touch):**
- The closed/half/full snap machine (`gripDown/Move/Up`) is a textbook interruptible sheet:
  `gripActive` sets `transition:none` for 1:1 follow, release runs flick-velocity detection
  (`gripVel`, `FLICK_V=0.5`) → one-state step, else nearest-snap with directional bias, then a
  cubic-bezier settle. `dragClose.ts` and `coverSwipe.ts` are equally correct.

**Friction:**
1. **Whole-overlay open/close is a canned time transition** (`:1144`):
   ```svelte
   transition:fly={{ y: 600, duration: 320, easing: cubicOut }}
   ```
   Opening the player is a fixed 320 ms fly — not gesture-interruptible and not spring-shaped.
2. **Page-collapse (drag the top half down to dismiss) is distance-only** (`:779`):
   ```ts
   if (dragY > 120) player.collapse();
   ```
   No flick-velocity path — a fast short flick down does **not** dismiss, unlike every other
   gesture in the app (the sheet snap machine, `dragClose`, `coverSwipe` all honor velocity).
   Inconsistent and less tactile.
3. Safe-area handling is correct (`.np` uses `env(safe-area-inset-bottom)`, loader uses
   `env(safe-area-inset-top)`).

**Severity MEDIUM** — the sheet works well; the two gaps are consistency/polish.

---

## Domain 4 — Album Artwork Dynamics — HIGH (crossfade) + MEDIUM (scale)

**Files:** `src/lib/components/NowPlaying.svelte:1242-1245` (current cell), `:1526-1544` (cover CSS), `:502-527` (effectiveCover)

```svelte
<div class="cover-cell cur"
  style:background-image={effectiveCover ? `url(${effectiveCover})` : fallbackCover(player.current)}>
</div>
```

**Findings:**
1. **Hard cover swap on non-gesture track change (HIGH).** When the track changes via
   auto-advance, a queue tap, `next()`/`prev()` buttons, or the cover-art resolving late, the
   `.cur` cell's `background-image` is replaced **instantly**. The meta *text* crossfades
   (`{#key uid}` + `in:/out:fade`, `:1262-1269`) but the cover does not — a visible pop /
   possible flash-of-gradient while the new image decodes. Only the **swipe** path animates
   (the strip slides); every other track change snaps.
2. **No contextual pause/play scale (MEDIUM).** The brief explicitly calls for "artwork
   slightly shrinking when paused, expanding when playing." The `.cover` only reflows on sheet
   state; it never reacts to `player.playing`. Native players (Apple Music, Spotify) shrink the
   art ~6-8% when paused. Nothing here does.
3. The neighbor cells self-heal covers via `use:lazyCover`; the current cell self-heals a dead
   URL via `player.healCover` — resolution correctness is fine. The gap is purely **motion**.

**Severity HIGH** (crossfade) **+ MEDIUM** (pause-scale).

---

## Domain 5 — Layout Stability & Shifts — LOW

**Files:** `src/lib/components/NowPlaying.svelte:1281-1284` (times), `:1272-1297` (error/sleep rows), `:1552` (meta)

**Findings:**
1. **Time readout has no `tabular-nums` (LOW).** `.times` (`:1601`) renders `fmtTime` in the
   proportional Inter font; digit-width variation (`1:11` vs `1:44`) nudges the left readout's
   right edge every second. `.st-readout` / `.st-badge` *do* use `font-variant-numeric:
   tabular-nums`; the main `.times` does not — a one-line fix.
2. **Error + sleep-timer rows push the transport down (LOW).** `{#if player.error}` (`:1272`)
   and `{#if sleepTimer.active}` (`:1287`) insert in normal flow between meta and transport, so
   toggling them shifts the transport/progress vertically. Transient, rare.
3. Titles, artists, queue rows, related skeletons are all stable (`nowrap`+ellipsis+marquee, and
   skeletons mirror row shape). Long titles do **not** cause shift. ✅
4. The top loader (`.np-top-loader`) and Nowbar loader are absolutely positioned — no shift. ✅

**Severity LOW.**

---

## Cross-cutting — Motion vocabulary — MEDIUM

There is no shared easing/duration system. The following are duplicated by hand:

- `cubic-bezier(.22,1,.36,1)` — cover reflow, sheet settle, coverSwipe/dragClose spring-back
  (≥8 sites across `NowPlaying.svelte`, `Nowbar.svelte`, `coverSwipe.ts`, `dragClose.ts`).
- Durations `0.12s / 0.15s / 0.25s / 0.28s / 0.32s / 290ms / 320ms` scattered inline.
- No `svelte/motion` usage at all (`grep 'svelte/motion'` → 0 hits), despite the stack fully
  supporting `Spring`/`Tween` (Svelte 5.56.2).

**Fix:** publish a small set of physics tokens in `:root` (`--ease-spring`, `--ease-out-quint`,
`--dur-quick/base/slow`) + a shared global utility layer, and use a real `Spring` for the one
truly state-driven physical animation (cover pause-scale). This satisfies the brief's "physics-
based CSS custom variables **or** Svelte's native motion engines" mandate without rewriting the
gesture actions (whose direct-transform 1:1 follow is already the correct Emil mechanic and would
*regress* if forced through a spring store).

**Severity MEDIUM** (maintainability + consistency; enables Domains 1-4 cleanly).

---

## Plan mapping (Phase 2)

| Plan | Covers | Severity |
|------|--------|----------|
| `001-motion-tokens-and-globals.md` | Cross-cutting vocabulary (prerequisite) | MEDIUM |
| `002-live-drag-scrubber.md` | Domain 2 | HIGH |
| `003-cover-crossfade-and-pause-scale.md` | Domain 4 | HIGH + MEDIUM |
| `004-playpause-glyph-morph.md` | Domain 1 | MEDIUM |
| `005-sheet-collapse-velocity.md` | Domain 3 | MEDIUM |
| `006-layout-stability.md` | Domain 5 | LOW (folded in — cheap) |

**Non-negotiable invariants to preserve during all edits:**
- Never `setPointerCapture` on `pointerdown` (Pitfall 7). New scrub action captures only after slop.
- Generation guards / click-suppressors in gesture code stay byte-intact.
- Reduce-motion: honor both `settings.reduceMotion` **and** OS `prefers-reduced-motion`.
- Media Session / Capacitor bindings in `player.svelte.ts` are not touched.
- Runes mode: `$state`/`$derived`/`$effect` only; `browser` guards on any `window`/`Image` access.
