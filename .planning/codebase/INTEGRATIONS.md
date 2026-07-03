# External Integrations

**Analysis Date:** 2026-07-03

> All external calls that carry a secret, or that are CORS-blocked for the browser, go
> through same-origin SvelteKit server routes under `src/routes/api/`. The client never
> talks to a CN/Deezer/Last.fm upstream directly except a few CORS-open hosts (iTunes,
> Cover Art Archive). Client `/api/*` URLs are built via `apiUrl()`/`apiFetch()`
> (`src/lib/services/api-base.ts`) so the same code runs same-origin on web and
> cross-origin (`https://openmusic.lol`) inside the native APK.

## APIs & External Services

### Music metadata sources — CN (via catch-all proxy `src/routes/api/[source]/[...path]/+server.ts`)

Registered in `src/lib/proxy/proxy-registry.ts`; per-source URL builders in `src/lib/proxy/`. The route validates the source against `PROXIES`, builds the upstream URL, fetches with `fetchWithRetry` (native `AbortSignal.timeout(8000)`, up to 3 attempts, 429/5xx backoff — `src/lib/proxy/http.ts`), and forwards the upstream body UNCHANGED with own-origin CORS.

- **Netease** — `https://api.qijieya.cn/meting/` (Meting proxy). Types: `search`, `url`, `lrc`. No auth. `src/lib/proxy/netease.ts`. Client adapter: `src/lib/sources/netease.ts`.
- **QQ** — `https://tang.api.s01s.cn/music_open_api.php` (tang API). `search`/`detail` share one endpoint (distinguished by `mid`). No auth. `src/lib/proxy/qq.ts` / `src/lib/sources/qq.ts`.
- **Kuwo** — `https://kw-api.cenguigui.cn/` (cenguigui kw-api). `search` (`name=`) / `detail` (`id=&type=song&level=zp`). No auth. `src/lib/proxy/kuwo.ts` / `src/lib/sources/kuwo.ts`.
- **JOOX** — `https://apicx.asia/api/joox_music` (apicx proxy). `search`/`detail`. **Auth: `JOOX_TOKEN` injected server-side from `platform.env`** (the ONLY proxy that reads `env`); non-secret `br=4` (Atmos/lossless tier) also injected. Missing token throws (refuses to emit `token=undefined`). Never logged. `src/lib/proxy/joox.ts` / `src/lib/sources/joox.ts`.

### Music metadata sources — dedicated routes (NOT the catch-all)

- **5sing (Kugou UGC)** — search `http://search.5sing.kugou.com/home/json` (`src/routes/api/fivesing/search/+server.ts`), url `http://mobileapi.5sing.kugou.com/song/getSongUrl` (`src/routes/api/fivesing/url/+server.ts`). Plain **http** upstream (TLS cert mismatch on https; CF Workers allow outbound http; client still uses own-origin https — no mixed content). No auth. Client adapter: `src/lib/sources/fivesing.ts`.
- **Jamendo** — `https://api.jamendo.com/v3.0/tracks/` (`src/routes/api/jamendo/search/+server.ts`). Auth: **public `JAMENDO_CLIENT_ID`** from `platform.env` (baked in `wrangler.jsonc` `vars`). `audioformat=mp32` returns a direct progressive mp3 in `audio`. Absent client_id → empty `{ results: [] }`. Client adapter: `src/lib/sources/jamendo.ts`.
- **Audius** — search `https://api.audius.co/v1/tracks/search?app_name=musicsquare` (`src/routes/api/audius/search/+server.ts`); **stream relay** `https://api.audius.co/v1/tracks/{id}/stream?app_name=musicsquare` (`src/routes/api/audius/stream/[id]/+server.ts`). `app_name` is a free-text id, NOT a secret, appended server-side. The stream route follows the upstream 302 → signed/expiring `storage.googleapis.com` mp3 and pipes bytes (must NEVER JSON-return the redirect target); forwards `Range`, propagates `Accept-Ranges`/`Content-Range`/`Content-Length` for 206 seeking; `AbortSignal.timeout(15000)`, retries=1. Client adapter: `src/lib/sources/audius.ts`.

### Cover art / artwork enrichment

- **Deezer** (PRIMARY cover source) — `https://api.deezer.com/*`, keyless. Routes: `search` (`src/routes/api/deezer/search/+server.ts`), `chart`, `album` (search + by-id), `artist` (search + by-id), `related`, `artist-albums`. Reshaped client-facing JSON; image host allow-list `*.dzcdn.net` / `cdn-images.dzcdn.net`; 30s preview host `*.dzcdn.net`. Client service: `src/lib/services/deezer.ts`.
- **iTunes Search** (Western-catalog + artist fallback covers) — `https://itunes.apple.com/search`, keyless, `Access-Control-Allow-Origin: *` so it is called DIRECTLY from the client (no proxy). Song: `entity=song`; artist: `entity=album&attribute=artistTerm`. Artwork upgraded `100x100bb` → `1200x1200bb`. CDN host `is1-ssl.mzstatic.com`. `src/lib/services/itunes-cover.ts`, consumed by `src/lib/services/cover-backfill.ts`.
- **Cover Art Archive (CAA)** — `https://coverartarchive.org/release-group/{mbid}/front-250`, keyless, called DIRECTLY from the client (307-redirects to image or 404s; no rate limit). `src/lib/services/cover-art.ts`.
- **Last.fm images** — surfaced through the Last.fm routes below; host allow-list `last.fm` / `*.last.fm` / `*.fastly.net` (`lastfm.freetls.fastly.net`).

### Metadata enrichment / discovery — Last.fm (`https://ws.audioscrobbler.com/2.0/`)

- **`/api/similar`** — `artist.getSimilar` → `{ artists: string[] }` (`src/routes/api/similar/+server.ts`).
- **`/api/lastfm/info`** — `track/artist/album.getInfo` (allow-listed) → tags/bio/image/listeners/playcount/album-tracklist; filters the grey-star placeholder hash; `safeImageUrl`/`safeLastfmUrl` guards (`src/routes/api/lastfm/info/+server.ts`).
- **`/api/lastfm/discovery`** — chart/tag/top-albums discovery shelves for the home screen (`src/routes/api/lastfm/discovery/+server.ts`).
- Auth: **optional `LASTFM_KEY`** injected server-side, never echoed. Absent key is a SUPPORTED state → 200 empty shape / `{ artists: [] }` (client degrades to same-artist fallback). `LASTFM_SECRET` typed for future signed calls (auth/scrobble) — not currently wired.

### Translation

- **`/api/translate`** (POST) — unofficial Google Translate `https://translate.googleapis.com/translate_a/single` (no key). Batches lyric/name lines with a sentinel-join, CHUNK_SIZE=20 to dodge echo-mode, per-line fallback (concurrency 6), returns `{ translated: string[], flags: boolean[] }` (1:1 aligned; `flags` marks GENUINELY-translated lines so clients don't cache fallbacks). `src/routes/api/translate/+server.ts`, client service `src/lib/services/translate.ts` + `src/lib/stores/names.svelte.ts`. See MEMORY: soft-fail echoes originals — gate on the flag.

## Data Storage

**Databases / edge cache:**
- Cloudflare **`caches.default`** (edge cache) on dedicated proxy routes, keyed by the OWN-ORIGIN Request (never the upstream URL / secret), CORS re-applied per hit:
  | Route | TTL | File |
  |-------|-----|------|
  | `/api/deezer/search` | 86400 (24h) | `src/routes/api/deezer/search/+server.ts` |
  | `/api/deezer/chart` | 3600 (1h) | `src/routes/api/deezer/chart/+server.ts` |
  | `/api/deezer/related` | 86400 | `src/routes/api/deezer/related/+server.ts` |
  | `/api/deezer/artist-albums` | 86400 | `src/routes/api/deezer/artist-albums/+server.ts` |
  | `/api/jamendo/search` | 3600 | `src/routes/api/jamendo/search/+server.ts` |
  | `/api/audius/search` | 600 (10m) | `src/routes/api/audius/search/+server.ts` |
  | `/api/fivesing/search` | 3600 | `src/routes/api/fivesing/search/+server.ts` |
  | `/api/lastfm/discovery` | 1h / 6h / 24h per method | `src/routes/api/lastfm/discovery/+server.ts` |
  | `/api/translate` | `Cache-Control: max-age=86400` (browser, no edge put) | `src/routes/api/translate/+server.ts` |
  - NO edge cache / no `Cache-Control`: `/api/[source]/[...path]` (all CN search/detail/lrc), `/api/lastfm/info`, `/api/similar`, `/api/deezer/album`, `/api/deezer/artist`, `/api/audius/stream/[id]`.
- No SQL/D1/KV/R2 database. Cloudflare bindings used: `caches.default` only. `platform.env` used for secrets/vars, not durable storage.

**Client-side storage:**
- `localStorage` keys (all prefixed `openmusic:`):
  - `openmusic:player:v1` — player store (`src/lib/stores/player.svelte.ts`)
  - `openmusic:library:v1` — favorites + playlists (`src/lib/stores/library.svelte.ts`)
  - `openmusic:settings:v1` — user settings incl. enabled sources (`src/lib/stores/settings.svelte.ts`)
  - `openmusic:history:v1` — play history (`src/lib/stores/history.svelte.ts`)
  - `openmusic:search-history:v1` — recent searches (`src/lib/stores/searchHistory.svelte.ts`)
  - `openmusic:cover-cache:v1` — resolved cover URLs (`src/lib/services/cover-cache.ts`)
  - `openmusic:action-log:v1` — diagnostic action log (`src/lib/stores/actionLog.svelte.ts`)
  - `openmusic-blob-uri:<uid>` — native blob URI pointers (`src/lib/services/blob-store.ts`)
- **IndexedDB** — `openmusic-blobs` DB, `tracks` store (schema v1), keyed by track `uid`: offline audio Blob cache for downloaded tracks (`src/lib/services/blob-store.ts`). Downloaded songs play from the local blob before the CDN.

**File Storage (native only):**
- App-private offline copy via `Directory.Data` (`@capacitor/filesystem` + `capacitor-blob-writer`, streamed — no base64 round-trip).
- Public `Music/OpenMusic/` copy via the hand-written Kotlin MediaStore bridge (`src/lib/services/media-store.ts`). Web build = no-op.

**Caching (offline shell):**
- Service worker (`src/service-worker.ts`) precaches the app shell into a per-deploy version-keyed cache; pure bypass logic in `src/lib/services/sw-cache.ts` NEVER caches `/api/*` live metadata, cross-origin audio CDN bytes, 206 range streams, or non-GET. Registered on web (`register: true`); DISABLED on native (`register: false`, `svelte.config.js`).

## Authentication & Identity

- No end-user auth / login. Anonymous, device-local (localStorage/IndexedDB) library + settings.
- Upstream auth is server-injected: `JOOX_TOKEN` (required), `LASTFM_KEY` (optional), `JAMENDO_CLIENT_ID` (public), `LASTFM_SECRET` (reserved for future signed Last.fm scrobble/love — not wired). All read via `platform.env` in server routes; none reach the client bundle.

## Monitoring & Observability

**Error Tracking:** None (no Sentry/analytics SDK). Proxy routes swallow upstream errors and return best-effort empty shapes (never block playback).

**Logs:** In-app diagnostic action log at Settings → Activity log (`src/lib/stores/actionLog.svelte.ts`, `logAction`), persisted to `openmusic:action-log:v1` — used to debug playback (esp. Android background). Server routes deliberately NEVER log secrets or signed upstream URLs.

## CI/CD & Deployment

**Hosting:**
- Web: Cloudflare Pages (`openmusic.lol`; legacy `openmusic.pages.dev`). CF preview subdomains allow-listed in `src/lib/proxy/http.ts`.
- Android: signed APK via GitHub Releases.

**CI Pipeline (GitHub Actions):**
- `.github/workflows/android-main.yml` — rolling prerelease APK on push to `main`.
- `.github/workflows/android-release.yml` — signed `assembleRelease` (Node 22 + pnpm frozen lockfile → `pnpm build:native` → `npx cap sync android` → `./gradlew assembleRelease` → sign with release keystore → `softprops/action-gh-release`).

## Environment Configuration

**Server (Cloudflare `platform.env`, typed in `src/lib/proxy/proxy-types.ts`):**
- `JOOX_TOKEN` (required for JOOX playback) — secret via `wrangler pages secret put`.
- `LASTFM_KEY` (optional) — secret; enables Last.fm info/similar/discovery.
- `LASTFM_SECRET` (optional) — secret; reserved for signed Last.fm calls.
- `JAMENDO_CLIENT_ID` (public) — `wrangler.jsonc` `vars`.

**Build-time (Vite):**
- `VITE_API_BASE` — empty on web; `https://openmusic.lol` on native (`src/lib/services/api-base.ts`).
- `BUILD_TARGET=native` — selects `adapter-static` + disables service-worker registration.

**Secrets location:**
- Production: Cloudflare Pages secrets (`wrangler pages secret put …`).
- Local dev: `.dev.vars` (present at repo root; keys `JOOX_TOKEN`, `LASTFM_KEY`, `LASTFM_SECRET` — contents NOT read).
- Android signing: GitHub repo secrets (`RELEASE_KEYSTORE`, `KEY_ALIAS`, `KEYSTORE_PASSWORD`, `KEY_PASSWORD`); `release.jks` at repo root.

## Webhooks & Callbacks

**Incoming:** None.
**Outgoing:** None. All outbound is request/response fetch to the upstreams listed above.

## CORS Posture

- Central CORS seam: `src/hooks.server.ts` adds allow-listed CORS to every `/api/*` response and answers OPTIONS 204 (covers `/api/translate`, which had none per-route). Origin allow-list (never `*`) in `src/lib/proxy/http.ts`: `openmusic.lol` (+ subdomains), `openmusic.pages.dev` (+ subdomains, cutover), `localhost`/`127.0.0.1` (dev), `https://localhost` + `capacitor://localhost` (Capacitor WebView). `Vary: Origin` set for edge-cache correctness. Never emits `Access-Control-Allow-Origin: *` (JOOX-token-bearing proxy must not be an open relay).

## Optimization Opportunities (integration level)

- **Missing edge caching on hot routes** — `/api/[source]/[...path]` (all four CN sources: every search + every track-detail + lrc fetch), `/api/lastfm/info`, and `/api/similar` do NOT use `caches.default` and set no `Cache-Control`. Repeat searches/plays re-hit upstream each time. Deezer/Jamendo/Audius/5sing/discovery already cache; the CN catch-all and Last.fm info/similar are the biggest un-cached surfaces. CN detail/lrc are effectively immutable per track — strong 24h candidates; Last.fm info/similar are near-static — 6-24h candidates. `/api/deezer/album` and `/api/deezer/artist` (by-id) are also uncached despite near-static data.
- **Redundant cover network calls** — three independent client-side cover resolvers (Deezer via proxy, iTunes direct, CAA direct) plus the CN-source backfill can each fire per tile; `cover-cache.ts` mitigates but per-MEMORY (`cover-cache stale-URL root cause`) failures aren't cached and there's no per-entry eviction, so misses can re-fan-out. Consider caching negative results and deduping the resolver fan-out.
- **`/api/translate` has no edge cache** — only a browser `Cache-Control: max-age=86400`; identical lyric/name batches from different clients re-hit Google. An edge `caches.default` keyed on `{to, lines-hash}` would cut upstream calls and echo-mode risk. (POST body caching needs a manual cache-key Request.)
- **`/api/deezer/search` empty-`q` short-circuit** returns without `Cache-Control` (fine), but the by-id Deezer routes lacking any cache are the higher-value gap.
- **Audius stream relay bandwidth** — `/api/audius/stream/[id]` pipes full audio bytes through the Worker (necessary — the GCS URL is signed/expiring), so every Audius play consumes Worker egress. This is unavoidable given the upstream design but is worth noting as the one route where bytes (not just metadata) transit the edge.

---

*Integration audit: 2026-07-03*
