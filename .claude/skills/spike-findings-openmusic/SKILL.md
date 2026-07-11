---
name: spike-findings-openmusic
description: Implementation blueprint from spike experiments (001–004) for cutting OpenMusic's click-to-play API calls while staying fully functional. Kuwo-first resolution, Last.fm track.getSimilar up-next, inline covers. Auto-load when building the source-resolution / up-next / cover / API-reduction redesign.
---

<context>
## Project: openmusic

Cut wasteful API calls on click-to-play. Today's secondary paths fan out full multi-source `searchAll`
calls (crossSourceLyric, the Deezer→iTunes→CN cover chain, and `buildSimilarQueue`'s 8× per-artist search).
Target: click → resolve ONE high-quality source that returns audio + cover + lyrics + a download link in one
shot → fall back only on failure → carry EXACT name+artist into Up-Next so only a cover needs resolving.

Spike sessions wrapped: 2026-07-11 (4 spikes, all VALIDATED).
</context>

<requirements>
## Requirements (non-negotiable — every reference honors these)

- **Resolve every play through `kuwo` first (1 call → audio + cover inline).** kuwo is empirically 100%
  playable + 100% cover across ALL 14 language/region×genre segments. Fallback: `kuwo → qq → netease →
  joox → (fivesing/audius/jamendo)`. Reorder the registry off netease-first.
- **Never fan out all 7 sources on click** — that's a search-page concern, not a play concern.
- **Use the source-embedded cover on the hot path; upgrade to Deezer HQ lazily.** Only joox/fivesing lack a cover.
- **Up-Next PRIMARY = Last.fm `track.getSimilar`** (1 call → exact `{artist,title}` pairs, ranked by `match`);
  replaces the 8× `searchAll` artist-hop (56 calls → 1). Fallback = `artist.getSimilar`, but resolve candidates single-source.
- **Up-Next items carry exact name+artist** → resolve lazily on play (kuwo-first), no re-search.
- **Lyric miss = ONE cross-source fetch** (netease/qq/joox), never a `searchAll` fan-out.
- **jamendo/audius/fivesing stay OFF the hot path** — last-resort only for CC-indie/UGC/niche.
- **KNOWN PRODUCTION BUG:** netease's `api.qijieya.cn/meting/` upstream is intermittently dry (returns `[]`);
  a dead default-primary silently degrades search live. Needs its own fix (health-gate / second upstream).
- **Version-picker (UI, not spiked):** same name+artist yields many rows across sources — the data to
  populate a "choose which version" modal is already in the search results.
</requirements>

<findings_index>
## Feature Areas

| Area | Reference | Key Finding |
|------|-----------|-------------|
| Source resolution | references/source-resolution.md | kuwo = 100% playable+cover across all 14 segments → kuwo-first, 1 call, cover inline |
| Similar / Up-Next | references/similar-upnext.md | Last.fm `track.getSimilar` → exact pairs in 1 call (vs 56); needs a new `/api/lastfm/similar-tracks` route |
| Click-to-play cost | references/click-to-play-cost.md | Measured baseline ~59 calls/play (56 = buildSimilarQueue) → redesign ~3 |

## Source Files
Original spike READMEs, harnesses, results.json, and POLICY.md preserved in `sources/` for full reference.
</findings_index>

<metadata>
## Processed Spikes

- 001-source-resolve-richness
- 002-similar-songs-api
- 003-clickplay-query-audit
- 004-source-coverage-by-segment
</metadata>
