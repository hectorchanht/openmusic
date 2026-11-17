# quick-261116-srchrank — SUMMARY

**Shipped:** search ranking authentic-first fix + UGC sources default-off (Hector 2026-11-16,
"blue bigbang" screenshot: exact BLUE/BIGBANG at ~#16, fan stadium videos on top).

## Changes

- `score-match.ts` similarity(): combined-token exact — every query token (>= 2) present
  across candidate artist+title (raw strings, foldScript + lowercase) → SIM_EXACT.
  Additive-only; 2-arg resolve/fallback scores can only rise for true combined matches.
- `score-context.ts`: queryLen for multi-token queries = longest token length (was the full
  query length — the ruler that floated 12-char unrelated titles over the 4-char exact one).
  Single-token/lyric queries unchanged.
- `artist-tiles.ts` prioritizeArtistIntent: contiguous query windows also match, so a
  "title artist" query leads the named artist's tile.
- UGC default-off: fivesing, bilibili, audius, jamendo, archive, ccmixter —
  `PLAYBACK_DEFAULTS.enabledSources` + each adapter's `enabledByDefault`. ytmusic/bandcamp
  stay on.
- `settings.svelte.ts`: one-time migration gated by persisted `sourcesDefaultsVersion`
  (PLAYBACK_DEFAULTS.sourcesDefaultsVersion = 1): pre-existing installs get the six sources
  forced off once (their persisted maps are auto-saved defaults, not choices); re-enabling
  afterwards sticks.

## Verification

- Repro before fix (real ranker, screenshot rows): BLUE score 3.0, rank #11/14.
- New regression tests in ranking.test.ts: BLUE #1 for both "blue bigbang" and
  "bigbang blue"; title-carried credit exact; partial coverage not promoted.
- Affected suites (sources/config/settings/catalog/search): 398/398 pass. Posture tests
  updated to the new defaults (registry/archive/bilibili/source-order/catalog lyric walk).
- svelte-check: 0 errors.
- FULL suite: 5499 passed / 0 failed.
- Shipped: commit 65cd94e on main (Git Data API push, cherry-picked onto 745aae0 — sibling
  nav work untouched), web-deploy run 44025359724 success. Live-verified on openmusic.lol:
  deployed chunk carries `sourcesDefaultsVersion` + defaults map `fivesing:!1, jamendo:!1,
  audius:!1, archive:!1, …`.
