# YouTube Music Source (search · play · lyrics; account = legal-gated)

Proven by spikes 005–008 (live InnerTube probes from a datacenter IP, EN/JP/CJK/indie queries).
**BUILT as Phase 27** — this file is the map of what exists and why, not a greenfield plan.

## Requirements
- **[005] YTMusic `search()` = InnerTube `WEB_REMIX` + songs-filter param, public key, no auth.** `songid =
  videoId`, `uid = ytmusic:${videoId}`. Parse `musicResponsiveListItemRenderer` rows; disambiguate
  artist/album via each run's `pageType`. Cover URL is resizable (`=w{n}-h{n}`) → free HQ, no backfill.
- **[006] YTMusic playback = `ANDROID_VR` player client + a cached `visitorData` token → itag 140 (AAC/mp4).**
  Formats are DIRECT urls (NO signature cipher, NO `n` throttle) → no base.js engine needed. iOS Safari needs
  AAC (itag 140), not Opus (251).
- **[006] Stream URLs are IP-locked + expire ~6 h → MUST proxy bytes through the edge**, never set
  `<audio>.src` to a raw googlevideo URL. Reuse the `audius` proxy pattern: `/api/ytmusic/stream/{videoId}`
  → Worker calls player + streams the body (own-origin src, CORS/Capacitor-safe). `resolve()` re-fetches per
  play (no long URL caching).
- **[006] OPEN (verify on a deployed Worker): player + googlevideo subrequests must egress the same
  Cloudflare IP**, and bot-challenge rate under load must be acceptable. This path is adversarial and will
  need ongoing maintenance (YouTube fights extractors). ToS/legal risk flagged for a human call.
  → **ANSWERED post-build: NO.** googlevideo refuses the edge byte fetch with 403 even inside one
  invocation (see Constraints). Native APK resolves on-device instead.
- **[007] (verdict) Lyrics = GO:** plain lyrics via `next→browse` (no auth); timed LRC is NOT exposed by YT →
  reuse existing `crossSourceLyric` by name+artist.
- **[008] (verdict) Account/library = SPLIT to a later, legal-gated milestone.** Cookie auth is native-only,
  only the grey-area TV OAuth device flow works on web, genre is not a field (infer it). Ship NO auth.

## How to Build It
Real code: `src/lib/proxy/ytmusic-innertube.ts` (pure constants + player helpers, client-importable),
`src/lib/proxy/ytmusic.ts` (edge POST, visitorData cache, lyrics walkers), `src/routes/api/ytmusic/{search,lyrics,stream/[videoId]}/+server.ts`,
`src/lib/sources/ytmusic.ts` (adapter), `src/lib/services/ytmusic-native.ts` (APK on-device resolver).

1. **Search (edge forwards, client parses).** `POST https://music.youtube.com/youtubei/v1/search?prettyPrint=false&key=<WEB_REMIX_KEY>`
   ```js
   { context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'US' } },
     query, params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D' }   // Songs chip
   ```
   Headers: `content-type: application/json`, `origin`/`referer: https://music.youtube.com`. Post-spike the
   route also fires the **Videos** chip (`EgWKAQIQAWoKEAkQChAFEAMQBBAV`) in parallel (`allSettled`) and
   returns `{ ytmusicMerged: [songs, videos] }` — video-only uploads (niche/CN-unavailable) surface too.
2. **Row parse** (port of `harness.mjs` `rowToStub`): walk for every `musicShelfRenderer`, then per row
   - videoId: `overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint.videoId`
     → fallback `playlistItemData.videoId` → `flexColumns[0]…runs[0].navigationEndpoint.watchEndpoint.videoId`
   - title = `flexColumns[0]` first run; `flexColumns[1]` runs classified by
     `navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType`
     (`MUSIC_PAGE_TYPE_ARTIST` / `_ALBUM`), `/^\d+:\d{2}$/` = duration
   - cover = last of `thumbnail.musicThumbnailRenderer.thumbnail.thumbnails[]`
3. **visitorData.** Read `responseContext.visitorData` from ANY WEB_REMIX response (`extractVisitorData`).
   Cache edge-side ~6 h; never echo it (or the key) in a response body.
4. **Stream route** `GET /api/ytmusic/stream/:videoId` — `POST https://www.youtube.com/youtubei/v1/player?…key=`
   ```js
   { context: { client: { clientName: 'ANDROID_VR', clientVersion: ANDROID_VR_VERSION, androidSdkVersion: 32,
       deviceModel: 'Quest 3', hl: 'en', gl: 'US', visitorData } },
     videoId, contentCheckOk: true, racyCheckOk: true }
   // UA: com.google.android.apps.youtube.vr.oculus/${ANDROID_VR_VERSION} (Linux; U; Android 12; Quest 3) gzip
   ```
   `isPlayable` (`playabilityStatus.status === 'OK'`) → else refresh visitorData ONCE, retry, else 502.
   `selectAudioFormat`: itag 140 with direct `url` → else best `audio/mp4` direct url → else 502. Fetch
   that url in the same invocation with `Range` forwarded, stream `res.body` back as `audio/mp4` with
   Accept-Ranges/Content-Range/Content-Length passed through (206 → seeking works).
5. **Adapter `resolve()`.** Web: stamp `audioUrl = apiUrl('/api/ytmusic/stream/' + videoId)` (no JSON hop,
   audius pattern). Native: `nativeResolveStreamUrl()` does search-for-visitorData + player over
   `CapacitorHttp` from the phone's residential IP and returns the googlevideo url; null → proxy stamp.
   Stamp `quality = '128k'` / `'128k AAC'` explicitly (no file extension to infer from).
6. **Lyrics, two tier.** `/api/ytmusic/lyrics?videoId=` does `next` (`{context, videoId, isAudioOnly:true}`) →
   tab whose title matches `/lyric/i` → its `endpoint.browseEndpoint.browseId` → `browse` →
   `musicDescriptionShelfRenderer.description.runs[].text` + `footer` attribution (Musixmatch/LyricFind).
   Returns `{text, attribution}` or `{}`; edge-cache 1 day. Adapter stores non-empty text in `track.lrc`;
   a miss leaves it null so `ensureTrackDetails` fires `crossSourceLyric(name, artist)` for timed LRC.
7. **Registry:** appended LAST, `enabledByDefault: true`, **`autoResolveEligible: false`** — searchable and
   explicit-pick only, never a cross-source failover target for a non-ytmusic track.

## What to Avoid
- **Don't set web `<audio>.src` to a raw googlevideo URL** — signed for the caller's IP → 403. And a
  browser can't call InnerTube at all (no CORS; an `Origin: https://openmusic.lol` POST gets 403).
- **Player clients that fail from a datacenter:** `ANDROID_MUSIC`/`ANDROID_VR` without visitorData =
  `LOGIN_REQUIRED`, `IOS` = 400, `TVHTML5_SIMPLY_EMBEDDED_PLAYER` = unsupported, `WEB_REMIX` = `UNPLAYABLE`.
  visitorData is MANDATORY even on a current ANDROID_VR version.
- **Never pick itag 251** (Opus/webm) — Safari won't play it. Ignore `signatureCipher` formats; we solve no cipher.
- **Don't parse `flexColumns[1]` positionally** — breaks on rows with no album link. Classify by `pageType`.
- **Don't expect an empty search** — a nonsense query still returns 20 fuzzy rows. Don't re-rank in the
  adapter either: `scoreMatch` at the search page owns ranking (adapter-level sort was dead code).
- **Don't export helpers from `+server.ts`** — SvelteKit 500s with `Invalid export` at request time; unit
  tests miss it. Pure helpers live in `ytmusic-innertube.ts`.
- **Don't route media bytes through `apiFetch`** — a long stream would hold a governor slot. Edge uses raw
  `fetchWithRetry`; key edge caches on an own-origin Request, never the key-bearing upstream URL.
- **No open relay:** only fetch the `url` from the player response; `videoId`/`q` go only into fixed-URL bodies.
- **Don't set `lrcUrl`** and don't add ytmusic to `LYRICLESS_SOURCES` (it HAS plain lyrics).
- **Don't add auth "while you're here"** (008). No OAuth/device-flow/cookie/token code in this source.
  Data API v3 can't give history or genre regardless (history removed; genre is not a field).
- **Don't enable the global CapacitorHttp patch** — one explicit call site only, or every request reroutes.

## Constraints
- **ROTTING VERSION PIN:** stale `ANDROID_VR_VERSION` → `LOGIN_REQUIRED` + zero formats → stream route
  **502** → every ytmusic track silently skipped. Fix = bump the one constant in `ytmusic-innertube.ts`
  (spike used 1.60.19; 1.60.x died 2026-09; 1.65.10 verified). One bump fixes edge AND APK.
- **403 with `content-type: audio/mp4` (content-length 0) = googlevideo refused the EDGE byte fetch.** The
  player call succeeded; the url is FULL-IP-locked (`ip` in `sparams`, no `ipbits`) and Cloudflare's
  datacenter IP is refused. No in-scope fix on web; the same chain from a residential IP serves 206.
- URLs expire ~6 h (`expiresInSeconds ≈ 21540`); `RESOLVE_URL_TTL_S` (15 min) re-resolves well inside it.
- itag 140 = AAC-LC 128 kbps 44.1 kHz. Metadata endpoints (search/next/browse) are NOT bot-gated; only player is.
- Bot gate is IP-reputation driven — one colo issuing many player calls may be challenged harder.
- **Legal/ToS:** serving extracted YouTube audio violates YouTube ToS (same class as the CN Meting proxies,
  higher profile). Account sync would additionally impersonate the YouTube-TV OAuth client and store
  per-user refresh tokens — a new threat model. Human decision, not assumed.
- Show the lyrics `footer` attribution when a UI slot exists (Track has no attribution field yet).

## Origin
Synthesized from spikes: 005, 006, 007, 008 (+ post-build facts from Phase 27 and quick-260915-30m / -3ng)
Source files available in: sources/005-ytmusic-innertube-search/, sources/006-ytmusic-playable-stream/,
sources/007-ytmusic-lyrics/, sources/008-ytmusic-account-library/
