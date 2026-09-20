---
phase: quick-260919-pid
plan: 01
subsystem: search
tags: [typeahead, autocomplete, deezer, pure-logic, tdd]
requires:
  - src/lib/services/deezer.ts (DeezerHit shape)
provides:
  - ARTIST_ROWS / ALBUM_ROWS ceilings on the typeahead's leading groups
  - bounded grouped suggestion order (artists -> albums -> songs)
affects:
  - src/routes/(app)/search/+page.svelte (renders deriveSuggestions() output in array order — UNCHANGED, no edit needed)
tech-stack:
  added: []
  patterns:
    - pure node-testable logic module wrapped by a thin .svelte component
key-files:
  created: []
  modified:
    - src/lib/search/autocomplete-logic.ts
    - src/lib/search/autocomplete-logic.test.ts
decisions:
  - "Typeahead suggestions are GROUPED by kind (artists -> albums -> songs), not interleaved"
  - "ARTIST_ROWS = 2 / ALBUM_ROWS = 2 are ceilings; songs take every remaining slot up to SUGGEST_CAP"
  - "Asymmetric by design: songs backfill unused leading slots, but artists/albums never expand past their caps — a no-song result is legitimately short"
metrics:
  duration: ~6 min
  completed: 2026-09-19
---

# quick-260919-pid: Group typeahead suggestions (artists → albums → songs) Summary

Replaced the round-robin song/artist/album interleave in `deriveSuggestions()` with a bounded
grouped concat — at most 2 artist rows, then at most 2 album rows, then songs filling every
remaining slot to `SUGGEST_CAP` — driven by measured live-Deezer evidence that an unbounded
concat would render zero song rows.

## What Was Built

**Task 1 (RED) — `3edc82a` `test(quick-260919-pid): pin bounded artists → albums → songs suggestion order`**

- Imported `ARTIST_ROWS` / `ALBUM_ROWS` (nonexistent at that point — the RED lever).
- Deleted the two interleave-era tests (`'interleaves at least one artist suggestion near the top…'`,
  `'surfaces album rows near the top when present, without exceeding the cap (gm4)'`). They would
  have passed incidentally under the new design, but their names/comments described the superseded
  order; the new exact-array assertions are strictly stronger.
- Trimmed the gm4 distinct-album test from 3 albums to 2 (`ALBUM_ROWS` now truncates the third), so
  its assertion stays about DEDUPE, not about the cap. The `toMatchObject` album-artist line is intact.
- Added five `toEqual`-exact ordering tests: grouped order, cap-overflow bounding (+ first-seen order
  within each truncated group), song backfill, the no-song asymmetry, and the single-hit case.

**Task 2 (GREEN) — `4e92c72` `feat(quick-260919-pid): bounded grouped typeahead — 2 artists, 2 albums, songs fill`**

- `export const ARTIST_ROWS = 2` / `export const ALBUM_ROWS = 2` directly after `SUGGEST_CAP`, each
  with a one-line doc comment giving the measured reason.
- Replaced the interleave block (the `out` accumulator, `SONGS_FIRST` / `ARTISTS_NEAR_TOP` /
  `ALBUMS_NEAR_TOP`, the three cursors, three head loops and the round-robin `while`) with one
  expression: `[...artists.slice(0, ARTIST_ROWS), ...albums.slice(0, ALBUM_ROWS), ...songs].slice(0, SUGGEST_CAP)`.
  That single slice-concat produces BOTH the backfill and the asymmetry — no cursors, no per-group minimums.
- Decision record in-body: the locked grouped order (no headings, no i18n keys — the ♪ ◎ ♫ glyphs
  already mark kind), the six-query measured evidence table verbatim, the backfill/asymmetry rule
  with an explicit "do NOT fix the short list", and `SUPERSEDED (was ql0/gm4 interleave):` quoting
  the old rationale verbatim.
- Stale doc comments refreshed: module header `(dedupe / cap / interleave)` → `(dedupe / cap / group)`;
  the `deriveSuggestions` JSDoc bullet now describes the grouped rule and points at the in-body record.

The three build loops, their dedupe keys and empty-skips, `MIN_QUERY_LEN`, the empty-hits guard,
`SUGGEST_CAP`'s value, the `// --- albums (gm4):` comment, `suggestionKeyword` (quick-260919-pbs) and
`debounce` are byte-identical. `src/routes/(app)/search/+page.svelte` was not touched — it already
renders the array in order.

## Verification (observed output, not inferred)

| Gate | Command | Result |
|---|---|---|
| RED (Task 1, pre-implementation) | `pnpm vitest run src/lib/search/autocomplete-logic.test.ts` | **5 failed \| 21 passed (26)** — exactly the five new ordering tests fail; every preserved test already passes |
| GREEN (Task 2) | `pnpm vitest run src/lib/search/autocomplete-logic.test.ts` | **26 passed (26)** |
| Typecheck | `pnpm check` | `COMPLETED 4567 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| Full suite | `pnpm test` | **142 test files passed, 2905 tests passed**, 9.79s |
| Scope | `git diff --stat HEAD~2 HEAD` | 2 files changed (`autocomplete-logic.ts` +48/-35, `autocomplete-logic.test.ts` +76/-22). `search/+page.svelte` NOT among them |
| Deletion check | `git diff --diff-filter=D --name-only HEAD~1 HEAD` | empty — no files deleted |

Done-criteria greps: `SONGS_FIRST\|ARTISTS_NEAR_TOP\|ALBUMS_NEAR_TOP` → 0; `export const ARTIST_ROWS = 2\|export const ALBUM_ROWS = 2` → 2; `--- albums (gm4):` → 1; `quick-260919-pid` → 4 in source / 7 in tests; `tame impala` (evidence table) → 1; `SUPERSEDED (was ql0/gm4 interleave)` → 1.

**Not verified here:** the live browser rendering of the new order. This plan changes a pure
function and its unit tests only; the six live-Deezer measurements quoted in the code comment are
the ones taken during planning, not re-run in this execution.

## Deviations from Plan

None — plan executed as written.

One note that is not a deviation: the pre-existing uncommitted changes in the working tree
(`src/lib/actions/tapBounce.ts`, `src/lib/components/SongRow.svelte`, `src/routes/(app)/+layout.svelte`,
untracked `src/lib/actions/tapBounce.test.ts`) are the user's and were left staged-out of both
commits, per the execution constraints. `git status` after the final commit still shows them modified.

## Known Stubs

None.

## Self-Check: PASSED

All modified files exist on disk; both task commits (`3edc82a`, `4e92c72`) are in `git log`.
