# Source Resolution (kuwo-first, minimal-API)

Proven by spikes 001 + 004 (empirical: 20 + 38 real songs across 14 language/region × genre segments,
resolved through the live `/api/*` proxy, every audio + cover URL ranged-probed for real playability).

## Requirements
- **Resolve every play through `kuwo` first — one call returns audio + cover.** kuwo is empirically
  **100% playable + 100% cover across ALL 14 segments** (Mandarin, Cantonese, CN rock/hiphop/oldies/OST,
  Japanese, Korean, English pop/rock/hiphop, EDM, R&B, instrumental, Latin). No segment needs a different primary.
- **Fallback chain: `kuwo → qq → netease → joox → (fivesing → audius → jamendo)`.** Reorder the registry
  default away from today's `netease`-first (netease is the least reliable of the CN-4).
- **Never fan out all 7 sources on click.** Fan-out is a search-page concern, not a play concern.
- **Use the source-embedded cover on the hot path; upgrade to Deezer HQ lazily.** kuwo/qq/netease return a
  usable cover with the resolve → skip the Deezer→iTunes→CN cover chain for ~all plays.

## How to Build It
1. **Reorder `src/lib/sources/registry.ts`** so `SOURCES` / the resolve chain is `kuwo, qq, netease, joox,
   fivesing, jamendo, audius`. (Search fan-out interleave order can stay, but the RESOLVE/fallback order must be kuwo-first.)
2. **Single-source resolve on click** — `ensureTrackDetails(track)` already resolves one source
   (`SOURCES[track.source].resolve`). Keep that. On failure, cross-source fallback should walk the chain
   above (kuwo first), NOT re-search all sources.
3. **Cover on the hot path:** after resolve, the track already carries `.cover` (kuwo `pic`, qq `album_pic`,
   netease `pic`). Bind the now-playing/tile cover to that immediately. Fire the Deezer HQ upgrade
   (`resolveCoverForTrack`) lazily, post-paint, only as an *upgrade* — and only run the full
   Deezer→iTunes→CN chain for the coverless sources (joox/fivesing) or a genuine miss.
4. **Lyrics:** kuwo returns lyrics on ~33/38; genuine misses (song that should have lyrics) get ONE
   cross-source lyric fetch from netease/qq/joox — the existing `crossSourceLyric` in
   `src/lib/services/catalog.ts`, but capped to a single candidate resolve, NEVER a full `searchAll` fan-out.
5. **Downloadable link = the resolved `audioUrl`** — every source returns a direct progressive file
   (mp3/flac) or an own-origin stream. No separate download resolve.

## What to Avoid
- **Do NOT keep `netease` as the default primary.** Its upstream (`api.qijieya.cn/meting/`) is
  INTERMITTENT — in spike 001 it returned `[]` for the first 7 queries then recovered; in spike 004 it
  whiffed en-pop (Taylor Swift + Ed Sheeran) entirely. Rich when up, unreliable as a floor. (This is also a
  live production regression worth its own fix: a dead default-primary silently degrades search today.)
- **Do NOT rely on `joox` for covers** — it returns NO cover field, ever (0/38). Audio+lyrics only.
- **Do NOT put `jamendo`/`audius` on the hot path.** They NEVER beat kuwo, not even on Western/EDM/Latin
  (audius 22/38, jamendo 20/38 globally). Zero incremental mainstream coverage → last-resort only, for
  CC-indie / UGC / niche the CN-4 genuinely lack. `fivesing` = UGC covers/karaoke, also last-resort.
- **Do NOT trigger `crossSourceLyric`'s `searchAll`** on a lyric miss for lyricless sources
  (jamendo/audius/fivesing) — already guarded by `LYRICLESS_SOURCES`, keep it.
- `qq` search is flaky (returns 0 rows intermittently under load, no throw) — fine as fallback #2, not primary.

## Constraints
- CN source upstreams are third-party proxies; contracts can drift (adapters THROW on drift by design).
- `qq` is the ONLY source that returns duration (`song_play_time`); kuwo-primary plays have unknown
  duration (D-03 already treats unknown as neutral — acceptable).
- `vite dev` DOES inject `platform.env` from `.dev.vars` + `wrangler.jsonc` vars (JOOX_TOKEN, JAMENDO_CLIENT_ID,
  LASTFM_KEY all work locally) — verified, so local testing is representative.
- Audius `/stream/{id}` 403s on some tracks (region/auth); another reason it's last-resort.

## The policy in one line
**Try kuwo. It works ~100% of the time with cover inline. That's the whole hot path.** Full doc:
`sources/004-source-coverage-by-segment/POLICY.md`.

## Origin
Synthesized from spikes: 001, 004
Source files: sources/001-source-resolve-richness/, sources/004-source-coverage-by-segment/ (incl. POLICY.md)
