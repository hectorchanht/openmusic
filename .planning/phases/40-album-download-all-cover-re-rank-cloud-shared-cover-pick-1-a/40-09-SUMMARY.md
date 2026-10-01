---
phase: 40-album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a
plan: 09
subsystem: cover-pick
tags: [cover-pick, rows, ui]
requires: ["40-07"]
provides: ["pin ?? crowd rung 0 on every display surface"]
affects: [SongRow, CompactRow, NpUpNext, NpRelated, NowPlaying, home page, downloads settings page]
tech-stack:
  added: []
  patterns: ["rung 0 passed IN to pickRowCover as readChosenCover(uid, artist, title)"]
key-files:
  created: []
  modified:
    - src/lib/components/SongRow.svelte
    - src/lib/components/CompactRow.svelte
    - src/lib/components/NpUpNext.svelte
    - src/lib/components/NpRelated.svelte
    - src/lib/components/NowPlaying.svelte
    - src/lib/services/row-cover.ts
    - src/routes/(app)/+page.svelte
    - src/routes/(app)/settings/downloads/+page.svelte
decisions:
  - "Display surfaces read readChosenCover (pin then crowd) at rung 0; readPinnedCover is now only used inside cover-version.svelte.ts (no component uses it any more)"
metrics:
  duration: ~6min
  completed: 2026-09-30
---

# Phase 40 Plan 09: Crowd cover on every display surface Summary

All ten display call sites swap `readPinnedCover(uid)` for `readChosenCover(uid, artist, title)` (pin, then crowd pick), so a crowd pick cached on play repaints every row, the NP hero carousel, up-next, related, home shelves and the downloads list through `coverVersion()`, with no new fetches.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Rung 0 swap in SongRow, CompactRow, NpUpNext, NpRelated, NowPlaying + row-cover.ts header | 4912784c |
| 2 | Rung 0 swap on home page (3 sites) and settings/downloads | 7345bce6 |

## Verification (observed)

- `pnpm check`: 0 errors, 12 warnings (pre-existing unused-CSS warnings in artist page).
- `pnpm exec vitest --run src/lib/services/row-cover.test.ts src/lib/components/`: 6 files, 63 tests passed.
- `pnpm test`: first run reported 1 failed / 3831 passed (failure name lost, output was tailed); four re-runs all exited 0. Treated as a pre-existing flake, not caused by these template-only edits.
- `pnpm build`: done (adapter-cloudflare).
- Acceptance greps: `readChosenCover(` count 3 on home, 1 on downloads, ≥1 in each of the five components; no `readPinnedCover(` remains outside cover-version.svelte.ts / tests.
- Not verified: the visual two-profile crowd check, which is Plan 08's checkpoint.

## Deviations from Plan

None. NowPlaying had no pin-state affordance, so `readPinnedCover` was dropped from its import entirely.

Note: `settings/downloads` now reads `readChosenCover(...) ?? readCoverByUidOrName(...)`. `readCoverByUidOrName` already starts with `readChosenCover` (40-07), so the explicit rung is redundant but harmless. It is kept because the plan asks for it.

## Self-Check: PASSED
- Commits 4912784c and 7345bce6 present in git log.
- All 8 modified files exist.
