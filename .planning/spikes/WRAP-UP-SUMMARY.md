# Spike Wrap-Up Summary

**Date:** 2026-07-11
**Spikes processed:** 4
**Feature areas:** Source resolution · Similar/Up-Next · Click-to-play cost
**Skill output:** `./.claude/skills/spike-findings-openmusic/`

## Processed Spikes
| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 001 | source-resolve-richness | standard | ✅ VALIDATED | Source resolution |
| 002 | similar-songs-api | comparison | ✅ WINNER (track.getSimilar) | Similar/Up-Next |
| 003 | clickplay-query-audit | standard | ✅ VALIDATED | Click-to-play cost |
| 004 | source-coverage-by-segment | standard | ✅ VALIDATED | Source resolution |

## Key Findings
- **kuwo is universal:** 100% playable + 100% cover across all 14 language/region×genre segments (20+38 real
  songs). One kuwo call resolves any song with audio + cover. Fallback `kuwo → qq → netease → joox → rest`.
- **Source-embedded cover is free** on kuwo/qq/netease → drop the Deezer→iTunes→CN cover chain from the hot
  path (lazy HQ upgrade only; joox/fivesing still need backfill).
- **Last.fm `track.getSimilar` wins Up-Next:** 1 call → exact `{artist,title}` pairs (ranked by `match`),
  5/5 resolvable in kuwo. Replaces `buildSimilarQueue`'s 8× `searchAll` artist-hop.
- **Measured baseline:** one single-song play = ~59 `/api/*` calls, 56 of them the buildSimilarQueue artist-hop.
  Redesign projects ~3. Idle app = 0 calls (no polling); home mount ≈ 80 Deezer cover-backfill calls (separate).
- **jamendo/audius earn no hot-path slot** — never beat kuwo, even on Western/EDM/Latin; last-resort gap-fillers only.
- **Production regression surfaced:** netease's qijieya Meting upstream is intermittently dry — a dead
  default-primary silently degrades live search. Needs its own fix.
- **Not spiked (UI):** version-picker modal — the multi-version data already exists in search results.

## Minimal-API policy (deliverable)
`.planning/spikes/004-source-coverage-by-segment/POLICY.md` — "try kuwo first, done" — 1 call plays any song.
