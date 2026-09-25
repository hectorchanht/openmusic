# Phase 39: Fresh chart homepage - Context

**Gathered:** 2026-09-25
**Status:** Ready for planning
**Source:** Spikes 011 + 012 (edge-verified) and a user Q&A in the spike session — no separate
discuss-phase run. Blueprint: `.claude/skills/spike-findings-openmusic/references/home-charts.md`.

<domain>
## Phase Boundary

The home page shows what is actually hot in the listener's region right now, instead of the stale
Deezer `/chart` + Last.fm tag/geo shelves. Measured root cause (spike 011): Last.fm geo HK is Western
(its HK scrobblers listen to English pop), Last.fm tags rank all-time (王菲 夢中人, 1994, at #2 of
`cantopop`), and Deezer's `/chart` is global — none can show current HK/TW pop. The new sources can.

In scope:
- New default chart shelves: Top Songs, New Releases, Top Artists, Top Albums, Trending on YouTube,
  a Genres group, and an extra-regions group.
- Three new edge proxy routes (Apple Music RSS, KKBOX kma, YouTube Charts) + a `genre` param on the
  existing Deezer chart route + one client-side legacy-iTunes genre service.
- /settings/home redesign: Chart region, More regions, Genres picker, the new sections in the
  reorder/hide/density list, and the old sources clearly marked as "classic" and hidden by default.
- A one-time layout switch for existing users; Reset-to-default yields the new layout.
- Randomize over cached pools (fixes "first render is always the same").

NOT in scope: removing any old shelf or its code path (they stay, opt-in); YouTube Music-source playback
of trending tiles; KKBOX per-language rows; YT Music "Moods & genres" playlists; the KKBOX Open API
fallback (documented, not built); Apple music-video charts.
</domain>

<decisions>
## Implementation Decisions

### Shelf → source (spike-verified)

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

### Region (user decision)
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

### Existing users (user decision)
- **One-time switch on first load after the update:** new chart sections shown, old `top-hits`,
  `top-artists`, `tags`, `countries` added to `homeHidden`. Library sections, the user's relative order of
  existing sections, per-section density, shelf size, landing tab, chrome toggles — all preserved.
- Implement as a versioned settings migration (e.g. a `homeLayoutVersion` field in the settings blob),
  idempotent, run once inside `settings.load()`; a blob already at the new version is untouched. New
  section ids are inserted into the saved order where the old chart block sat (not blindly appended).
- Reset-to-default (`resetHome()`) produces the new layout. Fresh installs get it from the defaults.

### Genres (user decision)
- **Default ON: Asian pop (cantopop, mandopop, kpop, jpop) + Western core (hiphop, rock, dance, rnb).**
  electronic / alternative / asian available, off. Picker = multi-select + reorder chips like today's tags.
- Every legacy-iTunes row is kept only if `category.attributes['im:id'] === String(genreId)` (a bogus id
  returns the overall chart with a 200). `feed.entry` is an object, not an array, when there is one row.
- The old Last.fm `tags` shelves keep their own chip picker, inside the classic group.

### Old shelves (user decision)
- `top-hits` (Deezer), `top-artists` (Deezer), `tags` (Last.fm), `countries` (Last.fm) are NOT removed.
  They stay in /settings/home, hidden by default, visibly marked as the classic/Last.fm·Deezer sources,
  and re-enabling one restores today's behaviour exactly (including its current Randomize page trick).
- A hidden section issues ZERO requests (today's rule — keep it).

### /settings/home layout
- Groups (Claude's discretion on exact visuals; UI-SPEC decides): **Charts** (new sections + Chart region +
  More regions + Genres), **Your library** (liked, downloads, radio, fav-artists, playlists, history),
  **Classic (Last.fm / Deezer)** (the four old sections + the old genre-tag and country chips), then the
  existing global controls (items per shelf, grid columns, landing tab, tile density, chrome toggles).
- Reorder stays one global order across all sections (the home renders one list); grouping is a
  presentation of that list, or reorder-within-group — UI-SPEC decides, but the persisted
  `homeSectionOrder` stays a single array of ids and `resolveSectionOrder` stays the robustness layer.

### Randomize + first render
- Each shelf fetches its top 50–100 once (edge-cached); the rendered shelf is a random N
  (`clampShelfSize`) sampled from that pool. Randomize re-samples locally — **zero extra requests** for
  the new shelves.
- Preserve the existing contract (code comment in `+page.svelte`, user quote "after refresh it should show
  the latest set B, not A"): the sampled arrangement is persisted, a reload shows the persisted arrangement,
  and only a cold cache or a Randomize press draws a new sample. A cold first render IS random, so two
  fresh users no longer see the same page.

### Tile taps
- Song tiles (Top Songs, New Releases, Trending, genres, regions): `player.playStub(artist, title, image,
  'home-discovery')` — the existing resolve-on-tap path; no new resolve logic. Trending tiles resolve by
  name too (the ytmusic edge byte fetch is 403 on the web build — spike 006 post-build finding).
- Artist tiles: the existing artist-page navigation used by today's Top Artists tiles.
- Album tiles: open the existing album page (MusicBrainz `?mbid=` / Deezer path) resolved from
  album name + artist — researcher finds the existing album-open path and reuses it.
- Long-press = the existing `tileMenu` stub → `resolveStub` flow.

### Caching / resilience
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
</decisions>

<specifics>
## Specific Ideas

- Apple RSS: `https://rss.marketingtools.apple.com/api/v2/{cc}/music/most-played/{n≤100}/{songs|albums}.json`;
  artwork `artworkUrl100` → replace `/{w}x{h}bb.` with `/600x600bb.` (206 verified).
- KKBOX: `https://kma.kkbox.com/charts/api/v1/daily?type={song|newrelease}&terr={hk|tw|sg}&lang=tc&category=297&limit=50`
  (50 max; `terr=my` 404; `terr=jp` returns a Mandarin chart; `album`/`artist` types → 103).
- YouTube Charts: POST `https://charts.youtube.com/youtubei/v1/browse?alt=json`, body
  `{context:{client:{clientName:'WEB_MUSIC_ANALYTICS',clientVersion:'2.0',hl:'en',gl:CC}},browseId:'FEmusic_analytics_charts_home',query:'perspective=CHART_DETAILS&chart_params_country_code={cc}&chart_params_chart_type={TRACKS|ARTISTS}&chart_params_period_type=WEEKLY'}`;
  rows via deep-find `trackViews` / `artistViews`; no global chart (`ZZ`/`global` → 400).
- Legacy iTunes (client only): `https://itunes.apple.com/{cc}/rss/topsongs/limit=100/genre={id}/json` —
  CORS `*`, 700–1200 ms; **never from the edge** (shared Workers egress IP → 403/429).
- Deezer genre: `https://api.deezer.com/chart/{genreId}/tracks?limit=50` (edge-verified 8/8).
- Image hosts to add to the allowlist: `*.mzstatic.com`, `i.kfs.io`, `*.googleusercontent.com` (yt3/lh3).
- Randomize: the old `RANDOM_PAGE_BOUND` random-Last.fm-page trick stays for the classic shelves only.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spike evidence + blueprint
- `.claude/skills/spike-findings-openmusic/references/home-charts.md` — implementation blueprint (shelf map, parsers, landmines, constraints)
- `.planning/spikes/011-edge-chart-sources/README.md` — edge reachability, per-source limits, freshness data, head-to-head vs Last.fm
- `.planning/spikes/012-genre-charts/README.md` — genre sources, the itunes.apple.com edge block, genre ids
- `.planning/spikes/MANIFEST.md` — Requirements [011], [012], [user 2026-09-24]

### Home page + layout config
- `src/routes/(app)/+page.svelte` — `refresh()`, `buildLibraryShelves`, cache keys, progressive shelf mount (`REVEAL_*`, debug page-switch-lag-tap-dead cycle 3), `playStub`/`tileMenu`, section render loop
- `src/lib/services/home-layout.ts` — `HOME_SECTIONS`, `resolveSectionOrder`, `resolveSubset`, `clampShelfSize`, pools; the robustness layer for persisted config
- `src/lib/config/defaults.ts` — `HOME_DEFAULTS`
- `src/lib/stores/settings.svelte.ts` — home fields, `load()` coercion, `save()`, `resetHome()`
- `src/routes/(app)/settings/home/+page.svelte` — current sections list, tag/country chips, pickers
- `src/lib/services/discovery.ts` — `shuffle`, `pickRandomPage`, `mapWithConcurrency`, `DiscoveryTrack`/`DiscoveryArtist`, `resolveStub`
- `src/routes/(app)/charts/**` — existing See-all pages for the classic shelves

### Edge proxy patterns
- `src/routes/api/deezer/chart/+server.ts` — the posture to copy (CORS, OPTIONS, `edgeCache`, `fetchWithRetry`, `safeImageUrl`, reshape to discovery items, empty on failure)
- `src/lib/proxy/edge-cache.ts`, `src/lib/proxy/http.ts`, `src/lib/proxy/safe-image-url.ts`
- `src/lib/services/deezer.ts` (`deezerChart`), `src/lib/services/api-base.ts` (`apiFetch` governor)
- `src/lib/services/itunes-cover.ts` — precedent for client-side, CORS-open iTunes calls

### Project rules
- `CLAUDE.md` — Shared Primitives table (import, never re-inline), SSR/browser guards, i18n double quotes + key parity across all 15 locales, comment/decision-ref house style
- Memory: `api-fetch-flood-freeze` (every fetch governed, no unbounded fan-out), `svelte-server-endpoint-only-verb-exports` (helpers in `$lib`, not extra `+server.ts` exports), `share-carrier-grammar-tracks-cover-chain` (a new image host may need to be known to the share `?ci=` host-tag set if chart covers can reach a share card)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `player.playStub(artist, title, image, 'home-discovery')` — resolve-on-tap for any `{artist,title}` tile.
- `DiscoveryTrack` / `DiscoveryArtist` shapes — every new route reshapes to these, so tiles, menus and
  cover backfill work unchanged.
- `mapWithConcurrency(items, FANOUT_CAP, fn)` — capped fan-out for per-genre / per-region shelves.
- `shuffle()` / `pickN()` — random-N sampling for Randomize.
- `SettingPicker`, `chipReorder`, `dragReorder`, `SettingHint` — settings UI building blocks.

### Established Patterns
- Hidden section = no fetch; empty shelf = no header.
- Persisted config is untrusted input: every new setting gets a pure resolver/clamp in `home-layout.ts`
  with node tests (region ∈ allowlist, genre ∈ pool, version migration idempotent).
- Edge query params are allowlisted (territory, type, category, genre) — never raw user strings upstream.
- Generation guard (`refreshGen`) — only the latest refresh writes shelf state.

### Integration Points
- `HOME_SECTIONS` / `resolveSectionOrder` (new ids appended safely for old blobs — plus the one-time
  migration for placement + hiding).
- `settings.load()` coercion block + `save()` payload + `resetHome()`.
- `+page.svelte` render loop per section id + `shelfCount()` for the progressive mount budget.
- i18n: new section/setting labels in all 15 locale files (`en` is the key source; `i18n.test.ts` parity).
</code_context>

<deferred>
## Deferred Ideas

- KKBOX per-language rows (Cantonese 320 / Mandarin 297 / Western 390 — HK only); largely overlap the
  Cantopop/Mandopop genre shelves.
- YT Music "Moods & genres" curated playlists (3 browse calls per shelf).
- Playing Trending tiles through the ytmusic source by `videoId` (web edge byte fetch is 403).
- KKBOX Open API (client-credentials) as a documented fallback if kma breaks.
- Post-deploy check from the HKG colo (spikes observed YVR/PDX only).
- Apple music-video charts; YouTube daily charts.
</deferred>

---

*Phase: 39-fresh-chart-homepage*
*Context gathered: 2026-09-25 from spikes 011–012 + user Q&A*
