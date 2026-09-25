---
spike: 005
name: ytmusic-innertube-search
type: standard
validates: "Given InnerTube WEB_REMIX search from the edge, when a query is sent, then ≥1 playable track parses into an OpenMusic Track stub (videoId/title/artist/album/cover)"
verdict: VALIDATED
related: [006-ytmusic-playable-stream, 007-ytmusic-lyrics]
tags: [ytmusic, innertube, search, source]
---

# Spike 005: YouTube Music InnerTube Search

## What This Validates
Given InnerTube's `WEB_REMIX` search endpoint hit from the edge (public key, no auth), when a
query is sent, then the deeply-nested response parses into OpenMusic `Track` stubs with a
`videoId` (→ `songid`), title, artist, album, and cover — enough to render a search row and
hand a `videoId` to the stream spike (006).

## Research
- **Endpoint:** `POST https://music.youtube.com/youtubei/v1/search?key=<WEB_REMIX public key>`.
  The key is **not a secret** — it ships in the YTM web client bundle; every InnerTune-lineage
  client (Metrolist / OuterTune / ArchiveTune) uses the same one. Client context
  `{clientName:"WEB_REMIX", clientVersion:"1.2024…"}` is required or the API 400s.
- **Songs filter:** `params = EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D` restricts results to the "Songs"
  chip → a single clean `musicShelfRenderer` of `musicResponsiveListItemRenderer` rows, no
  Top-result / Videos / Albums noise. Stable and widely used.
- **Response shape:** `contents → tabbedSearchResultsRenderer → …sectionListRenderer →
  musicShelfRenderer.contents[] → musicResponsiveListItemRenderer`. Per row:
  - `videoId` in `overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer
     .playNavigationEndpoint.watchEndpoint.videoId` (with `playlistItemData.videoId` fallback).
  - `flexColumns[0]` → title; `flexColumns[1]` → mixed runs (artist · album · duration),
    disambiguated by each run's `browseEndpoint … pageType` (`MUSIC_PAGE_TYPE_ALBUM/ARTIST`).
  - cover in `thumbnail.musicThumbnailRenderer.thumbnail.thumbnails[]` (URL is resizable via
    `=w{n}-h{n}` — can upscale for the HQ cover later, same trick as other sources' covers).

| Approach | Client | Pros | Cons | Status |
|----------|--------|------|------|--------|
| WEB_REMIX search + songs filter | web | No auth, clean song shelf, rich metadata, CJK-safe | Deeply nested JSON, relevance-ranked (never truly empty) | **Chosen** |
| ANDROID_MUSIC search | android | Simpler JSON in places | Different UA/context, and stream side needs it anyway (006) | Deferred to 006 |
| Scrape music.youtube.com HTML | — | — | Brittle, huge payloads, JS-rendered | Rejected |

## How to Run
```
node .planning/spikes/005-ytmusic-innertube-search/harness.mjs
```
Hits the live endpoint for 5 queries and writes `results.json`.

## What to Expect
Each query returns a `Songs` shelf of ~20 rows; every row parses to a stub with a non-null
`videoId`, `cover`, `artist`, and `album`. See console table + `results.json`.

## Investigation Trail
1. **Reachability probe (pre-spike):** `music.youtube.com/youtubei/v1/search` → 200, 225 KB from
   this sandbox. Google/YT endpoints ARE reachable here (unlike CN Meting proxies) → real E2E is
   possible, not just unit-level.
2. **First parse:** used the songs `params` filter → single clean shelf. The `flexColumns[1]`
   run list mixes artist/album/duration; disambiguated by `pageType` on each run's browse endpoint
   rather than positional guessing (positional breaks on rows with no album link).
3. **Breadth test:** ran EN mainstream, JP pop, CJK (Jay Chou 周杰倫), indie (Clairo), and a
   nonsense negative control.

## Results
**VERDICT: VALIDATED ✓**

| Query | Rows | videoId | cover | artist | album |
|-------|------|---------|-------|--------|-------|
| hikaru utada first love (JP) | 20 | 20/20 | 20 | 20 | 20 |
| taylor swift blank space (EN) | 20 | 20/20 | 20 | 20 | 20 |
| 周杰倫 稻香 (CJK) | 20 | 20/20 | 20 | 20 | 20 |
| clairo bags (indie) | 20 | 20/20 | 20 | 20 | 20 |
| aaaasdfghjklqwerty zzz (nonsense) | 20 | 20/20 | 20 | 20 | 20 |

- **100% field coverage** across all real queries — richer than any CN source at search time
  (CN rows often lack album and always lack a duration until the detail hop; YTM gives all four
  plus duration in the single search call).
- **CJK-clean:** Chinese query returned exact matches with correct 周杰倫 metadata.
- **Surprise (expected, not a defect):** the nonsense query still returns 20 fuzzy rows — YTM
  search is relevance-ranked and never returns empty. Same as every music search; the client's
  existing `score-match.ts` / dedupe picks the right row. NOT a blocker.
- **Cover is resizable** (`=w544-h544` style) → free HQ upgrade, no Deezer backfill needed for
  YTM rows (unlike joox/fivesing).

**Signal for the build:** search is the *easy* pillar. A `ytmusic` adapter's `search()` is a
thin port of `harness.mjs`'s parse. `songid = videoId`, `uid = ytmusic:${videoId}`. The proxy
route just forwards the POST + key edge-side (key is public, but keep it edge-side for CORS +
one-place-to-rotate, exactly like the other proxies). **The risk is entirely downstream in 006
(playable stream).**
