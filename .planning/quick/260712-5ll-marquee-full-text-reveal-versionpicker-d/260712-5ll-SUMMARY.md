---
quick_id: 260712-5ll
slug: marquee-full-text-reveal-versionpicker-d
date: 2026-07-12
status: complete
tasks_completed: 2
commits:
  - 130f9cb fix(quick-260712-5ll): marquee scrolls at constant readable speed
  - 3966f48 fix(quick-260712-5ll): VersionPicker drops source chip, marquees song name
key_files:
  modified:
    - src/lib/actions/marquee.ts
    - src/app.css
    - src/lib/actions/marquee.test.ts
    - src/lib/components/VersionPicker.svelte
---

# Quick Task 260712-5ll — Summary

## Task 1 — marquee reveal (readability)
Measured the marquee in-browser against the app's real CSS: `dx = scrollWidth - clientWidth` is
correct and `translateX(-dx)` reveals the full tail on both a plain clip and the NowPlaying
`.title` structure. The text was fully scrolling — just too fast to read at the fixed 8s loop.
Made the duration proportional (`marqueeDurationMs`, 2*overflow/120px/s, clamped 5–20s) so every
title scrolls at a constant readable speed; `use:marquee` sets `--marquee-dur`, `app.css` reads it.
Commit `130f9cb`.

## Task 2 — VersionPicker
Removed the source chip (+ `sourceLabel` + unused `SOURCES` import); the song name now takes the
full width and marquees when it overflows. Kept the version tag + artist/album subtitle so
cross-source variants stay distinguishable. Commit `3966f48`.

## Verification
- Empirical in-browser marquee measurement (synthetic DOM): dx correct, full tail revealed,
  `--marquee-dur` drives `animation-duration`.
- `marquee.test.ts`: **13 passed** (new `marqueeDurationMs` proportional/clamp/monotonic tests).
- `pnpm check`: **0 errors / 0 warnings** on the committed files (verified before an unrelated
  CONCURRENT session's mid-edit to `Nowbar.svelte` — an unbalanced `{#key}` — temporarily broke the
  shared working tree / dev server. That file + `charts/tags/[tag]/+page.svelte` are NOT part of this
  task and were left untouched; my commits used explicit paths only.)
- **Device UAT still needed**: the version modal marquee requires a real multi-source track (no CN
  upstream reachable in the sandbox).
