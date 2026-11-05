# Phase 43: SoundCloud + Bandcamp sources - Context

**Gathered:** 2026-11-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Add SoundCloud and Bandcamp as two new REAL playback sources: each is a full `SourceAdapter`
(search + resolve → its OWN playable audio URL) wired into every resolver path the CN sources use —
search fan-out, song detail (`ensureTrackDetails`), prefetch/buffer, download, cross-source fallback,
and the name-stub walk.

The phase started as "add every provider labithiotis/mdl supports" (Spotify, Apple Music, Amazon
Music, YouTube Music, SoundCloud, Bandcamp, Qobuz, Deezer, Tidal). Discussion established that mdl
takes metadata from those platforms and pulls ALL audio from YouTube (its `--format flac` is a
YouTube AAC/Opus transcode — fake lossless). Only SoundCloud and Bandcamp serve their own audio
publicly, so only they are in scope.

</domain>

<decisions>
## Implementation Decisions

### Which providers qualify
- **D-01:** A provider is added ONLY if it serves its own playable audio. No "name-only" providers
  whose playback is silently resolved by another source (user: 唔好掛名provider但係其他resolve).
- **D-02:** Spotify, Apple Music, Amazon Music, Tidal, Qobuz are NOT added — DRM, no public audio.
- **D-03:** Deezer is NOT promoted to a playback source (30 s previews only). Its existing
  metadata/cover/radio roles are unchanged.
- **D-04:** YouTube Music already exists (Phase 27) and is unchanged. ytmusic must NOT be used as a
  resolver for other providers' tracks (user rejected the mdl "YouTube resolves everything" model).

### SoundCloud / Bandcamp posture
- **D-05:** Both `enabledByDefault: true` (appear in the search fan-out).
- **D-06:** Both are ON the resolve floor (`autoResolveEligible` left undefined) at the END of the
  auto-resolvable section of `PLAYBACK_ORDER` — i.e. after `suyin`, before the search-only block
  (`archive`, `ccmixter`, `bilibili`, `ytmusic`). They can be a cross-source fallback / name-stub
  target of last resort.
- **D-07:** Neither enters `TIER_1_SOURCES` (they sit past the first `TIER_1_SIZE` eligible ids
  automatically by position — verify, don't special-case).

### Version mismatch
- **D-08:** When a SoundCloud/Bandcamp track is auto-picked as a fallback/name-stub target and its
  duration or title differs notably from the requested song (live/cover/remix), PLAY it but surface a
  notice ("may not be the original"), via the existing store→UI notice path (`TranslationKey`, all 16
  locales, double quotes). Do not silently reject.

### SoundCloud playback format (decided after research, 2026-11-04)
- **D-09:** Research found only ~0-3% of SoundCloud tracks still have a progressive stream; the rest are HLS-only (fMP4 AAC). User chose Option B: play the HLS `.m3u8` via NATIVE `<audio>` only when `audio.canPlayType('application/vnd.apple.mpegurl')` is truthy (iOS Safari, Chrome 141+ native HLS); where it isn't, the track fails over like any unplayable track. Progressive stream preferred when present. Downloads stitch init + segments in the browser into an `.m4a`. No JS HLS player (no hls.js / MSE) — the CLAUDE.md "No HLS" constraint is relaxed to "no HLS in JS" and CLAUDE.md must be updated to say so. Android APK WebView behaviour needs a device check (human UAT).
- SNIP (30 s preview) / BLOCK tracks are excluded.

### Claude's Discretion
- SoundCloud access method (api-v2 with a `client_id` scraped edge-side from the web app JS, cached;
  or another public route) and how to choose a transcoding: prefer a progressive (non-HLS) stream;
  a track with only HLS, or a 30 s preview/snipped track (`policy: SNIP`, Go+ only), is unplayable —
  exclude it from results or let resolve fail over.
- Bandcamp search (public search endpoint/page) and resolve (track page `data-tralbum` → free
  `mp3-128` stream URL). Bandcamp stream URLs expire — use the existing freshness guard
  (`hasFreshAudioUrl`) semantics.
- Source order between the two (research recommends `suyin, bandcamp, soundcloud, archive`).
- Whether the browser can fetch audio directly (CORS / referrer) or needs the edge, following the
  existing `/api/stream-url` / proxy patterns.
- Cover host allowlist entries in `proxy/safe-image-url.ts` (sndcdn.com, bcbits.com).
- Quality tags (128k) and `loadRetries` values.
- Exact threshold for D-08's "notably different" (reuse `score-match.ts` where possible).

</decisions>

<specifics>
## Specific Ideas

- Reference repo (MIT): https://github.com/labithiotis/mdl — useful only for its SoundCloud/Bandcamp
  URL handling; its audio path is YouTube and is explicitly NOT the model here.
- "Like the CN resolvers": the new sources must behave exactly like joox/kuwo/qq in every resolver
  path, not as a separate feature surface.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source contract + ordering
- `src/lib/sources/types.ts` — `SourceId` union, `SourceAdapter` contract (`autoResolveEligible`, `loadRetries`, `health`), `makeUid`
- `src/lib/sources/registry.ts` — ADAPTERS map, `getEnabledAdapters`, `isAutoResolveEligible`, `TIER_1_SOURCES`
- `src/lib/sources/source-order.ts` — `PLAYBACK_ORDER` (single source of truth for seat position)
- `src/lib/proxy/proxy-registry.ts` — edge proxy registration
- `src/lib/sources/bilibili.ts` + `src/lib/proxy/bilibili.ts` — most recent new-source example (quick-261020-bili)
- `src/lib/sources/archive.ts`, `src/lib/sources/ccmixter.ts` — other recent legal-catalog adapters

### Resolver paths the new sources must flow through
- `src/lib/services/catalog.ts` — `searchAll`, `ensureTrackDetails`, `resolveNameStub`
- `src/lib/services/fallback.ts` — cross-source failover
- `src/lib/services/track-ready.ts`, `src/lib/services/url-safety.ts`, `src/lib/proxy/safe-image-url.ts`, `src/lib/services/source-health.ts`, `src/lib/services/api-base.ts` (apiFetch governor) — shared primitives (CLAUDE.md "Shared Primitives")
- `src/lib/services/score-match.ts` — match scoring (D-08)

### Project rules
- `CLAUDE.md` — registry-driven sources, never-name-a-source, i18n double quotes, `+server.ts` verb-only exports
- `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/INTEGRATIONS.md`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Adding a source = adapter `src/lib/sources/<id>.ts` + proxy `src/lib/proxy/<id>.ts` + `ADAPTERS` entry + `SourceId` member + `PLAYBACK_ORDER` seat.
- `createHealthGate` (source-health.ts) for flaky upstreams; `apiFetch` for every `/api/*` call; `jsonResponse` for routes.
- Settings source toggles read `SOURCES` generically — new sources should appear without UI code (verify) plus their `label`.

### Established Patterns
- Adapters never throw into the fan-out (except deliberate contract-drift throws recorded by allSettled).
- `apiFetch` resolves non-ok responses — check `res.ok` inside the counted try (memory: apifetch gate hole).
- Edge route helpers live in `$lib`, never as extra exports in `+server.ts`.

### Integration Points
- `PLAYBACK_ORDER` seat drives fallback ladder, name-stub walk, interleave and dedupe tie-break.
- Download path calls `resolve(track, signal, quality)`.

</code_context>

<deferred>
## Deferred Ideas

- Paste-link import of Spotify / Apple Music / Amazon / Tidal / Qobuz / Deezer / YouTube Music playlists into a local playlist (each song visibly played by its real source) — backlog.
- Real lossless via the user's own paid accounts (Qobuz token, Tidal OAuth, Deezer ARL) — backlog, legal-gated like the YTM account milestone.
- Spotify/Apple/Amazon/Tidal/Qobuz as metadata-only search surfaces — rejected (D-01), not deferred.

### Reviewed Todos (not folded)
- og-artist-tier-picture-xl-oversize.md — Deezer OG image size; unrelated.

</deferred>

---

*Phase: 43-soundcloud-bandcamp-sources*
*Context gathered: 2026-11-04*
