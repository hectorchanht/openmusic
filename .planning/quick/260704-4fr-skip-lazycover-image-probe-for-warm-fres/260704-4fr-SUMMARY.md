---
phase: quick-260704-4fr
plan: 01
subsystem: cover-cache / lazyCover
tags: [performance, cover-cache, lazyCover, optimization-backlog-8]
requires:
  - cover-cache {u,t} write-timestamp shape (quick-260704-2xq)
provides:
  - coverAgeByUidOrName pure freshness reader (age-in-ms or null)
  - FRESH_MS-gated confirmed-fresh probe-skip in lazyCover resolveCoverForRow step 1
affects:
  - src/lib/services/cover-cache.ts
  - src/lib/actions/lazyCover.ts
tech-stack:
  added: []
  patterns:
    - raw-age reader (consumer owns the freshness threshold; TTL stays private to cover-cache)
    - confirmed-fresh-only fast path (null/expired/legacy age keeps the self-heal probe)
key-files:
  created: []
  modified:
    - src/lib/services/cover-cache.ts
    - src/lib/services/cover-cache.test.ts
    - src/lib/actions/lazyCover.ts
    - src/lib/actions/lazyCover.test.ts
decisions:
  - "coverAgeByUidOrName returns a RAW AGE (ms), not a boolean, so lazyCover owns the FRESH_MS window and the 14d TTL constant stays private to cover-cache."
  - "FRESH_MS = 24h — a browsing-session + same-day-revisit window; only a confirmed-fresh (<24h) timestamp skips the probe, everything else keeps the dead-URL self-heal."
  - "SAFETY: a null age (miss / legacy bare-string / expired / unknown) MUST take the probe path — only a confirmed-fresh timestamp skips."
metrics:
  duration: 6 min
  completed: 2026-07-03
  tasks: 2
  files: 4
---

# Phase quick-260704-4fr Plan 01: Skip lazyCover Image Probe for Warm-Fresh Covers Summary

Skips lazyCover's `new Image()` self-heal probe on a WARM+FRESH cover-cache hit (written < 24h ago), painting the cached URL immediately with zero image load — while every non-confirmed-fresh hit (null / legacy / expired / >= FRESH_MS age) keeps the existing dead-URL probe self-heal fully intact. Optimization backlog item #8, unblocked by the `{u,t}` write-timestamp shape landed in quick-260704-2xq.

## What Was Built

### Task 1 — `coverAgeByUidOrName` pure freshness reader (cover-cache.ts)
A new exported function `coverAgeByUidOrName(uid, artist, title): number | null` returning the raw age in ms (`Date.now() - t`) of the first fresh `{u,t}` hit in the SAME uid-first → name read order the URL readers use:
- **Empty-uid guard:** the uid layer is consulted only when `uid` is truthy — an empty uid never reads the shared `'uid:'` slot (mirrors `getCachedCoverByUid`).
- **Same TTL guard:** reuses `entryTime` + `TTL_MS` via a private `ageFromEntry` helper (no duplicated shape/TTL logic); an entry with `age > TTL_MS` (strict `>`, matching `readUrlFromEntry`) is a miss.
- **null** for: total miss, legacy bare-string (no `t`, freshness unknowable), or expired.
- **Pure / never-throws:** one `readRecord()` call (which swallows corrupt/unavailable storage → `{}`), no writes, no delete-on-read.

### Task 2 — Confirmed-fresh probe skip (lazyCover.ts)
In `resolveCoverForRow` step 1, after computing the https `cached` url:
- Added module-level `const FRESH_MS = 24 * 60 * 60 * 1000; // 24h` (browsing-session + same-day-revisit window; a <24h CDN cover URL is overwhelmingly still live, the 14d cache TTL is the outer bound).
- `const age = coverAgeByUidOrName(track.uid, track.artist, track.title);` — if `age !== null && age < FRESH_MS`, call `onResolved(track.uid, cached)` and return, SKIPPING the probe (zero new Image).
- Every other case (null age, or `age >= FRESH_MS`) falls through to the UNCHANGED `await probeImage(cached)` → keep-on-load / evict-both + re-resolve self-heal.
- Steps 2 (own-cover probe), 3 (resolve chain), `probeImage`, the empty-uid guard, and `onResolved` semantics are untouched.

## TDD Cycle

Both tasks followed RED → GREEN (no refactor commits needed; the minimal implementations were clean):
- **Task 1 RED** `d85f6d7`: 9 new cover-cache cases fail (`coverAgeByUidOrName not exported`), 44 pre-existing green.
- **Task 1 GREEN** `1d27986`: 53/53 cover-cache.
- **Task 2 RED** `fe405e6`: extended the cover-cache mock (new reader defaulted to null in `beforeEach` → the 13 pre-existing lazyCover tests keep the probe path); Case F fails (1 Image constructed, probe not yet gated), 14 others green.
- **Task 2 GREEN** `5f8f76a`: lazyCover 15/15, cover-cache 53/53.

## Verification (actual results)

- `pnpm vitest run src/lib/services/cover-cache.test.ts src/lib/actions/lazyCover.test.ts` → **68 passed (68)**, 2 files. The 13 pre-existing lazyCover tests stayed green (mock defaults the new reader to null → probe path).
- `pnpm check` → **0 errors / 0 warnings** (4298 files, `1783106441062 COMPLETED 4298 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`).
- `git diff --name-only` (this plan's commits `d85f6d7..HEAD` + working tree) → exactly the four allowed files: `cover-cache.ts` (+ test), `lazyCover.ts` (+ test). `cover-version.svelte.ts`, `player.svelte.ts`, `+page.svelte`, `cover-backfill.ts` are UNTOUCHED.
- No file deletions across the four code commits.

## Deviations from Plan

None. Plan executed exactly as written. (See Deferred Issues for one out-of-scope pre-existing anomaly found but intentionally NOT fixed.)

## Deferred Issues

**Pre-existing NUL byte in `lazyCover.ts` `inFlightKey`** (logged to `deferred-items.md`):
- The empty-uid de-dupe key template literal contains a literal NUL byte instead of a space: `` `name:${track.artist}\x00${track.title}` ``. This causes git/grep to treat `lazyCover.ts` as binary (`git show --stat` shows `Bin 7940 -> 9836 bytes`, no line diffs).
- **Pre-existing** — verified present at `d85f6d7^` / `HEAD^` before this plan; the `inFlightKey` line is OUTSIDE this plan's diff (my change only touched step 1, the import, and `FRESH_MS`).
- **Impact:** cosmetic/robustness only — the NUL is a de-dupe map key, never rendered or networked; distinct-song stub rows still de-dupe correctly. No effect on covers, playback, or the fast-path change; `pnpm check` and vitest both pass on the file.
- **Not auto-fixed:** out of scope (hard guardrail restricts this plan to the warm-fresh fast path; the NUL is in an unrelated pre-existing line). Suggested as a standalone one-char fix in a future quick task.

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired data sources introduced.

## Accepted Trade-off (documented in code — T-4fr-02)

A fresh entry whose CDN URL dies WITHIN the FRESH_MS window will not self-heal via lazyCover until it ages past FRESH_MS — but `player.healCover` (now-playing) and later visits still catch it. This is the intended, bounded, cosmetic cost of skipping the warm-row probe. The `isHttps` gate before `onResolved` is unchanged (T-4fr-01 / T-rvy-01 posture preserved): a tampered localStorage value can at worst be a non-loading https image, never a script/CSS-injection vector.

## Commits

- `d85f6d7` test(quick-260704-4fr): add failing tests for coverAgeByUidOrName freshness reader
- `1d27986` feat(quick-260704-4fr): add coverAgeByUidOrName pure freshness reader
- `fe405e6` test(quick-260704-4fr): add fresh-skip / stale-probe cases + extend cover-cache mock
- `5f8f76a` feat(quick-260704-4fr): skip lazyCover cache-hit probe for warm-fresh covers

## Self-Check: PASSED

All four code files + SUMMARY.md + deferred-items.md exist on disk; all four commits (`d85f6d7`, `1d27986`, `fe405e6`, `5f8f76a`) exist in git history.
