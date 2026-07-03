---
phase: quick-260703-i7e
plan: 01
subsystem: player-engine
tags: [playback, visibility, background-audio, resume]
requires: []
provides: "player engine without foreground auto-resume; playback starts only on explicit user action or track-end auto-advance"
affects: [src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts]
tech-stack:
  added: []
  patterns: ["visibilitychange hidden-branch flush-only (no visible-branch action)"]
key-files:
  created: []
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
decisions:
  - "Foreground auto-resume (resumeOnForeground + resumeIfStalled) fully removed — caused unwanted playback more often than it recovered a genuine background stall"
metrics:
  duration: ~10 min
  completed: 2026-07-03
---

# Quick 260703-i7e: Remove On-Visible Autoplay Mechanism Summary

Removed the foreground auto-resume path (`resumeOnForeground` flag + `resumeIfStalled()` method) so a backgrounded/screen-locked tab returning to the foreground never re-issues `audio.play()` on its own; playback now starts/resumes only from explicit user action or normal track-end auto-advance. Position persistence, bfcache re-sync, external-pause respect, and re-resolve/skip logic are all untouched.

## What Changed

### Task 1 — `player.svelte.ts` (commit 355303b)
- Deleted the `resumeOnForeground` private field and its 8-line doc comment.
- Deleted the `resumeIfStalled()` method and its doc comment (its only caller was the visible branch below).
- Collapsed the `visibilitychange` listener: it still logs visibility and calls `flushPersist()` on hide (`document.hidden`), but the visible/`else` branch (the `resumeIfStalled()` call) is gone — the listener now does nothing when the tab becomes visible.
- Updated the `pause`-listener comment that referenced foreground recovery via `resumeIfStalled`: it now states background-stall recovery is no longer attempted; playback resumes only on explicit user action or normal auto-advance. External-pause RESPECT rationale kept intact.

### Task 2 — `player.svelte.test.ts` (commit 29cc5f1)
- Removed the two dead describe blocks that poked the removed private members via a cast:
  - "player — foreground resume of a background-stalled track (debug-midplay-stall-background)"
  - "player resilience — foreground resume of a background-stalled auto-advance (background-autoadvance-stall)"
- Both comment banners removed with their blocks. Adjacent tests (headphone-unplug-pause-respected, dead-tail never-stop, re-resolve-cap) left untouched.

## Verification

- `grep -c "resumeOnForeground\|resumeIfStalled"` = 0 in both files.
- `npm run check`: 0 errors, 0 warnings (4297 files).
- `npm run test`: 987 passed, 67 files. Player file: 149 passed (was 161 — 12 removed tests).
- Key link confirmed: `visibilitychange` hidden branch still calls `flushPersist()` (player.svelte.ts:1154→1162).
- Manual reasoning: no remaining code path calls `audio.play()` as a result of the tab becoming visible.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- FOUND: src/lib/stores/player.svelte.ts
- FOUND: src/lib/stores/player.svelte.test.ts
- FOUND commit: 355303b (Task 1)
- FOUND commit: 29cc5f1 (Task 2)
