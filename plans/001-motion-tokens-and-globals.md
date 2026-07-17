# 001 — Motion Tokens & Shared Global Utilities (prerequisite)

**Severity:** MEDIUM (cross-cutting; enables 002-005 cleanly)
**Target file:** `src/app.css` (append to `:root` + new global blocks)
**Local component `<style>` touched:** none.

## Goal
Publish a single physics-based motion vocabulary (CSS custom properties) + the shared global
utility classes the other plans consume, so no plan hardcodes a curve or duration. Satisfies the
brief's "physics-based CSS custom variables" mandate. The existing hand-rolled inline
`cubic-bezier(.22,1,.36,1)` settles in the gesture actions are LEFT AS-IS (they are load-bearing
and correct); new work references the tokens.

## Exact entry point
In `src/app.css`, inside the existing `:root { … }` block (after the `--home-grid-cols: 3;` line,
before the closing `}` at line 39), add:

```css
  /* ---- Motion system (plan 001) --------------------------------------------------------
     One vocabulary for every state-driven transition. The gesture ACTIONS keep their own
     inline settle curves (load-bearing 1:1-follow mechanics); these tokens are for the
     declarative CSS/Spring layer introduced in plans 002-005. --ease-spring is a slightly
     overshooting settle (Apple sheet feel); --ease-out-quint is a fast, no-overshoot decel
     for glyph/opacity swaps. Durations are the three tiers actually used across the app. */
  --dur-quick: 160ms;   /* glyph morphs, opacity crossfades */
  --dur-base: 240ms;    /* progress/knob catch-up, general */
  --dur-slow: 320ms;    /* cover reflow, sheet-scale settle */
  --ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);   /* the app's existing settle, named */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);   /* gentle overshoot for tactile snaps */
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);      /* symmetric material-ish */
  /* Spring physics for svelte/motion Spring instances (plan 003 reads these numerically). */
  --spring-stiffness: 0.16;
  --spring-damping: 0.62;
```

Then append these NEW global utility blocks at the END of `src/app.css` (after the existing
`.tap-bouncing` block). They are consumed by plans 002 & 004:

```css
/* ---- Global scrubber (plan 002) --------------------------------------------------------
   Shared slider skin for any horizontal progress+seek control. The component supplies the
   fraction (inline --scrub-frac 0..1) and toggles `.scrubbing` while a pointer drag is live.
   Track is a comfortable ≥14px visual rail with a 44px touch target via padding; the fill +
   knob read --scrub-frac so JS only ever writes one custom property. While `.scrubbing` the
   catch-up transition is OFF (1:1 finger-follow) and the knob grows — the tactile "grabbed"
   affordance. Not scrubbing → the knob/fill glide over --dur-base so timeupdate ticks don't
   step. touch-action:none so a horizontal drag never scrolls/collapses the sheet behind it. */
.scrubber {
  position: relative;
  height: 14px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}
.scrubber::before {
  content: '';
  position: absolute;
  left: 0; right: 0;
  height: 4px;
  border-radius: 4px;
  background: var(--color-text-muted);
  opacity: 0.3;
}
.scrubber .scrub-fill {
  position: absolute;
  left: 0;
  height: 4px;
  border-radius: 4px;
  background: var(--color-primary);
  width: calc(var(--scrub-frac, 0) * 100%);
}
.scrubber .scrub-knob {
  position: absolute;
  left: calc(var(--scrub-frac, 0) * 100%);
  width: 12px; height: 12px;
  border-radius: 50%;
  background: var(--color-text);
  transform: translateX(-50%) scale(1);
  box-shadow: 0 1px 4px rgba(0,0,0,0.4);
}
.scrubber:not(.scrubbing) .scrub-fill { transition: width var(--dur-base) linear; }
.scrubber:not(.scrubbing) .scrub-knob {
  transition: left var(--dur-base) linear, transform var(--dur-quick) var(--ease-spring);
}
.scrubber.scrubbing .scrub-knob { transform: translateX(-50%) scale(1.7); }
@media (prefers-reduced-motion: reduce) {
  .scrubber .scrub-fill,
  .scrubber .scrub-knob { transition: none; }
}

/* ---- Global play/pause glyph morph (plan 004) -----------------------------------------
   Both glyphs are always rendered, stacked in one grid cell (grid-area 1/1), so there is
   NEVER a layout shift and the swap is a true cross-dissolve + scale rather than a destroy/
   recreate snap. Parent toggles `.is-playing`. Reduce-motion (OS query + the app's global
   :root[data-reduce-motion] rule) collapses it to an instant swap. Used by NowPlaying .play
   and Nowbar .np-btn — one skin, two call sites. */
.play-glyph { display: inline-grid; place-items: center; }
.play-glyph .pg {
  grid-area: 1 / 1;
  display: grid;
  place-items: center;
  transition: opacity var(--dur-quick) var(--ease-out-quint),
              transform var(--dur-quick) var(--ease-out-quint);
}
.play-glyph .pg-play  { opacity: 1; transform: scale(1); }
.play-glyph .pg-pause { opacity: 0; transform: scale(0.6); }
.play-glyph.is-playing .pg-play  { opacity: 0; transform: scale(0.6); }
.play-glyph.is-playing .pg-pause { opacity: 1; transform: scale(1); }
@media (prefers-reduced-motion: reduce) {
  .play-glyph .pg { transition: none; }
}
```

## Reduce-motion
`:root[data-reduce-motion] * { transition: none !important }` (already in app.css) covers the
app-flag path for both utilities; the `@media (prefers-reduced-motion: reduce)` blocks cover the
OS path. No JS needed.

## Verification
`pnpm check` (CSS-only, no type impact). Visual: unchanged until 002/004 mount the classes.
