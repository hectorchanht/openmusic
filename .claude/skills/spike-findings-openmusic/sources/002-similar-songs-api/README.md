---
spike: 002
name: similar-songs-api
type: comparison
validates: "Given a seed track, when fetching similar songs, then one API can return EXACT {artist,title} pairs directly (no artist-hop + per-artist search fan-out)"
verdict: VALIDATED
related: [001, 003]
tags: [similar, upnext, lastfm, deezer]
---

# Spike 002: similar-songs-api

## What This Validates
Given a seed track, when building the Up-Next / similar list, can we get similar songs as
**exact `{artist, title}` pairs in one call** — instead of today's artist-hop
(`artist.getSimilar` → **8× `searchAll`**, one full fan-out per similar artist)?

Compared three approaches over 10 seeds (6 Chinese + 4 Western):
- **002a** Last.fm `track.getSimilar` → similar TRACKS (name + artist) in ONE call
- **002b** Last.fm `artist.getSimilar` → similar ARTISTS (today's first hop), then must search each
- **002c** Deezer `artist/{id}/related` → related ARTISTS (also artist-hop), then must search each

Then verified 002a's pairs actually RESOLVE in our catalog (kuwo — the spike-001 reliable source).

## Research
- `track.getSimilar` (artist, track) → `similartracks.track[]`, each `{ name, artist: {name}, match }`.
  Not exposed by any existing route: `/api/similar` only does `artist.getsimilar`; `/api/lastfm/info`
  whitelists `*.getinfo`. So this spike calls Last.fm directly with the `.dev.vars` LASTFM_KEY
  (never logged / never written to any output file) to measure feasibility before adding a route.
- Deezer has no public "similar tracks" endpoint through our proxy (only `related` artists), so it is
  structurally the same artist-hop as the baseline.

## How to Run
```bash
# dev server up on :4321; LASTFM_KEY present in .dev.vars
cd .planning/spikes/002-similar-songs-api && node harness.mjs
```

## What to Expect
Per seed: track.getSimilar count + top-5 pairs + how many of the top-5 resolve in kuwo; the
artist.getSimilar / deezer-related counts; and an API-call model for building a 10-song list.

## Investigation Trail
1. **track.getSimilar returns rich, exact, resolvable pairs.** 8/10 seeds returned 20 songs each.
   Top-5 were **5/5 resolvable in kuwo for EVERY seed that had data** — e.g. 周杰伦 稻香 →
   七里香 / 晴天 / 江南 / 修煉愛情 / 淘汰; Coldplay Yellow → The Scientist / Sparks / Somewhere Only We Know.
   The `match` score (1.00 … 0.2) also gives a ready-made ordering for the list.
2. **Traditional-vs-Simplified is a non-issue.** Last.fm returns Traditional (周杰倫); kuwo still
   found all of them (5/5) — the existing matchKey tolerance covers it. Song suffixes ("- 電影…主題曲",
   "(feat. …)") also resolved fine.
3. **Coverage gap: newer/CN-pop songs.** 2/6 Chinese seeds returned 0 similar tracks
   (邓紫棋 光年之外, 毛不易 消愁) — thin Last.fm track-level scrobble data for recent CN pop. BUT
   `artist.getSimilar` returned 20 artists for BOTH, so an artist-level fallback still exists.
   Western coverage was 4/4 perfect.
4. **Deezer related is dry for CN, decent for Western** (0 for 十年/光年之外/江南; 20 for the rest) —
   and even when populated it's still an artist-hop, so it doesn't beat track.getSimilar.

## Results

### API-call model — build a 10-song Up-Next list
| approach | calls to build the list | pairs are exact song+title? | on-play cost per item |
|----------|------------------------|-----------------------------|-----------------------|
| **002a track.getSimilar** | **1** | **yes** (real songs) | 1 single-source resolve + free/1 cover |
| 002b artist.getSimilar (today) | 1 + **8× searchAll** (≈ 33–57 upstream calls) | no (artist → guess top track) | already resolved by the fan-out, but 8× the calls |
| 002c deezer related | 1 + N× searchAll (same artist-hop) | no | same as baseline |

### Verdict: VALIDATED — `track.getSimilar` is the winner

- **PRIMARY similar source = Last.fm `track.getSimilar`.** One call yields exact `{artist,title}`
  pairs, pre-ranked by `match`, that resolve in our catalog. This replaces the 8× `searchAll`
  fan-out in `buildSimilarQueue` with a **single** request — the biggest click-to-play saving.
- **FALLBACK (when track-level is dry — some newer CN songs) = `artist.getSimilar` → resolve each
  candidate's top track via the SINGLE primary source (kuwo), NOT an 8-source `searchAll` each.**
  Keeps the fallback cheap too.
- **Up-Next carries exact name+artist**, so tapping a queued song needs only a single-source resolve
  (no re-search) + a cover (free from kuwo, else 1 Deezer HQ). This is exactly the user's target flow.

### Signal for the build
1. **Add an edge route** (e.g. `/api/lastfm/similar-tracks?artist=&track=&limit=`, mirroring
   `/api/similar`'s posture: LASTFM_KEY server-side, clean `{ tracks: [{artist,title,match}] }` shape,
   never `*` CORS). The existing `/api/similar` (artist.getsimilar) stays as the fallback.
2. **Rewrite `buildSimilarQueue`**: track.getSimilar → map pairs to lightweight stubs (exact
   name+artist, source unset) → dedupe/exclude → return. NO per-artist `searchAll`. Resolve lazily
   on play through the kuwo-first chain (spike 001). Fallback path uses artist.getSimilar but resolves
   candidates single-source.
3. Order the list by `match` score (free relevance ranking).
