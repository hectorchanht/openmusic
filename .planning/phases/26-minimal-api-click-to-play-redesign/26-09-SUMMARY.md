---
phase: 26-minimal-api-click-to-play-redesign
plan: 09
subsystem: stores/player (up-next formation)
tags: [up-next, regenerate, never-empty, safety-net, buildDiversePicks, upnext-source, activity-log, report-callback, wr-06, queue-gen, gap-closure, vitest, tdd]

# Dependency graph
requires:
  - src/lib/stores/player.svelte.ts regenerate()/ensureAhead() — the fresh-play + grow up-next builders this plan hardens
  - src/lib/services/similar.ts buildSimilarQueue(track, excludeUids, report?) — the 26-07 report(via) callback this plan opts in to
  - src/lib/services/picks.ts buildDiversePicks(count, excludeUids?) — the diverse safety-net source (already used by ensureAhead)
  - src/lib/stores/actionLog.svelte.ts logAction — the never-throw Activity-log sink
provides:
  - src/lib/stores/player.svelte.ts regenerate() empty-result buildDiversePicks safety net (never-empty Up-Next on a fresh play)
  - src/lib/stores/player.svelte.ts upnext.source Activity-log event ({via, count}) on both the fresh-play (regenerate) and grow (ensureAhead) paths
affects: [up-next-formation, never-empty-queue, click-to-play, activity-log-verifiability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "regenerate() mirrors ensureAhead's never-stop safety net: when buildSimilarQueue returns an empty tail, fall back to buildDiversePicks(8, exclude) so a fresh play never installs an empty Up-Next (T-26-09-01)"
    - "WR-06 queueGen guard re-checked after BOTH awaits (buildSimilarQueue AND the new buildDiversePicks) — a superseding setQueue() during either await discards the stale regenerate without clobbering the explicit queue (T-26-09-02)"
    - "26-07 report(via) callback opted in: a local `let via` captures the terminal formation path ('similar'|'artist'|'lastresort'|'empty'), extended locally with 'diverse' for the safety-net branch; logAction('upnext.source', {via, count}) on the install path makes the UAT never-empty claim verifiable in Settings -> Activity log"
    - "ensureAhead threaded with the same report + upnext.source log for grow-path parity — control flow UNCHANGED (it already had its own buildDiversePicks net)"
    - "logAction spy via vi.mock importOriginal + vi.fn(actual.logAction) (mirrors the file's cover-version/removeCoverBoth spy pattern) — keeps the real actionLog singleton + throttled persist for every other call site while recording upnext.source calls"

key-files:
  created:
    - .planning/phases/26-minimal-api-click-to-play-redesign/26-09-SUMMARY.md
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts

key-decisions:
  - "Safety net is a minimal, in-spirit mirror of ensureAhead (buildDiversePicks(8, exclude)) — no new source, no control-flow rewrite. The empty-tail branch sets via='diverse' unconditionally after calling buildDiversePicks, so the log honestly records that the diverse net was engaged even if it too returns 0 (all-dry → count:0)."
  - "Both WR-06 re-checks reuse the single myQueueGen snapshot taken at the top of regenerate() (the existing WR-06 idiom); the SECOND check after the buildDiversePicks await is the only genuinely new guard, closing the tampering window T-26-09-02 opened by the added await."
  - "ensureAhead upnext.source log is gated on more.length (only log when a tail actually installs) so a dry grow does not spam a {count:0} event; regenerate logs on its successful install path (after queueWithAnchor)."
  - "Threaded ensureAhead too (the plan's OPTIONAL grow-path verifiability) because it is a zero-control-flow-change addition and gives the Activity log full up-next-formation coverage across fresh-play AND exhaust-grow — but ensureAhead's own buildDiversePicks net was left exactly as-is."

requirements-completed: [UPNEXT-01]

# Metrics
duration: 9min
completed: 2026-07-12
---

# Phase 26 Plan 09: regenerate() Never-Empty Safety Net + upnext.source Log (Gap 2) Summary

**Closes the player half of Phase-26 UAT Gap 2 (Up-Next formation hardening). `track.getSimilar` was already the primary up-next path, but `regenerate()` — which runs on EVERY fresh click-to-play in the default 'generated' mode — installed whatever `buildSimilarQueue` returned, INCLUDING `[]`, with no safety net (unlike `ensureAhead`, which falls back to `buildDiversePicks`). Combined with 26-07's CR-01 post-filter gate, this guarantees a fresh play never yields an empty Up-Next: `regenerate()` now mirrors `ensureAhead`'s `buildDiversePicks(8, exclude)` fallback when the similar tail is empty, and opts in to 26-07's `report(via)` callback to emit an `upnext.source` Activity-log event (`{via, count}`) so the UAT claim "up-next is one `track.getSimilar` call, never empty" is verifiable on device. The WR-06 `queueGen` guard is now re-checked after BOTH awaits so a stale regenerate never clobbers an explicit `setQueue()`. `ensureAhead` was threaded with the same report + log for grow-path parity (control flow unchanged). Full suite green except the pre-existing deferred `searchHistory` SSR-guard failure.**

## Performance

- **Duration:** ~9 min
- **Completed:** 2026-07-12
- **Tasks:** 1 of 1, TDD RED->GREEN (no REFACTOR needed)
- **Files:** 1 created (this SUMMARY), 2 modified

## Accomplishments

- **Task 1 (regenerate() safety net + upnext.source log), TDD `0e8d47f` (RED) -> `a795953` (GREEN):**
  - **`regenerate()`** (`src/lib/stores/player.svelte.ts`): opted in to the 26-07 `report` callback (`let via` captures the reported terminal path); after the existing WR-06 guard, if `tail.length === 0` it now applies the ensureAhead-style safety net — `buildDiversePicks(8, exclude)`, a SECOND WR-06 re-check after that await, `via = 'diverse'`. Installs `[...head, ...manualEntries, ...tail]` via `queueWithAnchor` exactly as before, then emits `logAction('upnext.source', { via, count: tail.length })` on the install path. The outer try/catch (leave-queue-as-is on throw) and every existing guard are preserved.
  - **`ensureAhead()`** (grow-path parity, optional): threaded the same `report` callback and added `logAction('upnext.source', { via, count })` (gated on `more.length`) — its existing `buildDiversePicks` net and control flow are untouched; `via='diverse'` is set when the similar path is dry.
  - **RED->GREEN:** 4 new player-store tests (`player.regenerate — never-empty safety net + upnext.source log (26-09, Gap 2)`):
    1. non-empty similar -> installs the tail, logs `upnext.source {via:'similar', count:1}`, `buildDiversePicks` NOT called;
    2. empty similar -> `buildDiversePicks(8, Set)` invoked, queue non-empty, logs `upnext.source {via:'diverse', count:1}`;
    3. WR-06 — a `setQueue()` during the `buildSimilarQueue` await discards the stale regenerate (explicit queue preserved, diverse net never reached);
    4. WR-06 — a `setQueue()` during the `buildDiversePicks` safety-net await discards the stale regenerate (the SECOND guard; explicit queue preserved).
  - Tests 2, and the two WR-06/diverse-branch assertions in 3-4 failed RED (`buildDiversePicks` never called / `upnext.source` never logged); green after the impl. Test-file wiring: a `logAction` spy via `vi.mock` importOriginal + `vi.fn(actual.logAction)` (mirrors the existing `removeCoverBoth` spy pattern).

## Verification

- `pnpm test -- src/lib/stores/player.svelte.test.ts` — 189 passed (185 existing + 4 new).
- Full `pnpm test` — 1201 passed, 1 failed (ONLY the pre-existing deferred `searchHistory.svelte.test.ts` SSR-guard failure; see Out of Scope).
- `pnpm check` — 1 error + 1 warning, BOTH pre-existing and NOT in this plan's files: the concurrent session's `swipeLike` error in `src/routes/(app)/album/[name]/+page.svelte` and the long-standing unused `.warn` CSS selector in `src/routes/(app)/search/+page.svelte`. `player.svelte.ts` / `player.svelte.test.ts` produce zero check errors.
- grep confirms `regenerate()` now carries a `buildDiversePicks` safety net AND a `logAction('upnext.source', …)` call, both inside the WR-06 `queueGen` guards (single `myQueueGen` snapshot, re-checked after each await).

## TDD Gate Compliance

RED->GREEN with verified failing assertions before implementation:
- RED commit `0e8d47f` (test file only): 3 of the 4 new tests failed as expected (`buildDiversePicks` not called on empty similar; `upnext.source` never logged; second-await guard unexercised). The 1 that passed at RED (WR-06 first-await guard) is correct-by-current-behavior — the existing guard already covered the first await; it was confirmed still-correct at GREEN (no masked pass on the load-bearing safety-net/log assertions).
- GREEN commit `a795953` (impl file only): all 189 player tests pass.
- Gate sequence present in git log: `test(26-09)` -> `feat(26-09)`.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written. The one explicitly-OPTIONAL item (threading `report` + `upnext.source` into `ensureAhead` for grow-path verifiability) was taken up; it is a zero-control-flow-change addition (ensureAhead already had its own `buildDiversePicks` net).

### Out of Scope (logged, NOT fixed)

**Pre-existing `pnpm check` error: `swipeLike` in `src/routes/(app)/album/[name]/+page.svelte`**
- Introduced by the concurrent UI session's uncommitted WIP on `main`; unrelated to this plan and explicitly flagged as not-mine in the execution brief. Not touched per the scope boundary.

**Pre-existing test failure: `searchHistory.svelte.test.ts` SSR guard (Node native `localStorage`)**
- Fails with zero involvement from this plan (Node 22+ / vitest exposes `globalThis.localStorage`, so `typeof globalThis.localStorage === 'undefined'` no longer holds). Documented in prior Phase-26 SUMMARYs. Not touched.

**Pre-existing `pnpm check` warning: unused `.warn` CSS selector in `search/+page.svelte`**
- Present before this plan; unrelated. Not touched.

## Threat Model Compliance

- **T-26-09-01** (DoS — empty Up-Next dead end on a fresh play) — mitigated: `regenerate()` gains the ensureAhead `buildDiversePicks` safety net; a fresh play's Up-Next is never left empty when any source has data (asserted by the empty-similar test).
- **T-26-09-02** (Tampering — a stale regenerate clobbering an explicit `setQueue()`) — mitigated: the WR-06 `queueGen` guard is re-checked after BOTH awaits (the existing one after `buildSimilarQueue`, plus the NEW one after `buildDiversePicks`); both WR-06 tests assert the explicit queue survives.
- **T-26-09-SC** (package installs) — n/a: no new dependency added this plan.

## Known Stubs

None. The safety net calls the real `buildDiversePicks`, the `report(via)` capture is wired end-to-end, and `upnext.source` is a real Activity-log event. No placeholder/empty-return values were introduced.

## Threat Flags

None. No new network endpoint, auth path, file access, or trust-boundary schema change — the change is entirely internal to the player store's queue-formation seam.

## State / Roadmap Handoff

Per the sequential-execution brief (a concurrent session holds UNCOMMITTED WIP on `.planning/STATE.md` and `.planning/HANDOFF.json`), STATE.md and ROADMAP.md were LEFT for the orchestrator to reconcile centrally — this executor did NOT run the mutating `state.*` / `roadmap.update-plan-progress` SDK verbs, and staged ONLY its own files, to avoid clobbering the concurrent WIP. Requirement UPNEXT-01 is satisfied by this plan (regenerate never-empty + upnext.source verifiability); the orchestrator should mark it complete during reconciliation.

## Notes for Next Plan

- The `upnext.source` Activity-log event ({via, count}) now fires on every fresh play (regenerate) and every exhaust-grow (ensureAhead). On-device UAT for Gap 2 can confirm "one `track.getSimilar` call, never empty" by observing `upnext.source {via:'similar'}` on a fresh play (and `{via:'diverse'}` only for genuinely-dry seeds), with no empty Up-Next.
- Remaining Phase-26 gap-closure work (gaps 4-6: version-picker placement/dedup/pick-resolve-fallback) is tracked in the sibling 26-08/26-10/26-11 plans.

## Self-Check: PASSED
