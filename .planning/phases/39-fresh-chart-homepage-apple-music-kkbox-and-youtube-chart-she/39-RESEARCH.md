# Phase 39: Fresh chart homepage - Research

**Researched:** 2026-09-25 (dev Mac, live probes against every upstream + the running dev server on :5173)
**Domain:** Edge chart proxies (Apple Music RSS v2, KKBOX kma, YouTube Charts), a client-side legacy iTunes feed, Deezer genre charts, a versioned settings migration, and home-page shelf orchestration in SvelteKit 2 / Svelte 5 runes on Cloudflare Pages
**Confidence:** HIGH for upstream behaviour and codebase integration (live-probed today + code read). MEDIUM for the UX calls flagged in Open Questions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Shelf → source (spike-verified)

| Shelf (section id — Claude's naming, keep stable once shipped) | Source | Fetch from |
|---|---|---|
| Top Songs (`chart-songs`) | **KKBOX** daily `type=song` when region ∈ {hk, tw, sg}; **Apple Music RSS** `most-played/songs` otherwise | edge |
| New Releases (`new-releases`) | KKBOX `type=newrelease` — region ∈ {hk, tw, sg} only; the section renders nothing elsewhere | edge |
| Top Artists (`chart-artists`) | YouTube Charts `ARTISTS` weekly | edge |
| Top Albums (`chart-albums`) | Apple Music RSS `most-played/albums` | edge |
| Trending on YouTube (`yt-trending`) | YouTube Charts `TRACKS` weekly | edge |
| Genres group (`genres`) — one shelf per selected genre | regional pop = legacy iTunes RSS genre feed (**client-side**); Western = Deezer `/chart/{id}/tracks` | client / edge |
| More regions group (`regions`) — one Top Songs shelf per extra region | Apple Music RSS `most-played/songs` per storefront | edge |

- **Top Songs source split is a Claude recommendation, not a user call** — spike 011 measured KKBOX HK's
  top-20 median release age at 25 d vs Apple HK's 354 d (HK Apple Music listeners replay older catalogue).
  The user's original proposal said Apple for Top Songs; flag this at plan review.
- Genre pool (id → source): `cantopop` iTunes 1251@hk · `mandopop` iTunes 1253@tw · `kpop` iTunes 51@hk ·
  `jpop` iTunes 27@jp · `hiphop` Deezer 116 · `rock` Deezer 152 · `dance` Deezer 113 · `rnb` Deezer 165 ·
  `electronic` Deezer 106 · `alternative` Deezer 85 · `asian` Deezer 16. Regional genres use a FIXED
  storefront, independent of the Chart region (the HK storefront's J-Pop/Mandopop are stale purchase charts).

#### Region (user decision)
- **One main "Chart region" + optional "More regions".** Chart region drives Top Songs / New Releases /
  Top Artists / Top Albums. Default derived from the resolved app language: zh-Hant→`hk`, zh-Hans→`tw`
  (NEVER `cn` — the CN storefront's top 20 median age is ~22 years), en→`us`; the other 12 locales map to
  their home storefront (de→de, fr→fr, es→es, it→it, pt→br, ru→ru, tr→tr, th→th, vi→vn, id→id, hi→in,
  ar→sa or ae) — researcher verifies each against Apple RSS and YouTube Charts, falling back to `us`.
- The region list offered = storefronts verified for Apple RSS (KKBOX-only shelves simply don't render
  outside hk/tw/sg; YouTube Charts country codes verified per region, unsupported → Top Artists/Trending
  hidden for that region rather than erroring).
- "More regions" = multi-select + reorder chips (same interaction as today's countries chips). It
  REPLACES the Last.fm country shelves as the default per-country surface; the old `countries` section
  still exists under the classic group.
- Default "More regions" for a fresh user: Claude's discretion (suggest none, or 2–3 neighbours of the main
  region — e.g. hk → tw, jp, kr, us) — keep the default cold-home fan-out small.

#### Existing users (user decision)
- **One-time switch on first load after the update:** new chart sections shown, old `top-hits`,
  `top-artists`, `tags`, `countries` added to `homeHidden`. Library sections, the user's relative order of
  existing sections, per-section density, shelf size, landing tab, chrome toggles — all preserved.
- Implement as a versioned settings migration (e.g. a `homeLayoutVersion` field in the settings blob),
  idempotent, run once inside `settings.load()`; a blob already at the new version is untouched. New
  section ids are inserted into the saved order where the old chart block sat (not blindly appended).
- Reset-to-default (`resetHome()`) produces the new layout. Fresh installs get it from the defaults.

#### Genres (user decision)
- **Default ON: Asian pop (cantopop, mandopop, kpop, jpop) + Western core (hiphop, rock, dance, rnb).**
  electronic / alternative / asian available, off. Picker = multi-select + reorder chips like today's tags.
- Every legacy-iTunes row is kept only if `category.attributes['im:id'] === String(genreId)` (a bogus id
  returns the overall chart with a 200). `feed.entry` is an object, not an array, when there is one row.
- The old Last.fm `tags` shelves keep their own chip picker, inside the classic group.

#### Old shelves (user decision)
- `top-hits` (Deezer), `top-artists` (Deezer), `tags` (Last.fm), `countries` (Last.fm) are NOT removed.
  They stay in /settings/home, hidden by default, visibly marked as the classic/Last.fm·Deezer sources,
  and re-enabling one restores today's behaviour exactly (including its current Randomize page trick).
- A hidden section issues ZERO requests (today's rule — keep it).

#### /settings/home layout
- Groups (Claude's discretion on exact visuals; UI-SPEC decides): **Charts** (new sections + Chart region +
  More regions + Genres), **Your library** (liked, downloads, radio, fav-artists, playlists, history),
  **Classic (Last.fm / Deezer)** (the four old sections + the old genre-tag and country chips), then the
  existing global controls (items per shelf, grid columns, landing tab, tile density, chrome toggles).
- Reorder stays one global order across all sections (the home renders one list); grouping is a
  presentation of that list, or reorder-within-group — UI-SPEC decides, but the persisted
  `homeSectionOrder` stays a single array of ids and `resolveSectionOrder` stays the robustness layer.

#### Randomize + first render
- Each shelf fetches its top 50–100 once (edge-cached); the rendered shelf is a random N
  (`clampShelfSize`) sampled from that pool. Randomize re-samples locally — **zero extra requests** for
  the new shelves.
- Preserve the existing contract (code comment in `+page.svelte`, user quote "after refresh it should show
  the latest set B, not A"): the sampled arrangement is persisted, a reload shows the persisted arrangement,
  and only a cold cache or a Randomize press draws a new sample. A cold first render IS random, so two
  fresh users no longer see the same page.

#### Tile taps
- Song tiles (Top Songs, New Releases, Trending, genres, regions): `player.playStub(artist, title, image,
  'home-discovery')` — the existing resolve-on-tap path; no new resolve logic. Trending tiles resolve by
  name too (the ytmusic edge byte fetch is 403 on the web build — spike 006 post-build finding).
- Artist tiles: the existing artist-page navigation used by today's Top Artists tiles.
- Album tiles: open the existing album page (MusicBrainz `?mbid=` / Deezer path) resolved from
  album name + artist — researcher finds the existing album-open path and reuses it.
- Long-press = the existing `tileMenu` stub → `resolveStub` flow.

#### Caching / resilience
- Edge: own caching (Apple sends `max-age=0, private`) — fresh ~6 h, serve-stale up to ~48 h with a
  background refresh; cold miss + upstream failure → empty shelf. 5 s timeout on Apple (≈2% of calls hang).
- Client: persisted pools/arrangement for instant paint (bump the home cache key version).
- Undocumented sources (KKBOX kma, YouTube Charts) are never-throw at the service boundary → `[]`, and an
  empty shelf renders nothing (no header), like today's empty library shelves.
- YouTube Charts `clientVersion` is a pinned constant (`'2.0'` verified; `'0.1'` → 404), same maintenance
  posture as the ytmusic `ANDROID_VR` version constant.

### Claude's Discretion
- Section id names, route paths (`/api/charts/*` vs per-source), service/module split.
- Whether "See all" drilldowns exist for new shelves (if yes: one generic chart list page that renders the
  already-fetched pool, no new fetch; existing `/charts/*` pages stay for the classic shelves).
- Default "More regions" set; region list ordering; how the settings groups look (UI-SPEC).
- Whether Top Albums uses KKBOX or Apple for hk/tw (KKBOX `album` type returns error 103 — Apple is the
  only album source verified).

### Deferred Ideas (OUT OF SCOPE)
- KKBOX per-language rows (Cantonese 320 / Mandarin 297 / Western 390 — HK only); largely overlap the
  Cantopop/Mandopop genre shelves.
- YT Music "Moods & genres" curated playlists (3 browse calls per shelf).
- Playing Trending tiles through the ytmusic source by `videoId` (web edge byte fetch is 403).
- KKBOX Open API (client-credentials) as a documented fallback if kma breaks.
- Post-deploy check from the HKG colo (spikes observed YVR/PDX only).
- Apple music-video charts; YouTube daily charts.
</user_constraints>

<phase_requirements>
## Phase Requirements

No REQ-IDs are assigned. The IDs below are **researcher-derived** from 39-CONTEXT.md decisions and
MANIFEST `[011]` / `[012]` / `[user 2026-09-24]`, so the planner can map plans and tests to something.

| ID | Description | Research Support |
|----|-------------|------------------|
| P39-01 | Edge chart route: Apple RSS songs/albums, KKBOX song/newrelease, YouTube Charts TRACKS/ARTISTS, allowlisted params, reshape to `DiscoveryTrack`/`DiscoveryArtist`/`ChartAlbum` | §Standard Stack, §Pattern 1, §Code Examples 1–3, live probes |
| P39-02 | Edge serve-stale (fresh 6 h / stale 48 h, `platform.ctx.waitUntil` refill, empty never cached) | §Pattern 2, Code Example 4 |
| P39-03 | Deezer `/chart/{genre}/tracks` via a `genre` param on the existing route | §Pattern 3 |
| P39-04 | Client legacy-iTunes genre service (genre-id guard, object-vs-array, resize) | §Pattern 4, Code Example 5 |
| P39-05 | Region model: offered list, capability flags, `'auto'` → app-language default | §Region table, Code Example 6 |
| P39-06 | Versioned one-time migration + fresh defaults + `resetHome()` | §Pattern 5, Code Example 7 |
| P39-07 | Home integration: new shelves in `refresh()`, hidden = zero requests (ALSO for classic shelves), v3 cache, sampling, reveal budget | §Pattern 6, Pitfalls 1–4 |
| P39-08 | Tile taps: song → `playStub`, artist → `/artist/`, album → `albumHref()` | §Pattern 7 |
| P39-09 | Image allowlists for mzstatic / i.kfs.io / Google hosts; share `?ci=` needs no grammar change | §Security, Pitfall 7 |
| P39-10 | /settings/home: Charts / Library / Classic groups, region + more-regions + genre chips | §Settings UI inventory |
| P39-11 | i18n: new keys in all 15 locales, double quotes, parity test | §Settings UI inventory |
| P39-12 | Randomize = local re-sample (0 requests) for new shelves; classic keeps its random-page trick | §Pattern 6 |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- SvelteKit 2 + Svelte 5 runes (forced); stores are runes singletons in `*.svelte.ts`; pure logic in `.ts`, node-testable.
- Internal non-reactive counters/guards are plain fields, not `$state`. Generation guards (`refreshGen`) after every `await`.
- Stores never import UI and never localize; emit `TranslationKey`s. `settings` stays a LEAF store (imports nothing from player/library; `home-layout.ts` imports nothing).
- `$lib/...` path aliases; `import type` for types; named exports; no default exports in `$lib`.
- Never-throw services return a sentinel (`[]`/`null`); failures are thrown INSIDE `cached()` so they are never cached.
- Zero `as any` in production code; prefer `satisfies` / `as const`.
- SSR guard: anything touching `localStorage`/`window`/`navigator`/`Intl` in stores gates on `browser`.
- i18n: `src/lib/i18n/*.ts` use DOUBLE quotes for keys and values; all 15 locales have IDENTICAL key sets (`i18n.test.ts` parity + quote-style test).
- High comment density; add decision-ref comments (use a `39-D-xx` / quick-task tag); never delete existing decision-ref comments.
- **Shared Primitives — import, never re-inline:** `services/track-ready.ts`, `services/url-safety.ts` (`hasHttpsScheme`), `services/cover-gradient.ts` (`coverGradient`), `sources/registry.ts` (`onlySource`), `services/abort-signal.ts` (`combinedSignal`), `services/source-health.ts`, `proxy/safe-image-url.ts`, `proxy/lastfm-image.ts`, `proxy/http.ts` (`jsonResponse`).
- `+server.ts` may export ONLY HTTP verbs — helpers go in `$lib/proxy/*.ts` (memory `svelte-server-endpoint-only-verb-exports`).
- CORS only via `hooks.server.ts` allowlist, never `*`. Secrets edge-side only (none needed here — all sources keyless).
- Every client fetch goes through the `apiFetch` governor; no unbounded fan-out (memory `api-fetch-flood-freeze`).
- Only quality gate is `pnpm check` (svelte-check) + `pnpm test` (vitest, node project, no jsdom).
- GSD workflow: edits happen inside `/gsd-execute-phase`. Pushing `main` auto-deploys prod (memory `openmusic-pushes-autodeploy-live`) — do not push a half-built phase.
- `pnpm deploy` is shadowed by a pnpm builtin; use `pnpm run deploy` (memory).

## Summary

Every upstream the spikes chose still works today from this Mac, and the probes found five things the
spikes did not: (1) **YouTube Charts silently falls back to a global chart with a 200 for unsupported
countries** (cn, mo, kz, mm all returned 100 rows of the same "global" list) — the response echoes the real
chart at `…perspectiveMetadata.requestParams.chartParams.countryCode` (`'global'` on fallback), so the
parser must require `echo === requested cc`; (2) YouTube **`hl` localizes artist names** — `hl:'zh-TW'`
turns 48/100 HK artists into native names (Eason Chan → 陳奕迅, Jay Chou → 周杰倫) while Western names stay
put, which improves display, resolve-by-name, and the CJK MusicBrainz artist-page path; (3) YouTube
thumbnails also come from **`i.ytimg.com` (16:9 video frames) and `yt3.ggpht.com`**, not just
`*.googleusercontent.com` — the allowlist must include both; (4) **60–70% of KKBOX artist names carry a
Latin alias suffix** (`田馥甄 (Hebe)`, `李佳薇 (Jess Lee)`), and ~15% of titles carry a
` - 電影《…》主題曲` marketing subtitle; (5) Apple RSS failures cluster — one 15-call burst today saw three
12 s timeouts and a 502 (then 6/6 clean retries), well above the spike's ~2%.

The biggest integration hazard is in `+page.svelte`, not the new sources: **today's `refresh()` fetches
the Deezer chart and the full Last.fm tag/country fan-out unconditionally — `homeHidden` only gates
rendering.** CONTEXT's "a hidden section issues ZERO requests (today's rule)" is true only for `radio`.
Unless `refresh()` gates each classic fetch on visibility, hiding the four classic sections saves nothing
(~30 requests plus the Last.fm cover backfill keep firing). The same function's D-06 fallback
(`hasAnyDiscovery` → `buildDiversePicks`) and cold skeleton condition only know the classic shelves, so
with classic hidden they would wrongly trigger the fallback grid and hide every new shelf.

The default cold home becomes ~13 requests (5 chart + 4 client iTunes + 4 edge Deezer genre, 0 regions,
0 classic), every one carrying embedded art (≈0 cover backfill) — versus 30 + hundreds of backfill calls
today. Warm (within 6 h): 0. Randomize: 0 unless a classic shelf is visible.

**Primary recommendation:** One `GET /api/charts?src=&kind=&cc=` route over a shared serve-stale helper,
pure parsers in `src/lib/services/chart-parse.ts`, all region/genre/section allowlists and the migration in
`home-layout.ts`, and a visibility-gated `refresh()` that stores 50-item pools plus sampled index picks in
a v3 home cache.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Apple RSS / KKBOX / YouTube Charts fetch + parse + serve-stale | API / Backend (CF edge) | Database/Storage (`caches.default`) | Keyless but CORS-closed or untrusted; edge caching shared per PoP; allowlisting at the trust boundary |
| Deezer genre chart | API / Backend (existing `/api/deezer/chart`) | `caches.default` | api.deezer.com sends no CORS header |
| Legacy iTunes genre feed | Browser / Client | — | itunes.apple.com 403/429s the SHARED Workers egress IP (spike 012); CORS `*` in browser; per-device IP |
| Region default / allowlists / migration / resolvers | Browser (pure `home-layout.ts`) | — | Persisted config is untrusted localStorage; pure resolvers run node-testable |
| Pools + sampled picks persistence | Browser (localStorage v3 home cache) | — | Instant paint, 0-request Randomize |
| Resolve-on-tap | Browser (`player.playStub` → `resolveStub`) | API (CN proxies) | Unchanged existing path |
| Image URL validation | API (edge `safeImageUrl`) | Browser (same pure fn for the client iTunes feed) | Security control at every trust boundary |
| Region labels | Browser (`Intl.DisplayNames`) | — | Native platform feature, saves 27×15 i18n strings |

## Standard Stack

No new packages. The web app has no third-party runtime npm deps by design (CLAUDE.md); everything below
is platform `fetch`/`URL`/`Intl`/Cache API plus existing in-repo modules.

### Core (in-repo, reuse)
| Module | Purpose | Why |
|---------|---------|-----|
| `$lib/proxy/http.ts` `fetchWithRetry`, `jsonResponse`, `corsHeaders` | Edge upstream fetch + JSON response | Shared primitive (CLAUDE.md table) |
| `$lib/proxy/edge-cache.ts` `edgeCache`, `ownOriginCacheKey` | `caches.default` accessor (null under `vite dev`) | One `typeof caches` guard in the repo |
| `$lib/proxy/safe-image-url.ts` `safeImageUrl` + new `APPLE_/KKBOX_/YOUTUBE_IMAGE_HOSTS` | Image host allowlist | SECURITY control; per-source lists by design |
| `$lib/services/api-base.ts` `apiFetch` | Client governor (dedupe, 8 concurrent, 25 s timeout, breaker); **handles absolute URLs since 32-D-13** | The one client seam |
| `$lib/services/ttl-cache.ts` `cached` | In-memory TTL; rejections never cached | Same posture as `deezer.ts` |
| `$lib/services/abort-signal.ts` `combinedSignal` | Caller signal + timeout | Shared primitive |
| `$lib/services/discovery.ts` `mapWithConcurrency`, `shuffle` | Capped fan-out, sampling | Existing |
| `$lib/services/discography.ts` `albumHref` | Album page URL | Existing album-open path |
| `platform.ctx.waitUntil` (`App.Platform.ctx?: ExecutionContext` in `src/app.d.ts`) | Background stale refill | Already used by `/api/resolve` (31-D-06); `context` alias is deprecated |
| `Intl.DisplayNames({type:'region', style:'short'})` | Localized region labels | Verified in Node: en "Hong Kong/US/UK", zh-Hant "香港/美國", ar/th/hi/ru/de all short and native |

### Upstreams (verified 2026-09-25)
| Upstream | Request | Verified |
|---|---|---|
| Apple RSS v2 | `GET https://rss.marketingtools.apple.com/api/v2/{cc}/music/most-played/50/{songs\|albums}.json` → `feed.results[] {id,name,artistName,artworkUrl100,releaseDate,genres,url}` | 27/27 storefronts 200 (see Region table); `xx` → 500; `cache-control: max-age=0, private` |
| KKBOX kma | `GET https://kma.kkbox.com/charts/api/v1/daily?type={song\|newrelease}&terr={hk\|tw\|sg}&lang=tc&category=297&limit=50` → `data.charts[type][] {song_name, artist_name, album_name, cover_image.normal (500px), release_date}` | 6/6 200, 50 rows, images all `i.kfs.io` |
| YouTube Charts | `POST https://charts.youtube.com/youtubei/v1/browse?alt=json` (body in Code Example 3) → deep-find `trackViews` / `artistViews` | 40/40 countries echo their own code; `xx` → 400; unsupported (cn/mo/kz/mm) → **200 + global chart, echo `'global'`** |
| Legacy iTunes RSS (client) | `GET https://itunes.apple.com/{cc}/rss/topsongs/limit=100/genre={id}/json` | hk/1251 100/100 on-genre, tw/1253 99/99, hk/51 84/95, jp/27 100/100; bogus 99999 → 200, 98 rows, **0 on-genre**; `access-control-allow-origin: *`; images `is1-ssl.mzstatic.com/…/170x170bb.png` |
| Deezer genre | `GET https://api.deezer.com/chart/{id}/tracks?limit=50` → `{data:[{title, artist.name, album.cover_xl}], total}` | 7/7 genres 50 rows; bogus id → `{"data":[],"total":0}` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| One `/api/charts` route | Three per-source routes | Three copies of the serve-stale wrapper; one route keeps it in one place |
| `Intl.DisplayNames` for region names | 27 i18n keys × 15 locales | 405 hand-maintained strings for zero gain |
| iTunes `/lookup?id=` for Apple album tracklists (`?itid=` branch) | Name path via `albumHref` | Exact tracklist in 1 CORS-open call, but a new album-page branch. Name path already works (Last.fm returned full tracklists for 田馥甄 / 梁詠琪 / Ariana Grande day-old albums); add `itid` only if empty tracklists show up |

**Installation:** none.

## Package Legitimacy Audit

This phase installs **no external packages** (npm, PyPI, or otherwise). slopcheck not run — nothing to check.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
Home mount (+page.svelte onMount)
  │ settings.load()  ──► [one-time migration if homeLayoutVersion < 2] ──► save()
  │ loadCache('openmusic:top-picks:v3')
  │   ├─ hit ─► paint picks from pools instantly
  │   │        ├─ cfg !== configSig()          ─► refresh(all)            (config changed)
  │   │        └─ now - fetchedAt > 6 h        ─► refresh(charts, bg)     (write cache; UI swaps next mount)
  │   └─ miss ─► refresh(all) — each shelf assigned as it lands (gen-guarded)
  ▼
planChartShelves(cfg)  (pure: visible sections × region capabilities → task list; hidden ⇒ no task)
  │  mapWithConcurrency(tasks, FANOUT_CAP=4)  ──► client services (charts.ts, never-throw, cached 6 h)
  │      ├─ /api/charts?src=kkbox|apple|yt…  ─► apiFetch governor ─► EDGE
  │      ├─ /api/deezer/chart?genre=116…     ─► apiFetch governor ─► EDGE
  │      └─ itunes.apple.com/{cc}/rss/…      ─► apiFetch governor ─► Apple (direct, CORS *)
  │  classic shelves (only if visible): deezerChart + tag/country fan-out (unchanged, random page on Randomize)
  ▼
EDGE /api/charts  (+server.ts GET → $lib/proxy/charts.ts)
  validate(src, kind, cc) against allowlists ──invalid──► 200 { items: [] }
  canonical key /api/charts/_k?v=1&src&kind&cc ─► caches.default
     ├─ hit, age ≤ 6 h  ─► items
     ├─ hit, age > 6 h  ─► items (stale) + ctx.waitUntil(refill: fetch → parse → put if non-empty)
     └─ miss            ─► fetch upstream (5 s budget) → parse → put if non-empty → items | []
  parse: Apple / KKBOX / YT(echo check) → safeImageUrl → {artist,title,image,mbid:null} etc.
  ▼
Client: pools[key] = items (≤50) ; picks[key] = sorted random indices (N = clampShelfSize)
  render loop over resolveSectionOrder(order) minus homeHidden, budgeted by shelfCount()
  tap song ─► player.playStub(artist,title,cover,'home-discovery')
  tap artist ─► goto('/artist/'+name)      tap album ─► goto(albumHref({name,id:null,mbid:null…}, artist))
  Randomize ─► re-draw picks for every pool (0 requests) + classic refresh with random pages if visible
```

### Recommended Project Structure
```
src/lib/services/
├── home-layout.ts        # EXTEND: section ids + groups, CHART_REGIONS/KKBOX/YT flags, LANG_REGION,
│                         #   CHART_GENRES pool, resolvers, migrateHomeLayout, HOME_LAYOUT_VERSION
├── chart-parse.ts        # NEW, pure: parseAppleRss, parseKkbox, parseYtCharts, parseItunesGenreFeed,
│                         #   resizeMzstatic, resizeYtThumb, stripLatinAlias, stripReleaseSuffix
├── charts.ts             # NEW, client: chartSongs/newReleases/chartArtists/chartAlbums/ytTrending/
│                         #   regionTopSongs/genreChart (apiFetch + cached + never-throw)
└── home-charts.ts        # NEW, pure: planChartShelves(cfg), samplePicks(len, n), regionLabel(cc, lang)
src/lib/proxy/
├── charts.ts             # NEW, edge: validateChartQuery, upstream builders (YT body, hl map, pinned
│                         #   clientVersion), serveChart() serve-stale over caches.default
└── safe-image-url.ts     # EXTEND: APPLE_IMAGE_HOSTS, KKBOX_IMAGE_HOSTS, YOUTUBE_IMAGE_HOSTS
src/routes/api/charts/+server.ts          # NEW: GET + OPTIONS only
src/routes/api/deezer/chart/+server.ts    # EXTEND: ?genre= (allowlisted) → /chart/{id}/tracks
src/lib/services/deezer.ts                # EXTEND: deezerGenreChart(genreId)
src/lib/config/defaults.ts                # EXTEND: HOME_DEFAULTS new fields, classic ids in homeHidden
src/lib/stores/settings.svelte.ts         # EXTEND: fields + load() coercion + migration + save() + resetHome()
src/routes/(app)/+page.svelte             # EXTEND: refresh(), v3 cache, snippets, shelfCount, fallback gate
src/routes/(app)/settings/home/+page.svelte  # REDESIGN per UI-SPEC
src/routes/(app)/settings/data/+page.svelte  # FIX: clearPicks() removes the CURRENT home cache key
src/lib/i18n/*.ts (15 files)              # new keys, double quotes
```
Placing the pure parsers under `services/` and importing them from the edge follows an existing precedent:
`src/lib/proxy/resolve-cache.ts` imports `matchKey` from `$lib/services/match-key`.

### Region table (Apple RSS + YouTube Charts, probed 2026-09-25)

Offered list (27, all Apple 200 + YouTube echo-verified). All 27 are YouTube-capable; KKBOX = hk/tw/sg only.

| Region | Apple songs #1 today | YT echo | KKBOX | Default for app lang |
|---|---|---|---|---|
| hk | 用背脊唱情歌 — Gareth.T | hk | ✓ | zh-Hant |
| tw | 要去什麼地方 — 田馥甄 | tw | ✓ | zh-Hans (never cn) |
| sg | Nicole Kidman — ADÉLA | sg | ✓ | — |
| jp | ありふれた世界の果てに — YAO | jp | — | — |
| kr | SUN KISS — 튜이드 | kr | — | — |
| us | Choosin' Texas — Ella Langley | us | — | en |
| gb, ca, au | ✓ | ✓ | — | — |
| de | Movin' To The Sun — HUGEL… | de | — | de |
| fr | Fille à Papa — Vacra… | fr | — | fr |
| es | BbY WOW — KAROL G… | es | — | es |
| it | Lontano — Sfera Ebbasta | it | — | it |
| br | Nicole Kidman — ADÉLA | br | — | pt |
| pt, mx | ✓ | ✓ | — | — |
| ru | Шадэ — By Индия… | ru | — | ru |
| tr | Kayıp Kalp — BLOK3 | tr | — | tr |
| th | ขึ้นใจ (3am call) — Mirrr | th | — | th |
| vn | Tìm Em — Hngle | vn | — | vi |
| id | Teh Hijau — Tulus | id | — | id |
| in | Radhimaa — Sai Abhyankkar… | in | — | hi |
| ph, my | ✓ | ✓ | — | — |
| sa | Shoft Kalam — Marwan Pablo… (Arabic) | sa | — | **ar → sa** |
| ae | Nicole Kidman — ADÉLA (expat skew) | ae | — | — |
| eg | عشان بحبك — Amr Mostafa… | eg | — | — |

`ar → sa`, not `ae`: the Saudi chart is Arabic-language, the UAE chart is Western/expat-skewed on both
Apple (ADÉLA) and YouTube (an Indian remix). Also verified Apple 200 for nl, se, no, pl, nz, ie, ar, cl, co,
za, ng, ke, il (and YouTube echo for all); they can be appended to the list with zero code change if wanted.

**App language source:** there is no `'auto'` AppLang. `settings.appLang` is always one of the 15 concrete
values: `detectAppLang(navigator.language)` runs once on first visit and is persisted (`settings.svelte.ts`
load(), `i18n/index.ts` detectAppLang). `ja`/`ko` are NOT AppLangs (no dictionaries), so the blueprint's
ja→jp / ko→kr mapping cannot happen. So the Chart-region "default from app language" is best modelled as a
persisted `homeChartRegion: 'auto' | ChartRegion` (default `'auto'`, same idea as `bioLang: 'auto'`),
resolved at render by a pure `resolveChartRegion(saved, settings.appLang)`.

### Pattern 1: One edge route, allowlisted params, reshape to discovery shapes
**What:** `GET /api/charts?src=apple|kkbox|yt&kind=…&cc=…`. Valid combos only:
`apple × {songs, albums} × CHART_REGIONS`, `kkbox × {song, newrelease} × {hk,tw,sg}`,
`yt × {tracks, artists} × YT_REGIONS`. Anything else → `jsonResponse({ items: [] }, origin)` with no
upstream call (bounded key space: 27×2 + 3×2 + 27×2 = 114 cache keys). Reshape targets:
songs/newrelease/tracks → `DiscoveryTrack {artist,title,image,mbid:null}`; artists →
`DiscoveryArtist {name,image,mbid:null}`; albums → new `ChartAlbum {name, artist, image}`. Pool = first 50.
**When:** all new edge shelves.
**Why one route:** the serve-stale wrapper, timeouts and CORS live once. `/api/charts` (static segment)
wins over the `/api/[source]/[...path]` catch-all by SvelteKit route specificity; the catch-all would reject
`charts` anyway (not in the proxy registry).

### Pattern 2: Serve-stale over `caches.default` (no native SWR)
Store `{ fetchedAt, items }` under a canonical own-origin key built from the VALIDATED params
(`${url.origin}/api/charts/_k?v=${CHART_CACHE_VERSION}&src=…&kind=…&cc=…` — the `/api/resolve/_k`
precedent), `Cache-Control: public, max-age=172800` (48 h). Read: age ≤ 6 h → serve; age > 6 h → serve
stale AND `platform?.ctx?.waitUntil(refill)`; miss → await fetch. Never `put` an empty parse (schema drift or
a YT global-fallback must not overwrite a good stale entry). Always cache a FRESH `Response` built from the
body, never the one that passed through `hooks.server.ts` (Vary: Origin — T-31-03-04). The shape version
lives in the key (`cache.delete` is PoP-local, so bumping `v` IS the migration — resolve-cache.ts discipline).
Client response: `jsonResponse(body, origin, { ttl: 1800 })` so the browser HTTP cache never outlives the
client's 6 h pool TTL. Ponytail note as in `/api/resolve`: no in-flight marker, so N concurrent stale reads
in one PoP can each schedule a refill — bounded, one subrequest each.

### Pattern 3: Deezer genre on the existing route
`/api/deezer/chart?genre=116&limit=50`: if `genre ∈ DEEZER_GENRE_IDS` (116,152,113,165,106,85,16) fetch
`https://api.deezer.com/chart/{id}/tracks?limit=50` and return `{ tracks, artists: [] }` via the existing
`safeImageUrl(…, DEEZER_IMAGE_HOSTS)` reshape; otherwise ignore the param (today's `/chart` behaviour).
The existing cache key is the raw URL, so `genre` separates entries automatically; keep its 1 h TTL (Deezer
is reliable, no serve-stale needed). Client: `deezerGenreChart(genreId)` in `deezer.ts`, keyed
`dz:chart:g${id}`, same `cached()` + `.catch(() => [])` posture as `deezerChart`.

### Pattern 4: Client legacy-iTunes service through `apiFetch`
Route the absolute `itunes.apple.com` URL through `apiFetch`. Since 32-D-13, `apiUrl()` returns an absolute
URL untouched on both web and native, so the call gets dedupe, the 8-slot cap, the 25 s timeout and the
breaker. **The comment in `itunes-cover.ts` saying apiFetch "would corrupt" an absolute URL is stale**
(written before 32-D-13) — do not copy its raw-fetch reasoning. Breaker impact is nil: at most 4 iTunes
calls per refresh against a 30-failures/3 s threshold, and a 403 counts as a success (a 4xx is a real answer).
Native APK: CORS `*` works from the `https://localhost` WebView, and each device uses its own IP, not the
shared Workers egress. Caching: `cached('it:genre:${cc}:${id}', 6 h)` in memory plus the home v3 pool
persistence. A separate per-genre localStorage store is redundant.

### Pattern 5: Versioned migration inside `settings.load()`
New persisted field `homeLayoutVersion` (current `HOME_LAYOUT_VERSION = 2`; absent = 1). In the
`if (raw)` branch, after the `homeSectionOrder`/`homeHidden` type coercion:
if `!(typeof v.homeLayoutVersion === 'number' && v.homeLayoutVersion >= HOME_LAYOUT_VERSION)` →
`migrateHomeLayout(order, hidden)` (pure, in `home-layout.ts`), set a local `migrated = true`, and after the
try block `if (migrated) this.save()`. **The save is required:** without a persisted version, a user who
re-enables `top-hits` after migrating would have it re-hidden on every load. Fresh installs (no blob) take
`HOME_DEFAULTS` (new order, classic ids pre-hidden) and never run the migration. Old backups imported via
/settings/data carry an old `settings:v1` blob, which migrates on the next load. That is correct.

Migration algorithm: find the first index of any classic id (`top-hits|top-artists|tags|countries`) in the
saved order and insert the 7 new chart ids there in canonical order, skipping any already present. If no
classic id is present, insert them after `radio` (or at the start if `radio` is absent). Then
`hidden = union(hidden, CLASSIC_SECTIONS)`. Everything else is untouched, and `resolveSectionOrder` still
appends any id that is still missing at render time. Idempotent by construction and version-gated.

Optional, one line per mapping: inherit per-section density to the new ids where no override exists
(`top-hits→chart-songs`, `top-artists→chart-artists`, `tags→genres`, `countries→regions`). See Open Question 4.

### Pattern 6: Home orchestration (v3 cache, sampling, visibility gating)
- `planChartShelves(cfg)` (pure) emits one task per visible, capable shelf: `chart-songs` (kkbox if region ∈
  KKBOX else apple), `new-releases` (only if region ∈ KKBOX, else no task), `chart-artists`/`yt-trending`
  (only if region ∈ YT_REGIONS), `chart-albums` (apple), one per selected genre, one per extra region.
  **Hidden section ⇒ no task.** Node-test this: it is the "zero requests" guarantee.
- Classic fetches in `refresh()` become conditional: `deezerChart` only if `top-hits` or `top-artists` is
  visible, the tag fan-out only if `tags` is visible, countries only if `countries` is visible. Their Randomize
  random-page behaviour is unchanged.
- Top Songs resilience: if KKBOX returns `[]`, fall back to Apple songs for the same cc. That is one extra
  call only on failure, the same shape as today's Deezer → Last.fm per-source fallback.
- Cache `openmusic:top-picks:v3`: `{ v:3, cfg, fetchedAt, pools: Record<key, Item[]≤50>, picks:
  Record<key, number[]>, …classic fields unchanged }`. Keys: `chart-songs`, `new-releases`,
  `chart-artists`, `chart-albums`, `yt-trending`, `genre:<id>`, `region:<cc>`. Picks are sorted random indices
  (`samplePicks(len, clampShelfSize(...))`), so a shelf varies while keeping chart rank order (UI-SPEC may flip
  to shuffled order). Estimated size ≈ 13 pools × 50 × ~180 B ≈ 120 KB. The origin already holds ~740 KB of a
  ~5 MB budget (backup-logic.ts note), so cap pools at 50 and store only `{artist,title,image,mbid}` /
  `{name,image,mbid}` / `{name,artist,image}`. Remove the orphaned `openmusic:top-picks:v2` key on the first
  v3 save.
- `configSig()` must now also include: resolved region, extra regions, genres, and **the visible set of
  network-backed sections**. Hidden now gates fetching, so un-hiding `tags` has to change the signature, or
  the reload keeps a cache with no tag shelves.
- Mount: cfg changed → `refresh(all)`. Pools older than 6 h → background refresh of the chart pools only
  (classic keeps today's cfg-only revalidate, so a classic Randomize arrangement is not reverted). The result
  is written to the cache and applied on the next mount, with no visible in-place swap (Open Question 6).
- Cold path: assign each shelf's state as its task lands (gen-guarded), so one hanging Apple call does not
  hold back the KKBOX/YT shelves. `saveCache` runs once all tasks settle.
- Randomize: re-draw `picks` for every pool locally, then run the classic refresh with random pages only if
  a classic section is visible.
- Must update alongside: `hasAnyDiscovery` (include new shelves), the cold-skeleton condition (line 784),
  `scheduleBackfill` (include imageless items of new shelves, normally none), `shelfCount` (`genres` →
  genre shelf count, `regions` → region shelf count, single new shelves → `0` when empty so an empty
  `new-releases` does not eat a reveal frame).

### Pattern 7: Tile taps
- Song tiles: `player.playStub(artist, title, image, 'home-discovery')` (unchanged path; the cover is carried
  onto the resolved track, quick-260831-t2g). **Exception, recommended:** for YouTube-sourced tiles
  (`yt-trending`) pass `null` as the cover. YT track art is a 180 px thumbnail, sometimes a 16:9 `i.ytimg.com`
  video frame, on Google hosts that CN-facing users often cannot load. The NowPlaying hero paints the
  cover as CSS `background-image`, which has no error event (debug `ytmusic-cover-blank-hero.md`). With
  `null`, `play()` runs the normal iTunes-first cover chain. The tile itself still shows the thumbnail.
- Artist tiles: `goto('/artist/' + encodeURIComponent(name))`, exactly like today's `topArtistsBlock`.
- Album tiles: `goto(albumHref({ name: stripReleaseSuffix(name), id: null, mbid: null, image, releaseDate:
  null, type: 'album' }, artist))` → `/album/{name}?artist={artist}`. **Zero calls at tap**. The album page
  runs Last.fm `album.getinfo` tracklist + `enrichAlbum` + `deezerAlbum` (existing name-only behaviour).
  Verified Last.fm returns full tracklists for today's Apple HK #1/#2/#5 albums. Apple names carry
  ` - EP` / ` - Single` suffixes (6 of HK's top 100 albums), and stripping them is required for the name match.
- Long-press: existing `tileMenu(item)` → `resolveStub`. Album tiles have no song to resolve, so they get no
  long-press menu (mirror the artist-tile convention).

### Anti-Patterns to Avoid
- **Trusting status codes from YouTube Charts or legacy iTunes.** Both return 200 with a wrong chart on bad
  input. Check the echoed countryCode and the per-row genre id.
- **Caching an empty parse.** It overwrites a good stale entry and pins a blank shelf for 48 h.
- **Using the raw request URL as the chart cache key.** Extra junk params fragment the cache. Build the key
  from validated params.
- **A `+server.ts` that exports a helper.** It 500s at request time and unit tests miss it.
- **Fetching regardless of `homeHidden`.** That is today's classic-shelf behaviour, and the migration would
  save nothing.
- **Sharing one `AbortSignal.timeout(5000)` across `fetchWithRetry` attempts while expecting a retry after a
  timeout.** The signal is already aborted, so the retry aborts instantly. It is a total 5 s budget, which is
  fine, but a timed-out attempt is never retried. It only retries 5xx/429 inside the budget.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stale-while-revalidate | A KV/Durable Object layer | `caches.default` + in-body `fetchedAt` + `platform.ctx.waitUntil` | No new binding (memory: local wrangler cannot provision bindings) |
| Region display names | 27 i18n keys × 15 locales | `Intl.DisplayNames([lang], {type:'region', style:'short'})` | Native, localized, verified |
| Client concurrency / dedupe | A new limiter | `apiFetch` governor + `mapWithConcurrency(…, FANOUT_CAP)` | memory `api-fetch-flood-freeze`: "do NOT add another limiter" |
| Image URL validation | Inline regexes | `safeImageUrl` + per-source allowlists | Security primitive (CLAUDE.md) |
| Album page for Apple albums | A new album fetch | `albumHref()` → existing `/album/[name]` page | Existing Last.fm/Deezer name path |
| Share-card art for chart covers | Widening the `coverToken` grammar | Existing kn4/l82 carrier chain in `TrackMenu` / `cover-backfill.ts` | Memory: never widen the grammar to Google/opaque hosts (T-3uo-02) |
| Random sampling | Another Fisher-Yates | `shuffle()` from `discovery.ts` (the page-local `pickN` duplicates it) | Shared |

**Key insight:** every new source here is either undocumented or silently lies on bad input, so the
validation lives in pure parsers with real-response fixtures. Nothing needs new infrastructure.

## Runtime State Inventory

This phase migrates persisted state, so the inventory applies.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | localStorage `openmusic:settings:v1` (order/hidden). `openmusic:top-picks:v2` (orphaned by the v3 bump, ~tens of KB). The edge `caches.default` namespace `/api/charts/_k?v=1` is new. The existing `/api/deezer/chart` entries are unaffected (genre adds new keys) | Code: version-gated migration in `load()` plus save. Code: remove the `v2` key on the first v3 save. None for the edge |
| Live service config | None. All sources are keyless; no Cloudflare dashboard config | None (verified: no new env/secret/binding) |
| OS-registered state | None | None |
| Secrets / env vars | None. Apple/KKBOX/YT/iTunes/Deezer need no key; `wrangler.jsonc` is untouched | None |
| Build artifacts | None. Capacitor native build uses `VITE_API_BASE`, `/api/charts` resolves via `apiUrl()` | None. The APK needs a rebuild to ship (normal) |
| Backups | Exported backup files carry an old `settings:v1` blob with no `homeLayoutVersion` | None. Import + reload triggers the migration (desired) |
| Existing bug found | `settings/data/+page.svelte` `clearPicks()` removes `openmusic:top-picks:v1`, but the home uses `v2`, so "Clear picks" has not cleared the home cache since the v2 bump | Fix in this phase: export the home cache key from one module and reference it in both places |

## Common Pitfalls

### Pitfall 1: Hidden classic shelves still fetch
**What goes wrong:** Hiding the four classic sections saves nothing. `refresh()` still fires `deezerChart` +
22 tag + 7 country calls, plus the Last.fm cover backfill for imageless tiles.
**Why:** `refresh()` (+page.svelte:437–458) never reads `homeHidden`. Only `radio` is gated (onMount:706).
**How to avoid:** gate each classic fetch on visibility, and unit-test `planChartShelves` plus a fetch-spy
test that hidden ⇒ 0 calls.
**Warning signs:** the network panel on a fresh profile shows `/api/lastfm/discovery` or `/api/deezer/chart`
with no `genre` param.

### Pitfall 2: The D-06 fallback grid hijacks the home
**What goes wrong:** With classic hidden, `hasAnyDiscovery(hits, artists, tags, countries)` is false →
`buildDiversePicks` (searchAll fan-out) runs → `useFallback = true` → the template renders the fallback grid
INSTEAD of every section.
**How to avoid:** feed every new shelf into `hasAnyDiscovery`. Also update the cold-skeleton condition
(line 784), or the skeleton persists while new shelves exist.

### Pitfall 3: YouTube Charts global fallback
**What goes wrong:** An unsupported (or later-dropped) country returns the GLOBAL chart with a 200 (seen
today for cn/mo/kz/mm), so HK users could see Alka Yagnik under "Top Artists · 香港".
**How to avoid:** the parser returns `[]` unless
`contents.sectionListRenderer.contents[0].musicAnalyticsSectionRenderer.content.perspectiveMetadata.requestParams.chartParams.countryCode === cc`.
Keep the allowlist as well. `[]` is never cached.

### Pitfall 4: `configSig` does not know about visibility
**What goes wrong:** Un-hiding `tags` leaves the cached payload without tag shelves, and the unchanged cfg
skips the revalidate, so the section appears empty until Randomize.
**How to avoid:** include the visible network-backed section set (plus region/extras/genres) in `configSig()`.

### Pitfall 5: The migration re-runs, or is lost
**What goes wrong:** If `load()` migrates but does not persist, the version is only written on the user's
next unrelated `save()`, so a re-enabled classic shelf is re-hidden on every reload in between.
**How to avoid:** `if (migrated) this.save()` at the end of `load()`. Test "un-hide after migration survives
reload" in `settings-persist.svelte.test.ts`.

### Pitfall 6: Existing tests pin the old section list
**What goes wrong:** `home-layout.test.ts:25` ("is the ten home group ids in canonical order") and
`DEFAULT_SECTION_ORDER` assertions fail by design. The same goes for `sectionLabel: Record<HomeSectionId, …>`
in settings/home, which TypeScript forces to include every new id (good).
**How to avoid:** update those tests deliberately in the same plan as `HOME_SECTIONS`. Don't weaken them.

### Pitfall 7: Chart covers on Google hosts and in share cards
**What goes wrong:** Adding `*.googleusercontent.com` / `i.ytimg.com` / `yt3.ggpht.com` covers to the
hero/share path reintroduces the ytmusic-cover-blank-hero class of bug. Widening the `coverToken` grammar
breaks T-3uo-02.
**How to avoid:** pass `null` cover for YT song tiles (Pattern 7). Leave `coverToken` alone. Chart covers
that reach a share (mzstatic without a retained id, i.kfs.io, Google) already fall to the kn4/l82 prewarm
chain (iTunes → Deezer) on menu open. All four image hosts send `access-control-allow-origin: *` (verified),
so native media-session byte fetch and colour extraction work.

### Pitfall 8: KKBOX name noise hurts resolve and display
**What goes wrong:** `田馥甄 (Hebe)` / `五月天 (Mayday)` render ugly and go verbatim into the
`searchAll` query. ` - 電影《…》主題曲` subtitles do the same.
**How to avoid:** `stripLatinAlias(name)` drops a trailing `(ASCII-only)` group only when the rest is
non-empty and contains non-ASCII. Apply it in the KKBOX reshape and to YT names (YT zh-TW emits
`五月天 (Mayday)` too). Subtitle stripping is Open Question 5. Scoring is already safe because
`matchKey`/`scoreMatch` normalization drops brackets. Resolve impact could not be measured today because
qq/kuwo/netease upstreams were dry during research.

### Pitfall 9: Apple failure clusters
**What goes wrong:** A cold PoP with Apple hanging leaves Top Songs/Albums empty for that request.
**How to avoid:** 5 s budget per call (`AbortSignal.timeout(5000)`, `fetchWithRetry(…, 1)` retries a fast
502). Serve-stale covers warm PoPs. The client assigns shelves as they land. The home persists pools, so a
failed background refresh just keeps yesterday's pool.

### Pitfall 10: The browser pane cannot verify the progressive reveal
**What goes wrong:** rAF is frozen in the in-app Browser pane, so only `REVEAL_INITIAL = 3` shelves ever
mount there. It looks like "shelves missing".
**How to avoid:** in the pane, verify network calls, the first 3 shelves, and screenshots. Force a full
mount via back/forward (`navigating.type === 'popstate'` → `revealed = Infinity`). Verify budget logic in vitest.

## Code Examples

All examples are sketches built from live-probed response shapes. Names are recommendations.

### 1. Apple RSS v2 + KKBOX parsers (pure, `chart-parse.ts`)
```typescript
// 39-D-xx: Apple sends artworkUrl100 …/100x100bb.jpg; the legacy iTunes feed sends …/170x170bb.png.
// One regex serves both (upgradeArtwork() in itunes-cover.ts only swaps the literal '100x100bb').
export function resizeMzstatic(url: string | null | undefined, px = 600): string | null {
	if (!url) return null;
	return url.replace(/\/\d+x\d+bb\./, `/${px}x${px}bb.`);
}
// 60-70% of KKBOX artist names carry a Latin alias: '田馥甄 (Hebe)', '五月天 (Mayday)'.
export function stripLatinAlias(name: string): string {
	const m = /^(.*\S)\s*\(([\x20-\x7E]+)\)\s*$/.exec(name ?? '');
	return m && /[^\x00-\x7F]/.test(m[1]) ? m[1] : (name ?? '').trim();
}
export function stripReleaseSuffix(name: string): string {
	return (name ?? '').replace(/\s+-\s+(Single|EP)$/i, '').trim();
}
export function parseAppleRss(data: unknown, kind: 'songs' | 'albums', img: (u?: string | null) => string | null) {
	const rows = (data as { feed?: { results?: { name?: string; artistName?: string; artworkUrl100?: string }[] } })
		?.feed?.results ?? [];
	return rows.slice(0, 50).map((r) => ({
		artist: (r.artistName ?? '').trim(),
		title: (r.name ?? '').trim(),
		image: img(resizeMzstatic(r.artworkUrl100)),
		mbid: null
	})).filter((t) => t.artist && t.title);
	// albums: map to { name: stripReleaseSuffix(r.name), artist, image }
}
export function parseKkbox(data: unknown, type: 'song' | 'newrelease', img: (u?: string | null) => string | null) {
	const rows = (data as { data?: { charts?: Record<string, { song_name?: string; artist_name?: string;
		cover_image?: { normal?: string } }[]> } })?.data?.charts?.[type] ?? [];
	return rows.slice(0, 50).map((r) => ({
		artist: stripLatinAlias(r.artist_name ?? ''),
		title: (r.song_name ?? '').trim(),
		image: img(r.cover_image?.normal), // i.kfs.io …/fit/500x500.jpg
		mbid: null
	})).filter((t) => t.artist && t.title);
}
```

### 2. YouTube Charts parser with the global-fallback guard
```typescript
function deepFind(o: unknown, key: string): unknown[] | null {
	if (!o || typeof o !== 'object') return null;
	const rec = o as Record<string, unknown>;
	if (Array.isArray(rec[key])) return rec[key] as unknown[];
	for (const v of Object.values(rec)) { const r = deepFind(v, key); if (r) return r; }
	return null;
}
export function parseYtCharts(data: unknown, cc: string, kind: 'tracks' | 'artists', img: (u?: string | null) => string | null) {
	// 39-D-xx (probed 2026-09-25): an unsupported country returns 200 + the GLOBAL chart; the only
	// tell is the echoed countryCode ('global'). Never trust the status.
	const echo = (data as any)?.contents?.sectionListRenderer?.contents?.[0]
		?.musicAnalyticsSectionRenderer?.content?.perspectiveMetadata?.requestParams?.chartParams?.countryCode;
	if (echo !== cc) return [];
	const views = deepFind(data, kind === 'tracks' ? 'trackViews' : 'artistViews') ?? [];
	// thumbnails: yt3.googleusercontent.com (…=w180-h180-l90-rj → rewrite to =w544-h544-l90-rj),
	// lh3.googleusercontent.com (no size param → 512px as-is), yt3.ggpht.com, i.ytimg.com (16:9 frame)
	// …map to DiscoveryTrack {artist: artists.map(a=>stripLatinAlias(a.name)).join(', '), title: name}
	//   or DiscoveryArtist {name: stripLatinAlias(name)}; slice(0, 50)
}
```
(The `as any` above is sketch shorthand. Production code needs a typed narrowing chain, because CLAUDE.md
allows zero `as any` outside tests.)

### 3. YouTube Charts request (edge, `proxy/charts.ts`)
```typescript
// Pinned like ANDROID_VR_VERSION: '2.0' works, '0.1' → 404 (spike 011). A 404 here = bump this.
export const YT_CHARTS_CLIENT_VERSION = '2.0';
// hl localizes KNOWLEDGE-GRAPH artist names: zh-TW → 陳奕迅/周杰倫/張國榮 (48 of HK's top 100 change,
// Western names unchanged). Derived from cc only, so it never fragments the edge cache.
const YT_HL: Record<string, string> = { hk: 'zh-TW', tw: 'zh-TW' };
export function ytChartsInit(cc: string, kind: 'tracks' | 'artists', signal: AbortSignal): RequestInit {
	return {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		signal,
		body: JSON.stringify({
			context: { client: { clientName: 'WEB_MUSIC_ANALYTICS', clientVersion: YT_CHARTS_CLIENT_VERSION,
				hl: YT_HL[cc] ?? 'en', gl: cc.toUpperCase() } },
			browseId: 'FEmusic_analytics_charts_home',
			query: `perspective=CHART_DETAILS&chart_params_country_code=${cc}&chart_params_chart_type=${
				kind === 'tracks' ? 'TRACKS' : 'ARTISTS'}&chart_params_period_type=WEEKLY`
		})
	};
}
```

### 4. Serve-stale helper (edge)
```typescript
const FRESH_MS = 6 * 3600_000;
const STALE_S = 48 * 3600;
export async function serveChart(
	key: Request, load: () => Promise<unknown[]>, ctx: ExecutionContext | undefined
): Promise<unknown[]> {
	const cache = edgeCache();
	const hit = await readEntry(cache, key); // { fetchedAt, items } | undefined — never throws
	if (hit) {
		if (Date.now() - hit.fetchedAt > FRESH_MS) {
			ctx?.waitUntil(load().then((items) => items.length ? writeEntry(cache, key, items) : undefined).catch(() => {}));
		}
		return hit.items;
	}
	const items = await load().catch(() => []);
	if (items.length) await writeEntry(cache, key, items); // fresh Response, max-age=STALE_S
	return items;
}
// route: export const GET: RequestHandler = async ({ url, request, platform }) => { … serveChart(key, load, platform?.ctx) … }
```

### 5. Legacy iTunes genre feed (client, `chart-parse.ts` + `charts.ts`)
```typescript
export function parseItunesGenreFeed(data: unknown, genreId: number, img: (u?: string | null) => string | null) {
	const raw = (data as { feed?: { entry?: unknown } })?.feed?.entry;
	const entries = ([] as unknown[]).concat(raw ?? []); // one row → OBJECT, not array
	return entries
		.filter((e: any) => e?.category?.attributes?.['im:id'] === String(genreId)) // bogus id → overall chart w/ 200
		.slice(0, 50)
		.map((e: any) => ({
			artist: String(e['im:artist']?.label ?? '').trim(),
			title: String(e['im:name']?.label ?? '').trim(),
			image: img(resizeMzstatic(e['im:image']?.at(-1)?.label)), // 170x170bb.png → 600x600bb.png
			mbid: null
		}))
		.filter((t) => t.artist && t.title);
}
// charts.ts: cached(`it:genre:${cc}:${id}`, SIX_H, async () => {
//   const res = await apiFetch(`https://itunes.apple.com/${cc}/rss/topsongs/limit=100/genre=${id}/json`,
//     { signal: combinedSignal(6000, signal) });           // absolute URL OK since 32-D-13
//   if (!res.ok) throw new Error(String(res.status));
//   return parseItunesGenreFeed(await res.json(), id, (u) => safeImageUrl(u, APPLE_IMAGE_HOSTS));
// }).catch(() => [])
```

### 6. Region resolver (pure, `home-layout.ts`)
```typescript
export const CHART_REGIONS = ['hk','tw','sg','jp','kr','us','gb','ca','au','de','fr','es','it','pt','br','mx',
	'ru','tr','th','vn','id','in','ph','my','sa','ae','eg'] as const;          // Apple 200 + YT echo, 2026-09-25
export type ChartRegion = (typeof CHART_REGIONS)[number];
export const KKBOX_REGIONS: readonly ChartRegion[] = ['hk', 'tw', 'sg'];
export const YT_REGIONS: readonly ChartRegion[] = CHART_REGIONS;           // all verified; keep separate for drift
const LANG_REGION: Record<string, ChartRegion> = { en: 'us', 'zh-Hant': 'hk', 'zh-Hans': 'tw', de: 'de', fr: 'fr',
	es: 'es', it: 'it', pt: 'br', ru: 'ru', tr: 'tr', th: 'th', vi: 'vn', id: 'id', hi: 'in', ar: 'sa' };
export function resolveChartRegion(saved: unknown, appLang: string): ChartRegion {
	if (typeof saved === 'string' && (CHART_REGIONS as readonly string[]).includes(saved)) return saved as ChartRegion;
	return LANG_REGION[appLang] ?? 'us'; // 'auto', garbage, missing → app-language default; never 'cn'
}
```

### 7. Migration (pure, `home-layout.ts`)
```typescript
export const HOME_LAYOUT_VERSION = 2;
export const CLASSIC_SECTIONS = ['top-hits', 'top-artists', 'tags', 'countries'] as const;
export const CHART_SECTIONS = ['chart-songs', 'new-releases', 'chart-artists', 'chart-albums', 'yt-trending', 'genres', 'regions'] as const;
// Rule: insert only the MISSING chart ids, at the first classic id's slot; ids already present stay put.
export function migrateHomeLayout(order: string[], hidden: string[]): { order: string[]; hidden: string[] } {
	const out = [...new Set(order)];
	const missing = CHART_SECTIONS.filter((id) => !out.includes(id));
	let at = out.findIndex((id) => (CLASSIC_SECTIONS as readonly string[]).includes(id));
	if (at < 0) at = out.includes('radio') ? out.indexOf('radio') + 1 : 0;
	out.splice(at, 0, ...missing);
	return { order: out, hidden: [...new Set([...hidden, ...CLASSIC_SECTIONS])] };
}
```
Idempotent on its own: a second run finds nothing missing and the hidden union is unchanged. The
version gate means it normally runs once anyway.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Home charts from Deezer `/chart` (global) + Last.fm tag/geo (all-time / audience-skewed) | Apple RSS / KKBOX / YouTube Charts per region | This phase | Fresh regional charts (KKBOX HK median age 25 d) |
| Randomize = random Last.fm page fetch | Local re-sample of cached 50-item pools | This phase | 0 requests; first render random per user |
| `itunes-cover.ts` raw fetch for absolute URLs | `apiFetch` accepts absolute URLs (32-D-13) | Phase 32 | New client iTunes calls should be governed |
| `platform.context.waitUntil` | `platform.ctx.waitUntil` (`context` deprecated) | adapter-cloudflare, used since 31-D-06 | Use `ctx` |

**Deprecated/outdated:**
- Blueprint's `ja → jp`, `ko → kr` region defaults: impossible, because `ja`/`ko` are not AppLangs.
- Blueprint's image-host list (`yt3`/`lh3` only) is incomplete: add `i.ytimg.com` and `yt3.ggpht.com`.
- The spike's "Apple ~2% hangs" understates bursts: today 4/15 in one burst.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | KKBOX (not Apple) for Top Songs in hk/tw/sg is what the user wants (CONTEXT flags it) | Locked table / OQ1 | Swap one branch in `planChartShelves`; low |
| A2 | Stripping KKBOX/YT Latin aliases improves resolve (CN upstreams were dry during research, so not measured) [ASSUMED] | Pitfall 8 | Worst case neutral: scoring already ignores brackets |
| A3 | `hl:'zh-TW'` for hk/tw is preferred over English names [names VERIFIED; preference ASSUMED] | Code Ex 3 | Display preference only; one map entry |
| A4 | Applying the 6 h pool refresh on the NEXT mount (no in-place swap) satisfies the "set B persists" contract [ASSUMED] | Pattern 6 / OQ6 | UX nuance; easy to flip |
| A5 | `ar → sa` (Arabic chart) beats `ae` (expat-skewed) for Arabic users [data VERIFIED; preference ASSUMED] | Region table | One map entry |
| A6 | A 50-item pool gives enough Randomize variety at N ≤ 24 [ASSUMED] | Pattern 6 | Raise to 100 (Apple/YT/iTunes allow it; KKBOX caps 50) at ~2× storage |
| A7 | Sampled items render in chart-rank order [ASSUMED, UI-SPEC call] | Pattern 6 | Swap `sort` for `shuffle` |
| A8 | Default "More regions" = none [ASSUMED within Claude's discretion] | Discretion | Seed 2 neighbours; +2 requests |
| A9 | Empty genre selection = no genre shelves (not "all 11") [ASSUMED] | Settings | Reuse `resolveSubset` fallback semantics instead |
| A10 | No See-all pages for new shelves in this phase [ASSUMED within discretion] | OQ3 | Add a generic pool page later |
| A11 | `Intl.DisplayNames` short-style labels are acceptable UI text [VERIFIED output; acceptance ASSUMED] | Settings UI | Fall back to i18n keys |
| A12 | Passing `null` cover for YT tiles is acceptable (CONTEXT says pass `image`) [ASSUMED deviation] | Pattern 7 | Pass image; accept hero blank risk for CN users |

## Open Questions

1. **Top Songs source for hk/tw/sg (KKBOX vs Apple).**
   - What we know: KKBOX freshest (median 25 d vs Apple HK 354 d); CONTEXT marks it Claude's recommendation.
   - Recommendation: keep KKBOX with Apple fallback-on-empty; confirm at plan review.
2. **Refine the default region with `navigator.language`'s region subtag?** (zh-TW → tw instead of hk, en-GB → gb, en-HK → hk.)
   - What we know: the locked rule maps from AppLang only, so a zh-TW user gets `hk`.
   - Recommendation: keep the locked rule. Raise the refinement at plan review; it is a small pure-function change.
3. **See-all for new shelves.** Recommend none this phase: render a non-navigating heading. The shelf shows
   24 of 50, and a drilldown needs the home cache extracted into a module. UI-SPEC confirms.
4. **Density for new sections.** New ids default to `'list'` (the home passes `'list'` as the global default).
   Should the migration inherit classic per-section densities (top-hits→chart-songs etc.), and should
   `HOME_DEFAULTS.homeSectionDensity` seed e.g. `chart-albums: 'pile'`? UI-SPEC decides.
5. **KKBOX title subtitles** (` - 電影《…》主題曲`, 7–9 of 50 rows). Recommend stripping only when the
   suffix contains 主題曲/主题曲/片尾曲/插曲 (never ` - Live`). Needs a resolve check once CN upstreams are healthy.
6. **When a 6 h-stale client pool refresh becomes visible.** Recommend: write the cache, apply on the next mount.
   Confirm it matches the "reload shows the persisted arrangement" contract.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | tooling | ✓ | v25.9.0 (≥22 required) | — |
| pnpm | tooling | ✓ | 8.15.5 | — |
| curl | probes | ✓ | system | — |
| Dev server | E2E | ✓ | :5173 (bare `pnpm dev`); :4321 not running | start `pnpm dev` |
| Apple RSS / KKBOX / YT Charts / iTunes RSS / Deezer | shelves | ✓ (all probed today) | — | never-throw `[]` |
| Last.fm (dev server `/api/lastfm/info`) | album page, classic | ✓ | — | — |
| CN upstreams (qq/kuwo/netease) | resolve-on-tap E2E | ✗ **dry today** (qq `[]` for 周杰伦, kuwo "Internal Error", netease HTML) | — | Verify tap-to-play later. It is an existing path, not a phase deliverable |
| Cloudflare edge (`caches.default`, `waitUntil`) | serve-stale | ✗ locally (`vite dev` has no Cache API; `edgeCache()` → null) | — | Unit-test with a stubbed `caches` + `ctx.waitUntil` (resolve-endpoint.test.ts harness); prod verify after deploy |

**Missing dependencies with no fallback:** none block execution.
**Missing with fallback:** CN upstreams (tap-to-play E2E deferred); edge cache (stubbed in vitest).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.3, single `server` node project (no jsdom); `expect.requireAssertions: true` |
| Config file | `vite.config.ts` (`test.projects[0]`, include `src/**/*.{test,spec}.{js,ts}`) |
| Quick run command | `pnpm vitest --run src/lib/services/chart-parse.test.ts src/lib/services/home-layout.test.ts src/lib/services/home-charts.test.ts` (baseline: home-layout + discovery + settings-persist = 83 tests in 0.9 s) |
| Full suite command | `pnpm test && pnpm check` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P39-01 | Apple/KKBOX/YT parsers on trimmed real fixtures; `stripLatinAlias`, `stripReleaseSuffix`, `resizeMzstatic`, YT thumb rewrite; YT echo mismatch → `[]` | unit | `pnpm vitest --run src/lib/services/chart-parse.test.ts` | ❌ Wave 0 |
| P39-01 | Route param allowlist: bad src/kind/cc → `{items:[]}` + 0 fetches | unit (route) | `pnpm vitest --run src/routes/api/charts/charts-endpoint.test.ts` | ❌ Wave 0 |
| P39-02 | miss → fetch + put; fresh hit → 0 fetch; stale hit → stale body + `ctx.waitUntil` refill; empty parse not put; upstream throw → `[]` | unit (route, stubbed `caches`/`fetch`/ctx) | same file | ❌ Wave 0 |
| P39-03 | `?genre=116` → `/chart/116/tracks`; unknown genre → `/chart`; cache key distinct | unit (route) | `pnpm vitest --run src/routes/api/deezer/chart/deezer-chart-endpoint.test.ts` | ❌ Wave 0 |
| P39-04 | iTunes: single-entry object, off-genre rows dropped, bogus id → `[]`, never throws, goes through apiFetch | unit | `pnpm vitest --run src/lib/services/charts.test.ts` | ❌ Wave 0 |
| P39-05 | `resolveChartRegion` covers all 15 AppLangs, never `cn`, garbage → default; `resolveExtraRegions` drops main/dupes/unknown; `resolveChartGenres` allowlist | unit | `pnpm vitest --run src/lib/services/home-layout.test.ts` | ✅ extend |
| P39-06 | `migrateHomeLayout`: old default, custom order (insert at first classic), garbage order, idempotent; load() migrates once + persists version; un-hide survives reload; fresh install defaults; `resetHome()` = new layout | unit + store round-trip | `pnpm vitest --run src/lib/services/home-layout.test.ts src/lib/stores/settings-persist.svelte.test.ts` | ✅ extend |
| P39-07 | `planChartShelves`: hidden ⇒ no task; new-releases outside hk/tw/sg ⇒ no task; YT tasks only for YT_REGIONS; `samplePicks` bounded/sorted/unique | unit | `pnpm vitest --run src/lib/services/home-charts.test.ts` | ❌ Wave 0 |
| P39-07 | Cold home request count ≈ 13 (hk) / 12 (us), 0 classic calls | E2E (dev server, fresh localStorage, network log) | manual via browser pane | manual |
| P39-08 | album tap → `/album/{name}?artist=` with suffix stripped | unit (`albumHref` input) + E2E | home-charts.test.ts + manual | ❌ / manual |
| P39-09 | new allowlists accept mzstatic/i.kfs.io/googleusercontent/ytimg/ggpht, reject look-alikes (`evil-mzstatic.com`) | unit | `pnpm vitest --run src/lib/proxy/safe-image-url.test.ts` | ✅ extend |
| P39-11 | key parity + double quotes across 15 locales | unit | `pnpm vitest --run src/lib/i18n/i18n.test.ts` | ✅ (auto) |
| P39-12 | Randomize redraws picks with 0 fetches (fetch spy) | unit (pure sampler) + E2E network log | home-charts.test.ts + manual | ❌ / manual |

### Sampling Rate
- **Per task commit:** the quick run command for the files touched.
- **Per wave merge:** `pnpm test`.
- **Phase gate:** `pnpm test && pnpm check` green, then E2E on :5173 (fresh profile: request count, first 3
  shelves render, settings/home groups, un-hide a classic section → it fetches and renders), before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/lib/services/__fixtures__/charts/` holds trimmed real responses: `apple-hk-songs.json`, `apple-hk-albums.json`, `kkbox-hk-song.json`, `yt-hk-tracks.json` + `yt-cn-global.json` (keep the `perspectiveMetadata` path), `itunes-hk-1251.json` + a single-entry variant + `itunes-bogus.json`, `deezer-116.json`
- [ ] `src/lib/services/chart-parse.test.ts`
- [ ] `src/lib/services/home-charts.test.ts`
- [ ] `src/lib/services/charts.test.ts` (stub `fetch`, reset `__resetGovernor` + `__clearSearchCache`)
- [ ] `src/routes/api/charts/charts-endpoint.test.ts` (copy the `stubCache`/`stubUpstream` harness from `resolve-endpoint.test.ts`)
- [ ] `src/routes/api/deezer/chart/deezer-chart-endpoint.test.ts`
- Framework install: none.

E2E notes: Deezer, Last.fm, Apple, KKBOX, YT and iTunes are all reachable from this sandbox (CN sources
were dry today). The Browser pane's rAF is frozen, so only 3 shelves mount there. Use back/forward
(popstate → `revealed = Infinity`) or screenshots, and verify reveal timing in vitest.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | All sources keyless |
| V3 Session Management | no | — |
| V4 Access Control | no | Public data; CORS allowlist via `hooks.server.ts` (never `*`) |
| V5 Input Validation | yes | Allowlisted `src/kind/cc/genre` at the edge. Pure resolvers for every persisted setting (region ∈ list, genre ∈ pool, version gate). Shape guard on the v3 home cache read |
| V6 Cryptography | no | — |
| V12/V13 (SSRF / API) | yes | Upstream URLs built only from allowlisted values. No user string reaches an upstream URL or body. Canonical cache keys from validated params |
| V14 Configuration | yes | No new secrets/bindings. `+server.ts` verb-only exports |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Param injection into upstream URL (`cc=../`, arbitrary genre) | Tampering / SSRF | Closed allowlists; invalid → `[]`, 0 subrequests |
| Cache poisoning / fragmentation via extra query params | Tampering / DoS | Canonical key `/api/charts/_k?v&src&kind&cc` from validated params |
| Malicious image URL from an undocumented upstream (CSS `url()` break-out, off-host) | Tampering | `safeImageUrl` per-source allowlists (char screen + https + dot-anchored host), applied at the edge AND to the client iTunes feed |
| Upstream schema drift / silent wrong-chart 200 | Spoofing (of data) | YT echo check, iTunes genre-id check, never-throw → `[]`, empty never cached |
| Amplification / self-DoS (cold fan-out) | DoS | Edge cache (~114 keys total), 5 s budgets, `FANOUT_CAP=4`, `apiFetch` governor, hidden = no task |
| localStorage tampering (region/genres/order/version) | Tampering | Pure resolvers with node tests; `resolveSectionOrder` stays the robustness layer |
| Widening the share-card fetch surface | Elevation (SSRF via /api/og) | Do NOT extend `coverToken` grammar; existing kn4/l82 chain |

## Sources

### Primary (HIGH confidence)
- Live probes 2026-09-25 from this Mac: Apple RSS v2 (27 + 15 storefronts, songs + albums, headers), KKBOX kma (hk/tw/sg × song/newrelease), YouTube Charts (40 countries × TRACKS/ARTISTS, echo field, `hl` variants, thumbnail hosts), legacy iTunes RSS (4 genres + bogus, CORS header), iTunes `/lookup` (CORS), Deezer `/chart/{id}/tracks` (7 + bogus), image resize + CORS on mzstatic / i.kfs.io / yt3 / lh3, Last.fm `album.getinfo` via dev server
- Codebase: `+page.svelte`, `home-layout.ts`, `defaults.ts`, `settings.svelte.ts`, `settings/home/+page.svelte`, `api-base.ts`, `itunes-cover.ts`, `deezer.ts`, `discovery.ts`, `discography.ts`, `album/[name]/+page.svelte`, `album/[artist]/[name]/*`, `api/deezer/chart/+server.ts`, `proxy/{http,edge-cache,safe-image-url,resolve-cache}.ts`, `api/resolve/+server.ts`, `app.d.ts`, `hooks.server.ts`, `share.ts` coverToken, `cover-backfill.ts` header, `media-artwork.ts`, `i18n/{index,detect,i18n.test}.ts`, `settings-persist.svelte.test.ts`, `backup-logic.ts`, `settings/data/+page.svelte`, `vite.config.ts`
- Spikes 011/012 READMEs, `spike-findings-openmusic` SKILL + `references/home-charts.md`, 39-CONTEXT.md

### Secondary (MEDIUM confidence)
- `.planning/debug/ytmusic-cover-blank-hero.md` (Google-host blank hero class)
- Project memories: api-fetch-flood-freeze, share-carrier-grammar-tracks-cover-chain, browser-pane-raf-frozen, svelte-server-endpoint-only-verb-exports

### Tertiary (LOW confidence)
- Resolve-by-name impact of alias/subtitle stripping (CN upstreams dry during research)

## Metadata

**Confidence breakdown:**
- Standard stack / upstream behaviour: HIGH. Every endpoint, failure mode and image host probed today.
- Architecture / integration: HIGH. Traced through the actual `refresh()`, `load()`, album and share code.
- Pitfalls: HIGH for 1–4, 6, 7, 10 (code-verified). MEDIUM for 8–9 (upstream behaviour varies).
- UX choices: MEDIUM (see Assumptions A3–A12).

**Research date:** 2026-09-25
**Valid until:** ~2026-10-09 for the undocumented sources (KKBOX kma, YouTube Charts clientVersion); ~30 days otherwise.
