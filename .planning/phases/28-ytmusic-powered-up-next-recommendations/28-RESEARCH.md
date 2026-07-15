# Phase 28: YTMusic-Powered Up-Next Recommendations - Research

**Researched:** 2026-07-15
**Domain:** YouTube Music InnerTube watch-next/radio queue → source-aware up-next builder + chart-hits fallback (SvelteKit + Cloudflare edge, Svelte 5 runes)
**Confidence:** HIGH (the crux InnerTube shape was captured LIVE from the real endpoint in this session; codebase pipeline read at file:line)

<user_constraints>
## User Constraints (from 28-CONTEXT.md)

### Locked Decisions
- **Source-aware similar branch:** when `seed.source === 'ytmusic'`, the up-next builder MUST use `seed.songid` (videoId) against a YTMusic related/watch-next lookup — BEFORE/INSTEAD OF the string-keyed Last.fm tiers (which cannot map a YT-only track). CN / non-YT seeds keep the existing 3-tier `buildSimilarQueue` behavior UNCHANGED (Last.fm getSimilar → Last.fm+Deezer similar-artists → same-artist searchAll).
- **YTMusic related source:** reuse the EXISTING edge transport — `innerTubePost` → `NEXT_URL` (`youtubei/v1/next`) + `WEB_REMIX_CONTEXT` in `src/lib/proxy/ytmusic.ts`. Do NOT invent a new transport. The same `NEXT_URL` response is already fetched by the lyrics route (which discards the watch-next rows); this phase parses those rows. Expose via a source method (`ytmusic.related(videoId)`) + a route (new `/api/ytmusic/related` OR extend the lyrics route — planner's discretion). Resulting YT up-next stubs MUST respect `autoResolveEligible: false`.
- **Empty-similar fallback → top hits (LOCKED, user-directed):** replace `buildDiversePicks(8, …)` random `ARTIST_POOL` sampling (`src/lib/services/picks.ts`) as the last-resort empty-similar fallback with a fallback that draws from real **top/chart hits**. Applies to BOTH callers: `regenerate()` and `ensureAhead()` empty branches. Prefer an existing charts/top-hits data path (the app already has a charts surface) — don't invent a hard-coded list.
- **Resilience:** never-throw at the service boundary; a YTMusic related failure or empty result degrades gracefully into the (new top-hits) fallback chain — the never-stop playback guarantee must hold.

### Claude's Discretion
- Exact route shape (new `/api/ytmusic/related` vs extending the lyrics route).
- The precise `NEXT_URL` watch-next JSON parse (row container path, dedupe of the seed itself, stub field mapping) — **now RESOLVED in this research via a live capture, see below.**
- Which existing charts/top-hits service to reuse for the fallback, and its shape.
- Whether the YT-branch lives inside `buildSimilarQueue` or as a sibling the caller selects on `seed.source`.

### Deferred Ideas (OUT OF SCOPE)
- Surfacing the fallback to the user via toast/`player.notice` (explicitly NOT requested this phase).
- Any YTMusic account/cookie auth, library inheritance, or personalized recommendations (legal-gated, spike 008).
- Extending YTMusic similar to CN seeds (branch is YT-only; CN seeds keep Last.fm/Deezer/CN tiers).
- Changing the up-next mode resolver / settings (`effectiveUpnextMode` is correct — confirmed in diagnosis).
- Radio-queue `continuations` / infinite paging (the response carries `continuations` + `isInfinite`; not this phase).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UPNEXT-YT-01 | YTMusic related/watch-next source: parse NEXT_URL watch-next queue → Track stubs; source method (`ytmusic.related(videoId)`) + route, reusing `innerTubePost`/`NEXT_URL`/`WEB_REMIX_CONTEXT`. | Live-captured response shape + exact field paths (§Q1). RADIO body is the key (§Q2). Route seam recommendation (§Q3). Real trimmed fixture saved to `28-ytmusic-related.fixture.json`. |
| UPNEXT-YT-02 | Source-aware branch in `buildSimilarQueue`/`regenerate` keyed on `seed.source==='ytmusic'` + `seed.songid`; honor `autoResolveEligible:false`. | Branch placement + resolution-path trace (§Q4). YT stubs carry real `source:'ytmusic'` + `songid:videoId`, NO `resolveByName` → resolve via own adapter (§Q4). |
| UPNEXT-FB-01 | Replace `buildDiversePicks` random `ARTIST_POOL` fallback with a top/chart-hits fallback. | `getChartTopTracks` (Last.fm) is the reusable path; map to name-stubs; Deezer chart is the no-key fallback (§Q5). Exact caller wiring at player.svelte.ts:2011-2014 / :3077-3081 (§Q5). |
| UPNEXT-YT-03 | Never-throw + graceful degrade; zero regression to CN-seed similar; `pnpm test` green + `pnpm check` clean. | Branch fires ONLY for ytmusic seeds → zero CN regression (§Q6). Test inventory + new tests (§Validation Architecture). Bogus-videoId → 0 rows verified (§Q1). |
</phase_requirements>

## Summary

The blocking unknown for this phase — *what does the InnerTube `next` (watch-next) response actually look like, and which request body yields a genuinely related song list?* — was resolved with a **live capture against the real endpoint** in this session (YouTube/InnerTube is reachable in-sandbox, as Phase 27 established). The answer is decisive and changes the plan:

- The **lyrics-route body** `{context, videoId, isAudioOnly:true}` (and a plain `{context, videoId}`) returns a watch-next queue containing **only the seed itself** (one `playlistPanelVideoRenderer`) plus an `automixPreviewVideoRenderer` — it is NOT a related-song list.
- The **RADIO body** `{context, videoId, playlistId: 'RDAMVM' + videoId}` returns **50 `playlistPanelVideoRenderer` rows** of genuinely related songs. For the acceptance seed 港耆 (`dUlAfTZkjpE`) the rows are on-target Hong-Kong underground/indie tracks (大揪鬼, PetPetShawn, 胭脂扣, 摩四青年 label-mates). Row `[0]` is the seed (`selected:true`); rows `[1..49]` are the related queue.

Rows live at a fixed path (`…watchNextTabbedResultsRenderer.tabs[0].tabRenderer.content.musicQueueRenderer.content.playlistPanelRenderer.contents[].playlistPanelVideoRenderer`) with all fields needed for a `Track` stub: `videoId`, `title.runs[].text`, `shortBylineText.runs[].text` (clean artist/channel), `lengthText.runs[0].text` (`"3:51"`), and a solid-https `thumbnail.thumbnails[last].url`. The radio body generalizes (50 rows for mainstream seeds `dQw4w9WgXcQ`/`kJQP7kiw5Fk`) and degrades gracefully (bogus/empty videoId → 0 rows, no throw).

**Primary recommendation:** Add an edge-side pure parser `parseWatchNextQueue()` in `src/lib/proxy/ytmusic.ts`; add a new `GET /api/ytmusic/related?videoId=` route (closest analog to the lyrics route, same `NEXT_URL` POST but the RADIO body) that returns a trimmed `{ tracks: [...] }`; add a client service `ytmusicRelated(videoId)` mapping rows → **real `ytmusic` Track stubs** (`source:'ytmusic'`, `songid:videoId`, `uid:makeUid('ytmusic',videoId)`, NO `resolveByName`) so they resolve through the YT adapter's own `resolve()` (the stream route) — consistent with `autoResolveEligible:false`; add a `seed.source==='ytmusic'` branch at the TOP of `buildSimilarQueue`; and replace the two `buildDiversePicks(8, …)` empty-branch calls in `player.svelte.ts` with a new `buildTopHitsQueue(8, …)` built from `getChartTopTracks` (Last.fm chart) mapped to kuwo-first name-stubs.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fetch InnerTube watch-next radio queue | API / Edge (Cloudflare Worker route) | — | The WEB_REMIX key + upstream POST MUST stay edge-side (never in the client bundle); mirrors the lyrics route. `innerTubePost` uses RAW edge `fetch`, never the client `apiFetch` governor. |
| Parse watch-next JSON → clean rows | API / Edge (pure helper in `$lib/proxy/ytmusic.ts`) | — | Heavy 50-row envelope trimmed edge-side (smaller payload, lyrics-route posture). Pure + node-testable. `+server.ts` may export ONLY HTTP verbs — helper lives in `$lib/proxy`. |
| Map rows → `Track` stubs | Client service (`$lib/services/*`) | — | `makeUid`/`Track` are client contracts; mirrors how `similar.ts` builds stubs. Uses `apiFetch` (client governor) to call the edge route. |
| Source-aware up-next selection | Client service (`buildSimilarQueue`, `similar.ts`) | Store (`player.svelte.ts` callers) | Pure, node-testable branch keyed on `seed.source`; the runes store stays a thin caller (established split). |
| Top/chart-hits fallback | Client service (`picks.ts` + `lastfm.ts` chart) | — | Reuses the existing charts data path; name-stubs resolve lazily on play (kuwo-first). |
| Resolve a YT up-next stub → playable URL | Client adapter (`ytmusic.resolve()`) → API stream route | — | Deterministic `/api/ytmusic/stream/{videoId}` stamp; `autoResolveEligible:false` does NOT block same-source resolution (§Q4). |

## Research Answers

### Q1 — InnerTube watch-next response shape (THE crux; RESOLVED LIVE) `[VERIFIED: live InnerTube capture, 2026-07-15]`

Captured by POSTing the real `NEXT_URL` (`https://music.youtube.com/youtubei/v1/next`, WEB_REMIX public key, no visitorData — metadata endpoint is not bot-gated, spike 007) for seed `dUlAfTZkjpE` (港耆) and mainstream controls. A trimmed real fixture (seed + 5 related rows, only parser-needed fields) is saved at:

`/.planning/phases/28-ytmusic-powered-up-next-recommendations/28-ytmusic-related.fixture.json`

**Container path (identical across all bodies):**
```
contents
 .singleColumnMusicWatchNextResultsRenderer
 .tabbedRenderer.watchNextTabbedResultsRenderer
 .tabs[0].tabRenderer.content            ← tabs[0] = "Up next" (tabs are: Up next | Lyrics | [Comments] | Related)
 .musicQueueRenderer.content
 .playlistPanelRenderer
 .contents[]                             ← each element: { playlistPanelVideoRenderer: {…} }
```
Note: `playlistPanelRenderer` also carries `playlistId`, `isInfinite`, `continuations`, `numItemsToShow` (paging — out of scope).

**Per-row `playlistPanelVideoRenderer` field map (all optional — untrusted JSON, optional-chain everywhere, no `as any`):**

| Track field | Source path | Example |
|-------------|-------------|---------|
| `songid` / `uid` videoId | `row.videoId` (fallback `row.navigationEndpoint.watchEndpoint.videoId`) | `"iM9rpYryn1o"` |
| `title` | `row.title.runs[].text` joined (or `[0].text`) | `"PetPetShawn - 疫流 (Official Music Video)"` |
| `artist` | `row.shortBylineText.runs[0].text` (CLEAN channel/artist) | `"PetPetShawn"` |
| `duration` (secs) | parse `row.lengthText.runs[0].text` OR `row.lengthText.simpleText` (`m:ss`) | `"3:51"` → 231 |
| `cover` | `row.thumbnail.thumbnails[last].url` (largest; solid https `i.ytimg.com`) | `https://i.ytimg.com/vi/iM9rpYryn1o/hq720.jpg?…` |
| seed marker | `row.selected === true` on row[0] (the seed) | strip it |

- `longBylineText.runs` = `"<artist> • <views> views • <likes> likes"` (the first run carries the artist `browseEndpoint` with `pageType: MUSIC_PAGE_TYPE_ARTIST`). Prefer `shortBylineText` for a clean artist; it has no view/like noise. `[VERIFIED: live capture]`
- `lengthText` shape VARIES: some rows use `.runs[0].text`, some `.simpleText`. Parse BOTH (`lengthText.runs?.[0]?.text ?? lengthText.simpleText`). `[VERIFIED: live capture — seed row used simpleText-equivalent, related rows used runs]`
- Thumbnails are 16:9 video stills (`i.ytimg.com/vi/{id}/hq720.jpg`), NOT square album art — expected for a video-capable source; they are solid https so they seed the up-next tile cover without a cover chain (same benefit as the Last.fm image seed in `nameStub`).

**Graceful-degradation behavior (verified):**
| Seed | Rows returned |
|------|---------------|
| `dUlAfTZkjpE` (港耆, radio body) | 50 |
| `dQw4w9WgXcQ` (mainstream) | 50 |
| `kJQP7kiw5Fk` (mainstream) | 50 |
| `THIS_IS_BOGUS` | 0 (`contents` present, no `playlistPanelRenderer`) |
| `""` (empty) | 0 |

Parser MUST return `[]` when the path is absent (bogus/empty seed) — never throw. `[VERIFIED: live capture]`

**Executor-time caveat:** InnerTube is an unversioned, adversarial upstream — the client version string in `WEB_REMIX_CONTEXT` (`1.20240101.01.00`) and the row shape can drift. Keep the parser optional-chained + fixture-tested, and re-run the probe (`probe-next.mjs` pattern below) if the parser test fails at execution time. This is `[CITED: src/lib/proxy/ytmusic.ts:17 "one rotation point"]`.

### Q2 — Correct request body for related/radio (RESOLVED) `[VERIFIED: live capture]`

| Body | Result | Verdict |
|------|--------|---------|
| `{context, videoId, isAudioOnly:true}` (lyrics-route body) | 1 row = the SEED only + `automixPreviewVideoRenderer` | ✗ NOT a related list |
| `{context, videoId}` (plain) | 1 row = the SEED only + `automixPreviewVideoRenderer` | ✗ NOT a related list |
| **`{context, videoId, playlistId: 'RDAMVM' + videoId}`** (radio) | **50 rows** of related songs | ✓ **USE THIS** |

- `RDAMVM` = "Radio / Auto-Mix from Music Video" prefix; appending the videoId names the per-track radio station. The returned rows' `navigationEndpoint.watchEndpoint.playlistId` echoes `RDAMVMdUlAfTZkjpE`, confirming the radio identity. `[VERIFIED: live capture]`
- **Stripping the seed:** row[0] is the seed itself — drop it by BOTH `videoId === seedVideoId` AND `selected === true` (belt-and-suspenders). Then dedupe remaining rows by `videoId`. `[VERIFIED: live capture — row[0].selected===true, videoId===seed]`
- No `visitorData` / auth needed (the `next` metadata endpoint returned 200 anonymous, same as the lyrics route). Do NOT add auth. `[VERIFIED: live capture + CITED: src/lib/proxy/ytmusic.ts:49]`

### Q3 — Route seam decision (RECOMMENDATION)

**Recommend a NEW route `src/routes/api/ytmusic/related/+server.ts` (query param `?videoId=`), NOT extending the lyrics route.** Rationale:
- The lyrics route posts a DIFFERENT body (`isAudioOnly:true`, no `playlistId`) and consumes a different tab (`findLyricsTab`). Overloading it to also fetch the radio would mean two InnerTube POSTs per lyrics call (or a branchy single handler) — worse cohesion, worse cache keys.
- A dedicated route mirrors the lyrics route VERBATIM (own-origin CORS via `corsHeaders`, `OPTIONS` 204, `edgeCache`/`ownOriginCacheKey`, degrade to `{tracks:[]}` never a 500) and is independently cacheable per videoId. `[CITED: src/routes/api/ytmusic/lyrics/+server.ts:45-90]`

**SvelteKit `+server.ts` constraint (MANDATORY — from MEMORY + STATE.md quick-270715/commit 29c1c7d):** a top-level non-HTTP-verb `export function` in a `+server.ts` throws `Invalid export` at REQUEST time (a 500 that unit tests miss because they import the module directly; only E2E catches it). Therefore the **parser (`parseWatchNextQueue`) and the row/interface types MUST live in `$lib/proxy/ytmusic.ts`** — the route file exports ONLY `GET` (and `OPTIONS`). `[CITED: STATE.md:30; MEMORY svelte-server-endpoint-only-verb-exports; src/lib/proxy/ytmusic.ts:275-281]`

**Query param vs path param:** the stream route uses a path param `stream/[videoId]/`; the lyrics route uses a query param `?videoId=`. Since related is the lyrics route's twin (same `NEXT_URL` POST), recommend the **query param** form for consistency with lyrics. Either is acceptable; both are edge-validated (`videoId` placed only into the fixed-URL body — no open relay, threat T-27-02-01). `[CITED: src/routes/api/ytmusic/lyrics/+server.ts:47, 61]`

**Files to add / modify (Q3 concrete list):**
- ADD `src/routes/api/ytmusic/related/+server.ts` — `GET`: read+trim `videoId`; empty → `{tracks:[]}` no upstream call; `edgeCache` per videoId; `innerTubePost(NEXT_URL, {context:WEB_REMIX_CONTEXT, videoId, playlistId:'RDAMVM'+videoId})`; `parseWatchNextQueue(json, videoId)`; return `{tracks}`; `catch → {tracks:[]}` no cache write; `OPTIONS` 204.
- ADD fixture `src/lib/proxy/__fixtures__/ytmusic-next.json` (or `src/lib/sources/__fixtures__/`) — use the captured `28-ytmusic-related.fixture.json`.
- MODIFY `src/lib/proxy/ytmusic.ts` — add `parseWatchNextQueue(nextJson, seedVideoId): YtRelatedRow[]` (pure) + the `YtPlaylistPanelVideoRenderer` interfaces. Optionally export a `RADIO_PLAYLIST_PREFIX = 'RDAMVM'` constant (one rotation point).
- MODIFY the `ytmusic` adapter and/or a new service (see Q4/Q5) to expose `ytmusic.related(videoId)` / `ytmusicRelated(videoId)`.

### Q4 — How YT up-next stubs play given `autoResolveEligible:false` (RESOLVED — trace)

**Build the YT related stubs as REAL `ytmusic` Track stubs, NOT `resolveByName` name-stubs:**
```
{ uid: makeUid('ytmusic', videoId), source: 'ytmusic', songid: videoId,
  title, artist, album:'', cover: <thumb https>, audioUrl:null, lrc:null, lrcUrl:null,
  detailsLoaded:false, quality:null, qualityLabel:null, keyword:`${artist} ${title}`, displayIndex:i+1 }
```

**Resolution path when the stub reaches the front of the queue:**
`player.play()`/prefetch → `ensureTrackDetails(track)` → the `resolveByName` branch is SKIPPED (flag unset) → dispatches `SOURCES['ytmusic'].resolve(track)` → stamps `audioUrl = /api/ytmusic/stream/{videoId}` + `quality:'128k'` + best-effort lyrics + `detailsLoaded:true`. `[CITED: src/lib/services/catalog.ts:288-311; src/lib/sources/ytmusic.ts:235-273]`

**`autoResolveEligible:false` does NOT block this.** The flag is honored in exactly two places, neither of which applies to a track whose OWN source is ytmusic:
1. `fallbackOrder()` cross-source failover TARGET selection — excludes `autoResolveEligible===false` sources so a *non-ytmusic* track never fails over TO ytmusic. `[CITED: src/lib/services/fallback.ts:39-49]`
2. `resolveNameStub()` kuwo-first name-stub walk — `.filter(id => SOURCES[id].autoResolveEligible !== false)` so a name-stub never auto-resolves to ytmusic. `[CITED: src/lib/services/catalog.ts:240-242]`

Both bar the *reverse* direction (mainstream → ytmusic). A ytmusic-origin track resolving through its OWN adapter is the normal, intended path. `[CITED: src/lib/sources/types.ts:91-99 — "A FAILED ytmusic track still falls FORWARD…; only the reverse … is barred"]`

**Why NOT `resolveByName` name-stubs for YT related:** a `resolveByName` stub routes through `resolveNameStub`, which EXCLUDES ytmusic and tries kuwo→qq→… by name. The 港耆 radio rows are YT-only HK indie absent from CN catalogs → they would fail to resolve → dead up-next. Real ytmusic stubs resolving via `/api/ytmusic/stream` are the ONLY correct path and directly honor "searchable + explicit-pick only" (these are effectively YT picks). `[VERIFIED: cross-referenced catalog.ts:240 + the YT-only nature of the radio rows]`

**Failure safety net:** if a YT stub's stream 502s at play time, `runFallback` fires with `failed.source==='ytmusic'`; `fallbackOrder` drops ytmusic (it's the failed source) and tries kuwo→qq→… to resolve the SAME song by name. For a YT-only track that also fails, `next()`/`nextPlayableIndex` advances past it — never-stop holds. `[CITED: src/lib/services/fallback.ts:28-49; src/lib/stores/player.svelte.ts:3106-3111]`
**Device-UAT note:** in-sandbox the YT stream `/api/ytmusic/stream` bytes and `prefetchNext` silent probe cannot be fully E2E-verified (Phase 27 left real-device `<audio>` playback as remaining human UAT). Build correctness is unit-testable; playback stays a device check.

### Q5 — Top/chart-hits fallback source (UPNEXT-FB-01) (RESOLVED)

**Reusable data path:** `getChartTopTracks(limit, page?)` in `src/lib/services/lastfm.ts:211` — one `/api/lastfm/discovery?method=chart.gettoptracks` call → `DiscoveryTrack[]` (`{artist, title, image, mbid}`), never-throws (→ `[]` on absent-key/error). This is EXACTLY the "Top Hits" surface the user already sees at `/charts/top` and the home `top-hits` shelf. `[CITED: src/lib/services/lastfm.ts:211-219; src/routes/(app)/charts/top/+page.svelte:186; src/routes/(app)/+page.svelte:446]`

**Shape gap:** `DiscoveryTrack` is a name-stub `{artist,title,image}`, NOT a playable `Track`. Convert each to a **`resolveByName` name-stub** (the exact `nameStub` shape in `similar.ts:129`) so it resolves kuwo-first lazily on play — ONE chart call at build time, no per-item `searchAll` fan-out. Chart hits are mainstream and DO exist on kuwo, so kuwo-first resolution works well (unlike YT-only rows). The `image` seeds the tile cover.

**Recommended new builder** `buildTopHitsQueue(count, excludeUids)` in `picks.ts`:
1. `const hits = await getChartTopTracks(Math.max(count*2, 20))` (over-fetch so exclude/dedupe still yields `count`).
2. Map each `{artist,title,image}` → a `resolveByName` name-stub (reuse `nameStub`).
3. Drop `excludeUids`, dedupe by synthetic uid, `slice(0, count)`.
4. Never-throw → `[]` (caller leaves queue as-is, same as today).

**Drop-in wiring (exact caller lines):**
- `regenerate()` empty branch: `tail = await buildDiversePicks(8, exclude); via='diverse'` → `tail = await buildTopHitsQueue(8, exclude); via='top-hits'`. `[CITED: src/lib/stores/player.svelte.ts:3077-3081]`
- `ensureAhead()` empty branch: `more = await buildDiversePicks(8, have); via='diverse'` → `more = await buildTopHitsQueue(8, have); via='top-hits'`. `[CITED: src/lib/stores/player.svelte.ts:2011-2014]`
- Extend the local `via` union at player.svelte.ts:2007 and :3070 with `'ytmusic-related' | 'top-hits'`. `[CITED: player.svelte.ts:2007, 3070]`

**Keep `buildDiversePicks`** — it is still used by the home page fallback grid (`+page.svelte:497`) and its `ARTIST_POOL` export; only the PLAYER's two empty-branch callers switch to `buildTopHitsQueue`. `[CITED: src/routes/(app)/+page.svelte:497; src/lib/services/picks.ts:9]`

**No-key robustness (planner discretion):** `getChartTopTracks` needs `LASTFM_KEY` (optional). If absent it returns `[]`. For a no-key install, chain to the **Deezer chart** (`/api/deezer/chart`, NO key required, Deezer reachable in-sandbox) — it returns `{tracks:[{artist,title,image}]}` with covers. Recommended fallback order: `getChartTopTracks` → Deezer chart → (absolute last resort) `buildDiversePicks`. `[CITED: src/routes/api/deezer/chart/+server.ts:1-40; MEMORY deezer-reachable-in-sandbox]`

**Exclude semantics:** yes, still exclude the current queue's uids (same as `buildDiversePicks`). Note the documented bounded dedup gap: a `resolveByName` stub carries a SYNTHETIC uid (`<primary>:similar-<matchKey>`), so exclude-by-uid won't match a same-song REAL queue track — identical to the existing `nameStub` behavior, acceptable per plan. `[CITED: src/lib/services/similar.ts:179-183]`

### Q6 — Regression + budget guardrails (RESOLVED)

- **YT related fires ONLY for ytmusic seeds.** The branch guard `seed.source === 'ytmusic' && seed.songid` gates the entire YT path. For a CN/other seed, `buildSimilarQueue` runs byte-for-byte as today → ZERO added calls, ZERO regression to CN-seed similar. `[CITED: buildSimilarQueue structure, similar.ts:173-247]`
- **Added call count (YT seed):** +1 edge `/api/ytmusic/related` call (one InnerTube `next` POST) REPLACING the 1–3 Last.fm tier calls that would otherwise fire dry. Net ≈ neutral or slightly lower. Each related stub then resolves via 1 `/api/ytmusic/stream` call ON PLAY — same per-song cost as any queued track (no fan-out at build). `[CITED: spike-findings click-to-play-cost.md:27 "up-next build 56→1"]`
- **Top-hits fallback REDUCES calls:** `buildTopHitsQueue` = 1 chart call at build (vs `buildDiversePicks` = 8× `searchAll` fan-out). Name-stubs resolve lazily kuwo-first (1 call/play). `[CITED: src/lib/services/picks.ts:28-38]`
- **kuwo-first floor unchanged:** YT stubs resolve via their OWN adapter (not the kuwo-first name-stub walk); `resolveNameStub` still excludes ytmusic; top-hits name-stubs resolve kuwo-first exactly as Phase-26 similar stubs do. `[CITED: catalog.ts:240-242]`

**Existing tests that MUST stay green (and what changes):**
| Test file | What it asserts today | Impact |
|-----------|----------------------|--------|
| `src/lib/services/similar.test.ts` | primary/fallback tiers, `report(via)` = similar/artist/lastresort/empty, call-cost = 1 | Report type extended additively (`+'ytmusic-related'`). CN-seed tests unchanged. ADD a YT-seed test (mock `/api/ytmusic/related` → rows → ytmusic stubs; `report('ytmusic-related')`). |
| `src/lib/stores/player.svelte.test.ts:890-959` | `regenerate` never-empty net calls `buildDiversePicks`, logs `via:'diverse'` | UPDATE: empty branch now calls `buildTopHitsQueue`; mock it; assert `via:'top-hits'`. Update `vi.mock('$lib/services/picks', …)` at line 33 to export the new fn. |
| `src/lib/stores/player.svelte.test.ts:651-688` | `ensureAhead` seeds from current via `buildSimilarQueue`, falls to `buildDiversePicks` when dry | UPDATE the dry-fallback test to `buildTopHitsQueue` + `via:'top-hits'`. |
| `src/lib/sources/ytmusic.test.ts` | search parse over fixture; resolve stamps stream url | ADD `ytmusic.related()` / parser tests if the method lives on the adapter. Unchanged otherwise. |
| `src/lib/proxy/ytmusic.test.ts` | `findLyricsTab`, `extractLyrics`, `innerTubePost` | ADD `parseWatchNextQueue` tests over the captured fixture (seed stripped, N rows, field mapping, `[]` on bogus). |

## Standard Stack

No new npm packages. This phase is 100% first-party over existing platform primitives (`fetch`, InnerTube, `apiFetch` governor, SvelteKit routes).

| Existing module | Version/loc | Purpose | Why standard |
|-----------------|-------------|---------|--------------|
| `innerTubePost` / `NEXT_URL` / `WEB_REMIX_CONTEXT` | `src/lib/proxy/ytmusic.ts:59,124,51` | Edge InnerTube transport (reuse) | Verified in Phase 27, already POSTs `NEXT_URL` for lyrics |
| `getChartTopTracks` | `src/lib/services/lastfm.ts:211` | Top-hits fallback data | The existing `/charts/top` + home top-hits source |
| `nameStub` pattern | `src/lib/services/similar.ts:129` | `resolveByName` lazy stub | Phase-26 up-next contract (56→1) |
| `makeUid` / `Track` | `src/lib/sources/types.ts:121,27` | YT stub identity | Canonical colon-uid contract |
| `edgeCache` / `ownOriginCacheKey` / `corsHeaders` | `$lib/proxy/edge-cache`, `$lib/proxy/http` | Route caching + CORS | Lyrics-route posture |

## Package Legitimacy Audit

**N/A — this phase installs no external packages.** All work reuses first-party modules already in the repo (`package.json` shows the web app has NO third-party runtime npm deps; sources/proxy/services are hand-written over platform `fetch`/`URL`). No slopcheck needed.

## Architecture Patterns

### Data flow diagram

```
                         seed = player.current (fresh play or exhaust-grow)
                                        │
                    ┌───────────────────┴───────────────────┐
        regenerate()/ensureAhead()  →  buildSimilarQueue(seed, exclude, report)
        (player.svelte.ts:3071/2008)              (similar.ts:173)
                                        │
                     ┌──────────────────┼───────────────────────────┐
        seed.source==='ytmusic'?     NO │                            │ YES  (+ seed.songid)
                     │  (existing 3 tiers unchanged)                 ▼
                     │  Last.fm getSimilar → Last.fm+Deezer          ytmusicRelated(videoId)
                     │  similar-artists → same-artist searchAll      (client service, apiFetch)
                     │                                               │
                     ▼                                               ▼
              report('similar'|'artist'|'lastresort'|'empty')   GET /api/ytmusic/related?videoId=  (edge route)
                     │                                               │  innerTubePost(NEXT_URL, {ctx, videoId,
                     │                                               │     playlistId:'RDAMVM'+videoId})   [RADIO body]
                     │                                               ▼
                     │                                          parseWatchNextQueue(json, videoId)  ($lib/proxy, pure)
                     │                                          → strip seed(row0/selected) → dedupe → {tracks}
                     │                                               │
                     │                                          map → real ytmusic Track stubs
                     │                                          (source:'ytmusic', songid:videoId, NO resolveByName)
                     │                                          report('ytmusic-related')
                     └───────────────┬───────────────────────────────┘
                                     │ (empty result on EITHER path)
                                     ▼
                    buildTopHitsQueue(8, exclude)   (picks.ts — getChartTopTracks → name-stubs)
                    report/log via='top-hits'   [replaces buildDiversePicks ARTIST_POOL]
                                     │
                                     ▼
                    queue tail installed → on play: ensureTrackDetails →
                      • ytmusic stub → SOURCES['ytmusic'].resolve → /api/ytmusic/stream/{videoId}
                      • top-hits name-stub → resolveNameStub kuwo-first (ytmusic excluded)
```

### Pattern: edge-parse, client-map (mirror the lyrics route)
**What:** heavy InnerTube JSON parsed to a trimmed clean array EDGE-side; client service maps clean rows → `Track` via `makeUid`.
**When:** any new InnerTube-backed capability.
**Why:** keeps the 50-row envelope + WEB_REMIX key edge-side; small payload; `+server.ts` exports only verbs.

### Pattern: source-aware branch at the top of a pure builder
**What:** `if (seed.source==='ytmusic' && seed.songid) { … return; }` as the FIRST block of `buildSimilarQueue`; existing tiers become the `else`/fall-through.
**When to short-circuit vs fall-through:** on an EMPTY YT result, recommend returning `[]` with `report('empty')` so the caller's `buildTopHitsQueue` net fires — do NOT fall through to the Last.fm tiers (they key on artist/title strings and will be dry for a YT-only seed, wasting 1–3 calls). `[design recommendation — planner discretion per CONTEXT]`

### Anti-Patterns to Avoid
- **Using the lyrics-route body for related.** `{videoId, isAudioOnly:true}` returns ONLY the seed — you MUST send `playlistId:'RDAMVM'+videoId`. `[VERIFIED: live capture]`
- **Building YT related as `resolveByName` name-stubs.** They'd resolve kuwo-first (ytmusic excluded) → dead up-next for YT-only rows. Use real ytmusic stubs.
- **A top-level helper `export` in `+server.ts`.** 500 at request time — parser goes in `$lib/proxy/ytmusic.ts`.
- **Calling `apiFetch` edge-side.** `apiFetch` is the CLIENT governor; the route uses `innerTubePost` (raw edge fetch). `[CITED: src/lib/proxy/ytmusic.ts:10-13]`
- **Re-fetching the seed as a queue member.** Strip row[0] (`selected:true` / videoId match).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| InnerTube POST + retry + timeout + key-hiding | a new fetch wrapper | `innerTubePost(NEXT_URL, body)` | Already handles retry/timeout/key-strip (ytmusic.ts:124) |
| Anonymous visitor token | visitorData plumbing | NOTHING — `next` needs none | Metadata endpoint not bot-gated (verified) |
| Top-hits list | a new hard-coded artist array | `getChartTopTracks` | The real charts surface already exists (lastfm.ts:211) |
| Up-next stub → playable | eager `resolveStub`/`searchAll` per item | lazy stub + `ensureTrackDetails` on play | Phase-26 56→1 budget |
| Route CORS / cache / OPTIONS | new boilerplate | copy the lyrics route | Same posture, proven |

## Common Pitfalls

### Pitfall 1: Assuming the lyrics response already carries the related queue
**What goes wrong:** re-using the existing lyrics `NEXT_URL` call (no `playlistId`) yields ONLY the seed row.
**How to avoid:** send the RADIO body `playlistId:'RDAMVM'+videoId`. **Warning sign:** parser returns 0–1 rows for a known-good seed.

### Pitfall 2: `lengthText` shape drift (runs vs simpleText)
**What goes wrong:** reading only `.simpleText` (or only `.runs`) drops the duration on half the rows.
**How to avoid:** `lengthText.runs?.[0]?.text ?? lengthText.simpleText`. Duration is OPTIONAL on `Track` — a miss must NOT drop the row (D-03 unknown-neutrality). `[VERIFIED: live capture]`

### Pitfall 3: InnerTube contract drift at execution time
**What goes wrong:** YT changes the row shape / client version rejects; parser test fails.
**How to avoid:** optional-chain everything; keep the fixture test; re-run the live probe (below) and refresh the fixture. Never throw from the route (degrade to `{tracks:[]}`).

### Pitfall 4: Player test mocks go stale
**What goes wrong:** swapping `buildDiversePicks`→`buildTopHitsQueue` in the player breaks the `vi.mock('$lib/services/picks')` mock + `via:'diverse'` assertions.
**How to avoid:** update the mock export and the `via` assertions to `'top-hits'` in the SAME change (player.svelte.test.ts:33, 919-940, 673-688).

## Code Examples

**Re-capture / refresh the InnerTube fixture (executor-time verification):**
```js
// node probe-next.mjs <videoId>  — RADIO body is the one that returns related rows
const KEY='AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const NEXT='https://music.youtube.com/youtubei/v1/next?prettyPrint=false&key='+KEY;
const CTX={client:{clientName:'WEB_REMIX',clientVersion:'1.20240101.01.00',hl:'en',gl:'US'}};
const H={'content-type':'application/json',origin:'https://music.youtube.com',referer:'https://music.youtube.com/'};
const id=process.argv[2]||'dUlAfTZkjpE';
const r=await fetch(NEXT,{method:'POST',headers:H,body:JSON.stringify({context:CTX,videoId:id,playlistId:'RDAMVM'+id})});
const j=await r.json();
const rows=j.contents.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer
  .watchNextTabbedResultsRenderer.tabs[0].tabRenderer.content.musicQueueRenderer
  .content.playlistPanelRenderer.contents.map(c=>c.playlistPanelVideoRenderer);
console.log(rows.length, rows[1].videoId, rows[1].title.runs[0].text, rows[1].shortBylineText.runs[0].text);
```

**Parser skeleton (`$lib/proxy/ytmusic.ts`, pure, optional-chained — mirrors `findLyricsTab`):**
```ts
export interface YtRelatedRow { videoId: string; title: string; artist: string; cover: string | null; duration?: number; }
export function parseWatchNextQueue(nextJson: unknown, seedVideoId: string): YtRelatedRow[] {
  const rows = (nextJson as YtNextJson)?.contents?.singleColumnMusicWatchNextResultsRenderer
    ?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content
    ?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents ?? [];
  const out: YtRelatedRow[] = []; const seen = new Set<string>();
  for (const c of rows) {
    const r = c?.playlistPanelVideoRenderer; if (!r) continue;
    const videoId = r.videoId ?? r.navigationEndpoint?.watchEndpoint?.videoId ?? null;
    if (!videoId || videoId === seedVideoId || r.selected === true) continue; // strip seed
    if (seen.has(videoId)) continue; seen.add(videoId);
    const title = (r.title?.runs ?? []).map((x) => x.text ?? '').join('').trim();
    const artist = (r.shortBylineText?.runs?.[0]?.text ?? '').trim();
    const cover = r.thumbnail?.thumbnails?.slice(-1)[0]?.url ?? null;
    const len = r.lengthText?.runs?.[0]?.text ?? r.lengthText?.simpleText ?? '';
    const m = /^(\d+):(\d{2})$/.exec(len);
    const row: YtRelatedRow = { videoId, title, artist, cover };
    if (m) row.duration = Number(m[1]) * 60 + Number(m[2]);
    out.push(row);
  }
  return out;
}
```
`// Source: shape VERIFIED live 2026-07-15; see 28-ytmusic-related.fixture.json`

## Runtime State Inventory

N/A — this is a feature/greenfield-code phase (new route + service + branch), not a rename/refactor/migration. No stored data keys, OS-registered state, secrets, or build artifacts are renamed. The only persisted surface touched is the queue in `openmusic:player:v1`, which already stores arbitrary `Track` shapes (ytmusic stubs are valid `Track`s) — no migration needed.

## State of the Art

| Old approach | Current approach | Why |
|--------------|------------------|-----|
| Up-next builder keys on artist/title strings only (source-blind) | Source-aware: ytmusic seed → InnerTube radio queue | 港耆 (YT-only) has no Last.fm/Deezer/CN data → all string tiers dry (the diagnosed bug) |
| Empty-similar → `buildDiversePicks` random `ARTIST_POOL` | Empty-similar → `buildTopHitsQueue` (real chart hits) | User-directed: random pool is noise; charts are broadly useful |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `WEB_REMIX_CONTEXT` client version `1.20240101.01.00` remains accepted for the radio `next` call at execution time | Q1/Q2 | LOW — verified live today; if it drifts, refresh via the probe. Route degrades to `{tracks:[]}` (never-stop holds). |
| A2 | `getChartTopTracks` is the intended "top hits" source vs the Deezer chart | Q5 | LOW — both exist; `getChartTopTracks` is what `/charts/top` uses. Planner may chain Deezer for no-key robustness. |
| A3 | Short-circuiting to `[]` (not falling through Last.fm tiers) on an empty YT result is preferred | Q3/patterns | LOW — CONTEXT gives branch-placement discretion; falling through only wastes 1–3 dry calls (still correct). |
| A4 | YT stream playback for related stubs works on real devices | Q4 | MEDIUM — build is unit-testable; actual `<audio>` playback is Phase-27 remaining device UAT (not verifiable in-sandbox). |

## Open Questions

1. **Radio continuations / infinite queue** — the response carries `continuations` + `isInfinite:true`. This phase takes the first ~49 rows. If a long YT-seed session exhausts them, `ensureAhead` re-fetches the same radio (minus played uids → shrinking).
   - Recommendation: out of scope (CONTEXT defers infinite paging). A future phase can thread `continuations`.

2. **Should `ytmusic.related()` live on the adapter or as a standalone service?** The `SourceAdapter` interface only declares `search`/`resolve`.
   - Recommendation: a standalone client service `ytmusicRelated(videoId)` (e.g. in `similar.ts` or a small `$lib/services/ytmusic-related.ts`) called by the `buildSimilarQueue` branch — avoids widening the shared `SourceAdapter` contract for a one-source capability. CONTEXT's "`ytmusic.related(videoId)`" is illustrative, not binding.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| YouTube InnerTube `next` | UPNEXT-YT-01 related queue | ✓ (verified live) | WEB_REMIX 1.20240101.01.00 | route degrades to `{tracks:[]}` → top-hits fallback |
| Last.fm `/api/lastfm/discovery` (chart) | UPNEXT-FB-01 top hits | ✓ (needs `LASTFM_KEY`; optional) | — | Deezer `/api/deezer/chart` (no key) |
| Deezer `/api/deezer/chart` | UPNEXT-FB-01 no-key fallback | ✓ (reachable in-sandbox) | public /chart | `buildDiversePicks` (last resort) |
| CN meting proxies (kuwo/qq/…) | resolving top-hits name-stubs on PLAY | ✗ in-sandbox | — | device/deployed only (existing constraint) |

**Missing with no fallback:** none block the BUILD path. **Missing with fallback:** CN upstreams are unreachable in-sandbox — top-hits name-stub *resolution on play* is a device/deployed check, not a sandbox unit test (existing project constraint, MEMORY sandbox-no-cn-upstream-network).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.3` (single node/server project, no jsdom) |
| Config file | `vite.config.ts` (test project); run via `pnpm test` |
| Quick run command | `pnpm test -- src/lib/proxy/ytmusic.test.ts src/lib/services/similar.test.ts` |
| Full suite command | `pnpm test` (`vitest --run`) then `pnpm check` (svelte-check) |

### Phase Requirements → Test Map
| Req | Behavior | Test type | Automated command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| UPNEXT-YT-01 | `parseWatchNextQueue` strips seed, dedupes, maps fields; `[]` on bogus | unit (fixture) | `pnpm test -- src/lib/proxy/ytmusic.test.ts` | ✅ file exists, ❌ Wave 0 test |
| UPNEXT-YT-01 | `/api/ytmusic/related` GET returns `{tracks}`, `{tracks:[]}` on empty/error, OPTIONS 204 | unit | new `src/routes/api/ytmusic/related/related.test.ts` (or in ytmusic.test) | ❌ Wave 0 |
| UPNEXT-YT-02 | `buildSimilarQueue` YT-seed branch → ytmusic stubs, `report('ytmusic-related')`; CN seed unchanged | unit | `pnpm test -- src/lib/services/similar.test.ts` | ✅ file, ❌ Wave 0 test |
| UPNEXT-YT-02 | YT stub resolves via `SOURCES['ytmusic'].resolve` (not resolveNameStub) | unit | `pnpm test -- src/lib/sources/ytmusic.test.ts` | ✅ (resolve test exists; add stub-origin case) |
| UPNEXT-FB-01 | `buildTopHitsQueue` = 1 chart call → name-stubs, excludes uids | unit | new `src/lib/services/picks.test.ts` (none today) | ❌ Wave 0 |
| UPNEXT-FB-01 | `regenerate`/`ensureAhead` empty branch → `buildTopHitsQueue`, `via:'top-hits'` | unit | `pnpm test -- src/lib/stores/player.svelte.test.ts` | ✅ (update mocks/assertions) |
| UPNEXT-YT-03 | never-throw everywhere; full suite green | suite | `pnpm test && pnpm check` | ✅ |

### Sampling Rate
- **Per task commit:** the quick run command (proxy + similar).
- **Per wave merge:** `pnpm test` full suite.
- **Phase gate:** `pnpm test` green + `pnpm check` clean before `/gsd:verify-work`. Real-device YT `<audio>` playback of a related stub = human UAT (carry-over from Phase 27).

### Wave 0 Gaps
- [ ] Fixture `src/lib/proxy/__fixtures__/ytmusic-next.json` — from the captured `28-ytmusic-related.fixture.json` (covers UPNEXT-YT-01).
- [ ] `parseWatchNextQueue` tests in `src/lib/proxy/ytmusic.test.ts`.
- [ ] YT-seed branch test in `src/lib/services/similar.test.ts` (mock `/api/ytmusic/related`).
- [ ] `src/lib/services/picks.test.ts` — new file for `buildTopHitsQueue`.
- [ ] Update `player.svelte.test.ts` mocks (line 33) + `via` assertions (`'diverse'`→`'top-hits'`).
- Framework already installed — no install step.

## Security Domain

`security_enforcement` is not set in `.planning/config.json` (treated as enabled). This phase reuses the Phase-27 edge posture; the applicable controls:

| ASVS | Applies | Control (reuse) |
|------|---------|-----------------|
| V5 Input Validation | yes | `videoId` trimmed + placed ONLY into the FIXED `NEXT_URL` body (POST-to-fixed-URL, no open relay) — copy the lyrics route (T-27-02-01). Edge `encodeURIComponent` on any path/query use. |
| V6 Cryptography | no | No secrets minted; WEB_REMIX key is public but kept edge-side (never echoed to a response body — T-27-02-02). |
| V4 Access Control | partial | CORS allowlisted via `corsHeaders` + `hooks.server.ts` seam — never `*`. `OPTIONS` 204. |
| V2/V3 Auth/Session | no | Fully anonymous — NO account/OAuth/cookie/visitorData (spike 008 is a separate legal-gated milestone; do NOT add auth). |

| Threat | STRIDE | Mitigation |
|--------|--------|-----------|
| WEB_REMIX key leak to client | Info Disclosure | Key stays in the edge URL only; `innerTubePost` strips the query string from thrown errors (ytmusic.ts:139-141) |
| Open-relay via attacker `videoId` | Tampering | videoId only in the fixed InnerTube body, never a free URL |
| Upstream 5xx / drift crashes the app | DoS | Route degrades to `{tracks:[]}` (never 500); builder never-throws → top-hits fallback → never-stop |

## Sources

### Primary (HIGH)
- **LIVE InnerTube capture (2026-07-15)** — `youtubei/v1/next` for `dUlAfTZkjpE`, `dQw4w9WgXcQ`, `kJQP7kiw5Fk`, bogus, empty; RADIO vs plain vs lyrics bodies. Trimmed real fixture: `.planning/phases/28-…/28-ytmusic-related.fixture.json`.
- Codebase (read at file:line): `src/lib/proxy/ytmusic.ts`, `src/routes/api/ytmusic/lyrics/+server.ts`, `src/lib/services/similar.ts`, `src/lib/services/catalog.ts`, `src/lib/services/fallback.ts`, `src/lib/services/picks.ts`, `src/lib/services/lastfm.ts`, `src/lib/sources/ytmusic.ts`, `src/lib/sources/types.ts`, `src/lib/sources/registry.ts`, `src/lib/stores/player.svelte.ts`, `src/routes/(app)/charts/top/+page.svelte`, `src/routes/api/deezer/chart/+server.ts`.
- `.planning/debug/upnext-similar-empty-fallback.md` (diagnosis), `28-CONTEXT.md`, `STATE.md`.
- `Skill("spike-findings-openmusic")` — kuwo-first floor, 56→1 up-next budget, click-to-play cost model.

### Secondary (MEDIUM)
- MEMORY notes: `svelte-server-endpoint-only-verb-exports`, `deezer-reachable-in-sandbox`, `sandbox-no-cn-upstream-network`, `ytmusic-integration-spike-verdicts`, `search-ranking-authority-scoreMatch`.

### Tertiary (LOW)
- `RDAMVM` prefix semantics (radio/automix) — inferred from the echoed `watchEndpoint.playlistId` + community convention; the BEHAVIOR (50 related rows) is VERIFIED live regardless of the acronym gloss.

## Metadata

**Confidence breakdown:**
- InnerTube shape + radio body: HIGH — captured live from the real endpoint this session, generalized across 3 seeds + 2 degenerate inputs.
- Codebase pipeline / resolution path: HIGH — read at file:line, cross-referenced flag handling in fallback.ts + catalog.ts.
- Top-hits fallback source: HIGH — existing `getChartTopTracks` confirmed as the `/charts/top` + home source.
- Real-device YT playback of related stubs: MEDIUM — carry-over Phase-27 device UAT (not sandbox-verifiable).

**Research date:** 2026-07-15
**Valid until:** ~2026-08-14 for the codebase claims; InnerTube shape is an adversarial upstream — re-run the probe if the parser fixture test fails.
