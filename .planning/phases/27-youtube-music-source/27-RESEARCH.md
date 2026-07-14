# Phase 27: YouTube Music Source — Research

**Researched:** 2026-07-15
**Basis:** Spikes 005–008 (all committed under `.planning/spikes/`). Feasibility is already PROVEN end-to-end from this environment; this document distills the spikes into implementation-ready guidance. No open research questions remain except one operational item (edge-IP egress on a deployed Worker) tracked as a risk.

## Summary — what the spikes settled

| Pillar | Verdict | How |
|--------|---------|-----|
| Search | GO | InnerTube `WEB_REMIX` + songs-filter, public key, no auth. 100% field coverage, CJK-safe. |
| Play | GO (maintenance caveat) | `ANDROID_VR` player + cached `visitorData` → itag 140 AAC, **direct url, no cipher, no throttle**. IP-locked → proxy bytes edge-side. |
| Lyrics | GO (plain) | `next`→Lyrics-tab→`browse` plain text + attribution; timed LRC via existing `crossSourceLyric`. |
| Account/library | OUT | Cookie auth impossible on web; OAuth device flow is grey-area + adds token storage. Separate milestone. |

## Implementation guidance

### 1. Edge proxy `src/routes/api/ytmusic/` (dedicated routes, not the `[source]` catch-all)
The CN catch-all forwards simple GETs to Meting; YTMusic needs POST bodies + a key + client contexts + a byte-proxy, so it warrants dedicated routes like `audius`/`deezer` have.

- **`GET /api/ytmusic/search?q=`** → POST InnerTube `search` (WEB_REMIX ctx + songs `params` + key). Return the InnerTube JSON (or a trimmed slice) for the client to parse. Cache-friendly (search is stable) — an edge cache TTL is reasonable, mirroring `/api/similar` edge-cache.
- **`GET /api/ytmusic/lyrics?videoId=`** → POST `next` → extract Lyrics-tab `browseId` → POST `browse` → return `{ text, attribution }` (or `{}` when no lyrics tab). Two upstream hops; edge-cacheable per videoId.
- **`GET /api/ytmusic/stream/:videoId`** → the money route. POST `player` (ANDROID_VR ctx + cached visitorData) → select itag 140 → `fetch` the googlevideo URL **within the same Worker invocation** (so player + media egress share an IP) → return a streamed `Response` with `Range`/`Content-Range`/`Accept-Ranges`/`Content-Type: audio/mp4` passthrough. Raw `fetch`, never the `apiFetch` governor. On `playabilityStatus != OK` → refresh visitorData once and retry, else respond 502 so the client's fallback engages.

**visitorData management (edge):** fetch once from any InnerTube response's `responseContext.visitorData`; cache in the Cloudflare Cache API (or a module-scope var with a timestamp). Reuse across requests; refresh on `LOGIN_REQUIRED` or after a TTL. Never send to the client. Keep it a single named helper (`getVisitorData(env)`), unit-testable with a mocked fetch.

**Secrets:** none required — the WEB_REMIX key is public (shipped in YTM's web bundle) but keep it as an edge-side `const`, not in the client bundle, so it's one place to rotate + keeps `<audio>.src` own-origin.

### 2. Client adapter `src/lib/sources/ytmusic.ts` (model on `audius.ts`)
- `search(keyword, page, signal)`: `apiFetch('/api/ytmusic/search?q=' + enc(keyword), {signal})` → parse InnerTube rows → `Track[]`. Page > 1 → `[]` (single shelf, no reliable pagination — like audius). Contract-drift → throw.
- `resolve(track, signal, quality?)`: stamp `track.audioUrl = apiUrl('/api/ytmusic/stream/' + enc(videoId))` (deterministic, no JSON hop), set `quality`/`qualityLabel` via `inferQualityFromUrl` (or a fixed AAC-128 tag), fetch plain lyrics from `/api/ytmusic/lyrics` into `track.lrc` (best-effort, swallow failure), `detailsLoaded = true`. Timed lyrics come from the existing `crossSourceLyric` path — do not reimplement.
- Cover: resizable thumbnail from search; the shared cover cache + lazy Deezer HQ upgrade already handle the rest.

### 3. Registry & types
- `types.ts`: extend `SourceId` union with `'ytmusic'`. (No new required Track fields — `videoId` maps to `songid`; optional `duration` already exists.)
- `registry.ts`: add `ytmusic` to `SOURCES`, appended LAST, `enabledByDefault: true`. Confirm `fallbackOrder` (fallback.ts) does NOT add ytmusic to the mainstream failover floor — it should only ever resolve its own tracks.

### 4. Integration points (verify, mostly no change)
- `catalog.ts searchAll` picks up the new adapter automatically via `getEnabledAdapters` (registry-driven — no source named). `ensureTrackDetails` dispatches to `SOURCES['ytmusic'].resolve`. `crossSourceLyric` already keys by name+artist.
- Settings source-toggle + source-label UI are registry-driven — YTMusic should appear with no per-source UI code; verify the label renders and the toggle persists (`settings.enabledSources.ytmusic`).

## Gotchas / landmines (from the spikes)
- **Don't set `<audio>.src` to a googlevideo URL** — IP-locked, will 403 from the browser. Always the own-origin proxy path.
- **iOS Safari can't play Opus/webm (itag 251)** — must be AAC/mp4 (itag 140).
- **No visitorData ⇒ `LOGIN_REQUIRED`/bot-check even from a good IP** — visitorData is mandatory for the ANDROID_VR player call.
- **Stream URL expires (~6 h)** — resolve per play; never persist the URL.
- **Datacenter-IP bot pressure** — a Cloudflare colo issuing many `player` calls may get challenged harder than the sandbox did; cache/rotate visitorData and expect periodic breakage.
- **Search never returns empty** — YTM fuzzy-matches; rely on existing `score-match`/dedupe, not on a zero-results signal.
- **`apiFetch` governor is for JSON only** — the byte-proxy uses raw `fetch` or it will deadlock the governor on a long-lived media stream.

## Validation Architecture

How each requirement is proven. Unit/server tests run under the single Vitest node project (no jsdom); playback + real-network behavior is human/deployed-Worker UAT (sandbox parity is high for YT but device/edge confirmation is required for the stream).

| Req | Validation | Level |
|-----|-----------|-------|
| YT-SRC-01 | `registry.test.ts` sees `ytmusic` enabled + last; `SourceId` typechecks; `makeUid('ytmusic','x')==='ytmusic:x'` | unit |
| YT-SEARCH-01 | `ytmusic.test.ts` parses a captured InnerTube fixture → ≥1 Track with videoId/title/artist/album/cover; contract-drift input throws | unit (fixture) |
| YT-PLAY-01 | proxy unit test: player-response fixture → picks itag 140 + builds a streamed Response with Range passthrough; visitorData-refresh path covered. Real playback (206, plays in `<audio>`, seek) = deployed-Worker + device UAT | unit + UAT |
| YT-LYRICS-01 | lyrics-route unit test over `next`/`browse` fixtures → `{text,attribution}`; `parseLRC` unit proves graceful plain-text degradation; timed-fallback path reuses existing crossSourceLyric tests | unit |
| YT-DOWNLOAD-01 | download over the proxy URL yields a complete AAC file (non-ranged GET) — asserted via the existing download flow; UAT on device | unit-ish + UAT |
| YT-RESILIENCE-01 | `searchAll` allSettled test: a throwing ytmusic search leaves other sources' results intact; resolve-failure routes to fallback (existing player tests + a ytmusic-specific case) | unit |

**Nyquist floor:** every requirement above has at least one automated assertion except the two inherently-runtime ones (real stream playback, real download bytes), which are explicitly UAT-gated with a documented reason (IP-locked stream can't be exercised by a node unit test). The one operational unknown — player+media same-IP egress on a deployed Worker + bot-challenge rate under load — is tracked as a phase risk, not a unit gap.

## Open risk (not a research gap — an operational verify)
On a **deployed** Cloudflare Worker, confirm the `player` subrequest and the googlevideo byte-fetch egress an IP googlevideo accepts (do both in one invocation), and measure the bot-challenge rate under realistic load. Mitigations if it fails: single-pipeline fetch, visitorData rotation, or (worst case) accept that YTMusic playback is best-effort with automatic fallback to mainstream sources.
