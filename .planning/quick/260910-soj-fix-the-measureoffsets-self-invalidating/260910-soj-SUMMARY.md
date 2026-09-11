---
phase: quick-260910-soj
plan: 01
subsystem: ui-nowplaying
tags: [svelte5, runes, effect-loop, untrack, nowplaying, bugfix]
requires: []
provides:
  - "measureOffsets() single-assignment invariant (never reads the $state it writes)"
  - "half-rest $effect dependency set reduced to sheetState / sheetDragging / coverEl"
affects:
  - src/lib/components/NowPlaying.svelte
tech-stack:
  added: []
  patterns:
    - "untrack() at the only reactive call site (house idiom, cf. ~639 backfillCovers, ~784 overlays.open)"
    - "compute-into-local + assign-once so no caller can self-invalidate through a shared function"
key-files:
  created: []
  modified:
    - src/lib/components/NowPlaying.svelte
decisions:
  - "Fixed at the source (single halfOffset assignment from a local) AND kept the house untrack() guard at the reactive call site; strictly redundant today, kept because this file has a documented freeze history"
  - "Deferred onSettled closures (transitionend / double-rAF / 340ms fallback) deliberately NOT wrapped — they run outside any reaction and register no dependencies"
metrics:
  duration: 6 min
  completed: 2026-09-10
---

# Quick Task 260910-soj: Fix the measureOffsets Self-Invalidating Effect Summary

Broke the `effect_update_depth_exceeded` loop in `NowPlaying.svelte` by making `measureOffsets()` assign `halfOffset` exactly once from a local (it previously read back the `$state` it had just written) and by calling it under `untrack()` at the only reactive call site.

## What Was Built

Two one-line behaviour changes plus tagged decision comments, in one file:

1. **`measureOffsets()`** (`src/lib/components/NowPlaying.svelte:994-1002`) — the measured value now lands in `const rawHalf`, and the clamp is the single write: `halfOffset = Math.max(20, Math.min(closedOffset - 20, rawHalf));`. The function no longer reads `halfOffset` at all, so no caller — present or future — can form a self-dependency through it, and a converging re-measure hits Svelte's equality short-circuit on one write instead of ping-ponging across two.
2. **Half-rest `$effect`** (`src/lib/components/NowPlaying.svelte:1213`) — `measureOffsets();` became `untrack(() => measureOffsets());`. The effect's dependency set is now exactly `sheetState`, `sheetDragging`, `coverEl` (all written by gesture/tap handlers, none by `measureOffsets`).
3. **Decision comments** tagged `quick-260910-soj` at both sites, recording the loop mechanism and why the deferred closures stay unwrapped. Existing comments including `BUG-2 ROOT CAUSE FIX` are intact.

Untouched as required: the two pointer-handler call sites (`startGripFromCover` ~924, `gripDown` ~1053, still bare — not reactive), `const onSettled = () => measureOffsets();`, the `transitionend` listener, the double-rAF, the 340ms fallback and the cleanup (BUG-2 mechanism byte-identical), `halfOffset` still `$state(150)`, `closedOffset` still a plain `300`, `player.svelte.ts` zero diff.

## Key Decisions

**Both one-liners, not one.** The source fix (single assignment) is the root-cause fix in the shared function — the lazy fix that covers every caller. The `untrack()` is the house idiom at the reactive call site: it makes the dependency set explicit and stays correct if someone later adds a reactive read inside `measureOffsets`. It costs one token in a file with three documented loop classes behind it.

**Deferred closures left bare.** `onSettled` is invoked from `transitionend` / rAF / `setTimeout` tasks where `active_reaction` is null, so its reads register no dependencies. Wrapping them would be noise.

## Verification Performed

| Gate | Result |
|------|--------|
| `pnpm check` | `COMPLETED 4413 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| `pnpm test` | `Test Files 105 passed (105)` / `Tests 1956 passed (1956)` — 8.85s |
| Grep gate: non-comment `halfOffset =` inside `measureOffsets` | `1` |
| Grep gate: `halfOffset))` readback inside `measureOffsets` | absent |
| Grep gate: `untrack(() => measureOffsets())` | `1` |
| Grep gate: bare `^\t\tmeasureOffsets();` (pointer handlers) | `2` |
| Grep gate: `const onSettled = () => measureOffsets();` | present |
| Grep gate: `let halfOffset = $state(150)` / `let closedOffset = 300;` | both present |
| Grep gate: `BUG-2 ROOT CAUSE FIX` / `quick-260910-soj` | present (soj tag x2) |
| Scope gate: `git diff --name-only HEAD -- src` | `src/lib/components/NowPlaying.svelte` only |
| Post-commit deletion check | no files deleted |

All gates were run and their real output observed. The regression suite has no node-testable surface for this change (it is a Svelte reactivity/DOM-measurement path under the single non-jsdom Vitest project) — the suite is regression evidence only.

**NOT verified here (deliberately deferred):** Task 2's in-app behavioural checkpoint — no `effect_update_depth_exceeded` when resting in half via tap and via grip, `.rel-row` count > 0 with 0 skeleton rows, and `|sheet.top - transport.bottom| <= 1px` on the tap path and after a cover reflow. Per the executor's instructions the orchestrator runs the browser verification itself; no dev server was started here. The rAF path of the BUG-2 re-measure and the visual animation remain unconfirmable in a sandbox pane with frozen `requestAnimationFrame` and `visibilityState === "hidden"` regardless of who drives the browser.

## Deviations from Plan

None - plan executed exactly as written. Task 2 (`checkpoint:human-verify`) was skipped by explicit orchestrator instruction, not by executor judgement.

## Known Stubs

`applyHalfInset()` (~1293 at plan time) is a bare `return;` stub and nothing sets `--sheet-half-top`, so the half-open sheet rests via normal flow rather than via `halfOffset`. Pre-existing, recorded at plan time as out of scope, untouched here. Consequence: `halfOffset` currently has no reactive consumer — it only feeds the imperative drag/snap math through `offsetFor`. It was kept `$state` per the plan constraint; proving the reactivity unnecessary is a separate task.

## Commits

- `0e39660` — `fix(quick-260910-soj): stop the half-rest $effect self-invalidating via measureOffsets`

## Self-Check: PASSED

- `src/lib/components/NowPlaying.svelte` — FOUND
- commit `0e39660` — FOUND in `git log --all`
- unrelated working-tree changes (`.gitignore`, `CLAUDE.md`, `.planning/HANDOFF.json`, `docs/agents/`, phase-31 `.gitkeep`) left unstaged and uncommitted, as required
