---
quick_id: 260715-l9p
slug: rank-youtube-music-merged-search-results
title: Correct YouTube Music search ranking at the right layer (scoreMatch, not the adapter)
date: 2026-07-15
mode: quick
status: complete
subsystem: sources
tags: [ytmusic, search, ranking, score-match, cjk]
requires:
  - ytmusic search() + parseSearchEnvelope Songs+Videos merge (quick-260715-jdj)
  - scoreMatch base similarity term (Phase 10, score-match.ts) + search-page rankList (Phase 21)
provides:
  - CJK-safe substring-containment credit in scoreMatch.similarity() so a candidate that LITERALLY contains the typed query outranks unrelated fuzzy rows on the search page
affects:
  - EVERY source's search-result ordering flows through scoreMatch at the search page rankList — the fix lifts a containing row above zero-similarity rows for CJK/substring queries
key-files:
  modified:
    - src/lib/services/score-match.ts
    - src/lib/services/score-match.test.ts
    - src/lib/sources/ytmusic.ts
    - src/lib/sources/ytmusic.test.ts
decisions:
  - "WRONG-LAYER DIAGNOSIS: the l9p adapter-level scoreMatch re-rank in ytmusic.search() was DEAD CODE. The search page (search/+page.svelte rankList, ~line 299) re-sorts EVERY source's results by scoreMatch, DISCARDING each adapter's returned array order. So an adapter-level sort changed nothing on screen — the ranking authority is scoreMatch at the search page."
  - "RIGHT-LAYER FIX: added SIM_SUBSTR=2 credit in scoreMatch.similarity(). matchKey strips spaces, so a CJK query that is a substring of a longer title (港耆 ⊂ 摩四老年港耆…) collapses to one token, never token-matches, and scores 0 — tying with unrelated rows. The substring term credits a candidate that literally contains the query."
  - "GUARDED additive-only (score === 0): keeps every already-matching candidate byte-identical, so resolution scoring (Pitfall 7, resolveStub / crossSourceLyric) is UNCHANGED. It can only break ties among zero-similarity rows toward the one containing the query — never demote a real match."
  - "SIM_SUBSTR TUNING (live E2E follow-up): the initial flat SIM_SUBSTR=2 was too small. On the search page scoreMatch runs WITH ctx, so a NON-containing 2-char title (== queryLen → full shortTitleBoost=3) whose artist spans 2+ sources (ARTIST_FREQ_BOOST=2) scores 0+3+2=5 and BEAT the containing long-titled video at 2. Fix: DERIVE SIM_SUBSTR = SHORT_TITLE_BOOST_MAX(3) + ARTIST_FREQ_BOOST(2) + 1 = 6, so a literal containment always dominates the set-relative boost stack (which are tie-breakers among relevant rows, not a lever to float an unrelated short title above a containing one). Mirrors PREVIEW_PENALTY's derivation pattern. == a full component match (SIM_ARTIST+SIM_TITLE=6 — equal acceptable: 'contains the whole query' ≈ 'matched a full component'); far below SIM_EXACT(10). Moved the const below the Phase 21 boost consts to avoid the temporal-dead-zone at load. The score===0 guard is unchanged, so resolution scoring stays byte-identical for any already-matching candidate."
  - "De-dup the two matchKey halves when they are identical: the search page passes {artist:q, title:q}, so a naive qArtist+qTitle would double a CJK query (港耆港耆) and fail to match a title containing it once — join once. resolveStub passes a distinct artist/title so its join is the real artist+title concatenation. (Rule 1 correction over the literal spec — see Deviations.)"
  - "Reverted the l9p adapter re-rank + its two adapter-ordering tests; kept the jdj Songs+Videos merge/dedupe. displayIndex stays parse (shelf) order — the search page re-ranks for display."
metrics:
  tasks: 1
  files: 4
  tests_added: 5
  tests_total: 1332
---

# Quick Task 260715-l9p: Correct YTMusic search ranking at the right layer Summary

Move the YouTube Music search-ranking fix from the WRONG layer (a dead-code re-rank inside the `ytmusic` adapter) to the RIGHT layer (`scoreMatch.similarity()`, the shared ranking authority the search page runs over every source), by adding a guarded, CJK-safe substring-containment credit so a candidate that literally contains the typed query outranks unrelated fuzzy rows.

## The Wrong-Layer Diagnosis

The previous l9p pass re-ranked the merged Songs+Videos `Track[]` INSIDE `ytmusic.search()`. That code was **dead for search display**: `search/+page.svelte` `rankList()` (~line 299) re-sorts the *already-deduped* result set by `scoreMatch(qObj, …, ctx)` for EVERY source, discarding whatever order each adapter returned. So the adapter's sort never reached the screen — the ranking authority is `scoreMatch` at the search page, not the adapter.

`scoreMatch` gave the exact-match video `摩四老年 《港耆》 [Official Music Video]` (videoId `dUlAfTZkjpE`) a score of **0** for query `港耆` — identical to unrelated `港`/`耆` songs — so input order won and it sank to ~rank 9. Root cause: `matchKey` (`match-key.ts`) strips spaces, so a candidate title collapses into ONE CJK token; the query `港耆` never token-matches inside it, and per-component similarity needs an EXACT title. With no variant keyword either, a CJK substring match earned zero credit.

## The Fix

### PART A — `src/lib/services/score-match.ts` (the real authority)

- Added a derived `SIM_SUBSTR` (see "Follow-up tuning" below — the initial flat `2` was superseded by `SHORT_TITLE_BOOST_MAX + ARTIST_FREQ_BOOST + 1 = 6`).
- In `similarity()`, AFTER the existing exact/component/token computation, added a CJK-safe substring-containment credit, guarded so it is purely additive for the previously-zero case:
  ```ts
  if (score === 0) {
    const cJoin = cArtist + cTitle;
    const qJoin = qArtist === qTitle ? qTitle : qArtist + qTitle;
    if (qJoin.length >= 2 && cJoin.includes(qJoin)) score += SIM_SUBSTR;
  }
  ```
  - The `score === 0` guard means it ONLY adds signal where there was NONE (no exact/component/token credit) → it can never demote a real match; it breaks ties among zero-similarity rows toward the one literally containing the typed query. `length >= 2` avoids single-CJK-char noise.
- **Untouched:** `SIM_EXACT/ARTIST/TITLE/TOKEN`, `VARIANT_WEIGHT`, `PREVIEW_PENALTY`, ctx/boosts.

### PART B — `src/lib/sources/ytmusic.ts` (revert the misplaced re-rank)

- Removed the `import { scoreMatch }` and the entire re-rank/sort block from `search()`. `search()` now returns `parseSearchEnvelope(json, keyword)` directly.
- KEPT the `jdj` Songs+Videos merge + videoId dedupe inside `parseSearchEnvelope`; `displayIndex` stays the parse (shelf) emit order.
- Load-bearing revert comment records that ranking is owned by `scoreMatch` at the search page, not the adapter.

## Tests

- **`score-match.test.ts`** (+5 cases, new describe block):
  - A candidate whose title CONTAINS `港耆` outranks ones that do NOT (`港城` / `耆卿`).
  - The search-page `{artist:q, title:q}` shape still credits containment (halves de-duped — no `港耆港耆` doubling).
  - An EXACT match still scores `SIM_EXACT` (10) — substring term does not perturb the early return.
  - A candidate with a prior non-zero token/component score is UNCHANGED (`score===0` guard holds → `SIM_TITLE`+`SIM_TOKEN`=5, not 7).
  - A single-CJK-char query (`港`) earns NO containment credit (`length >= 2` guard).
- **`ytmusic.test.ts`**: removed the two l9p adapter-ordering assertions (the scoreMatch re-rank test + the tied-order test); replaced with ONE revert-verification test asserting `search()` returns rows in parse (shelf) order (songs before videos, videoId-deduped). Kept all `jdj` tests (video-only row, cross-shelf dedupe, merged-envelope walk) and the fixture (realistic `港耆` video title + loose `港城`/`耆卿` rows).

## Follow-up tuning — SIM_SUBSTR 2 → 6 (derived to dominate the boost stack)

Live E2E against real YouTube Music search surfaced that the flat `SIM_SUBSTR = 2` was **too small**. On the search page `scoreMatch` runs WITH `ctx`, so a candidate accumulates set-relative boosts on top of similarity:

- A NON-containing short title whose LENGTH ≈ the query length gets the full `shortTitleBoost` (up to `SHORT_TITLE_BOOST_MAX = 3`), and
- If that artist appears under 2+ distinct sources, `artistFrequencyBoost` adds `ARTIST_FREQ_BOOST = 2`.

So an unrelated 2-char title for the 2-char query `港耆` (e.g. `港城` / `耆卿`) scored `0 + 3 + 2 = 5`, which **beat** the containing-but-long-titled video `摩四老年 《港耆》 [MV]` (`SIM_SUBSTR 2 + ~0 short-title boost`). The exact `港耆` video sank to ~rank 3 behind two loose 2-char titles.

**Fix:** make `SIM_SUBSTR` a DERIVED value (mirroring `PREVIEW_PENALTY`'s "derived to dominate" pattern) rather than an independently-chosen literal:

```ts
const SIM_SUBSTR = SHORT_TITLE_BOOST_MAX + ARTIST_FREQ_BOOST + 1; // = 6
```

- A candidate that **literally contains the typed query** is a strong relevance signal that MUST outrank any row lifted PURELY by the set-relative boosts — those boosts are tie-breakers among already-relevant rows, not a lever to float an unrelated short title above a containing one. Deriving the value (not picking a magnitude) makes the dominance explicit and self-maintaining if the boost consts change.
- Still `==` a full component match (`SIM_ARTIST + SIM_TITLE = 6` — equal is acceptable: "contains the whole query" ≈ "matched a full component") and far below `SIM_EXACT(10)`.
- **Const relocation:** `SIM_SUBSTR` moved out of the `SIM_*` block into the Phase 21 set-relative block, defined AFTER `SHORT_TITLE_BOOST_MAX` + `ARTIST_FREQ_BOOST` — a forward reference from its old position would hit the const temporal-dead-zone at module load. A one-line forward-pointer stays in the `SIM_*` block. `similarity()` reads it at call time (function body, not load time) so there is no TDZ hazard there.
- The `score === 0` guard, the `qArtist===qTitle ? qTitle : qArtist+qTitle` search-page de-dup, and the `length >= 2` guard are all UNCHANGED — resolution scoring (Pitfall 7) stays byte-identical for any already-matching candidate.

**Test added (the exact live failure, now green):** build a `SetContext` via `computeSetContext` where the non-containing `港城` row is 2 chars (== queryLen → full `shortTitleBoost`) and its artist spans 2 sources (`ARTIST_FREQ_BOOST`), so it carries the FULL boost stack (`3 + 2 = 5`); assert the containing long-title video (`SIM_SUBSTR 6`) now scores strictly higher. Also pinned the no-ctx containing score to `toBe(6)` so a stray edit back to a flat literal trips the test.

## Deviations from Plan

**1. [Rule 1 - Bug] The literal `qJoin = qArtist + qTitle` fails the live search page.**
- **Found during:** PART A implementation, cross-checked against `search/+page.svelte` (the `<read_first>` "confirm" step).
- **Issue:** The task assumed the keyword lands in `qObj.title` only. The actual code is `const qObj = { artist: query, title: query }` — the keyword fills BOTH slots. So `matchKey(query, query)` yields identical halves, and `qJoin = qArtist + qTitle` DOUBLES a CJK query (`港耆港耆`). A title containing `港耆` once (e.g. `摩四老年港耆`) then FAILS `cJoin.includes(qJoin)` — the credit never fires on the live page, and the orchestrator's live re-verification would fail. The specified unit test (`{artist:'', title:'港耆'}`) would still pass, masking the bug (a false green).
- **Fix:** De-dup identical halves — `const qJoin = qArtist === qTitle ? qTitle : qArtist + qTitle`. This is a no-op for the specified unit test (distinct `''`/`港耆` halves) and for `resolveStub`/`crossSourceLyric` (distinct artist/title), and precisely scopes the de-dup to the only caller with `artist === title` (the search-page `rankList`). Now the credit fires for `{artist:q, title:q}` as intended.
- **Files modified:** `src/lib/services/score-match.ts` (documented inline).
- **Commit:** see `fix(260715-l9p)` below.

## Scope Guarded (untouched, per instruction)

- `SIM_EXACT/ARTIST/TITLE/TOKEN`, `VARIANT_WEIGHT`, `PREVIEW_PENALTY`, ctx/boosts in `score-match.ts`.
- `parseSearchEnvelope`'s Songs+Videos dedupe/merge (`quick-260715-jdj`); songs-then-videos emit order.
- `search/+page.svelte` `rankList` (ranking authority — read-only confirmation only).
- `resolve()`, the proxy/search/stream routes, off-hot-path resilience, `autoResolveEligible: false`.
- Anonymous — no visitorData/auth added.

## Verification

- `pnpm check`: 0 errors, 0 warnings (4337 files).
- `pnpm test`: 79 files, **1332 passed** (before this tuning pass: 1331 → after: 1332; net +1 = the ctx-aware live-failure regression test).
- `score-match.test.ts`: 29 passed (was 24 in the first l9p pass → +5 substring cases → +1 ctx-aware tuning test = 30 assertions across 29 `it`s… net one new `it` this pass).
- Resolution/catalog tests: green — the `score === 0` guard keeps every already-matching candidate byte-identical (Pitfall 7 unchanged); only previously-tied-at-0 orderings shift, and the 2→6 magnitude only ever moves a containing row further ABOVE unrelated zero-similarity rows.
- Zero `as any` in prod source; tabs; single quotes; `$lib` path alias; type-only imports preserved.
- E2E dev-server check intentionally deferred to the orchestrator (per instruction).

## Self-Check: PASSED

- FOUND: src/lib/services/score-match.ts (SIM_SUBSTR + guarded substring credit in similarity())
- FOUND: src/lib/services/score-match.test.ts (+5 substring-containment cases)
- FOUND: src/lib/sources/ytmusic.ts (scoreMatch import + re-rank block removed; parseSearchEnvelope returned directly)
- FOUND: src/lib/sources/ytmusic.test.ts (two l9p ordering tests removed; revert-verification test added; jdj tests kept)
