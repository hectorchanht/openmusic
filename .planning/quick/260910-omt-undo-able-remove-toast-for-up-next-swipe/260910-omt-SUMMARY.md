---
phase: quick-260910-omt
plan: 01
subsystem: player-queue / feedback
tags: [toast, undo, up-next, swipe, i18n]
requires: [quick-260910-nx6]
provides: [QueueRemoval, player.restoreToQueue, toast.action, toast.act, toast.dismiss]
affects: [src/lib/stores/player.svelte.ts, src/lib/stores/toast.svelte.ts, src/lib/components/ToastHost.svelte, src/lib/components/NowPlaying.svelte]
tech-stack:
  added: []
  patterns: [receipt-and-inverse, supersede-drops-pending-action, idempotent-restore]
key-files:
  created:
    - src/lib/stores/toast.svelte.test.ts
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/stores/toast.svelte.ts
    - src/lib/components/ToastHost.svelte
    - src/lib/components/NowPlaying.svelte
    - src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - "Action toasts live 5000ms; plain toasts keep the locked 2000ms default"
  - "A superseding toast DISCARDS a pending action rather than firing it"
  - "restoreToQueue lifts removedUids only when THIS removal introduced the exclusion"
metrics:
  duration: 9 min
  completed: 2026-09-10
---

# Quick 260910-omt: Undo-able Remove Toast for Up Next Swipe Summary

Swipe-left on an Up Next row now raises a "Removed from queue · Undo" toast whose Undo reverses the removal exactly — original queue index, manual pin, and the D-10 session exclusion.

## What Was Built

**Task 1 — receipt + inverse (commit `63ca698`, TDD)**
`removeFromQueue(uid)` now returns `QueueRemoval | null` (`{track, index, wasManual, wasExcluded}`), capturing the prior side-state before it mutates. `restoreToQueue(r)` re-splices at the original index (clamped to the queue length), lifts `removedUids` only when that removal introduced the exclusion, restores the manual pin only if one existed, and is idempotent via a uid-present check. `null` is returned for the current row (CR-01 preserved) and for a uid not in the queue.

**Task 2 — toast action (commit `216d6c9`, TDD)**
`toast.show(msg, opts?)` gained an optional `action: {label, run}` and `duration`. Duration is `opts.duration ?? (action ? 5000 : 2000)`. `action` is reassigned on every `show`, so a superseding toast discards a pending undo — it can never fire late. `act()` dismisses before running (double-tap safe); `dismiss()` clears timer + msg + action. `ToastHost.svelte` renders a real focusable `<button>` inside the existing `role="status"` live region, text content only (no `{@html}`, T-23-01), styled from `+layout.svelte`'s `.notice-toast .retry` (untouched).

**Task 3 — wiring + i18n (commit `2f74a14`)**
`queueSwipeRemove` shows the toast with `run: () => player.restoreToQueue(r)`; the closure lives in the UI layer over the receipt only, never over private player state. `toast.removedFromQueue` + `toast.undo` added to all 15 locales with real translations, double quotes, placed after `toast.addedToQueue`.

## Verification (observed)

- `pnpm vitest --run src/lib/stores/player.svelte.test.ts` → **248 passed**, 0 failed (RED first: 8 failures before the implementation).
- `pnpm vitest --run src/lib/stores/toast.svelte.test.ts` → **7 passed** (RED first: 7/7 failing).
- `pnpm check` → `4407 FILES 0 ERRORS 0 WARNINGS` — proves all 42 pre-existing `toast.show(msg)` sites compile unchanged.
- `pnpm test` → **102 files / 1930 tests passed**, including the 15-locale `i18n.test.ts` parity guard.
- Locale key count: every one of the 15 locale files has exactly one `"toast.undo"`.

**Not verified here:** the in-app behavioural checkpoint (Task 4, steps 1-7) — deliberately skipped per the execution constraints; the orchestrator runs the browser verification. No dev server was started, nothing pushed, deployed, or built as an APK.

## Deviations from Plan

**1. [Rule 1 - Bug] Two pre-existing tests removed a uid that was never in the queue**
- **Found during:** Task 1 (GREEN)
- **Issue:** With the new `index === -1 → return null` early return, `removeFromQueue` no longer adds a non-queued uid to `removedUids` or calls `persist()`. Two existing tests depended on the old behaviour: the "not written to the persisted snapshot" test got `null` from localStorage, and the ensureAhead `have`-set test only passed by cross-test `removedUids` leakage from an earlier test that used the same uid.
- **Fix:** Both tests now put the track in the queue before removing it — the real swipe path, and no longer leakage-dependent. Behaviour unchanged for every production caller: the sole call site (`NowPlaying.svelte:675`) always passes a uid that is a rendered queue row.
- **Files modified:** `src/lib/stores/player.svelte.test.ts`
- **Commit:** `63ca698`

**2. [Rule 3 - Blocking] Task 3's verify grep is over-broad**
- **Found during:** Task 3
- **Issue:** `grep -c '"toast.undo"' src/lib/i18n/*.ts | grep -vc ':1$'` prints **4**, not 0 — the glob also matches `index.ts`, `detect.ts`, `detect.test.ts` and `i18n.test.ts`, none of which are locale dictionaries.
- **Fix:** Verified the intended property directly instead — all 15 locale files carry exactly one `"toast.undo"`, and `i18n.test.ts` (the real parity guard) is green.
- **Files modified:** none

**3. [Rule 2 - Accessibility] Action button tap target**
- **Found during:** Task 2
- **Issue:** Copying `.retry`'s `5px 14px` padding gives a ~28px-tall target, below the plan's own ≥32px requirement.
- **Fix:** `padding: 8px 14px` + `min-height: 32px`; every other value byte-identical to `.retry`.
- **Files modified:** `src/lib/components/ToastHost.svelte`
- **Commit:** `216d6c9`

## Threat Flags

None — no new network surface, no new dependencies (T-omt-SC holds). T-omt-01/02/03 all mitigated as planned: text-content only, supersede clears `action` plus idempotent index-clamped restore, and `act()` dismisses before running.

## Self-Check: PASSED

- FOUND: `src/lib/stores/toast.svelte.test.ts`
- FOUND commits: `63ca698`, `216d6c9`, `2f74a14`
- No file deletions in any of the three commits.
- Working tree: only the pre-existing unrelated changes (`.gitignore`, `CLAUDE.md`, `.planning/HANDOFF.json`, `docs/agents/`, phase-31 `.gitkeep`) remain unstaged, as required.
