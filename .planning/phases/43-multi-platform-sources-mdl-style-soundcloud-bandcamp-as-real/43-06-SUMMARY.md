---
phase: 43-multi-platform-sources-mdl-style-soundcloud-bandcamp-as-real
plan: 06
subsystem: player
tags: [player, notice, i18n]
requires: ["43-01 (walkSource stamps Track.versionMismatch)"]
provides: ["PlayerNotice.kind 'version'", "toast.mayNotBeOriginal in 15 locales"]
affects: [src/lib/stores/player.svelte.ts, "src/routes/(app)/+layout.svelte", src/lib/i18n/*]
tech-stack:
  added: []
  patterns: ["once-per-uid notice Set + WR-04 auto-clear window"]
key-files:
  created: []
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/routes/(app)/+layout.svelte
    - src/lib/i18n/{ar,de,en,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - "versionNotified is re-armed only by the manual full-recovery reset, not on the `playing` event (corruptNotified's other clear site) — clearing on every real output would re-toast the same uid on every play"
metrics:
  duration: ~10min
  completed: 2026-11-05
---

# Phase 43 Plan 06: Version-mismatch notice Summary

play() now emits `notice = { kind:'version', msg:'toast.mayNotBeOriginal', title, artist }` once per uid when the resolved track carries `versionMismatch` (any `noticeOnAutoPick` source's notable-mismatch pick). The layout host shows it as an auto-dismissing toast in every locale, and playback keeps going.

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 (RED) | Failing store tests (4 cases) | d5a8eb9b |
| 1 (GREEN) | `'version'` kind + `versionNotified` + emission after the post-resolve gen-check, 2.5s auto-clear | 6081826d |
| 2 | Layout host branch + `toast.mayNotBeOriginal` in 15 locales | 2564ec69 |

## Verification (observed)
- `vitest --run player.svelte.test.ts i18n.test.ts`: 426/426 passed
- `pnpm check`: 0 errors (18 pre-existing warnings)
- 15 locale files have the key, 0 single-quoted lines, 15 contain `{title}`; `n.kind === 'version'` appears once in +layout.svelte

## Deviations from Plan

**1. [Rule 1 - Bug] versionNotified cleared at only one of the two corruptNotified sites**
- **Found during:** Task 1
- **Issue:** The plan said to clear at both sites, but one of them (~2653) is the `playing` event handler. Clearing there re-arms the set on every successful playback, so a second play() of the same uid would toast again. That breaks the once-per-uid must-have.
- **Fix:** Clear only at the manual full-recovery reset (~5879).
- **Commit:** 6081826d

**2. Test isolation:** each test gets its own songid. Repeated plays of one uid across tests set off the src re-drive brake (a loop-guard `stopped` notice). This was only a test harness problem; product code is unchanged.

## TDD Gate Compliance
RED `test(43-06)` d5a8eb9b → GREEN `feat(43-06)` 6081826d. No refactor commit was needed.

## Threat Flags
None. Toast text goes through `t()` and `dnTitle` as plain text. No `{@html}` is used (T-43-20). Spam is capped by once-per-uid plus the 2.5s clear (T-43-21).

## Self-Check: PASSED
