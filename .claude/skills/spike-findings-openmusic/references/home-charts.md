# Fresh Home Charts (songs · albums · artists · new releases · genres)

## Requirements

- **[011] Home chart shelves source from Apple Music RSS + KKBOX kma + YouTube Charts, all fetched
  edge-side.** All three verified from Workers egress (two colos, zero blocks). Last.fm geo/tag and
  Deezer `/chart` are NOT fresh-regional: Last.fm geo HK is Western, Last.fm tags rank all-time.
- **[011] Own the caching.** Apple sends `max-age=0, private`; charts change daily/weekly → edge-cache each
  (source, territory, type) ~6 h with serve-stale on upstream failure. Apple hangs ~2% of calls → 5 s
  timeout, never block a shelf on it.
- **[011] Per-source limits are hard:** Apple `limit` ≤ 100 and never the `cn` storefront; KKBOX territories
  hk/tw/sg only, 50 rows max; YouTube per-country only (no global) and a pinned real `clientVersion`.
- **[011] The undocumented two (KKBOX kma, YouTube Charts) degrade to an empty shelf, never an error.**
- **[012] Genre shelves split by region.** Regional pop genres from the legacy iTunes RSS genre feed,
  fetched **CLIENT-SIDE**; Western genres from Deezer `/chart/{id}/tracks` at the edge; HK language rows
  from KKBOX categories 320/297/390.
- **[012] Verify every legacy iTunes row's genre id**; never use the HK storefront for J-Pop / Mandopop /
  Western genres.
- **[user 2026-09-24] Existing Last.fm/Deezer shelves stay, hidden by default.** New chart homepage is the
  default; Top Hits (Deezer), Top Artists (Deezer), Last.fm tag + country shelves remain in /settings/home
  and can be re-enabled.
- **[user 2026-09-24] Chart region = one main region + optional extra regions.** "Chart region" setting,
  defaulted from app language (zh-Hant→hk, zh-Hans→tw, ja→jp, ko→kr, en→us; never `cn`), drives Top Songs /
  Albums / New Releases / Top Artists. "More regions" multi-select adds one Apple Top Songs shelf per extra
  storefront, replacing the Last.fm country shelves. KKBOX shelves only exist for hk/tw/sg.
- **[user 2026-09-24] Existing users get a ONE-TIME switch** (new shelves on, old Deezer/Last.fm shelves
  hidden; library shelves, custom order and density preserved).
- **[user 2026-09-24] Default-on genres: Asian pop (Cantopop, Mandopop, K-Pop, J-Pop) + Western core
  (Hip-Hop, Rock, Dance, R&B).** Electronic / Alternative / Asian (Deezer) available but off.

## How to Build It

### 1. Shelf → source map

| Shelf | Source | Fetch from | Request |
|---|---|---|---|
| Top Songs ({region}) | Apple RSS v2 | edge | `https://rss.marketingtools.apple.com/api/v2/{cc}/music/most-played/{n≤100}/songs.json` |
| Top Albums ({region}) | Apple RSS v2 | edge | same, `/albums.json` |
| New Releases (HK/TW/SG) | KKBOX kma | edge | `https://kma.kkbox.com/charts/api/v1/daily?type=newrelease&terr={hk\|tw\|sg}&lang=tc&category=297&limit=50` |
| HK Cantonese / Mandarin / Western | KKBOX kma | edge | `…/daily?type=song&terr=hk&lang=tc&category={320\|297\|390}&limit=50` |
| Top Artists ({region}) | YouTube Charts | edge | POST `https://charts.youtube.com/youtubei/v1/browse?alt=json` (body below), `chart_type=ARTISTS` |
| Trending on YouTube | YouTube Charts | edge | same, `chart_type=TRACKS` — each row has `encryptedVideoId` |
| Regional genres (Cantopop, Mandopop, K-Pop, J-Pop) | legacy iTunes RSS | **browser** | `https://itunes.apple.com/{cc}/rss/topsongs/limit=100/genre={id}/json` |
| Western genres (Rap, Rock, Dance, R&B, Electro, Alt, Asian) | Deezer | edge | `https://api.deezer.com/chart/{genreId}/tracks?limit=50` |
| (opt-in, off by default) Top Hits / Top Artists | Deezer `/chart` | edge | existing `/api/deezer/chart` |
| (opt-in, off by default) tag + country shelves | Last.fm | edge | existing `lastfm.ts` |

Region → storefront/territory: `hk` everywhere; use **`tw` for Mandopop** and **`jp` for J-Pop** (the HK
storefront's copies are stale purchase charts). Recommended genre ids: iTunes Cantopop **1251**@hk,
Mandopop **1253**@tw, K-Pop **51**@hk, J-Pop **27**@jp; Deezer Rap 116, Rock 152, Dance 113, R&B 165,
Electro 106, Alternative 85, Asian 16.

### 2. Edge routes — copy the `/api/deezer/chart/+server.ts` posture

Own-origin CORS + OPTIONS 204, `edgeCache()` keyed by `ownOriginCacheKey(url)`, `fetchWithRetry` +
`AbortSignal.timeout`, `safeImageUrl` host allowlist (add `is1-ssl.mzstatic.com`…, `i.kfs.io`,
`yt3.googleusercontent.com`/`lh3.googleusercontent.com` to `$lib/proxy/safe-image-url.ts`), reshape to the
existing `DiscoveryTrack` / `DiscoveryArtist` shape (`{artist, title, image, mbid:null}`) so tiles and
`player.playStub()` work unchanged. Allowlist every query param (territory, type, category, genre) — never
pass user strings into the upstream URL. Route helpers go in `$lib/proxy/*.ts`, NOT as extra exports of
`+server.ts` (non-verb exports 500 at request time).

Serve-stale: `caches.default` has no SWR, so cache with a long `max-age` (e.g. 48 h) and a `fetchedAt`
stamp in the body; when `fetchedAt` is older than ~6 h, return the stale body and refresh in the
background (`platform.context.waitUntil`). On a cold miss with an upstream failure → empty shelf.

Parsers (from `sources/011-edge-chart-sources/worker.js`):

```js
// Apple RSS v2
const r = JSON.parse(text).feed.results;             // [{ name, artistName, artworkUrl100, releaseDate, id }]
image = r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.');   // resize serves 206

// KKBOX kma
const rows = d.data.charts[type];                     // type = 'song' | 'newrelease'
// { song_name, artist_name, album_name, cover_image: { normal /*500px*/, small }, release_date /*unix s*/ }

// YouTube Charts body — clientVersion MUST be real ('2.0' works; '0.1' → 404); pin it as a constant
{ context: { client: { clientName: 'WEB_MUSIC_ANALYTICS', clientVersion: '2.0', hl: 'en', gl: CC } },
  browseId: 'FEmusic_analytics_charts_home',
  query: `perspective=CHART_DETAILS&chart_params_country_code=${cc}&chart_params_chart_type=${TRACKS|ARTISTS}&chart_params_period_type=WEEKLY` }
// rows: deep-find 'trackViews' / 'artistViews' → { name, artists[].name, encryptedVideoId, thumbnail.thumbnails.at(-1).url, releaseDate }
```

### 3. Client-side regional genres (legacy iTunes)

A pure service beside `itunes-cover.ts` (already the "CORS-open, client-side iTunes" precedent). Go
through the same governor posture as other fetches, cache per `(cc, genre)` in memory/localStorage
~6 h, never throw (→ `[]`). Keep only rows whose `category.attributes['im:id'] === String(genreId)`.
`feed.entry` is an OBJECT, not an array, when there is exactly one row — wrap with `[].concat(...)`.
Image: `im:image.at(-1).label` (170px) → resize via the same mzstatic path trick.

### 4. Randomize + first render

Fetch the top 50–100 once (edge-cached), then pick a random N per render/Randomize from that pool.
First render stops being identical for every user, and Randomize costs zero extra requests — the old
random-Last.fm-page trick (`RANDOM_PAGE_BOUND`) is not needed for these shelves.

## What to Avoid

- **itunes.apple.com from the edge** — it sits behind Cloudflare and rate-limits the SHARED Workers egress
  IP (`403` on the RSS JSON, `429 Rate limit has been exceeded for: itunes-apple-com|general|2a06:98c0:…`
  on search). An XML 200 seen once was a cache hit, not a path.
- Apple RSS v2 `?genre=` — silently ignored (returns the overall chart).
- Trusting a legacy iTunes genre feed blindly — a bogus genre id returns **200 with the overall chart**.
- The legacy feed for Western genres — it ranks **iTunes Store purchases**: HK Rock median age 6617 d,
  Jazz 8291 d, US Hip-Hop led by a 2007 single. Use Deezer genre charts for those.
- Apple `cn` storefront (median age ~22 years), Apple `limit=200` (hangs ~11 s then 500), unknown
  storefront (500).
- KKBOX `terr=my` (404 `{"code":"101"}`), `terr=jp` (returns a Mandarin chart, not J-pop), `limit>50`
  (silently capped). KKBOX `album`/`artist` types → error 103.
- YouTube `chart_params_country_code` = `ZZ`/`global`/`""` → 400. No global chart.
- Tuning Last.fm to fix freshness — the problem is audience skew (Last.fm HK = Western scrobblers) and
  all-time tag ranking, not a parameter.

## Constraints

- Apple RSS: keyless; updated daily; `limit` ≤ 100; ~300–1450 ms; ~2% of calls hang to a 15 s timeout
  (observed only in bursts of the identical URL) → use a 5 s timeout + stale.
- KKBOX kma: undocumented; daily (`/daily`) and weekly (`/weekly`); p50 ~300 ms; UA not required.
  Documented fallback: KKBOX Open API (`api.kkbox.com/v1.1/charts`, client-credentials — free signup).
- YouTube Charts: undocumented; weekly, period end ~1 week back; 100 rows; p50 ~220 ms; origin/referer/UA
  not required. Same maintenance class as the ytmusic source (a clientVersion bump when it breaks).
- Legacy iTunes RSS: CORS `*`; 700–1200 ms from a browser; genre ids from
  `itunes.apple.com/WebObjects/MZStoreServices.woa/ws/genres?id=34`.
- Deezer genre charts: same host/rate cap as the prod `/api/deezer/chart` (~50 req / 5 s).
- Measured freshness (median release age of top 20, 2026-09-25): KKBOX HK 25 d · iTunes HK Pop 18 d ·
  iTunes K-Pop 37 d · iTunes Cantopop 57 d · iTunes J-Pop@jp 85 d · Apple TW 91 d · YouTube HK 120 d ·
  Apple HK 354 d.
- Not observed: the HKG colo (spikes ran at YVR/PDX). All APIs take an explicit territory param.

## Origin

Synthesized from spikes: 011, 012
Source files available in: sources/011-edge-chart-sources/, sources/012-genre-charts/
