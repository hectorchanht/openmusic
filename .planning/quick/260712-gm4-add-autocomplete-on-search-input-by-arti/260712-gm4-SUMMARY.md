---
quick_id: 260712-gm4
slug: add-autocomplete-on-search-input-by-arti
status: complete
date: 2026-07-12
---

# Quick Task 260712-gm4 — Summary

## Research answer (which API)

**Deezer public search** (`api.deezer.com/search`, keyless) — already proxied own-origin
at `/api/deezer/search` and already powering the existing song+artist typeahead
(`quick-260611-ql0`). Every `DeezerHit` **already carries `album`**, so album
autocomplete needed **zero new API/endpoint/proxy/env/dependency**. Full comparison of
alternatives (dedicated `/search/album`, iTunes, CN sources) in
`260712-gm4-RESEARCH.md`.

## What shipped

Album suggestions added to the search typeahead — it now autocompletes **song +
artist + album**.

- `Suggestion.kind` union gained `'album'`.
- `deriveSuggestions()` now derives a distinct **album** list from `hit.album`
  (skip empty; case-insensitive dedupe on `album|artist`; carries the album's artist
  for the muted sub; `key = album:${title}|${artist}`).
- Interleave redesigned to a fair 3-way: a few songs first, then a couple artists,
  then a couple albums, then round-robin the remainder across all three kinds under
  `SUGGEST_CAP=8` so no kind is starved.
- Typeahead render: 3-way kind glyph (song `♫` / artist `♪` / album `◎`); album rows
  show the artist sub-line like song rows. Tap fills the input + runs the search
  (`pickSuggestion` was already generic on `s.title` — no change needed).
- No new i18n keys (rows are data + glyph; header reuses `search.suggestions`).

## Files changed

- `src/lib/search/autocomplete-logic.ts` — `Suggestion.kind:'album'`, album derivation,
  3-way interleave.
- `src/lib/search/autocomplete-logic.test.ts` — `hit()` fixture gained an `album` arg;
  +4 album cases (derivation, empty-skip + case-insensitive dedupe, cross-kind key
  uniqueness, near-top + capped 3-way).
- `src/routes/(app)/search/+page.svelte` — 3-way glyph + album sub-line in the typeahead.

## Verification

- `pnpm test src/lib/search/autocomplete-logic.test.ts` → **18/18 pass** (4 new + 14 existing).
- `pnpm check` → **0 errors, 0 warnings**.
- **Live browser** (own dev server on :4321, Deezer reachable in sandbox):
  - Typing "jay chou" → typeahead shows 8 rows: 4 `♫` songs, 1 `♪` artist ("Jay Chou"),
    3 `◎` albums ("Jay Chou's Bedtime Stories", "Aiyo, Not Bad", "Greatest Works Of Art"),
    each album carrying the "Jay Chou" artist sub. Mobile screenshot captured.
  - Tapping the album row filled the input with the album name, closed the typeahead,
    and ran the search.

## Notes / follow-ups

- Albums are derived from the top song hits for the query (same semantics as the
  existing artist rows). If album-name precision ever matters, the upgrade path is a
  dedicated Deezer `/search/album` proxy route (documented in RESEARCH.md) — not needed now.
- Album/song rows are distinguished by glyph only (aria-hidden), same limitation the
  existing song/artist rows already have; acceptable for this task.
