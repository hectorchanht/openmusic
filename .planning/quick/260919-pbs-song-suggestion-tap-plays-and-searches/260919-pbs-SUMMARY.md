---
phase: quick-260919-pbs
plan: 01
subsystem: search
tags: [search, typeahead, autocomplete, playback]
requires: [player.playStub, search/+page.svelte run()]
provides: [suggestionKeyword]
affects: [src/routes/(app)/search/+page.svelte]
tech-stack:
  added: []
  patterns: [pure-helper-plus-thin-component-caller, decision-record-comment]
key-files:
  created: []
  modified:
    - src/lib/search/autocomplete-logic.ts
    - src/lib/search/autocomplete-logic.test.ts
    - src/routes/(app)/search/+page.svelte
decisions:
  - "Song suggestion tap plays AND commits a search for '<title> <artist>' (title alone when artist is empty)"
  - "Play first, then run() — playback must not depend on run()'s early-return guards"
metrics:
  duration: ~6 min
  completed: 2026-09-19
---

# quick-260919-pbs: Song Suggestion Tap Plays and Searches — Summary

Tapping a ♫ suggestion in the search typeahead now both plays the stub (unchanged) and commits a search for `"<title> <artist>"` via a new pure `suggestionKeyword()` helper, so the content area matches the song just tapped.

## What Changed

**`src/lib/search/autocomplete-logic.ts`** — added `suggestionKeyword(s: Pick<Suggestion, 'title' | 'artist'>): string`. Returns the trimmed title joined to the trimmed artist by a single space, or the title alone when the artist is missing/empty/whitespace. The fallback is load-bearing: `deriveSuggestions` emits `artist: ''` for hits with no artist, so a naive join would commit a trailing-space query.

**`src/lib/search/autocomplete-logic.test.ts`** — five co-located cases, written RED before the implementation.

**`src/routes/(app)/search/+page.svelte`** — `suggestionKeyword` added to the existing import; the `song` branch of `pickSuggestion` now falls into `q = suggestionKeyword(s); run();` after the `playStub` IIFE. The `quick-260831-rjo` decision block was UPDATED (not replaced): its artist/album bullets and its reference are intact, and the song bullet now records why rjo's "committed-looking text over a content area that never searched for it" objection no longer applies — the content area now searches for exactly the text in the input.

## Ordering (play first)

Play stays first. The `void (async () => …)()` IIFE runs synchronously up to `playStub`'s first `await`, so the optimistic stub lands in the now-bar in the same tick as the click, and playback does not depend on `run()`'s early returns (`!kw`, offline). Either order would in fact be safe — `run()` aborts only `ac`/`moreAc`/`suggestAc`, none threaded into `playStub` (whose 3rd arg is `cover`, not a signal), and it never touches player state or `pendingGen` — but play-first is the order whose safety does not depend on `run()`'s internals staying as they are.

## Verification (observed, not assumed)

| Gate | Result |
|---|---|
| `pnpm vitest --run src/lib/search/autocomplete-logic.test.ts` (RED) | 5 failed, 18 passed — `TypeError: suggestionKeyword is not a function` |
| same (GREEN) | **23 passed (23)**, 1 file |
| `pnpm check` | **0 ERRORS 0 WARNINGS**, 4566 files |
| `pnpm test` | **2895 passed (2895)**, 141 files |
| `grep -c quick-260919-pbs` in +page.svelte | 2 |
| `grep -c quick-260831-rjo` in +page.svelte | 1 (preserved) |
| `grep -c "q = suggestionKeyword(s)"` | 1 |

**Scope discipline confirmed by reading the diff line-by-line:** the only changed lines are the one import line, the three prose lines of the rjo song bullet (replaced by the updated record), and the four inserted lines in the song branch. The artist branch (`goto('/artist/'…)`), the album fallthrough (`q = s.title; run();`), `run()` itself, and the `playStub` IIFE with its `tr === null && player.pendingTrack == null` toast gating are byte-for-byte untouched.

**NOT verified:** no browser/device run. The behavioural claims (now-bar stub timing, results filling the content area) rest on reading the code paths, not on observing a tap.

## Deviations from Plan

None — plan executed as written. One presentational nit: the plan phrased step 2 as replacing the bare `return;` with `q = suggestionKeyword(s); run(); return;`. The lines were inserted before the existing `return;` instead, which is the same control flow with a smaller diff.

## Commits

- `867f489` feat(quick-260919-pbs): pure suggestionKeyword() helper + tests
- `6f8a605` feat(quick-260919-pbs): song suggestion tap plays AND commits the search

## Self-Check: PASSED

- `src/lib/search/autocomplete-logic.ts` — FOUND (`suggestionKeyword` exported)
- `src/lib/search/autocomplete-logic.test.ts` — FOUND (`describe('suggestionKeyword')`)
- `src/routes/(app)/search/+page.svelte` — FOUND (`q = suggestionKeyword(s)`)
- commits `867f489`, `6f8a605` — FOUND in `git log`
