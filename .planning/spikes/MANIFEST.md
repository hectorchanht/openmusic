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
- **[002] Similar-songs PRIMARY = Last.fm `track.getSimilar`** — returns exact `{artist,title}` pairs
  (pre-ranked by `match`) in ONE call, 5/5 resolvable in kuwo. Replaces `buildSimilarQueue`'s 8× `searchAll`
  fan-out (≈33–57 calls → 1). Needs a NEW edge route (`/api/lastfm/similar-tracks`) — existing `/api/similar`
  is artist-only and `/api/lastfm/info` whitelists `*.getinfo`.
- **[002] Similar FALLBACK (newer CN songs where track.getSimilar is dry) = `artist.getSimilar`**, but resolve
  each candidate's top track via the SINGLE primary source (kuwo), NOT an 8-source `searchAll` per artist.
- **[002] Up-Next items carry exact name+artist** → tap = single-source resolve only (no re-search) + free/1 cover.
  Order the list by Last.fm `match` score.

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | source-resolve-richness | standard | 20 songs × 7 sources: resolve success + payload richness (mp3 · inline cover+loads · lrc · duration · download) → rank primary + fallback | ✅ VALIDATED — kuwo primary; source-cover free; netease upstream intermittent | sources, resolve, cover, benchmark |
| 002 | similar-songs-api | comparison | Last.fm `track.getSimilar` vs Deezer vs current artist-hop baseline → exact artist+title pairs, fewest API calls | ✅ WINNER: track.getSimilar (1 call, exact pairs, 5/5 resolvable) vs 8× searchAll baseline | similar, upnext, lastfm, deezer |
| 003 | clickplay-query-audit | standard | Instrument real click-to-play → count + attribute `/api/*` calls (crossSourceLyric / cover / up-next) → baseline to beat | PENDING | audit, perf, baseline |
