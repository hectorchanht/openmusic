---
phase: quick-260910-nx6
plan: 01
subsystem: ui
tags: [svelte5, gestures, swipeAction, nowplaying, up-next, css-stacking]

requires:
  - phase: quick-260910-k45
    provides: the opaque-row root-cause fix on the sibling Related list (z-index orders, only an opaque background occludes)
  - phase: 23 (UX-04 / D-01/D-02)
    provides: the shared use:swipeAction directional gesture action
provides:
  - Up Next rows have no version-picker button at rest; the grip stays visible
  - swipe RIGHT on any Up Next row (incl. the current one) opens the VersionPicker
  - swipe LEFT removes a non-current row; a silent no-op on the currently-playing row
  - Up Next rows are opaque at rest and mid-swipe (playing / skipped / lifted variants included)
affects: [nowplaying, up-next list, any future swipe row on this list]

tech-stack:
  added: []
  patterns:
    - "Per-direction gating via an UNDEFINED callback (swipeAction's `enabled` is global, so `onSwipeLeft: undefined` disables ONE direction while keeping the other live)"
    - "Reveal-behind-opaque-row wrapper as a <span> so the row button is never nested in another button and a sibling control (grip) stays outside the sliding area"

key-files:
  created: []
  modified: [src/lib/components/NowPlaying.svelte]

key-decisions:
  - "Removed the last src/ consumer of swipeRemove (import dropped) but left src/lib/actions/swipeRemove.ts and its 11 tests in place — not in scope to delete."
  - "No toast on swipe-remove: the row disappearing is the feedback, and adding an i18n key touches 16 locale files."
  - "Current row shows no Trash reveal at all (.q-swipe.is-current .reveal-remove { display: none }) — never flash an icon for an action that cannot fire."
  - "Kept `.row.playing` generic and added a composited `.q-swipe .q-row.playing` (linear-gradient tint over var(--color-bg)) instead of editing the shared rule."
  - "Moved only the lifted drop shadow to `.q-swipe` — the wrapper's overflow:hidden would clip it off the row during a grip drag."

patterns-established:
  - "Directional swipe reveal on Up Next mirrors the Related list markup/CSS (swipe-wrap + two absolute .reveal spans + opaque row)"

requirements-completed: [QUICK-260910-NX6]

duration: 14min
completed: 2026-09-10
---

# Quick 260910-nx6: Up Next directional swipe reveal Summary

**The always-visible per-row Layers button is gone from Up Next — swipe right opens the version picker, swipe left removes (no-op on the playing row) — and the row is now genuinely opaque so the grip/reveal icons stop bleeding through the title mid-swipe.**

## Performance

- **Duration:** ~14 min
- **Tasks:** 2 of 3 executed (Task 3 = in-app behavioural probes, deliberately left to the orchestrator per the execution constraints)
- **Files modified:** 1 (`src/lib/components/NowPlaying.svelte`)

## Accomplishments

**Task 1 — markup + gesture (commit `fcebf1c`)**
- `Trash2` added to the `@lucide/svelte` import; `swipeRemove` import deleted (NowPlaying was its only `src/` consumer); `verOpenLabel` deleted with its sole consumer.
- New helpers `queueSwipeVersions(track)` / `queueSwipeRemove(track)` next to the Related-list helpers — store call + `hapticTick()` (swipeAction is a pure DOM gesture; the host fires haptics on commit, PATTERNS.md §3.3).
- `.q-row` wrapped in `<span class="swipe-wrap q-swipe" class:is-current={…}>` holding `.reveal-versions` (Layers, left) and `.reveal-remove` (Trash2, right), both `aria-hidden`. The `.grip-handle` button stays OUTSIDE the wrapper, so it never slides with the row.
- `use:swipeRemove` → `use:swipeAction={{ onSwipeRight: () => queueSwipeVersions(track), onSwipeLeft: current ? undefined : () => queueSwipeRemove(track) }}`. Verified in `swipeAction.ts:127` that the commit branch calls `onSwipeLeft?.()`, so an undefined callback is a silent no-op that still springs the row back — this is what preserves the old `enabled: uid !== current` contract (T-nx6-01) without killing swipe-right on the current row.
- `class:playing`, `class:skipped`, `use:longpress`/`onlongpress`, the skipped-retry `onclick` branch, `title`, `.q-art`, `.q-text`, `RowBadges` all byte-for-byte unchanged.

**Task 2 — CSS (same commit)**
- `.ver` rule + its `@media (hover: hover)` companion deleted; the stale "The Up-Next list (use:swipeRemove) is untouched" sentence rewritten.
- Added `.q-swipe` (position/overflow/radius + `flex:1; min-width:0`), `.q-swipe .reveal` / `.reveal-versions` / `.reveal-remove`, `.q-swipe.is-current .reveal-remove { display: none }`, and the load-bearing `.q-swipe .q-row { background: var(--color-bg); position: relative; z-index: 1 }` — placed BEFORE `@media (hover: hover) { .row:hover }` so the equal-specificity hover rule still wins.
- Three translucency leaks closed: `.q-swipe .q-row.playing` composites the same rgba tint over an opaque bg (the generic `.row.playing` is later in the cascade at equal specificity and would otherwise re-open the bleed); `.q-row.skipped` → `.q-row.skipped > *` so children dim but the button's background stays opaque; the lifted drop shadow moved from `.q-row` to `.list li.lifted .q-swipe` (the wrapper's `overflow: hidden` would clip it). `.list li.over .q-row` is inset — left alone.

Every changed line carries a `quick-260910-nx6` comment; no existing decision-ref comment (Gap 3/Gap 4 26-10, quick-260615-i9u, quick-260723, quick-260625-pzs-02, quick-260910-k45, MENU-03/D-12, T-26-10-01/02) was deleted — only sentences that became false were rewritten.

## Verification — observed results

Run from `/Users/laichan/code/tung/openmusic`:

- `pnpm check` → `COMPLETED 4406 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` (re-run after the final edit, same result).
- `pnpm test` → `Test Files 101 passed (101)`, `Tests 1916 passed (1916)`, duration 8.89s. `swipeAction.test.ts` and `swipeRemove.test.ts` untouched and green within that total.
- Grep gates: `grep -c 'swipeRemove' NowPlaying.svelte` → `0`; `grep -c 'class="ver"'` → `0`; `grep -c '\.ver\b'` → `0`; `swipe-wrap q-swipe` present; `.q-swipe .q-row { background: var(--color-bg)` present; `.q-row.skipped > *` present.
- `git diff -- src/lib/actions` → empty (swipeAction.ts / swipeRemove.ts and their tests unchanged).
- `git diff --diff-filter=D --name-only HEAD~1 HEAD` → empty (no file deletions in the commit).
- Commit `fcebf1c` stages ONLY `src/lib/components/NowPlaying.svelte`; the pre-existing dirty files (`.gitignore`, `CLAUDE.md`, `.planning/HANDOFF.json`, `docs/agents/`) were left untouched and uncommitted.

**NOT verified here (by instruction):** Task 3's six in-app behavioural probes — at-rest computed styles, mid-swipe opacity/backgroundColor and screenshots, swipe-right/left commits, current-row left no-op, and the tap/long-press/retry/reorder regressions. The orchestrator runs those in the browser. No claim is made about live gesture behaviour beyond the static/type/test evidence above. No push, no deploy, no APK build was performed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded three new comments to satisfy the plan's own grep gates**
- **Found during:** Task 1/2 verification
- **Issue:** My explanatory comments literally contained the strings `swipeRemove` and `.ver`, so the plan's `grep -c 'swipeRemove' … | grep -qx 0` and `grep -c '\.ver\b' … | grep -qx 0` gates failed on comment text alone (no code reference remained).
- **Fix:** Reworded to "the old swipe-to-remove action" / "always-visible per-row button" — same historical context, gates now report `0`.
- **Files modified:** src/lib/components/NowPlaying.svelte
- **Commit:** fcebf1c

**2. [Rule 1 - Cosmetic] Restored a blank line**
- **Found during:** diff review after Task 1
- **Issue:** Deleting the `verOpenLabel` block also swallowed the blank line before `async function openVersionPicker`.
- **Fix:** Blank line restored; `pnpm check` re-run clean.
- **Commit:** fcebf1c

### Skipped

**Task 3 (behavioural verification)** — skipped by explicit orchestrator instruction, not by choice. The plan's automated half of Task 3's verify block (`pnpm check` + `pnpm test`) was run and is green; the human/browser half is the orchestrator's.

## Assumption Drift (advisory)

**Wrapper element indentation**
- **Planned:** the plan did not specify indentation for the new wrapper.
- **Actual:** the `<span class="swipe-wrap q-swipe">` contents (reveal spans + `.q-row` button) are left at the wrapper's own indent level rather than nested one tab deeper, to keep the diff to the lines that actually changed instead of re-indenting ~45 lines of untouched markup.
- **Why:** minimises churn on a 1650-line hotspot file; purely cosmetic, zero behavioural effect.

## Known Stubs

None.

## Threat Flags

None — no new network surface, endpoint, auth path, or dependency. The one security-relevant item (T-nx6-01, the playing track cannot be removed by gesture) is implemented as planned via the undefined `onSwipeLeft`.

## Self-Check: PASSED

- `src/lib/components/NowPlaying.svelte` — FOUND
- `.planning/quick/260910-nx6-up-next-rows-hide-version-picker-behind-/260910-nx6-SUMMARY.md` — FOUND
- commit `fcebf1c` — FOUND in `git log`
