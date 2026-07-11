# Similar Songs / Up-Next (track.getSimilar)

Proven by spike 002 (10 seed tracks, Chinese + Western, compared against the current artist-hop baseline;
top-5 results verified resolvable in kuwo).

## Requirements
- **Similar-songs PRIMARY = Last.fm `track.getSimilar`** — one call returns exact `{artist, title}` pairs,
  pre-ranked by `match` score. Replaces `buildSimilarQueue`'s 8× `searchAll` artist-hop (56 calls → 1).
- **Up-Next items carry exact name + artist** → tapping a queued song needs only a single-source resolve
  (kuwo-first, see source-resolution) — NO re-search. Cover comes free from kuwo's inline `pic`.
- **Order the list by the Last.fm `match` score** (free relevance ranking).

## How to Build It
1. **Add an edge route** `src/routes/api/lastfm/similar-tracks/+server.ts`, mirroring
   `src/routes/api/similar/+server.ts` exactly:
   - Read `LASTFM_KEY` from `platform.env` (server-side, never client).
   - Call `ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=…&track=…&autocorrect=1&limit=…`.
   - Return a clean `{ tracks: [{ artist, title, match }] }` shape. CORS scoped to own origin (never `*`).
   - Absent key / error / miss → `200 { tracks: [] }` (supported fallback state, like `/api/similar`).
   - NOTE: you CANNOT reuse `/api/lastfm/info` (it whitelists `*.getinfo`) or `/api/similar` (artist-only).
2. **Rewrite `buildSimilarQueue`** in `src/lib/services/similar.ts`:
   - Call the new route → get `{artist, title, match}[]`.
   - Map each to a lightweight stub Track (exact name+artist, `source` unset, `detailsLoaded: false`).
   - Dedupe + drop the seed + `excludeUids`; sort by `match`.
   - Return — resolve lazily on play via the kuwo-first chain. **NO per-artist `searchAll`.**
3. **Fallback** (when `track.getSimilar` is dry — some newer CN songs return 0): fall through to the existing
   `artist.getSimilar` (`/api/similar`), BUT resolve each candidate's top track via the SINGLE primary source
   (kuwo), not an 8-source `searchAll` per artist.

## What to Avoid
- **Do NOT keep the artist-hop as primary.** `artist.getSimilar` → 8× `searchAll` (one full 7-source fan-out
  per similar artist) = the 56-call flood measured in spike 003. It returns artists, forcing a second search.
- **Do NOT `searchAll` the fallback either** — resolve fallback candidates single-source (kuwo).
- Do NOT assume Last.fm has track-level data for every CN song — 2/6 Chinese seeds (邓紫棋 光年之外,
  毛不易 消愁) returned 0 similar TRACKS (thin scrobble data). Western coverage was 4/4. Always keep the
  artist-level fallback for the dry case.

## Constraints
- Last.fm returns Traditional Chinese names (周杰倫); kuwo resolves them fine (5/5) — matchKey tolerance covers it.
- Result names may carry suffixes ("- 電影…主題曲", "(feat. …)") — kuwo search tolerated them (5/5 resolvable).
- Coverage: 8/10 seeds returned ~20 similar tracks each; when present, quality is high and resolvable.

## Net effect
Build a 10-song Up-Next list: **~56 calls → 1**. Each queued song then resolves on play with 1 kuwo call
(cover inline). See click-to-play-cost.md for the full before/after.

## Origin
Synthesized from spikes: 002
Source files: sources/002-similar-songs-api/
