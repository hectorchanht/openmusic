# quick-261116-srchrank — Search ranking: authentic/exact first, UGC sources off by default

**Reporter:** Hector, 2026-11-16 (screenshot, query "blue bigbang"). Exact song BLUE/BIGBANG
ranked ~#16; fan/uploader rows (YouTube stadium videos) at the top. His words: "the goal is
to play/show the original/authentic song first and at the top"; "toggle off some of the bad
sources by default"; "show authentic artist at the front all the time".

## Root cause (proven with the real ranker on the screenshot's rows)

- Search page passes the WHOLE query into both scoreMatch slots ({artist: q, title: q});
  matchKey strips spaces → query halves glue to one token "bluebigbang". Candidate
  BLUE/BIGBANG keys as "bigbang|blue": no component match, no token overlap, no substring →
  similarity 0. Exact song scored 3.0 (shortTitleBoost 1 + artistFreq 2), BELOW every other
  BIGBANG song (4.5, floated by title-length proximity to the 12-char query). Ranked #11 in a
  14-row repro of the screenshot.
- All 16 sources default ON (PLAYBACK_DEFAULTS + every adapter enabledByDefault), including
  UGC: fivesing （同人/翻唱/伴奏）, bilibili, audius, jamendo, archive, ccmixter; ytmusic merges
  its Videos shelf (fan uploads, uploader = artist) into search.

## Fix

1. **score-match.ts similarity()** — combined-token exact: tokenize RAW artist/title
   (foldScript + lowercase); if every query token (>= 2) appears across the candidate's
   artist+title combined, return SIM_EXACT. Additive-only (never lowers a score); covers
   title-carried credits ("BIGBANG Blue", blank artist). Artist-identity gates untouched.
2. **artist-tiles.ts prioritizeArtistIntent** — also match contiguous WINDOWS of the query
   tokens, so a "title artist" query leads the named artist's tile.
3. **UGC sources default OFF** — fivesing, bilibili, audius, jamendo, archive, ccmixter:
   PLAYBACK_DEFAULTS.enabledSources + each adapter's enabledByDefault. ytmusic + bandcamp
   stay ON (official Western/K-pop + MV; artist-official audio).
4. **One-time migration** — persisted enabledSources maps are auto-saved wholesale, so a
   defaults flip never reaches existing installs. settings.load(): if persisted
   sourcesDefaultsVersion < PLAYBACK_DEFAULTS.sourcesDefaultsVersion (1), force the new
   default-false ids off once and persist; re-enabling afterwards sticks.

## Verify

- Regression test in ranking.test.ts (blue bigbang fixture → BLUE #1).
- Full vitest at the pre-existing baseline; `pnpm check` 0 errors.
- Push main → web-deploy; live-verify on openmusic.lol.
