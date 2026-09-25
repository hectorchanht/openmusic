---
name: spike-findings-openmusic
description: Implementation blueprint from OpenMusic spikes 001–012. Kuwo-first resolution, Last.fm track.getSimilar up-next, inline covers (API-call reduction); YouTube Music as a source (InnerTube search/play/lyrics, edge limits); MusicBrainz CJK artist identity + original-script albums; fresh home charts (Apple Music RSS, KKBOX, YouTube Charts, genre shelves via client-side iTunes + Deezer). Auto-load when building source resolution, up-next, covers, the ytmusic source, artist/album pages, or the home-page chart shelves.
---

<context>
## Project: openmusic

Mobile-first music player (SvelteKit on Cloudflare) aggregating CN music sources. Spike sessions:

1. **Click-to-play API reduction (001–004):** click → resolve ONE high-quality source that returns audio +
   cover + lyrics + download link in one shot → fall back only on failure → carry EXACT name+artist into
   Up-Next so only a cover needs resolving.
2. **YouTube Music as a source (005–008):** InnerTube search/play/lyrics on the Cloudflare edge; account
   library split to a legal-gated milestone. Built as Phase 27.
3. **CN album upstream (010):** MusicBrainz as the CJK artist-identity + original-script album layer. Built
   (quick-260831-re9).
4. **Fresh home charts (011–012):** replace stale Deezer `/chart` + Last.fm tag/geo shelves with Apple Music
   RSS, KKBOX and YouTube Charts (edge), plus genre shelves from client-side iTunes RSS + edge Deezer.

Spike sessions wrapped: 2026-07-11 (001–004), 2026-09-25 (005–012).
</context>

<requirements>
## Requirements (non-negotiable — every reference honors these)

### Resolution / Up-Next (001–004)
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

### YouTube Music source (005–008) — full list in references/ytmusic-source.md
- Search = InnerTube `WEB_REMIX` + public key, no auth; `uid = ytmusic:${videoId}`.
- Play = `ANDROID_VR` + cached `visitorData` → itag 140 AAC, direct URL. **googlevideo refuses the Cloudflare
  edge byte fetch (403)** — the native APK resolves on-device. A 502 = stale `ANDROID_VR` clientVersion.
- Lyrics: plain via `next→browse`; timed LRC via the existing `crossSourceLyric`.
- Account/library: split to a legal-gated milestone — ship no auth.

### Artist / album identity (010)
- **MusicBrainz is the canonical ARTIST IDENTITY layer for CJK** (any script → one mbid at score 100).
- **Deezer is NOT replaced** — it keeps artwork, non-CJK artists and the fallback slot.

### Fresh home charts (011–012) — full list in references/home-charts.md
- Chart shelves from **Apple Music RSS + KKBOX kma + YouTube Charts, fetched edge-side**, cached ~6 h with
  serve-stale; the undocumented two degrade to an empty shelf, never an error.
- Genre shelves: regional pop from the **legacy iTunes RSS genre feed, CLIENT-SIDE only** (edge is
  rate-limited); Western genres from **Deezer `/chart/{id}`** at the edge; verify each iTunes row's genre id.
- **User decisions:** one main Chart region (from app language, never `cn`) + optional extra regions; a
  one-time switch for existing users (new shelves on, old Deezer/Last.fm shelves hidden but re-enableable);
  default-on genres = Asian pop + Western core.
</requirements>

<findings_index>
## Feature Areas

| Area | Reference | Key Finding |
|------|-----------|-------------|
| Source resolution | references/source-resolution.md | kuwo = 100% playable+cover across all 14 segments → kuwo-first, 1 call, cover inline |
| Similar / Up-Next | references/similar-upnext.md | Last.fm `track.getSimilar` → exact pairs in 1 call (vs 56); needs a new `/api/lastfm/similar-tracks` route |
| Click-to-play cost | references/click-to-play-cost.md | Measured baseline ~59 calls/play (56 = buildSimilarQueue) → redesign ~3 |
| YouTube Music source | references/ytmusic-source.md | Search + lyrics anonymous via WEB_REMIX; play = ANDROID_VR + visitorData → itag 140 direct AAC, but googlevideo 403s the edge byte fetch → native resolves on-device; 502 = bump ANDROID_VR_VERSION |
| Artist / album identity | references/artist-album-identity.md | MusicBrainz collapses 陳奕迅/陈奕迅/Eason Chan to one mbid; 72 original-script albums vs Deezer's 5; ~1 req/s with retryable 503, cache 24 h |
| Home charts | references/home-charts.md | Apple RSS / KKBOX / YouTube Charts all GO from the edge; Last.fm "lag" is audience skew + all-time ranking; genres = client-side iTunes (edge rate-limited) + edge Deezer |

## Source Files
Original spike READMEs, harnesses, workers, results.json, and POLICY.md preserved in `sources/` for full reference.
</findings_index>

<metadata>
## Processed Spikes

- 001-source-resolve-richness
- 002-similar-songs-api
- 003-clickplay-query-audit
- 004-source-coverage-by-segment
- 005-ytmusic-innertube-search
- 006-ytmusic-playable-stream
- 007-ytmusic-lyrics
- 008-ytmusic-account-library
- 010-cn-album-upstream
- 011-edge-chart-sources
- 012-genre-charts
</metadata>
