# Quick Research: Add more song-resolver sources without big changes

**Researched:** 2026-06-16
**Domain:** SvelteKit/Cloudflare edge music source adapters
**Confidence:** HIGH (both top picks probed live this session)

## Summary

Two genuinely low-effort, edge-reachable adds stand out, both probed live from this machine and returning direct `audio/mpeg` URLs playable in a native `<audio>` element:

1. **Audius** — Western/indie + UGC, fully public API (no key), `is_streamable` flag, stream endpoint 302s to a signed Google Cloud Storage mp3. Net-new supply beside Jamendo. **`enabledByDefault: false`** (indie/UGC catalog, like Jamendo's intent).
2. **GDStudio** (`music-api.gdstudio.xyz`) — a single uniform aggregator that fronts netease/kuwo/joox/kugou/migu/tidal/etc. Returns id→`url` (direct mp3) + LRC + cover. This is the cleanest path to **mainstream CN coverage we don't already have (kugou, migu)** through ONE adapter. **`enabledByDefault: false`** initially (it OVERLAPS our existing netease/kuwo/joox and has a 60-req/5-min cap — opt-in avoids doubling fan-out load and duplicate results).

**Primary recommendation:** ADD **Audius** first (zero overlap, no key, no rate worry, dedicated-route proxy). ADD **GDStudio** second, scoped to its *kugou + migu* sources only (the genuine gap), opt-in.

Everything else from musicdl (Spotify, TIDAL, Qobuz, Apple Music, YouTube Music, SoundCloud, Kugou-official, Migu-official, Baidu/Qianqian-official) is a BIG change (DRM, HLS, signing, or geo-block) — see "What to SKIP."

## RANKED RECOMMENDATION

| Source | Endpoint / host | Edge-reachable? | Playable direct URL? | Signing/secret? | `enabledByDefault` rec | Verdict |
|--------|-----------------|-----------------|----------------------|-----------------|------------------------|---------|
| **Audius** | `api.audius.co/v1/tracks/search` + `/v1/tracks/{id}/stream` | ✅ VERIFIED (curl 200/206, prod env) | ✅ stream 302 → GCS `audio/mpeg`, Range OK | ❌ none (public, `app_name` only) | **false** (indie/UGC, mirrors Jamendo) | **ADD** |
| **GDStudio (kugou+migu)** | `music-api.gdstudio.xyz/api.php` (`types=search\|url\|lyric\|pic`) | ✅ VERIFIED reachable (curl); kugou/migu enum INTERMITTENT this session | ✅ `types=url` → direct `.mp3` `audio/mpeg`, Range OK | ❌ none (public, attribution requested) | **false** (overlap + 60/5min cap) | **ADD (scoped)** |
| Free Music Archive | freemusicarchive.org | n/a | n/a | n/a | — | **SKIP** (public API shut down) |
| Kugou / Migu / Baidu (official direct) | upstream CN APIs | ❌ geo/rate-block from non-CN edge | varies | ✅ HMAC signing (kugou) | — | **SKIP / RISKY** (covered via GDStudio instead) |
| Spotify / Apple Music / YT Music | official | ✅ | ❌ DRM / no raw file / HLS | ✅ OAuth | — | **SKIP** (DRM, not native `<audio>`) |
| TIDAL / Qobuz | official | ✅ | ❌ token-gated, paid | ✅ | — | **SKIP** |
| SoundCloud (public) | api.soundcloud.com | partial | ⚠️ HLS + client_id rotation, app registration closed | ⚠️ | — | **RISKY/SKIP** |
| Deezer | already a dedicated route in repo | — | (30s previews) | — | — | already present (preview-only) |

## Candidate 1 — Audius (ADD, dedicated-route proxy)

Net-new Western/indie/electronic + UGC catalog; zero overlap with CN sources or Jamendo. Fully public — `app_name` is a free-text identifier, NOT a key. `[VERIFIED: curl, 2026-06-16]`

**Host discovery (optional):** `GET https://api.audius.co` → `{"data":["https://api.audius.co", ...],"env":"prod"}`. The root `api.audius.co/v1` is itself a stable load-balanced entry — the adapter can hit it directly; no need to round-robin discovery nodes for an MVP.

### search(keyword, page)
```
GET https://api.audius.co/v1/tracks/search?query=<kw>&app_name=musicsquare
```
Note: this endpoint returns a flat best-match list (no offset/limit param honored reliably) — treat `page>1` as "no more" or slice client-side, mirroring Jamendo's lightweight idiom.

Response: `{ "data": [ Track ] }`. Per-row fields the adapter reads (all optional, untrusted):
```jsonc
{
  "id": "EJQkAER",                       // songid (base-36 string, stable)
  "title": "Imagine Dragons--Radioactive",
  "user": { "name": "Yoryo", "handle": "yoryo98" },  // artist = user.name
  "artwork": { "150x150": "...jpg", "480x480": "...jpg", "1000x1000": "...jpg" }, // cover (may be null)
  "duration": 179,                       // seconds → Track.duration
  "is_streamable": true,                 // SKIP row if false
  "genre": "Rock", "mood": "...", "tags": "..."
}
```
Adapter mapping: `uid = makeUid('audius', id)`, `artist = user?.name`, `cover = artwork?.['480x480'] ?? artwork?.['150x150'] ?? null`, `album = '' ` (no album in track row). Skip rows where `is_streamable === false` or no `id`.

### resolve(track)
Audius does NOT return the file URL in search JSON. The stream URL is deterministic from the id, so resolve has no JSON hop — it just sets:
```
audioUrl = `${API_BASE}/v1/tracks/${songid}/stream?app_name=musicsquare`   // through OUR proxy
```
`GET /v1/tracks/{id}/stream` → **HTTP 302** to a signed `storage.googleapis.com/...` URL, `content-type: audio/mpeg`, honors `Range` (got `206`, 2001 bytes for `0-2000`). `[VERIFIED: curl -L, 2026-06-16]`

**Proxy = dedicated route** (mirror `fivesing`): `src/routes/api/audius/search/+server.ts` (passthrough JSON, append `app_name`, `caches.default` TTL ~10min) + `src/routes/api/audius/stream/[id]/+server.ts` that **follows the 302 and pipes the body** (so the eventual `<audio>.src` stays own-origin — Capacitor/CORS-safe like the Netease note in `api-base.ts`). Set `track.audioUrl` to the own-origin `/api/audius/stream/{id}` path via the same client; `inferQualityFromUrl` will tag it (no extension → falls back to its default tag — acceptable).

**Reachability risk:** LOW — verified prod, no key, no geo-block (US edge friendly).
**Quirk:** stream is a redirect, so the proxy must `redirect:'follow'` (or re-issue the GCS GET) and stream the body; do NOT just JSON-return the redirect target (GCS URL is signed + expires).

## Candidate 2 — GDStudio (ADD, scoped to kugou + migu; catch-all OR dedicated route)

One uniform API fronting many platforms. Use it ONLY for sources we lack — **kugou (酷狗) and migu (咪咕)** — to avoid duplicating netease/kuwo/joox. `[VERIFIED: curl reachable; netease/kuwo/joox enums returned live; kugou/migu rejected this session with `{"detail":"Value of source is not supported."}` — INTERMITTENT, the enum is documented to include them, treat as rate/rotation, re-probe at plan time]`

Base: `https://music-api.gdstudio.xyz/api.php`. Rate cap: **≤60 requests / 5 min** (shared) — another reason for opt-in. Attribution requested: "GD Music Station (music.gdstudio.xyz)".

### search(keyword, page) → `types=search`
```
GET .../api.php?types=search&source=<kugou|migu>&name=<kw>&count=20&pages=<page>
```
Response = **bare JSON array** (no envelope):
```jsonc
[{
  "id": "6686351",                  // songid
  "name": "Hello",                  // title
  "artist": ["Adele"],              // array → join ' / '
  "album": "25",
  "pic_id": "120/s4s55/...jpg",     // opaque, feed back to types=pic
  "url_id": "6686351",              // == id, feed to types=url
  "lyric_id": "6686351",            // feed to types=lyric
  "source": "kuwo"
}]
```
Mapping: `uid = makeUid('gdstudio', `${source}-${id}`)` (fold the sub-source into songid so kugou/migu ids never collide), `artist = artist.join(' / ')`, `cover` resolved lazily in resolve via `types=pic`.

### resolve(track) → `types=url` (+ optional `types=lyric`, `types=pic`)
```
GET .../api.php?types=url&source=<sub>&id=<id>&br=320   → {"url":"https://...mp3","br":320,"size":...}
GET .../api.php?types=lyric&source=<sub>&id=<id>        → {"lyric":"[00:06.22]Hello...","tlyric":"..."}
GET .../api.php?types=pic&source=<sub>&id=<pic_id>&size=300 → {"url":"https://...jpg"}
```
`types=url` returned a **direct `.mp3`** that played `206 / audio/mpeg` `[VERIFIED: curl -L]`. `br` accepts 128/192/320/740/999 (lossless tiers vary by source). Lyric is ready-to-parse LRC for the existing `parseLRC`.

**Proxy:** simplest as a **catch-all `ProxyAdapter`** (`src/lib/proxy/gdstudio.ts` + one line in `proxy-registry.ts`) since every call is the same host with passthrough params — or a dedicated `/api/gdstudio/[action]` route. Either is one file + one registry line.

**Reachability risk:** MEDIUM — host reachable, but the kugou/migu sub-source enum was intermittently rejected this session; the audio file URLs are upstream CDN (netease `m701.music.126.net` served fine from here, but kugou/migu CDN edge-reachability is UNVERIFIED — confirm a kugou/migu `types=url` actually streams from a non-CN edge before shipping `enabledByDefault`).

## What to SKIP and why

- **Free Music Archive (FMA):** public API was **shut down** (server load) — no programmatic search. SKIP. `[CITED: freemusicarchive.org/app-developers]`
- **Kugou / Migu / Baidu(Qianqian) official direct:** geo-block / rate-block from non-CN Cloudflare IPs, and Kugou requires per-request HMAC signing (`signKey`) — a big change. We get kugou/migu *through GDStudio* instead, so no direct integration. SKIP direct.
- **Spotify / Apple Music / YouTube Music:** DRM-protected, no raw downloadable file, HLS/encrypted streams — incompatible with native `<audio>`. OAuth required. SKIP.
- **TIDAL / Qobuz:** paid, token-gated, no anonymous direct file. SKIP.
- **SoundCloud:** public app registration is closed; stream is HLS + rotating `client_id` scraping — fragile and effectively a big change. RISKY → SKIP for a "no-big-change" task.
- **Bilibili / Ximalaya / Qingting / Lizhi (audiobook/UGC long-form):** off-intent for a song player; many are HLS. SKIP.
- **musicdl aggregators (myfreemp3 / gequbao / etc.):** HTML-scraping download sites, not stable JSON APIs — high drift, SKIP.

## Minimal-change checklist (per added source)

Confirmed against the live architecture (matches the orchestrator's recipe):
1. Add id to `SourceId` union — `src/lib/sources/types.ts:17` (`'audius'`, `'gdstudio'`).
2. New client adapter `src/lib/sources/<id>.ts` (model on `jamendo.ts` for Audius / `kuwo.ts` for GDStudio search+resolve).
3. Edge proxy: **dedicated route** `src/routes/api/<id>/...+server.ts` (model `routes/api/fivesing/search/+server.ts`, using `fetchWithRetry`+`corsHeaders` from `$lib/proxy/http`) — OR catch-all `src/lib/proxy/<id>.ts` + one line in `proxy-registry.ts`.
4. One import + one record entry in `src/lib/sources/registry.ts:5-13`.
5. NO edits to aggregation/dispatch/UI — they iterate `getEnabledAdapters()` generically.

`enabledByDefault`: **both `false`** at first. Jamendo is `true` because it's the sole low-overlap Western mainstream-ish supply; Audius is more niche/UGC, and GDStudio overlaps + is rate-capped. Flip Audius to `true` only after real-world result quality looks mainstream-relevant; keep GDStudio opt-in.

## Assumptions Log

| # | Claim | Risk if wrong |
|---|-------|---------------|
| A1 | GDStudio kugou/migu enums work (rejected intermittently this session) | If permanently unsupported, GDStudio adds nothing over existing sources — re-probe before planning |
| A2 | Kugou/Migu audio CDN URLs from GDStudio stream from a non-CN edge | If geo-blocked, GDStudio playback fails for those sources even though search works |
| A3 | Audius search `page>1` not paginatable via this endpoint | At worst "load more" is a no-op for Audius — cosmetic |

## Sources
- Live curl probes (HIGH): `api.audius.co` discovery + `/v1/tracks/search` + `/v1/tracks/{id}/stream` (302→GCS audio/mpeg, Range 206); `music-api.gdstudio.xyz/api.php` search/url/lyric/pic (url→direct mp3 206).
- [musicdl source list](https://github.com/CharlesPikachu/musicdl) (MEDIUM) — enumerated supported platforms.
- [Audius API docs](https://docs.audius.org/api/) (HIGH) — stream endpoint = mp3 + Range, optional key, `app_name`.
- [FMA app-developers](https://freemusicarchive.org/app-developers) (HIGH) — API shut down.
- Repo exemplars read: `src/lib/sources/jamendo.ts`, `kuwo.ts`, `types.ts`, `registry.ts`, `routes/api/fivesing/search/+server.ts`, `proxy/proxy-registry.ts`, `services/api-base.ts`.
