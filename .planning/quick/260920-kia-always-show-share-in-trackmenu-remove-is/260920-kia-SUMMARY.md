---
phase: quick-260920-kia
plan: 01
subsystem: ui-track-menu
tags: [share, track-menu, device-import, contract-8]
requires:
  - "src/lib/services/share.ts uidCarrier() device skip (38-D-08)"
provides:
  - "Unconditional Share row in TrackMenu for every track, catalog and device:"
affects:
  - "src/lib/components/TrackMenu.svelte"
tech-stack:
  added: []
  patterns:
    - "guard lives at the single shared chokepoint (share.ts), not duplicated per caller"
key-files:
  created: []
  modified:
    - src/lib/components/TrackMenu.svelte
decisions:
  - "quick-260920-kia supersedes the SHARE half of UI-SPEC Contract 8 (Phase 34): Share is unconditional; the `!isDevice` fork now gates DOWNLOAD ONLY"
  - "No device guard added in doShare() — the device skip stays at the one place all callers route through (share.ts uidCarrier), pinned by share.test.ts"
metrics:
  duration: 4 min
  completed: 2026-09-20
---

# Quick Task 260920-kia: Always Show Share in TrackMenu Summary

Share row in the track menu is now unconditional — the Phase 34 `{#if !isDevice}` wrapper around it is gone, because its stated rationale ("would emit a URL carrying a local uid") was already false: `songShareUrl()` builds a name-based `/song/{artist}/{title}` link and `share.ts uidCarrier()` returns `null` for `isDeviceUid()`.

## What Was Built

Single-file diff in `src/lib/components/TrackMenu.svelte` (+17/-8):

1. **Share list row** (was L1198-1202, now L1201-1211): deleted the `{#if !isDevice}` / `{/if}` pair around the single `<button class="mi" onclick={doShare}>`. The button sits at the same list position and the same tab indent as its `.mi` siblings (Sleep timer / Go to artist / Detail).
2. **Share row comment**: replaced the old "Hidden for device: entries" note with a `quick-260920-kia` supersession record — keeps the Contract 8 / header-fork reference, states the name-based-URL + `uidCarrier()` mechanism, and explicitly instructs against reintroducing a device guard in `doShare()`.
3. **Header comment** (L938-945, inside `<div class="head-actions">`): amended, not deleted. Kept the `34 (RESEARCH bites #10/#11, UI-SPEC Contract 8)` reference and the Download half's meaning; the Share half is now marked SUPERSEDED with "The `!isDevice` fork below gates DOWNLOAD ONLY". The trailing `track-menu-gate.ts` resolve-TIMING sentence is unchanged.

Untouched as planned: `const isDevice` (L97), the header Download fork, the Download list row, the `{#if isDevice}` "Don't import again" row, `doShare()`'s body and its cover resolution, `share.ts`, `share.test.ts`, i18n.

## Key Implementation Details

The reason no runtime guard was added to `doShare()` is the root-cause-over-symptom point: the device skip already exists at the single chokepoint every share caller routes through (`share.ts` `uidCarrier()`, L454: `if (!id || isDeviceUid(id.uid)) return null;`). Adding a second guard in the component would duplicate a rule that is already pinned by a test and create a second place to keep in sync.

## Verification — observed results

| Check | Command | Observed |
|---|---|---|
| Typecheck | `pnpm check` | `COMPLETED 4576 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| Share regression guard | `pnpm test -- src/lib/services/share.test.ts` | `1 passed (1)` file, `101 passed (101)` tests — includes the `device:`-uid-carries-NOTHING test |
| Guard count | `grep -n '{#if !isDevice}'` | Exactly 2 remain: L965 (header Download fork), L1084 (Download list row). Neither is adjacent to `onclick={doShare}` (L1211). |
| Diff scope | `git diff --stat` | `src/lib/components/TrackMenu.svelte | 25 +++++----` — one file, 17 insertions / 8 deletions |
| Tag present | `grep -c '260920-kia'` | 2 (header note + Share row note) |
| No deletions | `git diff --diff-filter=D HEAD~1 HEAD` | empty |

**Not verified (stated plainly, not implied):** the on-device/browser check — opening TrackMenu on an actually-imported `device:` track and observing the Share row present + Download absent. A `device:` track only exists after an Android MediaStore import, which cannot be produced in this environment, and no preview/browser tool was available to this run. The plan itself lists this as "Optional manual". What IS proven is that the template compiles, the guard is gone from the Share row only, and the carrier-free URL behaviour the change depends on is test-pinned.

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Commit | Message |
|---|---|
| `afd4609` | `fix(quick-260920-kia): always show Share in the track menu` |

## Self-Check: PASSED

- `src/lib/components/TrackMenu.svelte` — FOUND, modified, contains `260920-kia` (2 occurrences)
- Commit `afd4609` — FOUND in `git log`
- No changes outside the one planned file
