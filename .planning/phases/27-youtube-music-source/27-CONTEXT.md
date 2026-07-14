# Phase 27: YouTube Music Source — Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Source:** Direct capture from user scope + spikes 005–008 (feasibility already proven; this is not a discuss-phase substitute for unknowns — the unknowns were spiked)

<domain>
## Phase Boundary

**IN scope** — add YouTube Music as a first-class **anonymous** source that behaves like every other source:
- **Search** — InnerTube search → OpenMusic `Track` stubs, appears in the normal search fan-out.
- **Play** — resolve a `videoId` to a playable audio stream through the edge; plays in the existing single `<audio>`.
- **Lyrics** — plain lyrics inline; timed LRC via the app's existing cross-source fallback.
- **Download** — reuse the standard download path over the resolved stream URL.
- Wiring: one `SourceId` (`ytmusic`), one client adapter (`src/lib/sources/ytmusic.ts`), a dedicated edge proxy (`src/routes/api/ytmusic/`), one `registry.ts` line, plus the source appearing in the existing settings source-toggle and source-label UI (reuse existing surfaces — no new design system work).

**OUT of scope (do NOT plan any of this)** — everything from spike 008:
- No account connection, Google OAuth, device flow, cookie capture, or `Authorization` header auth.
- No library inheritance (liked songs, recent history, favourite genre).
- No per-user token storage. The source stays **fully anonymous — zero user credentials** — preserving the app's current trust posture.
- No YouTube-side timed-lyrics scraping, no Opus/itag-251 path, no signature-cipher engine, no PoToken generator.
Account/library sync is a **separate, later, legal-gated milestone**. If planning surfaces a temptation to add auth "while we're here," STOP — it's out.
</domain>

<decisions>
## Implementation Decisions (LOCKED — grounded in spikes 005/006/007)

### Identity & registry
- Add `'ytmusic'` to the `SourceId` union in `src/lib/sources/types.ts`.
- `songid = videoId`; `uid = makeUid('ytmusic', videoId)` = `ytmusic:${videoId}` (COLON form, D-10).
- Add one `ytmusic` line to `src/lib/sources/registry.ts` `SOURCES`. **Placement rule:** `enabledByDefault: true` (discoverable in search), but YTMusic is **appended LAST** in the enumeration and is **NOT** part of the kuwo-first resolve/fallback floor — it mirrors how `audius`/`jamendo` are searchable-but-off-the-hot-path (per `Skill("spike-findings-openmusic")` policy). The kuwo→qq→netease→joox resolve floor is UNCHANGED. Cross-source fallback must never pick `ytmusic` as a failover *target* for a non-ytmusic track; a failed `ytmusic` track still falls forward to the mainstream floor like any other.

### Search (spike 005)
- Client `search()` calls own-origin `/api/ytmusic/search?q=<keyword>` (never InnerTube directly — CORS + key live edge-side).
- The **proxy** does the InnerTube POST: endpoint `music.youtube.com/youtubei/v1/search`, `context.client = {clientName:'WEB_REMIX', clientVersion:'1.20240101.01.00', hl, gl}`, songs-filter `params = EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D`, public key `AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30`.
- **Parse lives in the client adapter** (testable, per conventions) over the proxied JSON — walk `musicShelfRenderer.contents[] → musicResponsiveListItemRenderer`; `videoId` from the play-button overlay; title/artist/album from `flexColumns` disambiguated by each run's `pageType`; cover from the resizable thumbnail. Port `spikes/005/harness.mjs` parse logic.
- Contract-drift guard: throw on an unexpected envelope (like `netease.ts`/`audius.ts`) so `searchAll`'s `allSettled` records a typed per-source error and other sources still render.

### Play (spike 006 — THE WALL, cleared)
- **Stream is edge-proxied bytes, NOT a raw URL** (the URL is IP-locked + expires ~6 h). Client `resolve()` deterministically stamps `audioUrl = apiUrl('/api/ytmusic/stream/' + videoId)` — own-origin, CORS/Capacitor-safe, exactly like `audius.resolve()`. No client-side JSON hop for the stream.
- The `/api/ytmusic/stream/{videoId}` proxy: call the InnerTube `player` endpoint with `clientName:'ANDROID_VR'`, `clientVersion:'1.60.19'` + a cached **`visitorData`** token in the client context → pick **itag 140 (AAC/mp4)** from `adaptiveFormats` (direct `url`, no cipher, no `n` throttle) → fetch googlevideo and **stream the body back** with Range passthrough (206 + `Accept-Ranges`). iOS Safari needs AAC (itag 140), not Opus.
- **visitorData is edge-managed:** the proxy fetches a `visitorData` once (from any InnerTube response), caches it (Cloudflare Cache API or module-scope), reuses it across requests, and refreshes on `LOGIN_REQUIRED`/expiry. Never exposed to the client.
- `resolve()` is called per play (no long URL caching — the URL expires).

### Lyrics (spike 007)
- Plain lyrics: proxy route `/api/ytmusic/lyrics?videoId=` does InnerTube `next` → find the Lyrics-tab `browseId` → `browse` → `musicDescriptionShelfRenderer.description.runs` text + `footer` attribution. `resolve()` (or a lazy lyric fetch) populates `Track.lrc` with the plain text; carry the licensor attribution.
- Timed/synced LRC: **not available from YT** → reuse the app's EXISTING `crossSourceLyric(name, artist)` (catalog.ts) — the exact name+artist are already on the Track from search, so it's the same lyric-miss path already shipped, no new wiring. Verify `parseLRC` degrades gracefully on plain (timestamp-less) lines.

### Download (reuse)
- Download uses the same `audioUrl` (the `/api/ytmusic/stream/{videoId}` path serves a complete AAC file on a non-ranged GET). No YT-specific download code — the existing download flow works over the proxied URL.

### Resilience (never-throw + adversarial upstream)
- Adapter honors the never-throw boundary: search maps failures to a typed per-source error via the `allSettled` seam; `resolve()` failure surfaces so the player's existing cross-source fallback advances (a dead YT track routes to the mainstream floor, then skip). A YTMusic failure NEVER breaks search or other sources.
- **This upstream is adversarial** (YouTube fights extractors) — build in graceful failure and treat the `ANDROID_VR`+`visitorData` path as ongoing maintenance. Log via the existing `actionLog` on resolve failures for field diagnosis.
- JSON hops (search/lyrics) go through the `apiFetch` governor; **media/blob bytes use raw `fetch`** (never the governor) — same rule as the rest of the app.

### Covers
- Use the search-embedded resizable thumbnail on the hot path; lazy Deezer HQ upgrade like other sources. YTMusic is NOT on the cover-backfill-required list (it always has a cover).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spike evidence (the proof this phase rests on)
- `.planning/spikes/005-ytmusic-innertube-search/README.md` + `harness.mjs` — search endpoint, params, parse.
- `.planning/spikes/006-ytmusic-playable-stream/README.md` + `player-harness.mjs` + `stream-harness.mjs` — ANDROID_VR+visitorData, itag 140, IP-lock → proxy.
- `.planning/spikes/007-ytmusic-lyrics/README.md` + `harness.mjs` — next→browse plain lyrics + attribution.
- `.planning/spikes/008-ytmusic-account-library/README.md` — WHY account-sync is OUT (read to avoid re-introducing it).

### Source model & closest analogs
- `src/lib/sources/types.ts` — `Track`, `SourceAdapter`, `makeUid`, `SourceId` union.
- `src/lib/sources/audius.ts` — **closest analog**: deterministic own-origin stream path + proxy-follows-redirect + no client JSON hop on resolve.
- `src/lib/sources/netease.ts`, `src/lib/sources/qq.ts` — contract-drift throw + upstream-JSON parse patterns.
- `src/lib/sources/registry.ts` — the single adapter enumeration (placement/order rules).
- `src/routes/api/audius/` — proxy stream pattern (Range passthrough, stream body).
- `src/routes/api/[source]/[...path]/+server.ts` + `src/hooks.server.ts` — proxy validation + the single CORS seam.

### Services this must integrate with (not modify unless noted)
- `src/lib/services/catalog.ts` — `searchAll`, `ensureTrackDetails`, `crossSourceLyric` (lyrics fallback).
- `src/lib/services/api-base.ts` — `apiFetch` governor + `apiUrl` seam.
- `src/lib/services/lrc.ts` — `inferQualityFromUrl`, `parseLRC` (plain-text degradation).
- `Skill("spike-findings-openmusic")` — kuwo-first resolution / up-next / cover policy this must honor (ytmusic off the hot path).
</canonical_refs>

<specifics>
## Specific Ideas
- InnerTube constants are fixed and verified (spikes): WEB_REMIX key, songs-filter param, ANDROID_VR client v1.60.19, itag 140. Keep them as named `const`s in the proxy (`SCREAMING_SNAKE_CASE`), commented with the spike ref.
- Keep the proxy a thin, well-commented forwarder; the parse/normalize logic stays client-side and unit-tested (co-located `ytmusic.test.ts` with a captured InnerTube fixture in `__fixtures__/`).
</specifics>

<deferred>
## Deferred Ideas
- Account connection + library inheritance (liked/history/genre) — spike 008, separate legal-gated milestone. "Favourite genre" would be *derived* from liked/history tags, not inherited.
- Opus/itag-251 stream variant (Android-only quality bump).
- YT-specific download-quality selection.
- Verify on a **deployed Cloudflare Worker** that the player + googlevideo subrequests egress the same IP, and measure bot-challenge rate under load — an operational validation, tracked as a phase risk (can't be proven in-sandbox or by unit tests).
</deferred>

---

*Phase: 27-youtube-music-source*
*Context captured: 2026-07-15 (from user scope + spikes 005–008)*
