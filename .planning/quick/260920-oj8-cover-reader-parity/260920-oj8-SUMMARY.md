---
phase: quick-260920-oj8-cover-reader-parity
plan: 01
subsystem: covers
tags: [cover-chain, track-menu, downloads, parity, deferred-item-closed]
requires:
  - player.displayCover (quick-260920-nyq) — the ONE now-playing cover reader
  - src/lib/stores/cover-version.svelte.ts (readPinnedCover, readCoverByUidOrName)
provides:
  - the cover picker pre-selects the tile the hero is actually showing
  - a downloaded file embeds the art the app displays (including an embedded data: cover)
  - no production site outside player.svelte.ts reads player.resolvedCover any more
affects:
  - TrackMenu cover picker active tile + the share-card cover carrier (same ladder, two consumers)
  - single-song downloads, the album bulk loop and background repair (all route through downloadTrack)
tech-stack:
  added: []
  patterns:
    - one store getter as the single cover read seam; call sites hold the ladder, not the chain
    - source-slice guard for a component-instance $derived the node-only suite cannot mount
key-files:
  created: []
  modified:
    - src/lib/components/TrackMenu.svelte
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
    - src/lib/services/share.test.ts
decisions:
  - The playing-song rung at both remaining sites is player.displayCover, so the picker, the
    downloaded file, the hero, the Nowbar and the OS media card cannot disagree (user spec)
  - An embedded local-file data: cover (37-D-02) now reaches the downloaded file too — what the user
    sees is what gets embedded
  - The TrackMenu ladder keeps ONE source guard, in share.test.ts which already owned that
    expression, rather than a second guard block in a second file
metrics:
  duration: ~9 min
  completed: 2026-09-20
  tasks: 3
  commits: 3
  files_changed: 4
---

# quick-260920-oj8: Cover Reader Parity Summary

Closes the two `quick-260920-nyq` deferred items: the cover picker's active tile and the artwork
embedded into a downloaded file both read `player.displayCover` for the playing song, so every
surface that shows a cover now runs through the same resolver and the same chain.

## What was built

**Task 1 — the picker ticks the tile the hero is showing (commit `0d7768f`).** One rung in
`TrackMenu.svelte`'s `activeCover` `$derived`: `player.resolvedCover` → `player.displayCover`. The pin
stays rung 1, the shared cache stays rung 3, `track.cover` stays last. The getter is reused, not
re-inlined (CLAUDE.md Shared Primitives), so pin precedence and the 37-D-02 `data:` exception are
inherited rather than restated. `activeCover` has two consumers — the picker's active tile and the
share-card cover — so the share card follows for free.

**Task 2 — a download embeds what the app displays (commit `672eecf`).** The same rung in
`download-track.ts`. It is still a pure READ, so the D-18 download-isolation contract is untouched
(the isolation test's throwing setters still pass). Behavioural consequence the user asked for: an
embedded local-file `data:` cover, which `displayCover` keeps ahead of the https-only cache, now
reaches the file instead of being displaced by a streaming version's name-layer art.

**Task 3 — the TrackMenu guard (commit `a82bafa`).** `share.test.ts` already owned a source guard
over this exact expression (a component-instance `$derived` in a `.svelte` file, and the single
Vitest project is node-only with no jsdom — there is nothing to mount). Its existing assertion was
pinned to `player.resolvedCover`, so it was updated, and the ladder assertions were added to the same
file rather than opening a second guard block elsewhere.

## Verification — actual output

| Check | Result |
|---|---|
| `pnpm check` (after each task) | `4577 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| `pnpm test -- download-track` | 50 passed |
| `pnpm test -- share` | 131 passed |
| `pnpm test` (full) | **145 files, 3003 tests, all passed** |
| revert probe — `download-track.ts` rung back to `resolvedCover` | 2 failed / 48 passed (both new assertions RED) |
| revert probe — `TrackMenu.svelte` rung back to `resolvedCover` | 3 failed / 128 passed (both new assertions + the updated 3uo guard RED) |
| `grep -rn 'player.resolvedCover' src --include=*.svelte --include=*.ts` (excl. tests + player.svelte.ts) | 13 hits, **all inside comments** — no production read site left |

Not verified, and why:

- **No browser/E2E check.** The Browser pane's rAF is frozen (project memory), so "the picker
  highlights the same tile the hero paints" was not observed rendering; it is pinned by the source
  guard plus the getter's own divergence tests in `player.svelte.test.ts`.
- **No real download run.** The blob/tag/save path is mocked in the suite, so "the file on disk
  carries that cover" is asserted at the `resolveArtworkDataUrl({ cover })` seam, not by reading tags
  back out of a written file.

## Tests added

| Test | Site | What it pins |
|---|---|---|
| `embeds what the HERO shows, not a stale resolvedCover, when THIS is the playing song` | download | the DIVERGENCE: `displayCover` = cache cover A, `resolvedCover` = stale cover B, the file must carry A |
| `embeds an embedded data: cover the hero is showing, over a cached https cover` | download | 37-D-02 reaches the file — the local-file case the user's spec explicitly covers |
| `reads player.displayCover for the playing song and never player.resolvedCover` | TrackMenu | the rung itself (RED on revert) |
| `keeps the pin first and track.cover last` | TrackMenu | rung ORDER — a pin still outranks every resolver, the stub's art is still the last resort |

Both download tests construct the divergence the brief asked for. For TrackMenu the divergence is
asserted structurally, not behaviourally: `activeCover` is a component-instance `$derived` inside a
`.svelte` file and the project has no jsdom, so there is nothing to mount and nothing to import. The
behavioural half runs where it can — `player.svelte.test.ts` holds the getter's own cache-beats-
`resolvedCover` and `data:`-exception tests (added by nyq), and `download-track.test.ts` exercises the
identical ladder end to end.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] A pre-existing source guard pinned the OLD rung**
- **Found during:** Task 3 (full-suite run)
- **Issue:** `share.test.ts`'s `quick-260809-3uo` guard asserted
  `/player\.current\?\.uid === track\.uid \? player\.resolvedCover : null/` — written to pin the uid
  identity check, but spelled with the field, so T1 turned it red.
- **Fix:** regex updated to `player\.displayCover`; the identity check it exists for is unchanged, and
  a comment records that the field moved while the guard's subject did not.
- **Commit:** `a82bafa`

**2. [Rule 3 - Blocking] The download test's player mock had no `displayCover`**
- **Found during:** Task 2
- **Issue:** the hoisted mock exposed `{ current, playGen, resolvedCover }`, so the new read returned
  `undefined` and the existing "prefers the hero cover" test (which asserted the OLD precedence) failed.
- **Fix:** `displayCover` added to the mock and to the `beforeEach` reset, and that test rewritten as
  the explicit divergence assertion above. Folded into the T2 commit rather than T3 so the tree is
  green at every commit.
- **Commit:** `672eecf`

### Deviation from the brief's shape

T3 was specified as "extending the existing co-located test files", one test per site. The download
site's tests landed in the T2 commit (keeping HEAD green), and the TrackMenu guard went into
`src/lib/services/share.test.ts` — which is not co-located with the component but already owns the
TrackMenu source guards for this exact expression. A second guard block in
`src/lib/components/track-menu-gate.test.ts` was written, proven RED, then discarded in favour of the
single existing one; `track-menu-gate.ts` is declared PURE in its header and pulling store reads into
its test file would have contradicted that.

## Assumption Drift (advisory)

**1. The explicit `readPinnedCover` rung 1 is redundant, not load-bearing**
- **Found during:** Task 1
- **Planned:** "keeping the pin first" reads as a rung that decides cases.
- **Actual:** it cannot change an outcome at either site. `displayCover` inherits the pin (via
  `readCoverByUidOrName`, PIN → uid → name), rung 3 reads the pin directly, and `track.cover` is last
  — so a pin wins at rung 1, 2 or 3 identically. It matters on ROW surfaces, where `pickRowCover` puts
  `track.cover` AHEAD of the cache, which is exactly why it was hoisted out in the first place.
- **Why it matters:** kept as written (the brief asked for it, and it documents intent), but a reader
  should not conclude the two ladders' rung-1 pin is what makes pinning work here.

**2. `download-track.ts` gained the pin as an explicit rung — a behavioural no-op**
- **Found during:** Task 2
- **Planned:** a straight field swap.
- **Actual:** for the playing song the read now passes through `displayCover`'s pin rung before the
  cache, where previously the pin was only reached via rung 2's `readCoverByUidOrName`. Same answer
  either way (see drift 1); noted so it is not mistaken for a precedence change.

## Threat surface

No new network endpoint, auth path, file access or schema change. Both edits swap one store read for
another store read on the same object; `resolveArtworkDataUrl` keeps its own https-only / 6 s / 1 MB
bounds and `displayCover`'s non-https branch admits only `isRenderableCover`'s `image/` base64
allowlist, so the set of bytes that can reach a tag is unchanged in kind. No dependencies added.

## Commits

| Task | Commit | Message |
|---|---|---|
| 1 | `0d7768f` | `fix(quick-260920-oj8): the cover picker ticks the tile the hero is showing` |
| 2 | `672eecf` | `fix(quick-260920-oj8): a download embeds the cover the app is showing` |
| 3 | `a82bafa` | `test(quick-260920-oj8): pin the TrackMenu cover ladder to the one reader` |

Not pushed — the remote auto-deploys production. `.planning/` docs are left uncommitted for the
orchestrator.

## Self-Check: PASSED

All 4 modified files exist on disk; all 3 commit hashes resolve in `git log`; `player.displayCover`
is present in both changed source files and no production read of `player.resolvedCover` remains
outside `player.svelte.ts`.
