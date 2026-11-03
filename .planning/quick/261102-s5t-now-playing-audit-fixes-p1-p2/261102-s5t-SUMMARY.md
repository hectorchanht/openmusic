---
quick_id: 261102-s5t
status: complete
commit: 3066c810
---

# Quick 261102-s5t — Summary

Fixed every P1 and P2 finding from the 2026-11-02 `/impeccable audit` of Now Playing (12/20).

## Done
- **Hit areas:** `.transport .t` + download slot, header `.icon` (38→44, hover gated), `.mv-icon`
  (44px, `margin-block: -5px` keeps the title row height; hover gated), Up-Next `.grip-handle` 44px.
  Scrubber: 44px transparent `::after` band scoped to `.prog` in NowPlaying (Nowbar untouched).
- **Semantics:** mobile subnav is `role="tablist"` (div, was nav) with `role="tab"` + `aria-selected`;
  wide Comments/Related/About toggle `aria-pressed`; scrubber `aria-valuetext`; overlay root is a
  `<div role="dialog" aria-modal="true">` named `nowplaying.nowPlaying` (section→div: dialog role is
  invalid on a sectioning element, svelte-check warned).
- **Reduced motion:** `flyMs` derived (0 under app flag or OS); lyric anchor + Up-Next
  scroll-to-current use `behavior: 'auto'` when reduced.
- **Tokens:** new `--color-danger-text` (dark `#ff7a90`, light `#c62a47`); `.np-error` and
  `.dc.unavailable` use it. Volume pill on `--color-surface-2`, range track muted 30%, hover on
  `--color-surface`. Hero `.play` inverts on light theme. Up-Next playing tint via
  `color-mix(--color-primary 15%)`. `--color-accent` (undefined anywhere → always red) removed:
  MV icon on = primary, SongRow `.mv-tag` + NpAbout links = neutral tokens. `.tr-hint` muted.
- **RTL:** Up-Next `text-align: start`, `margin-inline-*`; comment count `inset-inline-end`.

## Deliberately not changed
- `.np-volbtn` stays 34px: desktop-only DOM behind `(hover: hover)`, above the 24px WCAG floor.
- P3 items (invalid `border-radius: none` / negative padding, `will-change` at rest, lyric tab stops).

## Verification
- `pnpm check`: 0 errors, 31 warnings (identical to baseline; the one new warning was fixed).
- `pnpm test`: 241 files / 5168 tests pass.
- Not verified in a rendered browser (no dev server running during the task); light-theme and
  touch hit areas need an on-device look.
