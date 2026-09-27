---
phase: quick-260927-2wt
plan: 01
status: complete
subsystem: services/dedupe
tags: [dedupe, identity, radio, up-next, variants]
requires: [quick-260926-n0r]
provides:
  - "sameSongKey bilingual artist-alias rule (title halves equal + whole-script-run artist subset)"
  - "fetchVariants exact-key-first group lookup"
affects:
  - src/lib/stores/player.svelte.ts (queueWithAnchor / captureHistory / weaveFreshHistory, call sites unchanged)
  - src/lib/components/NpRelated.svelte
  - src/routes/(app)/album/[name]/+page.svelte
  - src/lib/services/fallback.ts
  - src/lib/services/catalog.ts
tech-stack:
  added: []
  patterns: ["pairwise predicate loosened, key() left byte-for-byte unchanged"]
key-files:
  created: []
  modified:
    - src/lib/services/dedupe.ts
    - src/lib/services/dedupe.test.ts
    - src/lib/services/variants.ts
    - src/lib/services/variants.test.ts
decisions:
  - "The duplicate radio row came from a bilingual artist alias (G.E.M. vs G.E.M.邓紫棋), not from a script fold. key() has folded Traditional to Simplified per char since quick-260926-n0r."
  - "Only sameSongKey is loosened. key()/songKey/dedupeBest/groupVariants are untouched, so search dedupe, similar, picks and the persisted comment-thread hash keep their exact identity."
  - "fetchVariants looks up the exact songKey group first, and the sameSongKey loop is only the alias fallback."
metrics:
  duration: ~15m
  completed: 2026-09-27
  tasks: 2
  files: 4
---

# Quick 260927-2wt: sameSongKey matches a bilingual artist alias Summary

`sameSongKey` now treats two tracks as the same song when their title keys are equal and one artist key's script runs all appear in the other's (`gem` inside `gem|邓紫棋`). A Deezer/Last.fm radio stub resolved by a CN source now anchors into its own `queueWithAnchor` slot instead of being spliced to the front while the stub stays behind as a duplicate. `fetchVariants` was made exact-key-first so the looser predicate cannot hand back an alias group in place of the song's own group.

## Root cause

- Live keys with the dict warm: Deezer stub `多远都要在一起|gem`, CN resolved `多远都要在一起|gem邓紫棋`, Last.fm `多远都要在一起|邓紫棋`. The title halves already agreed. Only the artist halves differed.
- **The deferred-items diagnosis was stale.** The quick-260927-2cy note said "key() does not fold Traditional/Simplified". That fold has existed since quick-260926-n0r (`foldScript`, per char). The regression pin `鄧紫棋 | 多遠都要在一起` vs `邓紫棋 | 多远都要在一起` already passed on the exact-key path before this change.

## What changed

- `dedupe.ts`: a new `SCRIPT_RUNS` regex (two disjoint classes, so it runs in linear time on untrusted strings; covers T-2wt-01), a private `aliasArtist`, and a `sameSongKey` that keeps the old exact rule and adds the alias rule by splitting the finished key on its single `|`. The `songKey`, `key`, `dedupeBest` and `groupVariants` bodies are unchanged. The diff has no lines inside them.
- `variants.ts`: `groups.get(songKey(artist, title))` runs first, then the old `sameSongKey` loop.

## Caller audit (every non-test `sameSongKey` call site)

| Call site | Disposition |
|---|---|
| `player.svelte.ts:2753` captureHistory, locates current in the old queue | looser is intended |
| `player.svelte.ts:2802` queueWithAnchor, uid first, then sameSongKey, else splice to front | **the fix site** |
| `player.svelte.ts:4391` weaveFreshHistory prefix filter `!sameSongKey(t, seed)` | looser is intended |
| `NpRelated.svelte:94` self-filter | looser is intended |
| `album/[name]/+page.svelte:438` in-queue skip | looser is intended |
| `fallback.ts:113`, `catalog.ts:300` WR-06 adoption | still double-gated by `isAcceptableSubstitute`. Adopting `G.E.M.邓紫棋 \| X` for a failed `G.E.M. \| X` stub is accepted on purpose (T-2wt-02). |
| `variants.ts:41` fetchVariants | made exact-key-first in Task 2 |

## Commits

| Task | Commit | Files |
|---|---|---|
| 1: sameSongKey alias rule, tests, decision comment | `64c04f44` | dedupe.ts, dedupe.test.ts |
| 2: fetchVariants exact-first, plus the aliasArtist type fix | `4a0dcf5f` | variants.ts, variants.test.ts, dedupe.ts |

## Verification (observed)

- RED before each implementation. dedupe: 3 new tests failed (observed pair, alias pin, queueWithAnchor slot). variants: the exact-first test failed.
- Task 1 verify: dedupe, fallback, catalog and comments test files passed 4/4 (149/149 tests). `quick-260927-2wt` appears 3 times in dedupe.ts. The cold-dict block is still the last block.
- `pnpm check`: 4640 files, **0 errors, 0 warnings** (after the Rule 1 fix below).
- `pnpm test`: **165/165 files, 3664/3664 tests passed**, re-run on the final tree.
- Nothing was verified in a browser or on a device. The queueWithAnchor effect is pinned through the pure `dedupeBest(list).findIndex(sameSongKey)` path, which returns index 2 (it returned -1 before).

## Deviations from Plan

**1. [Rule 1 - Bug] aliasArtist type error found by `pnpm check`**
- **Found during:** Task 2 gates
- **Issue:** `x.match(SCRIPT_RUNS) ?? []` infers `RegExpMatchArray | never[]`, so `big.includes(r)` took `never` (svelte-check error at dedupe.ts:179). Vitest passed because the error is type-only.
- **Fix:** annotated `rx` and `ry` as `string[]`.
- **Commit:** `4a0dcf5f`. Task 1's commit `64c04f44` fails `pnpm check` on its own. The branch tip is clean.

**2. Commit trailer**
- The plan text said `Co-Authored-By: Claude Fable 5.1`. The orchestrator constraint requires `Claude Opus 5.5`, so both commits use that.

**3. Two commits, not one**
- One commit per task, as the orchestrator asked ("commit each task atomically"). The plan allowed one or two.

## Assumption Drift (advisory)

- **Found during:** Task 1 tests. **Planned:** "a blank artist ... on both sides" listed among the cases that should be false. **Actual:** two tracks with the same title and a blank artist on both sides have identical keys (`多远都要在一起|`), and the plan's own step 3 keeps the exact-key rule unchanged, so this returns true, as it did before. **Why:** making it false would change the existing exact rule for every caller, which is out of scope. The test pins it as `true` with a comment. The one-side-blank cases are false in both directions.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/services/dedupe.ts, dedupe.test.ts, variants.ts, variants.test.ts
- FOUND commits: 64c04f44, 4a0dcf5f
