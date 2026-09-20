---
phase: 38
plan: 04
subsystem: share
tags: [share-link, arrival, orchestration, cold-warm, input-validation]
requires:
  - "38-01: arrivalMode + stubFromUidParam (the pure seam this composes)"
  - "38-02: player.armTrack + player.spliceAndPlay (the two entry points it dispatches to)"
provides:
  - "ArrivalOutcome = 'armed' | 'played' | 'noop' | 'notfound'"
  - "arriveTrack(track) — the ONE cold/warm dispatcher"
  - "arriveShared({artist,title,u}, signal?) — carrier fast path + D-10 silent fall-through"
affects:
  - "plan 05 mounts arriveShared on both /song routes and re-points the legacy ?play= decoder"
  - "plan 07's appUrlOpen handler goto()s the route, so it ends here too (D-25)"
tech-stack:
  added: []
  patterns:
    - "pure .ts service that imports the runes store but is still node-tested via vi.mock"
    - "explicit miss branch (never implicit) for the isolate-and-degrade fall-through"
key-files:
  created: []
  modified:
    - src/lib/services/share-arrival.ts
    - src/lib/services/share-arrival.test.ts
decisions:
  - "38-D-27: the cold/warm test reads player.playing || player.loading via arrivalMode — an in-flight resolve is WARM"
  - "38-D-03 guard runs BEFORE any network in both entry points, so a re-opened link (or a getLaunchUrl re-fire) costs nothing"
  - "38-D-29: the cold branch calls armTrack directly; playNext never appears in this module"
  - "38-D-10 is written as two explicit miss branches (armTrack null / no audioUrl) that fall through to resolveStub"
  - "The module's SSR contract changed — it now imports the player store, so the header comment was rewritten to say lazy-import-only"
metrics:
  duration: ~12m
  completed: 2026-09-20
---

# Phase 38 Plan 04: The share-arrival orchestration Summary

Every share arrival — both `/song` routes, the legacy `?play=` decoder and the Android deep link —
now funnels through one `arriveTrack` dispatcher, with `arriveShared` adding the `?u=` carrier fast
path that degrades silently to the name resolve when it misses.

## What Was Built

**Task 1 — `arriveTrack` + `arriveShared`** (`src/lib/services/share-arrival.ts`)

- `ArrivalOutcome` with JSDoc mapping each value to the UI it drives (`armed` → idle + the D-19 CTA,
  `played` → the D-20 toast, `noop` → render nothing and explicitly NOT the unplayable message,
  `notfound` → the only outcome that earns it).
- `arriveTrack(track)`: D-03 already-current no-op first, then `arrivalMode({ playing, loading })` —
  warm → `spliceAndPlay` (`played` / `noop`), cold → `await armTrack` (`armed` / `notfound`).
  `playNext` is never reached (D-29), and the JSDoc records why.
- `arriveShared(input, signal?)`: decode the carrier through `stubFromUidParam` (the T-38-01 closed
  enum), D-03 guard before any network, then branch — cold arms seat-first so the nowbar shows the
  shared song while the single detail call runs (D-13); warm calls `ensureTrackDetails(stub, signal)`
  and splices when it came back with an `audioUrl`. Each miss falls through, then
  `if (signal?.aborted) return 'noop'` (T-38-04) guards the search fan-out, then
  `resolveStub(artist, title)` → `arriveTrack(byName)` (D-15).
- Module header rewritten: it now imports the runes player store, so the "imports NO store" line
  became a red-flagged SSR contract — lazy `await import()` inside `onMount` only, never a loader.

**Task 2 — the mocked orchestration describe** (`src/lib/services/share-arrival.test.ts`)

Three hoisted `vi.mock`s (player as a mutable plain object, `catalog`, `discovery`) above the
imports; the 13 pure tests are untouched and unaffected. 14 new tests: the five `arriveTrack`
branches, three carrier branches, and six fall-through/negative branches. Stubs are built through
the real `stubFromUidParam`, so the field set the mocks assert on is the one production passes.

## Verification (observed, not assumed)

| Check | Command | Observed |
|---|---|---|
| Task 1 typecheck | `pnpm check` | `4574 FILES 0 ERRORS 0 WARNINGS` |
| Task 1 exports | `grep -c "^export async function arriveTrack\|^export async function arriveShared\|^export type ArrivalOutcome"` | `3` |
| No network / no audio here | `grep -c "fetch("` / `grep -c "audio.load\|createObjectURL"` | `0` / `0` |
| D-29 | `grep -c "player.playNext("` | `0` |
| Both cold branches | `grep -c "player.armTrack("` | `2` |
| D-10 fall-through | `grep -c "resolveStub(input.artist, input.title)"` | `1` |
| `hasPlayedSinceSrc` comment-only | `grep -n` | 2 hits, lines 41 and 150, both inside comments |
| Plan-01 tests still green after the store import landed | `pnpm test -- src/lib/services/share-arrival.test.ts` | 13 passed (before Task 2) |
| Task 2 suite | `pnpm test -- src/lib/services/share-arrival.test.ts` | **27 passed (27)** — 13 pure + 14 new (≥12 required) |
| Player mock present once | `grep -cF "vi.mock('\$lib/stores/player.svelte'"` | `1` |
| Full suite | `pnpm test` | **145 files passed, 2969 tests passed**, 0 failed |
| Typecheck after Task 2 | `pnpm check` | `4574 FILES 0 ERRORS 0 WARNINGS` |

Required branch coverage, by test name: `cold → armTrack, never spliceAndPlay/playNext`,
`warm (playing) → spliceAndPlay`, `D-27: an in-flight resolve counts as WARM`,
`D-03: the shared song is already current → noop`, `D-10 cold: a dead carrier falls through`,
`D-10 warm: ensureTrackDetails returning the stub untouched is the miss signal`,
`T-38-01: an unknown source is no carrier at all`, `T-38-04: the page navigated away mid-resolve`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Two header comments contradicted the code after the append**

- **Found during:** Tasks 1 and 2
- **Issue:** `share-arrival.ts`'s header stated "It imports NO store", and the test file's header
  said `arriveShared()` is "explicitly OUT of scope here". Both became false the moment this plan
  landed, and CLAUDE.md treats a comment that contradicts the code as worse than none. The prod one
  is load-bearing: it is the SSR contract a future caller reads before importing the module.
- **Fix:** Rewrote the prod paragraph into a red-flagged SSR contract (lazy `await import()` under a
  `browser` guard only, never a `+page.ts` loader or `+server.ts`) and repointed the test header at
  the new bottom describe.
- **Files modified:** `src/lib/services/share-arrival.ts`, `src/lib/services/share-arrival.test.ts`
- **Commits:** `19f8e69`, `f9ff1e1`

No other deviations — both tasks executed as written, including every acceptance grep.

## Assumption Drift (advisory)

**Task 2 is marked `tdd="true"` but could not run a meaningful RED.**

- **Planned:** the plan orders Task 1 (implementation) before Task 2 (tests) while flagging Task 2
  TDD.
- **Actual:** with `arriveTrack`/`arriveShared` already committed by Task 1, a RED gate on Task 2
  would only have proved the mocks wired up, not the behaviour. The tests were written and committed
  as a single `test(...)` commit against the existing implementation.
- **Why:** the plan's own task ordering. Not re-ordered, because Task 1's acceptance criteria are
  grep/typecheck-based and gate the implementation independently, and the 14 tests are the same
  assertions either way. No plan-level `type: tdd` gate applies (frontmatter is `type: execute`).

## Known Stubs

None. Both functions are fully implemented. They have no production caller yet — plan 05 mounts
`arriveShared` on the two `/song` routes and re-points the legacy `?play=` decoder — which is
planned scope, not a stub.

## Threat Flags

None. No new network surface and no new parse: every request stays inside `ensureTrackDetails` /
`resolveStub` (already behind the `apiFetch` governor, T-38-04's stated mitigation), and the only
untrusted input — `input.u` — reaches a source dispatch exclusively through plan 01's closed-enum
`stubFromUidParam` (T-38-01, proven by the `u='kugou1'` test asserting zero `ensureTrackDetails`
and zero `armTrack` calls).

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 | `19f8e69` | `src/lib/services/share-arrival.ts` |
| 2 | `f9ff1e1` | `src/lib/services/share-arrival.test.ts` |

## Self-Check: PASSED

- `src/lib/services/share-arrival.ts` — FOUND (modified; all three exports present)
- `src/lib/services/share-arrival.test.ts` — FOUND (modified; +14 tests, 27 total)
- Commits `19f8e69`, `f9ff1e1` — both FOUND in `git log`
