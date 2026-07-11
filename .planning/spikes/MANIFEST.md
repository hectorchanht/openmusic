# Spike Manifest

## Idea
Cut wasteful API calls on click-to-play. Today, secondary paths fan out full multi-source
`searchAll` calls: `crossSourceLyric` (on a lyric miss), the cover-resolution chain
(Deezer→iTunes→CN search per tile), and `buildSimilarQueue` (Last.fm returns similar
*artists*, then one `searchAll` per artist ×8). The target flow: click → resolve ONE
highest-quality source that returns everything in one shot (mp3 + cover + lyrics + a
downloadable link) → fall back to the next source only on failure → carry EXACT
name+artist into Up-Next so only a cover needs resolving (no re-search). Downstream
design item (out of scope unless trivial to probe): same name+artist yields many
versions → a version-picker modal before play.

## Requirements
Design decisions that emerged; non-negotiable for the real build. Updated as spikes progress.

- **[001] Reorder the resolve/fallback chain to `kuwo → qq → netease → joox → (fivesing/audius/jamendo)`.**
  Today netease is the registry-default primary but is empirically the least reliable of the CN-4
  (intermittent upstream). kuwo is the only source both reliable (20/20) and rich (audio+cover+lyrics ~19–20/20).
- **[001] Use the source-embedded cover on the hot path; upgrade to Deezer HQ lazily.** kuwo/qq/netease
  return a usable cover WITH the resolve — removes the Deezer→iTunes→CN cover chain from ~19/20 plays.
  Only joox + fivesing need cover backfill. (User hypothesis (a) validated.)
- **[001] One single-source resolve already yields the downloadable link** (every audioUrl is a direct
  progressive file or own-origin stream) — no separate download resolve.
- **[001] PRODUCTION BUG surfaced: netease is currently returning 0 results** — its qijieya Meting
  upstream (`api.qijieya.cn/meting/`) is intermittently dry. A dead default-primary silently degrades
  search live. Needs its own fix (retry/health-gate or a second netease upstream). NOT part of the spike.
- (pending spike 002 — similar-songs source of truth)

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | source-resolve-richness | standard | 20 songs × 7 sources: resolve success + payload richness (mp3 · inline cover+loads · lrc · duration · download) → rank primary + fallback | ✅ VALIDATED — kuwo primary; source-cover free; netease upstream intermittent | sources, resolve, cover, benchmark |
| 002 | similar-songs-api | comparison | Last.fm `track.getSimilar` vs Deezer vs current artist-hop baseline → exact artist+title pairs, fewest API calls | PENDING | similar, upnext, lastfm, deezer |
| 003 | clickplay-query-audit | standard | Instrument real click-to-play → count + attribute `/api/*` calls (crossSourceLyric / cover / up-next) → baseline to beat | PENDING | audit, perf, baseline |
