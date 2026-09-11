---
phase: quick-260910-tqw
plan: 01
subsystem: ui
tags: [svelte5, css, nowplaying, sheet, layout, dead-code]

requires:
  - phase: quick-260910-soj
    provides: the non-self-invalidating half-rest $effect (untrack(measureOffsets)) this change must not disturb
provides:
  - ".np.reflow .transport { margin-bottom: 0; } — the half-open sheet rests flush against the transport row"
  - "transition: margin 0.32s cubic-bezier(.22,1,.36,1) on .transport — the collapse glides on the .cover/.meta reflow curve instead of hitching at t=0"
  - "the inert half-inset path removed: applyHalfInset() + both call sites, the style:inset half branch, the .sheet.half CSS-var inset fallback"
  - "in-file decision record: the sheet is static since f251ed0, so every inset-based design is a no-op"
affects: [NowPlaying sheet gestures, half/full reflow, any future sheet-positioning work]

tech-stack:
  added: []
  patterns:
    - "State-class CSS override: reuse the existing class:reflow hook for per-state layout instead of adding JS/inline style"

key-files:
  created: []
  modified:
    - src/lib/components/NowPlaying.svelte

key-decisions:
  - "The 22px gap was .transport's bottom margin (76ade46), not an inset — collapse it at its source in .reflow rather than compensating with .sheet.half { margin-top: -22px }"
  - "The sheet is position: static in every state since f251ed0, so inset/--sheet-half-top designs are layout no-ops; the whole path was deleted rather than un-stubbed"
  - "Transition the margin on .meta's exact 0.32s cubic-bezier(.22,1,.36,1) — margin is outside the border box, so transportEl.getBoundingClientRect().bottom (BUG-2's measurement) is unaffected"
  - "Zero reactive change — no new $effect/$state, no template read of halfOffset; a pure CSS rule keyed on an existing class cannot form a dependency cycle"

patterns-established:
  - "Before designing around a positioning property, verify the element is positioned — two prior diagnoses assumed the inset path was live"

requirements-completed: [quick-260910-tqw]

duration: 9min
completed: 2026-09-10
---

# Quick 260910-tqw: Flush Half-Open Sheet Summary

**The half-open Now Playing sheet now rests flush against the transport row by collapsing `.transport`'s 22px bottom margin in `.np.reflow` (transitioned on the cover-reflow curve), and the inert `applyHalfInset()` / `--sheet-half-top` inset machinery that had misled two diagnoses is deleted.**

## Performance

- **Duration:** ~9 min
- **Tasks:** 1 of 2 (task 2 is the browser checkpoint — deferred to the orchestrator by instruction)
- **Files modified:** 1 (`src/lib/components/NowPlaying.svelte`, +22/−26)
- **Commit:** `0654c4f`

## Accomplishments

1. **`.np.reflow .transport { margin-bottom: 0; }`** — added directly after `.np.reflow .meta`, with a `quick-260910-tqw FLUSH HALF REST` decision block recording: the sheet is a static flex item following `.np-top` in normal flow (`position: absolute` removed in f251ed0), so the only thing between `transport.bottom` and `sheet.top` is that margin; 76ade46 moved the grip's 16px `padding-top` into it (10px → 22px) to keep the CLOSED peek, which also pushed the half sheet down; collapsing it in `.reflow` makes half flush, leaves CLOSED at 22px, and is moot in full (`.np.fullshrink` hides `.transport`).
2. **`.transport` gained `transition: margin 0.32s cubic-bezier(.22,1,.36,1)`** — byte-identical curve/duration to `.meta`, so the collapse settles with the cover/meta reflow instead of snapping at t=0. `margin: 10px 4px 22px` kept (CLOSED peek unchanged).
3. **Inert machinery retired** — `applyHalfInset()` (stub + commented body), its two call sites (`gripUp`'s `snapTimer`, `selectTab`'s 30ms `setTimeout` + its two comment lines), the `style:inset` half branch (collapsed to `style:inset={sheetState === 'full' ? '0' : undefined}`, full output byte-identical), and `.sheet.half`'s `inset: var(--sheet-half-top, 260px) 0 0 0;` + stale `halfSheetTop()` comment. `grep` for `applyHalfInset` and `sheet-half-top` across `src/` returns nothing.
4. **Both `/* position: absolute; */` records kept** (f251ed0's decision history), and `.sheet.half`'s leading comment extended with the `quick-260910-tqw` note explaining why `inset` cannot move the element.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Comment wording adjusted to satisfy the plan's own grep gate**

- **Found during:** Task 1, step 3e (and step 2)
- **Issue:** The plan's `<action>` text asked the new comments to name `applyHalfInset()` and `--sheet-half-top` literally, but its `<verify>` gate asserts `grep -c 'applyHalfInset'` = 0 and `grep -c 'sheet-half-top'` = 0 file-wide. Writing the tokens in a comment would have failed the gate the plan itself specifies.
- **Fix:** Same decision recorded without the literal identifiers — "df3221d's inset-writing stub" and "the CSS-var sheet-top fallback and the JS that wrote it". Semantics preserved; gate passes.
- **Files modified:** `src/lib/components/NowPlaying.svelte`
- **Commit:** `0654c4f`

No other deviations. No architectural changes, no dependency changes.

## Verification — observed output

All commands run in `/Users/laichan/code/tung/openmusic`.

**Grep gates** (each value observed, not assumed):

| Gate | Expected | Observed |
|---|---|---|
| `applyHalfInset` occurrences | 0 | **0** |
| `sheet-half-top` occurrences | 0 | **0** |
| `.np.reflow .transport { margin-bottom: 0; }` | 1 | **1** |
| `margin: 10px 4px 22px; transition: margin 0.32s cubic-bezier(.22,1,.36,1); }` | present | **1** |
| `style:inset={sheetState === 'full' ? '0' : undefined}` | 1 | **1** |
| `/* position: absolute; */` | 2 | **2** |
| `quick-260910-tqw` tag | ≥ 2 | **3** |
| `untrack(() => measureOffsets())` | present | **1** |
| `const onSettled = () => measureOffsets();` | present | **1** |
| `BUG-2 ROOT CAUSE FIX` | present | **1** |
| `quick-260910-soj` | present | **2** |
| `let halfOffset = $state(150)` | present | **1** |
| `halfOffset =` writes inside `measureOffsets` | 1 | **1** |
| added lines containing `$effect(` | 0 | **0** |
| added lines containing `$state(`/`$state<` | 0 | **0** |
| files changed under `src/` | only `NowPlaying.svelte` | **`src/lib/components/NowPlaying.svelte`** |

**`pnpm check`** → `COMPLETED 4413 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` (also proves no dangling `applyHalfInset` reference survived).

**`pnpm test`** → `Test Files 105 passed (105)` / `Tests 1956 passed (1956)`, duration 8.86s. Regression only — this change is CSS plus deletions with no node-testable surface.

**Post-commit deletion check** → `git diff --diff-filter=D --name-only HEAD~1 HEAD` empty; working tree still holds only the pre-existing unrelated changes (`.gitignore`, `CLAUDE.md`, `.planning/HANDOFF.json`, `docs/agents/`, the phase-31 `.gitkeep`), none staged.

## Not verified here (deferred to the orchestrator)

Task 2's in-app behavioural checkpoint was **skipped by instruction** — the orchestrator runs the browser verification itself. Nothing below has been observed by this executor:

- half rests within 1px of `transport.bottom` via the Related-tab tap path and the grip path
- CLOSED still measures a 22px gap and `marginBottom: '22px'`
- no `effect_update_depth_exceeded` in the console; `.rel-row > 0` with 0 skeleton rows (soj regression check)
- the real-browser glide of the 22px collapse alongside the cover reflow (the sandbox pane freezes `requestAnimationFrame`, so transitions never advance there)

No dev server was started, nothing was pushed, no deploy, no APK build.

## Assumption Drift (advisory)

**The plan's step-3e/step-2 comment wording vs. its own verify gate.**

- **Found during:** Task 1
- **Planned:** comments naming `applyHalfInset()` and `--sheet-half-top` explicitly, as the `<action>` prose dictates.
- **Actual:** the identifiers cannot appear anywhere in the file — the plan's `<verify>` requires 0 occurrences of each.
- **Why it matters:** anyone re-reading the plan will find the action text and the gate mutually exclusive; the gate was treated as authoritative. Advisory only — no scope or behaviour change.

## Self-Check: PASSED

- `src/lib/components/NowPlaying.svelte` exists and contains the new rule (verified by the grep table above).
- Commit `0654c4f` exists: `git log --oneline -1` → `0654c4f fix(quick-260910-tqw): rest the half-open sheet flush against the transport row`.
- `.planning/quick/260910-tqw-restore-the-flush-half-open-sheet-inset/260910-tqw-SUMMARY.md` written (this file, left uncommitted for the orchestrator's docs commit).
