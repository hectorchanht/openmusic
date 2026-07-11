---
quick_id: 260712-4xg
slug: fix-versionpicker-mobile-scroll-now-play
date: 2026-07-11
status: complete
tasks_completed: 2
commits:
  - 3df0d68 fix(quick-260712-4xg): dragClose scroll-aware so full-height sheets scroll
  - cc32c2d fix(quick-260712-4xg): resolve() keeps the picked version's title
key_files:
  modified:
    - src/lib/actions/dragClose.ts
    - src/lib/sources/kuwo.ts
    - src/lib/sources/qq.ts
    - src/lib/sources/joox.ts
---

# Quick Task 260712-4xg — Summary

Fixed two VersionPicker / now-playing issues.

## Task 1 — mobile sheet scroll (dragClose)
`dragClose` set `touch-action:none` on the sheet node, which is also the
`overflow-y:auto` scroller — native touch scroll was disabled and every vertical
swipe was consumed as drag-to-close, so a full-height version list was unreachable.
Made the action scroll-aware: `touch-action:pan-y` + `overscroll-behavior:contain`,
and a close-drag only starts from the top of the node's own scroll (`scrollTop<=0`)
pulling down; otherwise the browser scrolls the content. Shared action → also fixes
TrackMenu, SleepTimerSheet, and the album playlist picker. Commit `3df0d68`.

## Task 2 — now-playing uses the picked version's name
kuwo/qq/joox `resolve()` overwrote the title with the upstream detail name, so
picking a version reverted now-playing to the source's canonical name. Made them
prefer the existing title (`track.title || d.<name>`), matching netease.resolve
which never overwrote it. Commit `cc32c2d`.

## Verification
- `pnpm check`: 0 errors, 0 warnings.
- `pnpm test`: 1224 passed (kuwo/qq/joox/netease/variants/dedupe green — no test
  encoded the old title-overwrite behavior).
- **Device UAT still required** (sandbox: no CN upstream + no touch): scroll a
  full-height version list on a phone; pick a cross-source version and confirm
  now-playing shows the picked version's name.
