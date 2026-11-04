# Phase 43: SoundCloud + Bandcamp sources - Research

**Researched:** 2026-11-04
**Domain:** New own-audio source adapters (SoundCloud api-v2, Bandcamp public/mobile API) wired through the registry-driven resolver stack
**Confidence:** HIGH for Bandcamp and for the codebase touch-map. MEDIUM for SoundCloud: the upstream behaviour was verified live, but the playback format is a blocking decision (see Summary).

## Summary

**Bandcamp works cleanly** (verified live 2026-11-04). The POST `bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic` endpoint with `search_filter:"t"` returns up to 50 track rows. Each row carries `id` + `band_id`, which goes straight into the mobile JSON API `bandcamp.com/api/mobile/24/tralbum_details?band_id=&tralbum_type=t&tralbum_id=`. That call returns `duration` and `streaming_url['mp3-128']`, a `stream_redirect` that 302s to `t4.bcbits.com/stream/...mp3-128/...`. The final URL is plain progressive MP3: 206 on Range, no Referer check, valid 24 h (`ts=` is now+86400). It sends **no CORS header**. `<audio>` plays it directly, but a download `fetch()` needs our own byte-pipe route. No HTML scraping and no caller-supplied URLs are involved.

**SoundCloud is the problem. Progressive streams are essentially gone.** A live sample of 270 search rows across 6 queries found **0-3 % of tracks** with a full (non-snipped) `progressive` transcoding. They are all old uploads (`mp3_0_0`/`mp3_1_0`). Every other row is HLS-only (`aac_160k`/`aac_96k` fMP4 HLS, plus `abr_sq`, which 404s). `taylor swift` returned 24/50 rows as `policy:SNIP` (30 s previews). CONTEXT's discretion note says HLS-only is unplayable and should be excluded. Followed literally, SoundCloud would ship as a source that almost never returns a playable row. The HLS itself is very usable:
- The resolved `playlist.m3u8` (host `playback.media-streaming.soundcloud.cloud`) is VOD with an fMP4 `init.mp4` and ~10 s `dataNNN.m4s` segments.
- All parts are `access-control-allow-origin: *`, signed for about 2 h, and **not IP-locked**.
- Concatenating `init.mp4 + all segments` gives a valid `.m4a`. ffprobe read duration 276.21 s, matching the track's 276 212 ms.

**Primary recommendation:** Build Bandcamp exactly as specified. For SoundCloud, the planner must put a **user decision checkpoint first** (Open Question 1). Recommended answer is Option B: prefer progressive, else native `<audio src=m3u8>` gated on `canPlayType('application/vnd.apple.mpegurl')`, with downloads stitched client-side. The CONTEXT-literal fallback is Option A, progressive-only, which yields about 0-3 % of rows. Whatever is chosen, the SoundCloud adapter, its routes and every resolver hook are the same. Only the transcoding-pick function and the download leg differ.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SC `client_id` scrape + cache | API / Edge (`$lib/proxy/soundcloud.ts`) | Edge Cache API | api-v2 has no CORS for our origin (only `https://soundcloud.com` is allowed, verified), so it must be called edge-side |
| SC/BC search | Edge route → client adapter | — | Upstreams are not CORS-open; the edge parses and filters, the adapter maps to `Track` |
| SC/BC resolve (id → signed media URL) | Edge route (JSON, `no-store`) | Client adapter | Ids only cross the boundary; the edge never pipes playback bytes (stream-url precedent) |
| Playback | Browser (`<audio>` direct CDN URL) | — | SC CDN is CORS `*`; BC needs no CORS for media elements |
| BC download bytes | Edge byte-pipe `/api/bandcamp/stream` | Browser fetch | `bcbits.com` sends no ACAO, so a `fetch()` → Blob would be CORS-blocked (ccmixter precedent) |
| SC download bytes | Browser fetch (direct, CORS `*`) | — | Progressive: one fetch. HLS: fetch init+segments and concat |
| D-08 mismatch detection | Pure service (`song-variant.ts`) | `fallback.ts walkSource` | Pure predicate, node-testable; the walker is the one seam shared by failover and name-stub |
| D-08 notice | Store (`player.svelte.ts` emits `TranslationKey`) | Layout host (`t()`) | House rule: stores emit keys, the UI localizes |

## Standard Stack

No new npm packages. Everything uses platform `fetch`, `URL`, the Cloudflare Cache API, and existing `$lib` primitives [VERIFIED: codebase grep]. CLAUDE.md says the web app has no third-party runtime deps, and this phase keeps it that way.

| Primitive (reuse, never re-inline) | Location | Use here |
|---|---|---|
| `createHealthGate` | `services/source-health.ts` | one gate per new source, wired in search (ccmixter-health.ts pattern) |
| `apiFetch`, `apiUrl` | `services/api-base.ts` | every `/api/*` call from the adapters; `apiUrl` builds `proxyUrl` |
| `jsonResponse`, `fetchWithRetry`, `corsHeaders`, `corsPreflight` | `proxy/http.ts` | routes |
| `cachedUpstreamJson` | `proxy/edge-cache.ts` | search routes (1 h TTL, ccmixter idiom) |
| `safeImageUrl` + new `*_IMAGE_HOSTS` | `proxy/safe-image-url.ts` | validate covers echoed by edge search routes |
| `hasFreshAudioUrl` / `isTrackReady` | `services/track-ready.ts` | freshness (needs one generic extension, see Pitfall 3) |
| `candidateTier`, `isImplausiblyShort`, `rankAutoCandidates` | `services/song-variant.ts` | D-08 predicate |
| `makeUid` | `sources/types.ts` | uids |

## Package Legitimacy Audit

No external packages are installed in this phase, so slopcheck was not run (nothing to check).
**Packages removed:** none. **Packages flagged:** none.

## Live Upstream Findings (verified 2026-11-04 from this sandbox)

### SoundCloud
| Fact | Evidence |
|---|---|
| `client_id` = 32-char `client_id:"…"` literal in the **last** `https://a-v2.sndcdn.com/assets/*.js` script on `https://soundcloud.com/` (scan bundles last→first) | Found `swtEGNKrP2w6Z5B8DVvAurWCwNQBlgMd` in `55-528f1bd3.js` (the 9th of 9 bundles) [VERIFIED: curl] |
| Bad/rotated `client_id` → **401** | [VERIFIED: curl] (re-scrape trigger) |
| Search: `GET https://api-v2.soundcloud.com/search/tracks?q=&client_id=&limit=&offset=` → `{collection[], total_results, next_href}`; CJK queries work | [VERIFIED: curl] |
| By-id: `GET /tracks/{id}?client_id=` (single) and `/tracks?ids=a,b` (batch) return the full track incl. `media.transcodings`, `track_authorization`, `policy`, `duration` | [VERIFIED: curl] |
| Row fields: `id`, `title`, `user.username`, `publisher_metadata.artist` (rarely set), `artwork_url` (`-large.jpg` = 100 px; `-t500x500.jpg` → 200), `duration` ms (30000 for SNIP), `full_duration`, `policy` ∈ ALLOW/MONETIZE/SNIP/BLOCK, `streamable` | [VERIFIED: curl] |
| Transcoding: `{url, preset, snipped, quality, format:{protocol:'progressive'\|'hls', mime_type}}`. Hop `GET {url}?client_id=&track_authorization=` → `{url}`. Works without `track_authorization` today; pass it anyway (web app does) | [VERIFIED: curl] |
| **Progressive** final URL `cf-media.sndcdn.com/…128.mp3?Policy=…`: 206 Range, `ACAO:*`, no Referer check, **TTL ≈ 442 s (~7.4 min)**, no IP condition in Policy | [VERIFIED: curl + base64-decoded Policy] |
| **HLS** final URL `playback.media-streaming.soundcloud.cloud/…/playlist.m3u8?expires=`: `application/vnd.apple.mpegurl`, `ACAO:*`, VOD, `#EXT-X-MAP` init.mp4 + 28 × ~10 s `.m4s` for a 4.6 min track; **expires ≈ 2 h**; not IP-locked | [VERIFIED: curl] |
| init+segments concatenated = valid fMP4/m4a, correct duration | [VERIFIED: ffprobe] |
| Progressive availability: 50-row samples gave billie eilish 0, lofi 1, taylor swift 0 (24 SNIP), 邓紫棋 1, remix 0; 晴天 周杰伦 3/20 | [VERIFIED: curl] |
| api-v2 response carries `X-Datadome-ClientId` in allowed headers, so DataDome bot protection is in front | [VERIFIED: curl headers]; whether CF Worker egress gets challenged is **unverified** [ASSUMED risk] |

### Bandcamp
| Fact | Evidence |
|---|---|
| Search: `POST https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic` JSON `{"search_text":q,"search_filter":"t","full_page":false,"fan_id":null}` → `auto.results[]` (max 50, **no pagination**; `full_page:true` also 50) | [VERIFIED: curl] |
| Row: `type:'t'`, `id` (track), `band_id`, `band_name`, `name`, `album_name`, `album_id`, `art_id`, `img` (`…_3.jpg` 100 px), `item_url_path` | [VERIFIED: curl] |
| CJK works (晴天 → 50, 周杰伦 → 17, 邓紫棋 → 7, mostly covers/remixes/indie) | [VERIFIED: curl] |
| Resolve: `GET https://bandcamp.com/api/mobile/24/tralbum_details?band_id=B&tralbum_type=t&tralbum_id=T` → `tracks[0].{duration, streaming_url['mp3-128'], is_streamable}`. Works for album tracks too (returns just that track). `band_id` is **required** ("band_id required"). An unknown id gives **HTTP 200** `{"error":true,"error_message":…}` | [VERIFIED: curl] |
| `streaming_url` = `bandcamp.com/stream_redirect?…` → 302 → `t4.bcbits.com/stream/<hash>/mp3-128/<id>?p=0&ts=&t=&token=`; **ts = now + 24 h** | [VERIFIED: curl] |
| bcbits media: 206 Range, `audio/mpeg`, **no ACAO header**, any/none Referer OK | [VERIFIED: curl] |
| Artwork: `https://f4.bcbits.com/img/a{art_id}_16.jpg` (700 px) and `_10` (1200 px) → 200 | [VERIFIED: curl] |
| `streaming_limit: 3` in tralbum data (fan nag after 3 plays). Cookie-less API calls are assumed not to be capped | [ASSUMED] |

## Architecture Patterns

### System Architecture Diagram

```
search box ──► catalog.searchAll (fan-out, PLAYBACK_ORDER stagger)
                 ├─ soundcloud.search ─► apiFetch /api/soundcloud/search?q&limit
                 │                        └─ edge: clientId() [memo+Cache API, scrape on miss/401]
                 │                           → api-v2 /search/tracks → filter(policy, streamable,
                 │                             playable transcoding) → rows{id,title,artist,cover,duration}
                 └─ bandcamp.search ───► apiFetch /api/bandcamp/search?q
                                          └─ edge: POST autocomplete_elastic → type 't' rows
                                             {id:`${band_id}-${id}`,title,artist:band_name,album,cover}
tap / prefetch / fallback walkSource / resolveNameStub
   └─► ensureTrackDetails ─► SOURCES[src].resolve
          ├─ soundcloud.resolve ─► /api/soundcloud/resolve?id ─► edge: /tracks/{id} → pickTranscoding
          │                          → hop → {url, kind:'progressive'|'hls'}  (no-store)
          └─ bandcamp.resolve ───► /api/bandcamp/resolve?id ─► edge: tralbum_details → stream_redirect
                                     (redirect:'manual') → {url: bcbits mp3, duration} (no-store)
   └─► <audio>.src = direct CDN url   (BC proxyUrl = /api/bandcamp/stream?id, used by downloads)
walkSource hit from a source flagged noticeOnAutoPick + isNotableVersionMismatch → track.versionMismatch
   └─► player.play() after resolve → notice {kind:'version', msg:'toast.mayNotBeOriginal'} → layout t()
```

### Files a new source must touch (template: quick-261101-ccm `97f796d6`, quick-261020-arch `acbdd760`, quick-261020-bili `33360453`, plus later universal edits)

**New files (per source, `<id>` = `soundcloud` | `bandcamp`):**
| File | Purpose |
|---|---|
| `src/lib/sources/<id>.ts` + `.test.ts` | `SourceAdapter` (search + resolve), health gate wired in search |
| `src/lib/proxy/<id>.ts` + `.test.ts` | Pure edge helpers: row parsers/filters, id validators, `pickTranscoding` (SC), `clientId()` scraper (SC), `streamFromTralbum` (BC). Route helpers live here, **never** as extra exports in `+server.ts` |
| `src/lib/services/<id>-health.ts` | `export const <id>Health = createHealthGate();` + failure-shape doc (ccmixter-health.ts verbatim posture: count only HARD failures, never empty) |
| `src/routes/api/<id>/search/+server.ts` | `GET` + `OPTIONS` only |
| `src/routes/api/<id>/resolve/+server.ts` | `GET` + `OPTIONS`, `cache-control: no-store`, never 502/504 (use 503) |
| `src/routes/api/bandcamp/stream/+server.ts` | BC only: byte-pipe with Range passthrough for downloads (ccmixter stream route shape) |
| `src/lib/sources/__fixtures__/<id>.search.json` | Recorded live payloads (recapture with the curl commands above) |

**Edits (verified by grepping every `ccmixter`/`audius` reference):**
| File | Edit |
|---|---|
| `src/lib/sources/types.ts` | Add `'soundcloud' \| 'bandcamp'` to `SourceId`. Add optional `SourceAdapter.noticeOnAutoPick?: boolean` (D-08). Add optional `Track.versionMismatch?: boolean`. Add optional `Track.urlExpiresAt?: number` (Pitfall 3) |
| `src/lib/sources/registry.ts` | 2 imports + 2 `ADAPTERS` keys + history comment (`ADAPTERS` is `Record<SourceId,…>`, so tsc forces this) |
| `src/lib/sources/source-order.ts` | `PLAYBACK_ORDER`: insert after `'suyin'`, before `'archive'` (D-06) |
| `src/lib/config/defaults.ts` | `enabledSources`: `soundcloud: true, bandcamp: true` (quick-261104-defs: every source listed) |
| `src/lib/services/catalog.ts` | Add both to `LYRICLESS_SOURCES` (no upstream lyrics, matching ccmixter). Without this every play fires a pointless cross-source lyric walk |
| `src/lib/proxy/safe-image-url.ts` | `SOUNDCLOUD_IMAGE_HOSTS = { suffix: ['.sndcdn.com'] }`, `BANDCAMP_IMAGE_HOSTS = { suffix: ['.bcbits.com'] }` |
| `src/lib/services/track-ready.ts` | `isUrlFresh` also honours `track.urlExpiresAt` (generic, no source named) |
| `src/lib/services/song-variant.ts` | Pure `isNotableVersionMismatch(candidate, target)` (D-08) |
| `src/lib/services/fallback.ts` | `walkSource`: on hit, if `SOURCES[src].noticeOnAutoPick && isNotableVersionMismatch(resolved, failed)` → `resolved.versionMismatch = true` |
| `src/lib/stores/player.svelte.ts` | `PlayerNotice.kind` += `'version'`; emit once per uid in `play()` after resolve when `versionMismatch`; auto-clear like `corrupt-download` |
| `src/routes/(app)/+layout.svelte` | Notice host branch for `'version'` (copy the `corrupt-download` auto-dismiss branch) |
| `src/lib/i18n/*.ts` (all 16 locales) | `"toast.mayNotBeOriginal"`, **double quotes**, identical key set |
| `src/lib/sources/registry.test.ts` | Order literal at line 18, the `prefs` object (~line 85), posture tests (enabledByDefault true, autoResolveEligible undefined, label) |
| `src/lib/sources/source-order.test.ts` | `fallbackOrder('netease')` expectation gains the two ids after `suyin`; tier-1 expectation unchanged (D-07 proof) |
| `src/lib/services/catalog.test.ts` | `LYRICLESS` list at line 1020 |
| `README.md`, `src/routes/(app)/settings/about/+page.svelte` | Source list copy (81719747 precedent; optional docs) |

**Not touched (verified):** `proxy/proxy-registry.ts` (dedicated routes win over the catch-all; ccmixter/bilibili/archive are not in it). The settings toggle UI (`settings/playback/+page.svelte:185` iterates `Object.values(SOURCES)` + `adapter.label`, so no i18n for names). `dedupe.ts` (uses `playbackRank` from PLAYBACK_ORDER now). `api/stream-url` (its `UPSTREAMS` is redirect-follow only; SC/BC need a JSON hop, so use dedicated resolve routes). `resolve-edge.ts` (qq-only). `preconnect.ts` (observes origins).

**Optional / out of scope, flag only:** `services/share.ts:505-506` `ENTITY_SOURCE_RE` is already stale (missing kugou/migu/suyin/gdnetease/archive/bilibili/ccmixter). Its id class `[A-Za-z0-9]+` cannot carry the Bandcamp `band-track` songid. Adding the two ids is harmless for SC (numeric). For BC it only works if the songid avoids `-`. Recommend leaving share.ts alone this phase and noting it.

### Pattern 1: Adapter search (superset pagination + health gate + `res.ok`)
```ts
// Source: src/lib/sources/ccmixter.ts + audius.ts (repo), hardened per memory apifetch-resolves-non-ok
async search(keyword, page, signal) {
  if (soundcloudHealth.isGated()) return [];
  // SUPERSET contract (searchSession "cumulative-superset"; walkSource calls page=8):
  const limit = Math.min(50, Math.max(1, page || 1) * 10);
  let json: { rows?: Row[] } | null;
  try {
    const res = await apiFetch(`/api/soundcloud/search?q=${encodeURIComponent(keyword)}&limit=${limit}`, { signal });
    if (!res.ok) throw new Error(`soundcloud: ${res.status}`);   // apiFetch resolves 5xx — check INSIDE the try
    json = await res.json();
  } catch (e) { if (!signal.aborted) soundcloudHealth.recordFail(); throw e; }
  if (!json || !Array.isArray(json.rows)) { soundcloudHealth.recordFail(); throw new Error('soundcloud: contract-drift'); }
  soundcloudHealth.recordOk();
  return json.rows.map((r, i) => ({ uid: makeUid('soundcloud', r.id), source: 'soundcloud', songid: r.id, /*…*/, duration: r.duration, displayIndex: i + 1 }));
}
```
For Bandcamp, ignore `page` and always return the full ≤50 list. That still satisfies the superset contract, because the upstream has no pages.

### Pattern 2: SC edge `clientId()` with cache + 401 rescrape
- Per-isolate memo, then `caches.default` own-origin key (`ownOriginCacheKey`) TTL 6 h, then scrape: GET `https://soundcloud.com/`, regex `https://a-v2\.sndcdn\.com/assets/[^"]+\.js`, scan **last→first**, match `/client_id\s*:\s*"([A-Za-z0-9]{32})"/`.
- Every api-v2 call: on 401/403, drop the cache, rescrape **once**, retry once. Never loop.
- Subrequest budget per resolve: 0-2 (client_id) + 1 (`/tracks/{id}`) + 1 (hop) = ≤4. Search: ≤3. Fits the Workers Free 50-subrequest limit [CITED: developers.cloudflare.com/workers/platform/limits — ASSUMED still 50 on Free].

### Pattern 3: SC `pickTranscoding` (pure, unit-tested)
```ts
// exclude: policy 'BLOCK' | 'SNIP', streamable === false, t.snipped === true, url containing '/preview/'
// order:   progressive audio/mpeg  →  (Option B only) hls audio/mp4 aac_160k → aac_96k  →  null (row dropped)
// skip:    'abr_sq' audio/mpegurl (master ABR playlist — its hop 404'd live)
```
The search route drops rows whose `pickTranscoding` is null, so the UI never lists an unplayable row. Under Option B the client adapter also drops `kind:'hls'` rows when `!canPlayHls()`. The edge cannot know the client, so the route returns `kind` per row.

### Pattern 4: D-08 hook (one seam covers failover race, exhaustive pass, prefetch swap, name-stub)
`tryFallback` (race + exhaustive pass), `prefetch cross-source swap` and `resolveNameStub` all resolve through `fallback.ts walkSource`. `ensureTrackDetails` returns `resolveNameStub`'s track unchanged (`catalog.ts:561`), so a marker set in `walkSource` survives every path. `play()` is the single place an auto-picked track becomes audible: `runFallback` → `play(swap, {fromFallback})`, and a prefetch-swapped queue slot → `next()` → `play()`. Emit there, after resolve and the gen-check. Do **not** gate on the audio `playing` event (memory: unreliable on iOS).
```ts
// song-variant.ts — pure
export function isNotableVersionMismatch(c: {title:string; duration?:number}, target: {title:string; duration?:number}): boolean {
  if (candidateTier(c, target.title, [], target.duration) === 1) return true;          // variant title tag or implausibly short
  const a = c.duration, b = target.duration;
  if (!a || !b) return false;                                                          // unknown = neutral (D-03 philosophy)
  return Math.abs(a - b) > Math.max(30, 0.15 * b);                                      // [ASSUMED threshold — discretion]
}
```
The gate is a registry flag (`noticeOnAutoPick: true` on both new adapters), so `fallback.ts` never names a source.

### Anti-Patterns to Avoid
- **Naming a source in aggregation code.** Use flags (`noticeOnAutoPick`, `autoResolveEligible`) and `SOURCES[src]`. (`LYRICLESS_SOURCES` and `download-track.ts:369` are pre-existing named sets. Extending `LYRICLESS_SOURCES` follows the ccmixter precedent. Do not add the new ids to the `download-track.ts` direct-first allowlist. Use `proxyUrl` semantics instead, see Pitfall 5.)
- **Accepting a URL from the client** in any route. Inputs are ids only: SC `/^\d{1,12}$/`, BC `/^\d{1,12}-\d{1,12}$/`. Upstream URLs are built from fixed templates (stream-url T-01-01 discipline).
- **Using `fetchDirectStreamUrl` / `direct-url-cache` for SC.** Its 10-min memo outlives SC's ~7.4-min progressive URL.
- **Byte-piping SC/BC playback through the edge.** Only the BC *download* leg needs the pipe.
- **Extra exports in `+server.ts`.** They 500 at request time and unit tests miss it (memory).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Flaky-upstream backoff | custom counters | `createHealthGate()` | Shared state machine; walker reads `health.isGated()` to mark verdicts inconclusive |
| Edge JSON + CORS + cache | own `Response` building | `jsonResponse`, `cachedUpstreamJson`, `corsPreflight` | 18 copies were already deduped into these |
| Cover host validation | ad-hoc `startsWith` | `safeImageUrl(raw, *_IMAGE_HOSTS)` | Security control: char screen + dot-anchored suffix |
| Freshness | per-source age checks | `hasFreshAudioUrl` + generic `urlExpiresAt` | One definition (track-ready.ts history) |
| Variant/short detection | new regexes | `candidateTier` / `isImplausiblyShort` | Already the ranking authority |
| HLS playback in JS | hls.js / MSE | native `<audio>` (Option B) or progressive-only (A) | Project constraint: no MSE. hls.js would be the first runtime npm dep |
| Bandcamp HTML scraping | `data-tralbum` regex on track pages | mobile `tralbum_details` JSON | JSON, 200 ms, id-keyed, no URL input (the HTML path also works but needs the page URL as input, which is an SSRF-shaped surface) |

## Common Pitfalls

### Pitfall 1: SoundCloud progressive is ~gone (BLOCKING decision)
**What goes wrong:** Under the CONTEXT rule "HLS-only = unplayable", SoundCloud returns about 0-3 % of rows.
**How to avoid:** Resolve Open Question 1 before planning the SC plan. Either way, keep `pickTranscoding` as the single switch.
**Warning signs:** The SC search route returns `rows: []` for mainstream queries even though upstream `total_results` is in the thousands.

### Pitfall 2: Page semantics: `walkSource` searches **page 8**
`fallback.ts:330` calls `searchAll(query, 8, onlySource(src), signal)`. The comment says "fetch 8", but the second argument is `page`. Adapters using limit-multiplication (netease/qq/kuwo/suyin/gdnetease) get 80 rows. **True-page adapters (kugou, migu, fivesing, jamendo, audius `page>1 → []`) get page 8 of results or nothing in every fallback/name-stub walk.** That is a pre-existing bug and out of scope here, but the planner should log it as a todo. **New adapters MUST use superset/limit semantics** (SC `limit=min(50,page*10)`, BC full list), or they can never be a fallback or name-stub hit, which would break D-06.

### Pitfall 3: SC progressive URL TTL (~7.4 min) is shorter than the client trust window (15 min)
`RESOLVED_URL_MAX_AGE_MS = RESOLVE_URL_TTL_S*1000` (15 min). A prefetched SC URL would pass `hasFreshAudioUrl` while already returning 403, which brings back the "~8.4 s strike per dead URL" problem. **Fix:** a generic optional `Track.urlExpiresAt` (ms) honoured by `isUrlFresh`. The SC adapter sets `Date.now() + 5*60e3` for progressive and `+90*60e3` for HLS (m3u8 expires ~2 h). BC (24 h) needs nothing. A pause longer than the TTL followed by resume or seek triggers an audio `error` on the next Range request. The existing single same-src re-resolve handles it. Verify that path in a test.

### Pitfall 4: SC "artist" is usually the uploader, not the performer
`user.username` = "Darren Jun Ng92" for 晴天=周杰伦. `isAutoAcceptable`'s artist gate (`isAutoAcceptableArtist`) will rightly refuse those rows as fallback targets. Use `publisher_metadata.artist ?? user.username`. Optionally split `"Artist - Title"` when `publisher_metadata.artist` is absent (kugou.ts:73-78 has the `' - '` split idiom). Do not loosen the gate. Expected outcome: SC/BC become fallback hits mostly for Western/indie originals. That is correct, since D-06 makes them a last resort.

### Pitfall 5: Bandcamp download CORS
`download-track.ts` fetches `r.proxyUrl ?? r.audioUrl` with `fetch()`. `bcbits.com` sends no ACAO, so the BC adapter **must** set `proxyUrl = apiUrl('/api/bandcamp/stream?id=…')` (own-origin byte-pipe with Range passthrough, re-resolving from the id like ccmixter's stream route). Leave `audioUrl` = the direct bcbits URL for playback. SC progressive `cf-media` and the HLS parts are `ACAO:*`, so SC needs no proxy. **SC HLS (Option B) downloads:** `dlUrl` would be an `.m3u8`, and the saved file would be a playlist. The download path needs a small pure `stitchHls(m3u8Url) → Blob` (fetch playlist, `EXT-X-MAP` + segment URLs, concat, type `audio/mp4`, name `.m4a`) on that branch. Detect it by a generic signal such as `track.audioUrl` ending `.m3u8` path or a `kind` field, not by source name.

### Pitfall 6: `apiFetch` resolves non-ok
Check `res.ok` inside the counted try. A 503 from our route must `recordFail` and throw (memory: apifetch-resolves-non-ok-gate-hole; test with a resolved 503 `Response`).

### Pitfall 7: Bandcamp error is HTTP 200
`tralbum_details` returns `{"error":true}` with status 200. The resolve route must check `json.error` and missing `streaming_url['mp3-128']` (non-streamable track), then 503. The adapter throws, so the walker moves to the next candidate.

### Pitfall 8: Worker egress to SC/BC is unverified
DataDome sits in front of api-v2. Bandcamp is behind Varnish. Neither was testable from CF IPs (local `wrangler pages dev` egresses from the dev machine; memory: wrangler lacks openmusic account access). **Mitigation:** health gates from day one, plus a post-deploy probe task: `curl -s https://openmusic.lol/api/soundcloud/search?q=lofi&limit=5` and `…/api/bandcamp/search?q=lofi`, expecting non-empty `rows`. Memory: pushes to main auto-deploy prod, so ship both sources behind a working gate and do not rely on "don't push" as a safety gate.

### Pitfall 9: Fallback race fan-out load
`tryFallback` races **every** eligible source in parallel. Adding two floor sources means every fallback episode also hits SC + BC through our edge. The SC search costs ~1 subrequest when the `client_id` is cached. Edge search cache (1 h) and health gates bound it. Do not add per-request scraping.

### Pitfall 10: `+server.ts` exports, 502 masking
Routes export only `GET`/`OPTIONS`. Failures return **503**: CF replaces 502/504 bodies, as documented in the stream-url and ccmixter routes.

## Code Examples

### SC resolve route core (edge, `$lib/proxy/soundcloud.ts` helper)
```ts
// Source: live-verified shapes above; route shape = src/routes/api/stream-url/+server.ts
const t = await scJson(`/tracks/${id}`);                     // scJson = clientId + 401 rescrape-once
const pick = pickTranscoding(t);                             // null → 503 'unplayable'
if (!pick) return jsonResult({ error: 'unplayable' }, origin, 503);
const hop = await scJson(`${pick.url}?track_authorization=${encodeURIComponent(t.track_authorization ?? '')}`, /*absolute*/);
if (typeof hop?.url !== 'string' || !hop.url.startsWith('https://')) return jsonResult({ error: 'no url' }, origin, 503);
return jsonResult({ url: hop.url, kind: pick.kind, duration: Math.round(t.duration / 1000) }, origin); // no-store
```

### BC resolve route core
```ts
const [band, track] = id.split('-');                        // id validated /^\d{1,12}-\d{1,12}$/
const r = await fetchWithRetry(`https://bandcamp.com/api/mobile/24/tralbum_details?band_id=${band}&tralbum_type=t&tralbum_id=${track}`, { signal: AbortSignal.timeout(8000) }, 1);
const j = await r.json();
const redir = j?.error ? null : j?.tracks?.[0]?.streaming_url?.['mp3-128'];
if (typeof redir !== 'string') return jsonResult({ error: 'unstreamable' }, origin, 503);
const hop = await fetch(redir, { redirect: 'manual' }); await hop.body?.cancel();
const loc = hop.headers.get('location');                    // https://t4.bcbits.com/stream/…  (24 h)
if (!loc?.startsWith('https://') || !new URL(loc).hostname.endsWith('.bcbits.com')) return jsonResult({ error: 'no redirect' }, origin, 503);
return jsonResult({ url: loc, duration: j.tracks[0].duration }, origin);
```

### Quality tags
Set explicitly (do not use `inferQualityFromUrl`, which labels every non-lossless file `320K`): `quality:'128k', qualityLabel:'128K'` for SC progressive / BC mp3-128 (vocabulary used by kugou/migu/bilibili/ytmusic). For SC HLS, `'128k'` tag with label `'AAC'` or `'160K'` (discretion).

## State of the Art

| Old approach | Current (2026-11) | Impact |
|---|---|---|
| SC `progressive` mp3 for most tracks | HLS-only (fMP4 AAC) for ~97 %+ of tracks; progressive survives only on old mp3 uploads | Progressive-only SC ≈ unusable |
| Chrome desktop: no native HLS | Native HLS rolled out Chrome 141, default-on 142+ (desktop); mobile Chrome already had it | Option B viable on Chrome/Safari; Firefox still no [CITED: tech-ish.com 2025-12-08; status.mux.com incident] |
| Bandcamp HTML `data-tralbum` scrape | Mobile JSON `tralbum_details` by band_id + track id | Cleaner, id-keyed resolve |

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | CF Worker egress IPs are not blocked/challenged by SoundCloud (DataDome) or Bandcamp | Pitfall 8 | Source returns nothing in prod. Health gate contains it; post-deploy probe detects it |
| A2 | Android Chrome + Capacitor Android WebView play fMP4 audio-only HLS natively via `<audio src=m3u8>` and `canPlayType` reports it truthfully | Option B | B degrades to progressive-only on those platforms (feature-detected, so no crash). **Device verification required** (memory: APK debug via emulator + CDP) |
| A3 | Workers Free subrequest cap is still 50 | Pattern 2 | Irrelevant to recommended design (≤4 per request); would only matter for edge-stitch Option C |
| A4 | Cookie-less Bandcamp streams are not play-capped | BC findings | Repeat plays might get preview-capped. Detect by a short duration on resolve |
| A5 | D-08 threshold `max(30 s, 15 %)` | Pattern 4 | Too chatty or too quiet. Tune; covered by unit tests |
| A6 | SC `client_id` stays stable for hours to days | Pattern 2 | More rescrapes (bounded to one per 401) |
| A7 | Using SC's web `client_id` / Bandcamp's mobile API is acceptable to the user ToS-wise (both are unofficial, same posture as the CN sources and ytmusic) | All | Product/legal call, already implicitly made by D-05 |

## Open Questions

1. **SoundCloud playback format (BLOCKING, needs the user):** CONTEXT says HLS-only = unplayable, but that describes ~97 % of SoundCloud.
   - **A. Progressive-only (CONTEXT-literal):** zero new mechanics. SC yields ~0-3 % of rows. Honest but nearly useless.
   - **B. Native HLS fallback (recommended):** `<audio src=playlist.m3u8>` when `canPlayType('application/vnd.apple.mpegurl')` is non-empty. Works on iOS Safari natively and on Chrome 142+ desktop; Android Chrome/WebView need device verification (A2). No MSE, no hls.js, edge pipes no bytes. Costs: a small client `stitchHls` for downloads (CORS `*` verified, concat verified valid). It does relax the CLAUDE.md "No HLS" line to "no HLS *in JS*", which is why the user must approve.
   - **C. Edge stitch route** (`/api/soundcloud/stream?id` concatenating init+segments into one `audio/mp4` body): universal playback and downloads for free, but no Range (seeking past the buffer breaks), the edge relays all bytes, and ~5 + N-segment subrequests (a 10 s segment means the 50-subrequest Free cap is hit around 7.5 min). Not recommended.
   - Recommendation: B. If the user refuses HLS, ship A and say plainly in the plan summary that SC is mostly empty.
2. **PLAYBACK_ORDER between the two:** recommend `…'suyin', 'bandcamp', 'soundcloud', 'archive'…`. Bandcamp is always progressive and `band_name` is a real artist (passes the artist gate more often). D-06 only fixes the pair's position, so this is discretion.
3. **Pre-existing `walkSource` page=8 bug** (Pitfall 2) affects kugou/migu on the floor today. Log it as a separate quick task. Do not fix it inside this phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node | tooling | ✓ (must prefix PATH; default nvm is 22) | v24.13.0 at `~/.nvm/versions/node/v24.13.0/bin` | — |
| pnpm | tests/build | ✓ | 8.15.5 | — |
| vitest | validation | ✓ | `registry.test.ts` + `source-order.test.ts` pass (26 tests, 0.85 s) | — |
| SoundCloud / Bandcamp upstreams | live fixtures | ✓ from sandbox | — | recorded fixtures |
| CF Worker egress to SC/BC | prod | unverifiable pre-deploy | — | health gate + post-deploy curl probe |
| Android device/emulator | Option B HLS verify | emulator AVD `Pixel_3a_API_34` exists (memory) | — | ship B feature-detected; worst case = progressive-only on that platform |
| ffprobe | optional stitch sanity | ✓ | ffmpeg-full | — |

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | Vitest ^4.1.3 (node project, no jsdom), co-located `*.test.ts` |
| Config file | `vite.config.ts` (existing) |
| Quick run | `PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH pnpm exec vitest --run src/lib/sources/soundcloud.test.ts src/lib/sources/bandcamp.test.ts src/lib/proxy/soundcloud.test.ts src/lib/proxy/bandcamp.test.ts src/lib/sources/registry.test.ts src/lib/sources/source-order.test.ts` |
| Full suite | `PATH=…v24…:$PATH pnpm test && pnpm check` |

### Must-haves → Test Map
| Must-have (from D-xx) | Behavior | Type | Command / file | Exists? |
|---|---|---|---|---|
| D-05 | both `enabledByDefault:true`, labels, `defaults.enabledSources` lists both | unit | `registry.test.ts` | ✅ extend |
| D-06 | `PLAYBACK_ORDER` has both after `suyin`, before `archive`; `Object.keys(SOURCES)` follows; `isAutoResolveEligible` true; `fallbackOrder('netease')` ends `…'suyin','bandcamp','soundcloud'` | unit | `source-order.test.ts`, `registry.test.ts` | ✅ extend |
| D-07 | `TIER_1_SOURCES` still `['joox','kuwo','kugou','qq','netease']` | unit | `source-order.test.ts` (existing assertion must stay green unchanged) | ✅ |
| D-01 own audio / search | adapter maps fixture rows → `Track` (uid colon form, cover upgraded + allowlisted, duration s, artist precedence); superset pagination (page 8 → limit 50 SC / full list BC); health gate: 503 Response → `recordFail` + throw; `{rows}` drift → throw; gated → `[]` without fetch | unit | `sources/soundcloud.test.ts`, `sources/bandcamp.test.ts` | ❌ Wave 0 |
| resolve | SC: `/api/soundcloud/resolve` JSON → `audioUrl`, `quality '128k'`, `urlExpiresAt` set, `detailsLoaded`; non-ok → throw. BC: sets `audioUrl` direct + `proxyUrl` own-origin stream, `duration` | unit | same files | ❌ Wave 0 |
| edge helpers | `pickTranscoding` (progressive > hls aac_160k > aac_96k; excludes SNIP/BLOCK/snipped/preview/abr); `client_id` regex over a bundle fixture; id validators reject URLs/garbage; BC `{error:true}` → null; BC row filter `type==='t'`, songid `${band_id}-${id}` | unit | `proxy/soundcloud.test.ts`, `proxy/bandcamp.test.ts` | ❌ Wave 0 |
| covers | `safeImageUrl` accepts `i1.sndcdn.com`, `f4.bcbits.com`; rejects `evilsndcdn.com` | unit | `proxy/safe-image-url.test.ts` | ✅ extend |
| freshness | `hasFreshAudioUrl` false when `urlExpiresAt` passed even if `resolvedAt` < 15 min | unit | `services/track-ready.test.ts` (create if absent) | ❌/✅ check |
| lyricless | both in `LYRICLESS_SOURCES` (no cross-source lyric walk) | unit | `catalog.test.ts:1020` | ✅ extend |
| D-08 predicate | live/remix title → true; Δ40 s on 240 s → true; Δ10 s → false; unknown duration → false | unit | `services/song-variant.test.ts` | ✅ extend |
| D-08 marker | `walkSource` hit from a `noticeOnAutoPick` source with mismatch sets `versionMismatch`; from a CN source, never | unit | `services/fallback.test.ts` (stub adapters, as in `fallback-ring.test.ts`) | ✅ extend |
| D-08 notice | `play()` of a `versionMismatch` track sets `notice {kind:'version', msg:'toast.mayNotBeOriginal'}` once per uid, auto-clears | unit | `stores/player.svelte.test.ts` | ✅ extend |
| i18n | key present in all 16 locales (parity) | unit | `i18n/i18n.test.ts` | ✅ (auto) |
| routes export only verbs | live GET returns 200 JSON | smoke | `pnpm dev` then `curl -s localhost:4321/api/soundcloud/search?q=lofi`, `/api/bandcamp/search?q=lofi`, `/api/bandcamp/resolve?id=2636669871-2834446269`, `/api/bandcamp/stream?id=…` with `Range: bytes=0-99` → 206 | ❌ manual/E2E |
| prod egress | non-empty rows from openmusic.lol | smoke (post-deploy) | `curl -s https://openmusic.lol/api/soundcloud/search?q=lofi&limit=5` | manual |
| Option B only | HLS row plays on Android Chrome + APK WebView; `canPlayType` gate drops HLS rows on Firefox | manual (device) | emulator + CDP recipe | manual-only (A2) |

### Sampling Rate
- Per task commit: the quick-run command above (< 5 s).
- Per wave merge: `pnpm test`.
- Phase gate: `pnpm test` + `pnpm check` green + local route smoke curls, then post-deploy probe.

### Wave 0 Gaps
- [ ] `src/lib/sources/__fixtures__/soundcloud.search.json` (record api-v2 collection; include ≥1 progressive, ≥1 HLS-only, ≥1 SNIP row, e.g. query `晴天 周杰伦`, ids 219758544 / 101290022 / 253812759)
- [ ] `src/lib/sources/__fixtures__/bandcamp.search.json` + `bandcamp.tralbum.json` (band 2636669871 / track 2834446269; plus an `{"error":true}` sample)
- [ ] A small SC bundle snippet fixture string for the `client_id` regex test
- [ ] Test files: `sources/{soundcloud,bandcamp}.test.ts`, `proxy/{soundcloud,bandcamp}.test.ts`

## Security Domain

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | — (no user auth; `client_id` is a public web key, edge-only) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | Id regexes at every route (SC `/^\d{1,12}$/`, BC `/^\d{1,12}-\d{1,12}$/`), `q` trimmed + length-capped, `limit` clamped (ccmixter idiom) |
| V6 Cryptography | no | — |
| V12/V13 SSRF / API | yes | Upstream URLs only from fixed templates; the BC redirect `Location` must be https + `.bcbits.com` before returning/piping; SC hop URL must be https; `safeImageUrl` on every echoed cover |

| Threat | STRIDE | Mitigation |
|---|---|---|
| Open proxy via stream route | Elevation/Spoofing | Ids only; re-derive the media URL server-side; host check before fetch (ccmixter stream route model) |
| Cover URL injection into CSS `url()` | Tampering | `safeImageUrl` char screen + host allowlist |
| Upstream abuse/rate-limit from our edge | DoS (of us) | Edge search cache 1 h, health gates, `client_id` cached 6 h, rescrape once per 401 |
| Leaking secrets | Info disclosure | None introduced (no new secrets; `client_id` is public) |

## Project Constraints (from CLAUDE.md)
- SvelteKit + Svelte 5 runes. Stores in `*.svelte.ts`, pure logic in `.ts`, tabs, single quotes (i18n files: **double quotes**, identical key sets across all 16 locales).
- Registry-driven: aggregation code never names a source. Adding a source = adapter + edge helper/routes + registry line.
- Native `<audio>` only. **No MediaSource/HLS/Web Audio** (Option B changes this line, so it needs user sign-off).
- Never-throw services. Adapters throw only for typed contract drift recorded by `allSettled`. Use `apiFetch` for `/api/*` and check `res.ok`.
- `+server.ts` exports only HTTP verbs; helpers in `$lib`.
- All `/api/*` CORS via `hooks.server.ts` / `corsHeaders` (never `*`).
- Zero `as any` in production; `import type`; `$lib` aliases; comment non-obvious decisions with a decision ref (`D-0x`, phase-43 ids).
- Quality gate = `pnpm check` + `pnpm test`; Node 24 PATH prefix (memory).
- Git: work on main; pushes to main auto-deploy prod (memory). Use `pnpm run deploy`, never `pnpm deploy`.

## Sources

### Primary (HIGH)
- Live curl probes, 2026-11-04: soundcloud.com bundles, api-v2 `/search/tracks`, `/tracks/{id}`, `/tracks?ids=`, transcoding hops, cf-media + playback.media-streaming.soundcloud.cloud headers; bandcamp autocomplete_elastic, mobile `tralbum_details`, `stream_redirect`, bcbits headers, artwork sizes; ffprobe of the stitched HLS.
- Repo: `src/lib/sources/{types,registry,source-order,audius,ccmixter}.ts`, `src/lib/services/{catalog,fallback,track-ready,song-variant,download-track,stream-url}.ts`, `src/lib/proxy/{safe-image-url,proxy-registry,http}.ts`, `src/routes/api/{stream-url,ccmixter/*}/+server.ts`, `src/lib/stores/player.svelte.ts`, `src/routes/(app)/+layout.svelte`; commits `97f796d6`, `acbdd760`, `33360453`, `99d1b36f`.

### Secondary (MEDIUM)
- [tech-ish.com: Chrome/Edge native HLS on desktop (142+)](https://tech-ish.com/2025/12/08/google-chrome-microsoft-edge-chromium-native-hls-playback-desktop)
- [Mux status: Chrome 141 native HLS rollout incident](https://status.mux.com/incidents/g4wcv5cm02sg)
- [Demuxed 2025: A default HLS player for Chrome (Chromium engineer talk abstract)](https://university.svta.org/conference-proceedin/a-default-hls-player-for-chrome-and-why-i-hate-the-robustness-principle/)

### Tertiary (LOW)
- [Mingus' blog: SoundCloud api-v2 + DataDome 403s](https://minguss.codeberg.page/2025/12-23-soundcloud_api.html)
- [DEV: scraping SoundCloud 2026 (client_id rotation, per-IP blocks)](https://dev.to/agenthustler/scraping-soundcloud-in-2026-public-api-track-data-and-artist-stats-47kn)
- [videosdk.live native HLS guide (Android Chrome "device-dependent")](https://www.videosdk.live/developer-hub/hls/native-hls-playback)

## Metadata
**Confidence breakdown:**
- Codebase touch-map: HIGH (every reference grepped, template commits diffed).
- Bandcamp: HIGH (full search → resolve → media chain verified live).
- SoundCloud upstream: HIGH. SoundCloud playback strategy: MEDIUM (depends on the user decision + Android HLS device check).
- D-08 hook: HIGH for placement; threshold ASSUMED.
- Worker egress: LOW (unverifiable pre-deploy).

**Research date:** 2026-11-04
**Valid until:** ~2026-11-18 for SoundCloud (client_id/bundle layout and transcoding mix move fast); 30 days for the rest.
