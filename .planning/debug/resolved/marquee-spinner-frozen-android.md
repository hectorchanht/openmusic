---
status: resolved
trigger: "marquee and spinner are not moving or spinning in android mobile web app, but it works in desktop web site. they should always move"
created: 2026-08-09
updated: 2026-08-09
---

# Marquee + spinners frozen on Android, fine on desktop

## Symptoms

- **Expected:** scrolling titles (marquee) and loading spinners animate on every platform, always.
- **Actual:** on the Android mobile web app both are completely static. Desktop web is fine.
- **Errors:** none.
- **Reproduction:** open the app on Android with Settings → Appearance → "Reduce motion" ON.

## Current Focus

- hypothesis: (confirmed) reduce-motion suppression, not a platform/rendering bug
- next_action: none — fixed and verified

## Evidence

- `src/app.css` blanket rule `:root[data-reduce-motion] *, ::before, ::after { animation: none !important; transition: none !important; }`
  kills EVERY animation app-wide when the in-app **Reduce motion** setting is on. `!important` + universal
  selector means no component rule can survive it.
- User confirmed the in-app Reduce motion toggle is **ON** on the Android device and off on desktop —
  fully explains the platform split. Nothing Android-specific is involved.
- Second, independent gate on the same elements: per-component
  `@media (prefers-reduced-motion: reduce) { animation: none }` at 7 spinner sites + `app.css:105` for the
  marquee, plus a JS gate `prefersReducedMotion()` in `src/lib/actions/marquee.ts` that refuses to add
  `.marquee-on` at all. These would freeze the same elements on an Android device with battery saver or
  Developer Options → Animator duration scale = off, even with the app setting off.

## Eliminated

- hypothesis: Android WebView / Chrome not rendering CSS keyframes — ruled out; other animations that
  are not reduce-motion gated behave normally, and the suppression is exactly co-extensive with the gates.

## Resolution

- root_cause: marquee and spinners are gated by BOTH the in-app reduce-motion rule
  (`:root[data-reduce-motion] * { animation: none !important }`) and per-element
  `@media (prefers-reduced-motion: reduce)` gates. The user's Android device had the in-app setting on.
- decision: user wants marquee + spinners to ignore BOTH gates — they are functional (spinner = loading
  feedback; marquee = the only way to read a clipped title), not decoration.
- fix: introduce a `.motion-always` escape hatch excluded from the blanket reduce-motion rule, apply it to
  every spinner, re-assert the marquee keyframe at higher specificity, and delete the now-dead
  `prefers-reduced-motion` gates on those elements (including the JS gate in `marquee.ts`).

- files_changed:
  - `src/app.css` — blanket rule now `*:not(.motion-always)`; marquee keyframe re-asserted at (0,4,0);
    marquee's own `@media (prefers-reduced-motion)` gate deleted.
  - `src/lib/actions/marquee.ts` — dropped `prefersReducedMotion()` and the `reducedMotion` parameter of
    `marqueeState()`; overflow is the only input now.
  - `src/lib/actions/marquee.test.ts` — call sites updated; the "reduced motion is always off" case is
    replaced by one asserting the exemption.
  - `TrackMenu` / `VersionPicker` / `DownloadControl` `.row-spinner`, `search` `.spin`, both `song/*`
    `.spinner` — `.motion-always` added in markup, `@media` + `:global(:root[data-reduce-motion])` kill
    rules deleted.
  - `Nowbar` — rotation moved off the inner `<svg>` onto `.np-spin` (a solid 40px circle, so visually
    identical) because a class cannot be put on the Lucide svg; the `.sliver` indeterminate loader rail
    also opted in.

- verification (dev server, viewport 320x812, app **Reduce motion setting ON** via Settings → General):
  - marquee: 5 organically clipped titles carried `.marquee-on`, `animationName: marquee-scroll`,
    `animation.currentTime` 8207ms, each at a distinct non-zero `translateX` (−20.8 / −8.2 / −6.5 px).
  - search spinner: probe with `.spin.motion-always` → `svelte-ogmlmo-spin`, running, real rotation matrix;
    control probe with `.spin` alone → `animationName: none`. The hatch is what makes the difference.
  - nowbar spinner: `.np-spin.motion-always` → `svelte-1sudk8r-np-spin` running; control → `none`.
  - `pnpm check` 0 errors / `pnpm test` 90 files, 1616 tests passing.
  - Console errors are pre-existing sandbox network noise (cloudflareinsights CORS, iTunes CORS, CN
    upstream 502/500) — none from this change.

## Follow-up (same session): loader rails at full speed

User asked for the indeterminate loader rail to run at full speed too, not just to stop being frozen.

- Deleted the `@media (prefers-reduced-motion: reduce) { .sliver { animation-duration: 2.2s } }` slowdown.
- **Found a second, missed copy.** `NowPlaying.svelte` has its own top loader rail that reuses the
  Nowbar's `np-prog indet` / `.sliver` class names verbatim, with its own duplicate rule set and its own
  reduced-motion slowdown. It had NOT been given `.motion-always` in the first pass, so the app's
  reduce-motion setting still froze it completely. Both copies now carry the hatch and run at 1.1s.
- Verified with the setting ON: Nowbar rail (`svelte-1sudk8r-np-indet`) and NowPlaying rail
  (`svelte-gs8b8u-np-indet`) both `1.1s`, `running`; control probes without `.motion-always` → `none`.
  A CSSOM sweep of every stylesheet found zero surviving `prefers-reduced-motion` rules matching
  `.sliver`. `pnpm check` clean, 95 files / 1734 tests passing.
- Deliberately left alone: the skeleton shimmers (`.sk::after`, `.skel .art::after`) still stop under
  reduce-motion. The grey placeholder block already carries the "loading" meaning there; the sweep on top
  is decoration, unlike a spinner where the motion IS the signal.

- note: an early sample showed 0 `.marquee-on` even on overflowing titles. That was the Browser pane being
  hidden (`document.hidden`), which pauses rAF and ResizeObserver delivery so the action's `remeasure()`
  never ran. It resolved as soon as the pane was visible; not an app bug and not caused by this change.
  `matchMedia('(prefers-reduced-motion: reduce)')` was `false` in the test browser, which also confirms
  removing the JS gate could not have altered behaviour there.
