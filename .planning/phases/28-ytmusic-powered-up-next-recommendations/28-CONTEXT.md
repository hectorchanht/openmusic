# Phase 28: YTMusic-Powered Up-Next Recommendations - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Source:** Diagnosis-driven (`.planning/debug/upnext-similar-empty-fallback.md`) + user decisions in the `/gsd:do` build routing conversation

<domain>
## Phase Boundary

**Delivers:** A source-aware up-next similar-recommendations path so the "generate by similar songs" mode produces genuinely related tracks for a YouTube-Music-only seed (repro: 摩四老年《港耆》) instead of silently falling back to unrelated picks — plus a replacement empty-similar fallback that draws from real top/chart hits rather than a random hard-coded artist pool.

**In scope:**
- A YTMusic related/watch-next recommendation source (parse InnerTube `NEXT_URL` watch-next queue → `Track` stubs).
- A `seed.source === 'ytmusic'` branch in the up-next similar builder keyed on `seed.songid` (videoId).
- Replacing the `buildDiversePicks` random `ARTIST_POOL` last-resort fallback with a top/chart-hits fallback.
- Never-throw / graceful-degrade wiring; no regression to CN-seed similar behavior.

**Out of scope (do NOT build):**
- Surfacing the fallback to the user via toast/`player.notice` (explicitly NOT requested this phase).
- Any YTMusic account/cookie auth, library inheritance, or personalized recommendations (legal-gated, separate milestone per spike 008).
- Extending YTMusic similar to CN seeds (the branch is YT-only; CN seeds keep their existing Last.fm/Deezer/CN tiers).
- Changing the up-next mode resolver / settings (`effectiveUpnextMode` is correct — confirmed in diagnosis).
</domain>

<decisions>
## Implementation Decisions (LOCKED)

### Source-aware similar branch
- When the seed's `source === 'ytmusic'`, the up-next builder MUST use `seed.songid` (the YouTube videoId) against a YTMusic related/watch-next lookup — BEFORE / INSTEAD OF the string-keyed Last.fm tiers (which cannot map a YT-only track).
- CN / non-YT seeds keep the existing 3-tier `buildSimilarQueue` behavior unchanged (Last.fm getSimilar → Last.fm+Deezer similar-artists → same-artist searchAll).

### YTMusic related source
- Reuse the EXISTING edge transport — `innerTubePost` → `NEXT_URL` (`youtubei/v1/next`) + `getVisitorData` + `WEB_REMIX_CONTEXT` in `src/lib/proxy/ytmusic.ts`. Do NOT invent a new transport.
- The same `NEXT_URL` response is already fetched by the lyrics route (`src/routes/api/ytmusic/lyrics/+server.ts`), which currently discards the watch-next queue rows — this phase parses those rows.
- Expose via a source method (e.g. `ytmusic.related(videoId)`) + a route (new `/api/ytmusic/related` OR an extension of the lyrics route — planner's discretion on the cleaner seam).
- Resulting YT up-next stubs MUST respect `autoResolveEligible: false` (ytmusic is search+explicit-pick only) — the resolution path for these stubs must be consistent with that flag.

### Empty-similar fallback → top hits (LOCKED, user-directed)
- Replace the current `buildDiversePicks(8, …)` random `ARTIST_POOL` sampling (`src/lib/services/picks.ts`) as the last-resort empty-similar fallback with a fallback that draws from real **top/chart hits** (broad, actually-popular options).
- Rationale (user): random hard-coded artist-pool picks are noise; top/chart hits give broader, more useful options when no similar exists.
- Applies to BOTH callers: `regenerate()` and `ensureAhead()` empty branches (`player.svelte.ts`).
- Prefer an existing charts/top-hits data path if one exists in the codebase; the planner should identify the real source (the app already has a charts surface) rather than inventing a new hard-coded list.

### Resilience
- Never-throw at the service boundary; a YTMusic related failure or empty result degrades gracefully into the (new top-hits) fallback chain — the never-stop playback guarantee must hold.

## Claude's Discretion
- Exact route shape (new `/api/ytmusic/related` vs extending the lyrics route).
- The precise `NEXT_URL` watch-next JSON parse (row container path, dedupe of the seed itself, stub field mapping) — subject to research/fixture confirmation.
- Which existing charts/top-hits service to reuse for the fallback, and its shape.
- Whether the YT-branch lives inside `buildSimilarQueue` or as a sibling the caller selects on `seed.source`.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Diagnosis (root cause + full pipeline + feasibility inventory)
- `.planning/debug/upnext-similar-empty-fallback.md` — the source-blind root cause, exact file:line map of the up-next pipeline, and the 4 missing pieces for YTMusic related.

### Up-next pipeline (to modify)
- `src/lib/services/similar.ts` — `buildSimilarQueue` (line ~173); source-blind 3-tier builder. Where the YT branch goes.
- `src/lib/stores/player.svelte.ts` — `regenerate()` (~3046/3071/3077 empty-fallback), `ensureAhead()` (~1974/2008/2011 empty-fallback), fresh-play dispatch (~2788/2802/2804).
- `src/lib/services/picks.ts` — `buildDiversePicks` + hard-coded `ARTIST_POOL` (~9-12); the fallback being replaced.
- `src/lib/stores/settings.svelte.ts` — `effectiveUpnextMode` (~471-478); CORRECT, do not change (read-only reference).

### YTMusic transport (to reuse) + existing analog
- `src/lib/proxy/ytmusic.ts` — `NEXT_URL` (~59), `innerTubePost` (~124), `getVisitorData` (~167), `WEB_REMIX_CONTEXT` (~51).
- `src/routes/api/ytmusic/lyrics/+server.ts` — already POSTs `NEXT_URL` (~61) and reads only `findLyricsTab` (discards watch-next rows) — closest analog for a new related route.
- `src/lib/sources/ytmusic.ts` — adapter `search()`/`resolve()` (~213/235), `autoResolveEligible: false` (~210).
- `src/lib/sources/types.ts` — `Track` / `SourceId` / `makeUid()` contracts for building stubs.
- `src/lib/sources/registry.ts` — source enumeration (if a new capability needs registering).

### Charts / top-hits (for the new fallback)
- Charts surface under `src/routes/(app)/` + any `src/lib/services/` picks/discovery/charts service — planner to locate the reusable top-hits data path.

### Project skill
- `Skill("spike-findings-openmusic")` — resolution policy, kuwo-first floor, up-next patterns, API-call-reduction constraints (must not regress the click-to-play call budget from Phase 26).
</canonical_refs>

<specifics>
## Specific Ideas
- Repro / acceptance seed: 摩四老年《港耆》 [Official Music Video] — a YT-only track. With up-next mode = "generate by similar songs", playing it must produce a YTMusic-derived related queue (not `via='diverse'` random picks).
- The `logAction('upnext.source', {via, count})` signal (Activity log) should reflect the new source (e.g. `via='ytmusic-related'` and `via='top-hits'`) so the path is observable in Settings → Activity log.
</specifics>

<deferred>
## Deferred Ideas
- User-facing signal (toast/notice) when the up-next falls back — noted in the diagnosis's suggested_fix_direction but explicitly OUT this phase.
- YTMusic related for CN seeds / cross-source blending — future.
</deferred>

---

*Phase: 28-ytmusic-powered-up-next-recommendations*
*Context gathered: 2026-07-15 via diagnosis + build-routing decisions*
