---
phase: quick-260910-q5a
plan: 01
subsystem: covers
tags: [up-next, cover-cache, backfill, nowplaying]
requires: [cover-backfill, cover-version, match-key]
provides: [upnext-covers]
affects: [NowPlaying.svelte]
tech_stack:
  added: []
  patterns: ["pure .ts helper + thin runes caller", "gated $effect with abort-on-rerun", "untrack around fire-and-forget async"]
key_files:
  created:
    - src/lib/services/upnext-covers.ts
    - src/lib/services/upnext-covers.test.ts
  modified:
    - src/lib/components/NowPlaying.svelte
decisions:
  - "Up-Next covers fill through the existing backfillCovers (max 20, CAP=6 pool), never a new resolver and never per-tile use:lazyCover"
  - "The fill effect stays cache-free so it can never take a coverVersion() dependency (self-invalidation guard)"
  - "track.cover stays ahead of the shared cache in the tile read so quick-260910-piz album art always wins"
metrics:
  duration: ~12 min
  tasks: 2 of 3 (task 3 is the orchestrator-run browser checkpoint)
  completed: 2026-09-10
---

# Quick 260910-q5a: Covers for similarity-generated Up Next — Summary

Similarity-generated Up-Next rows now gain real album art: the tile reads the shared reactive cover
cache as a third rung, and one gated `$effect` runs a single capped `backfillCovers` pass (≤20 rows,
≤6 in flight) when the user actually opens the Up Next tab.

## What was built

**`src/lib/services/upnext-covers.ts`** (new, pure `.ts`, no runes / no store / no cache read):
- `UPNEXT_COVER_MAX = 20` — one attempt per generated row; the stated bound is ≤20 tier-1
  `/api/deezer/search` calls per fill, deep tiers per Deezer-miss row only. No extra throttle
  (composing local bounds on top of the `apiFetch` governor was the `api-fetch-flood-freeze` cause).
- `upNextCoverNeeds(list, max)` — skips rows already carrying an https `cover` (real source cover or
  a quick-260910-piz album seed), drops fully blank rows, de-dupes by `matchKey` (first wins), caps.
  Deliberately cache-free, which is what keeps the calling `$effect` free of a `coverVersion()` dep.
- `upNextTileCover(resolved, seeded, cached)` — `resolvedCovers[uid]` → `track.cover` → shared cache
  → null; `''` is a miss at every rung.

**`src/lib/components/NowPlaying.svelte`** (two sites):
- The `.q-art` tile renders from a new `{@const qArt = upNextTileCover(resolvedCovers[track.uid],
  track.cover, readCoverByUidOrName(track.uid, track.artist, track.title))}`. This is a reactive
  READ, not a fetch — no `use:lazyCover` was added to the Up-Next list (T-26-10-01 still holds).
- One new `$effect` beside `upNextList`: gated on `sheetState !== 'closed' && tab === 'queue'`, calls
  `backfillCovers(needs, { signal, onResolved: () => bumpCoverVersion(), max: UPNEXT_COVER_MAX })`
  under `untrack`, returns `() => ac.abort()` so a re-run leaves at most one live pool.

## Verification (observed, not assumed)

| Gate | Command | Observed |
|------|---------|----------|
| New unit tests (RED first) | `pnpm vitest --run src/lib/services/upnext-covers.test.ts` | RED: `Cannot find module '$lib/services/upnext-covers'`. GREEN after implementation: **8 passed (8)** |
| Typecheck | `pnpm check` | **4411 files, 0 errors, 0 warnings** |
| Full suite | `pnpm test` | **104 files, 1951 tests, all passed** (9.0s) |
| Plan grep gate | `grep -c quick-260910-q5a` / `T-26-10-01` / tile-read pattern | q5a tags **4** (≥2), `T-26-10-01` present, tile read matches |
| No new `use:lazyCover` on the list | `grep -n "use:lazyCover"` | only the pre-existing carousel `prev`/`next` cells at 1366/1385; the q-art tile has none |
| Diff is additive | `git diff -U0 \| grep '^-'` | exactly 3 removed lines — the import line and the two replaced tile lines |

**NOT verified here:** the in-app behavioural checkpoint (task 3 — live request counts, art appearing
on similarity rows, album-row non-regression, no burst while the sheet is closed). That was
explicitly reserved for the orchestrator's own browser run and was not executed by this agent.

## Deviations from Plan

None — plan executed exactly as written. No deviation rule fired.

## Threat-model compliance

- **T-q5a-01** — the tile still renders the same `background-image` path; `track.cover` rung unchanged;
  cache values come only from `backfillCovers` (https-only writer).
- **T-q5a-02** — `max: UPNEXT_COVER_MAX`, CAP=6 pool, abort-on-rerun, skip-cached + 5-min miss memo,
  tab-gated. No new throttle layered on the governor.
- **T-q5a-03** — the effect never reads `coverVersion()`; `upNextCoverNeeds` is cache-free;
  `backfillCovers` is called under `untrack`.
- **T-q5a-04** — https-covered rows are never submitted; `backfillCovers` writes the name layer only.
- **T-q5a-SC** — no new dependencies.

## Known Stubs

None.

## Self-Check: PASSED

All three files present on disk; commits `c3354bb` and `cc2584f` present in `git log`.

## Commits

- `c3354bb` feat(quick-260910-q5a): pure Up-Next cover helpers (needs filter + tile read order)
- `cc2584f` feat(quick-260910-q5a): fill Up-Next covers for similarity-generated rows

No push, no deploy, no APK build. Unrelated working-tree changes (`.gitignore`, `CLAUDE.md`,
`.planning/HANDOFF.json`, `docs/agents/`, the phase-31 `.gitkeep`) were left unstaged.
