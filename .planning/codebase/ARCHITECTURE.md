<!-- refreshed: 2026-07-03 -->
# Architecture

**Analysis Date:** 2026-07-03

> NOTE: The root `CLAUDE.md` is STALE. It describes a legacy vanilla `index.html` desktop player. The LIVE app is a **SvelteKit 2 + Svelte 5 (runes) + Vite 8** mobile PWA under `src/`, deployed on **Cloudflare Pages** (web) and wrapped by **Capacitor** (Android native). This document maps the real architecture.

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  ROUTES (SvelteKit pages, client-rendered SPA — ssr=false)                 │
│  `src/routes/(app)/` : home / search / library / album / artist / charts   │
│                        / song / settings/*                                 │
│  Root layout mounts the single <audio>: `src/routes/+layout.svelte`        │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ components read stores, call store methods
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  COMPONENTS  `src/lib/components/`                                          │
│  NowPlaying (1652L) · Nowbar · TrackMenu · CompactRow · HomeGridPager · …   │
│  ACTIONS `src/lib/actions/` (lazyCover, tapBounce, longpress, dragClose…)   │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ reactive $state reads + method calls (no props drilling)
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STORES (Svelte 5 runes singletons, `*.svelte.ts`)  `src/lib/stores/`      │
│  player (3017L, central) · library · settings · history · names ·          │
│  overlays · cover-version · sleepTimer · online · searchSession · toast    │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ pure/async function calls
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  SERVICES  `src/lib/services/`   (pure `.ts`, node-testable)               │
│  catalog (searchAll/ensureTrackDetails) · dedupe · discovery · picks ·     │
│  similar · cover-backfill · cover-cache · deezer · itunes-cover · lastfm · │
│  lrc · media-session · blob-store · sleep-timer · score-match · …          │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ SourceAdapter.search()/resolve() via registry
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  SOURCES (client adapters)  `src/lib/sources/`                             │
│  netease · qq · kuwo · joox · fivesing · jamendo · audius   (registry.ts)  │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ fetch same-origin /api/*
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  API PROXY (Cloudflare Workers, edge)  `src/routes/api/`                   │
│  [source]/[...path] catch-all (netease/qq/kuwo/joox) + proxy registry      │
│  deezer/* · lastfm/* · similar · translate · audius · jamendo · fivesing   │
│  CORS seam: `src/hooks.server.ts` ; JOOX_TOKEN injected edge-side only     │
└───────────────┬────────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  UPSTREAMS: Chinese music proxies, Deezer, iTunes, Last.fm, translate APIs │
│  + browser-native <audio> (direct CDN URL) + IndexedDB blob cache          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Root layout | Mounts the ONE app-wide `<audio>`, calls `player.attach()` + `player.restore()`, per-page OG head | `src/routes/+layout.svelte` |
| App layout | Bottom tab nav, Nowbar/NowPlaying mount, never-stop toast host, offline banner, overlay + online init | `src/routes/(app)/+layout.svelte` |
| `Player` store | Central playback engine: current/queue/transport state, resolve→play, cross-source fallback, never-stop loop guard, prefetch, media session, persistence | `src/lib/stores/player.svelte.ts` |
| `Library` store | Liked songs, playlists, downloads (blob refs), fav artists; localStorage `openmusic:library:v1` | `src/lib/stores/library.svelte.ts` |
| `Settings` store | All user prefs (enabled sources, quality, langs, home layout, playback); leaf store, imports nothing from player/library | `src/lib/stores/settings.svelte.ts` |
| `catalog` service | Fan-out `searchAll()` across enabled adapters (staggered, per-source isolated, TTL-cached) + `ensureTrackDetails()` lazy resolve | `src/lib/services/catalog.ts` |
| `registry` (sources) | The ONLY enumeration of client source adapters; `getEnabledAdapters()` precedence chain | `src/lib/sources/registry.ts` |
| `NowPlaying.svelte` | Full-screen expanded player: cover, synced lyrics, up-next queue, transport, gestures (1652 lines — the largest UI file) | `src/lib/components/NowPlaying.svelte` |
| `Nowbar.svelte` | Compact sticky mini-player (docked + embed variants) | `src/lib/components/Nowbar.svelte` |
| API catch-all | Same-origin proxy for netease/qq/kuwo/joox; validates source, builds upstream via `ProxyAdapter`, injects JOOX token edge-side | `src/routes/api/[source]/[...path]/+server.ts` |
| CORS hook | Single CORS seam for every `/api/*` route; allowlisted origin only, never `*` | `src/hooks.server.ts` |

## Pattern Overview

**Overall:** Store-driven reactive singletons over a pure service/adapter core, fronted by an edge proxy.

**Key Characteristics:**
- **Svelte 5 runes everywhere.** `runes: true` is forced project-wide in `svelte.config.js`. Stores are plain classes with `$state`/`$derived` fields, instantiated ONCE and exported as a singleton (e.g. `export const player = new Player()`). Components read `player.current` directly and it re-renders — no `writable`/`get`/subscribe, no prop drilling.
- **`.svelte.ts` vs `.ts` split is deliberate and load-bearing.** Runes-using modules are `*.svelte.ts` (stores). Pure logic is `.ts` (services) so it stays node-testable under the single Vitest `server` project (`vite.config.ts` — no jsdom project exists). The `cover-version.svelte.ts` / `cover-cache.ts` pair is the canonical "wrap, don't rewrite" example: pure cache in `.ts`, reactive version signal in `.svelte.ts`.
- **Registry-driven sources.** Adding a music source = one client adapter (`src/lib/sources/<id>.ts`) + one proxy (`src/lib/proxy/<id>.ts`) + one line in each registry. Aggregation/dispatch code NEVER names a source (`catalog.ts`, `dedupe.ts` iterate the registry).
- **Lazy resolution.** Search returns lightweight `Track` stubs (`audioUrl: null`, `detailsLoaded: false`). `ensureTrackDetails()` (`catalog.ts`) resolves the playable URL + lyrics on first play.
- **Generation guards** protect every async path against supersedence (see Key Abstractions).
- **Client-rendered SPA.** `ssr = false` + `prerender = false` at `src/routes/+layout.ts` (required for the Capacitor adapter-static build; web build shares it).
- **Dual-adapter build switch.** `BUILD_TARGET=native` swaps `adapter-cloudflare` → `adapter-static` (Capacitor SPA), `svelte.config.js`.

## Layers

**Routes (presentation):**
- Purpose: URL-addressable pages; each `+page.svelte` orchestrates a screen and reads stores.
- Location: `src/routes/(app)/`
- Contains: `+page.svelte` (UI), `+page.ts` (universal `load` — mostly OG data from `url.searchParams`), route-group layouts.
- Depends on: components, stores, services (for data loading like `buildDiversePicks`, `searchAll`).
- Used by: the browser router.

**Components:**
- Purpose: Reusable UI + player surfaces.
- Location: `src/lib/components/`
- Depends on: stores (read `$state`, call methods), actions, i18n `t()`.
- Used by: routes and each other (NowPlaying embeds Nowbar).

**Stores (state):**
- Purpose: All reactive runtime + persisted state; the seam between UI and logic.
- Location: `src/lib/stores/*.svelte.ts`
- Depends on: services (async logic), other leaf stores (settings/library imported by player; settings imports nothing back to avoid cycles).
- Used by: components and routes.

**Services (logic):**
- Purpose: Pure/async business logic — aggregation, dedupe, scoring, cover resolution, media session, persistence primitives.
- Location: `src/lib/services/`
- Depends on: source registry, proxy `/api/*`, other services. No `$state`.
- Used by: stores and routes.

**Sources (adapters):**
- Purpose: Per-platform `search()` + `resolve()`; normalize upstream JSON → canonical `Track`.
- Location: `src/lib/sources/`
- Depends on: `services/api-base` (`apiUrl`/`apiFetch`), `services/lrc` (`inferQualityFromUrl`).
- Used by: `catalog.ts` via `registry.ts`.

**Proxy / API (edge):**
- Purpose: Same-origin passthrough to upstreams, CORS scoping, secret injection (JOOX token, Last.fm key) that must never reach the client bundle.
- Location: `src/routes/api/` (routes) + `src/lib/proxy/` (per-source URL builders + registry).
- Depends on: Cloudflare `platform.env`, `proxy/http.ts` (`fetchWithRetry`, `corsHeaders`).
- Used by: source adapters + services via `fetch('/api/...')`.

## Data Flow

### Primary Playback Path: Search → Resolve → Play

1. User types a query; `searchAll(keyword, page, prefs, signal, onPartial)` fans out to enabled adapters, staggered by `SEARCH_STAGGER_MS` (200ms), per-source isolated via `Promise.allSettled`, TTL-memoized 60min (`src/lib/services/catalog.ts:85`).
2. Each `SourceAdapter.search()` calls `/api/<source>/...`, normalizes rows to `Track` stubs with canonical colon `uid` via `makeUid()` (`src/lib/sources/types.ts`).
3. Results are deduped by colon uid and round-robin interleaved; `dedupeBest()` collapses same-song variants (`src/lib/services/dedupe.ts:73`). Search page rows also merge Deezer via `dedupeBestWithDeezer`.
4. User taps a row → component calls `player.play(track, {fresh:true})` (`src/lib/stores/player.svelte.ts:2072`).
5. `play()` bumps `playGen`, sets `current` + `resolvedCover` SYNCHRONOUSLY, records history, then `await ensureTrackDetails(track)` resolves the playable URL + lyrics (`src/lib/stores/player.svelte.ts:2204`).
6. Guard: `if (myGen !== this.playGen) return` after every await — a newer tap discards this resolve (`player.svelte.ts:2205`).
7. `audio.src = resolved.audioUrl` (or a `blob:` URL from IndexedDB if downloaded), `armStall()`, `audio.play()`. Prefetch of the next track arms.

### Discovery Stub → Play (home / charts)

1. Home/charts tiles are Last.fm `{artist,title}` stubs, not real Tracks. Tap → `player.playStub(...)` sets an optimistic `pendingTrack` overlay INSTANTLY (`player.svelte.ts:2020`).
2. `resolveStub(artist, title)` runs `searchAll` + `dedupeBest` + `scoreMatch` re-rank to pick the best real cross-source Track (`src/lib/services/discovery.ts:32`), then `play()`.

### Cover Resolution Chain (Deezer → iTunes → CN, two-layer cache + self-heal)

1. On `play()` entry, `resolvedCover` is set synchronously from `track.cover ?? getCachedCoverByUid(uid) ?? getCachedCover(artist,title) ?? null` (uid-layer first, then name-layer — D-13 read order) (`player.svelte.ts:2100`).
2. On a sync miss, `resolveCoverForTrack()` runs the shared tier chain: Deezer (own-origin `/api/deezer/search`) → iTunes (direct CORS-open) → CN (`searchAll → dedupeBest[0].cover`), stopping at the first SOLID https URL (`src/lib/services/cover-backfill.ts:168`).
3. A SOLID resolve writes BOTH cache layers via `writeCoverBoth(uid, artist, title, url)` and `bumpCoverVersion()` so every mounted tile repaints live (`src/lib/stores/cover-version.svelte.ts`).
4. **Self-heal:** if the current cover errors while rendering, `healCover(uid)` evicts the dead entry (`removeCoverBoth`) and re-resolves, guarded by a per-`${uid}|${url}` one-shot set to prevent re-probe DoS (`player.svelte.ts:2439`, `player.svelte.ts:266`).
5. List rows resolve covers lazily on scroll-into-view via `use:lazyCover` — reads the two-layer cache first, probes a broken existing cover with `Image()`, then the shared chain; fires at most once per row (`src/lib/actions/lazyCover.ts`).

### Library Persistence

- `library.svelte.ts` persists liked/playlists/downloads/favArtists to localStorage `openmusic:library:v1`; loaded once in the app-layout `onMount`.
- `player.svelte.ts` persists current+queue+progress+shuffle/repeat to `openmusic:player:v1` (throttled on `timeupdate`, flushed on `visibilitychange`/`freeze`/`pagehide`). `restore()` runs from the root layout `$effect` (no autoplay per browser policy).
- Downloaded audio blobs live in IndexedDB via `blob-store.ts`; the Track carries only a reference.

**State Management:**
- One instance per store class, exported as a module-level `const`. Reads are reactive by virtue of Svelte 5 rune proxying; mutations are direct field assignment. There is NO manual subscribe/notify — this replaces the legacy imperative-renderer model entirely.

## Key Abstractions

**`Track` (canonical song shape):**
- Purpose: One song in two phases — stub (post-search: `audioUrl:null, detailsLoaded:false`) and enriched (post-resolve).
- Definition: `src/lib/sources/types.ts` (`interface Track`).
- Identity: `uid = ${source}:${songid}` (COLON form) via `makeUid()`. `displayIndex` is ORDERING ONLY, never identity (Pitfall 4). Source-specific extras (songMid, jooxSongId, fivesingSongType folding) are optional fields.

**`playContext` / queue model:**
- The "queue" is `player.queue: Track[]` plus `queueContext` (which surface started it) and `upNextAnchorUid` (the uid the Up-Next list is anchored to for slicing). `QueueContext` type in `src/lib/config/defaults.ts`.
- Install paths: `setQueue()` / `setListQueue()` / `clearQueue()`. Manual inserts: `playNext()` / `addToQueue()` (tracked in `manualUids`). Auto-grow: `ensureAhead()` / regenerate (generated up-next is the successor of repeat-all).

**Cover cache (three key families in one flat record):**
- localStorage `openmusic:cover-cache:v1`, keys: `uid:<colon-uid>` (exact song), `<matchKey>` (name layer, cross-uid bridge), `artist:<matchKey>` (artist-only). All provably disjoint. `src/lib/services/cover-cache.ts`.
- Read order everywhere: uid → name → null. `cover-version.svelte.ts` adds the reactive `coverVersion()` signal on top.

**Generation guards (supersedence):**
- `playGen` — bumped at top of every `play()`; every await re-checks `myGen !== this.playGen` and bails a stale resolve (`player.svelte.ts:256, 2116`).
- `queueGen` — bumped by every explicit `setQueue()`/`setListQueue()`; an in-flight `regenerate()`/`ensureAhead()` discards its result if superseded (`player.svelte.ts:268, 1686`).
- `pendingGen` — for `playStub` optimistic-overlay resolves (`player.svelte.ts:210`).
- `fallbackGen` — keyed to `playGen`; only ONE cross-source failover runs per generation (`player.svelte.ts:285`).

**`SourceAdapter` / `ProxyAdapter`:**
- Client adapter runs in-browser (`search`/`resolve` → normalize → Track). Proxy adapter runs on the edge (build upstream URL, inject secrets). Same `SourceId` key on both. `src/lib/sources/types.ts`, `src/lib/proxy/proxy-types.ts`.

## Entry Points

**App boot / audio:**
- Location: `src/routes/+layout.svelte` — the single `<audio>` element lives here (mounted once, survives navigation). `$effect` calls `player.attach(audioEl)` then `player.restore()`.
- `attach()` (`player.svelte.ts:1151`) wires all audio events (`play`/`playing`/`pause`/`canplay`/`timeupdate`/`ended`/`error`) + page-lifecycle persistence listeners.

**App shell:**
- Location: `src/routes/(app)/+layout.svelte` `onMount` — `library.load()`, `settings.load()`, landing-tab redirect, `overlays.init()`, `online.init()`.

**Play entry:**
- `player.play(track, opts)` (`player.svelte.ts:2072`) — direct plays / queue / auto-advance.
- `player.playStub(...)` (`player.svelte.ts:2020`) — discovery-stub taps.

**API edge entry:**
- `src/routes/api/[source]/[...path]/+server.ts` (catch-all) + dedicated `src/routes/api/{deezer,lastfm,similar,translate,audius,jamendo,fivesing}/**/+server.ts`. All fronted by `src/hooks.server.ts` CORS.

## The Audio Playback Lifecycle

1. `play()` sets `current`, `loading=true`, `resolvedCover` synchronously, bumps `playGen`, records history (`player.svelte.ts:2072`).
2. Offline-first branch: if `library.isDownloaded(uid)` and a blob exists, `audio.src = createObjectURL(blob)` and skip network (`player.svelte.ts:2132`).
3. Else `await ensureTrackDetails(track)`; gen-check; set `current = resolved`, sync queue entry, persist, adopt cover (`player.svelte.ts:2204`).
4. Set `audio.src`, reset `hasPlayedSinceSrc=false`, `armStall()` (initial-load watchdog), `audio.play()` (rejection → arm one-shot autoplay retry).
5. `prefetchNext()` walks forward, resolving + silently probing candidates so the next track is ready before this one ends (gapless, non-stop).
6. `playing` event = real audio output → `hasPlayedSinceSrc=true`, `disarmStall()`, reset `consecutiveFailures`/`errorBurst`/`reresolveBurst`, clear strikes, end fallback episode, drop sticky notice (`player.svelte.ts:1201`).
7. `error` event → single same-src re-resolve (transient blip), then cross-source `runFallback` (advance PAST a dead URL).
8. `ended` → `next()` (repeat-one loops; otherwise advance / auto-grow).

## Architectural Constraints

- **Threading:** Single-threaded event loop; all I/O is `async/await`. No Web Workers. `service-worker.ts` handles PWA caching only.
- **Global state:** Store singletons are module-level shared mutable state (`player`, `library`, `settings`, `history`, `names`, `overlays`, `online`, `sleepTimer`, `cover-version`, `toast`, `searchSession`). This is intentional (the runes model), not accidental.
- **Circular imports:** Avoided by discipline — `settings` is a LEAF (imports nothing from player/library). `player` imports `settings`/`library`/`history`/`names`/`actionLog` one-way. `discovery.ts` imports `settings`, so the discovery pools were moved to the pure `home-layout.ts` and re-exported to break a cycle.
- **Runes files:** Anything using `$state`/`$derived`/`$effect` MUST be `*.svelte.ts` or `*.svelte`. Pure logic stays `.ts` for node testability (single Vitest `server` project, no jsdom).
- **Secrets:** `JOOX_TOKEN`, `LASTFM_SECRET` live ONLY in Cloudflare `platform.env` (`src/app.d.ts`), injected edge-side in proxy adapters — never in the client bundle.
- **Audio engine:** Native HTML `<audio>` with `referrerpolicy=no-referrer`; `src` set directly to CDN URL or `blob:`. No MediaSource/HLS/Web Audio.
- **CORS:** All `/api/*` responses get allowlisted CORS via `hooks.server.ts` — never `*`.
- **SSR:** Disabled app-wide (`ssr=false`). Every store/service that touches `localStorage`/`window`/`document` is guarded (`browser` import or `typeof window !== 'undefined'`).

## Anti-Patterns

### `player.svelte.ts` is a 3017-line god object

**What happens:** The `Player` class owns transport state, queue management, cross-source fallback, the never-stop loop guard, prefetch/probe, media session, cover self-heal, sleep-timer integration, persistence, offline-blob playback, and history/manual-queue weaving — all in one class with ~55 methods and dozens of private fields.
**Why it's wrong here:** Very hard to reason about invariants; the numerous interacting private counters (`consecutiveFailures`, `errorBurst`, `reresolveBurst`, `skipBurst`, `fallbackGen`, `playGen`, `queueGen`, `pendingGen`) are correctly documented but tightly coupled — a change to one event handler can silently break a guard. The 4163-line test file (`player.svelte.test.ts`) confirms the surface area.
**Do this instead:** Extract cohesive slices into pure services the store thins-calls (the media-session slice already models this — throw-prone logic lives in the pure `src/lib/services/media-session.ts` and the store is a thin caller). Candidate extractions: the never-stop/fallback state machine, the prefetch/probe walk, and the cover self-heal — each is largely pure decision logic wrapped around a few `$state` fields. See OPTIMIZATION OPPORTUNITIES.

### `NowPlaying.svelte` at 1652 lines

**What happens:** The expanded player packs cover art, synced-lyrics rendering + scroll, up-next queue with drag-reorder, transport, gestures, and multiple sub-sheets into one component.
**Why it's wrong here:** A re-render hotspot — it reads many `player.*` reactive fields, so a high-frequency update (e.g. lyric highlight on `timeupdate`) can re-run more of the component than necessary.
**Do this instead:** Split the lyrics pane, up-next list, and transport into child components so each subscribes to only the `$state` it needs, containing re-render scope.

### Cover-cache write duplication across surfaces

**What happens:** `writeCoverBoth` / `setCachedCover` / `setCachedCoverByUid` are invoked from `player.play()`, `lazyCover`, `cover-backfill`, and `library.adoptCover` — several call sites replicate the "https-only guard + write both layers + bump" sequence.
**Why it's wrong here:** The SOLID/https guard (`httpsOnly`) is re-implemented in `player.svelte.ts:39`, `cover-backfill.ts`, and `lazyCover.ts`.
**Do this instead:** The `cover-version.svelte.ts` `writeCoverBoth` is meant to be the one write path; route every writer through it and drop the duplicated https guards.

## Error Handling

**Strategy:** Isolate-and-degrade. No error ever stops the app or the never-stop playback chain.

**Patterns:**
- Per-source search isolation: `Promise.allSettled` in `catalog.ts` — one source failing yields a typed `SettledSourceResult` error, others still display.
- Cover chain per-tier never-throw: each tier falls through to the next; a total miss leaves a gradient (`cover-backfill.ts`).
- Playback never-stop: a dead URL routes through single-retry → cross-source `runFallback` → skip; a loop-guard (`FAILURE_CAP=5`) trips a sticky "playback stopped" Retry notice instead of infinite ping-pong (`player.svelte.ts`).
- localStorage access always wrapped in try/catch returning null/no-op (quota, privacy mode, corrupt JSON).
- Store→UI errors surface via reactive fields (`player.error`, `player.notice`) read one-way by the layout toast host — stores never import UI.

## Cross-Cutting Concerns

**Logging:** Verbose player action log via `logAction()` (`src/lib/stores/actionLog.svelte.ts`), viewable at Settings → Activity log. Never on the `timeupdate` firehose.
**Validation:** API routes validate `params.source` against the proxy registry (404 unknown); scoring/dedupe validate track shape.
**Authentication:** None for the user; upstream secrets injected edge-side only.
**i18n:** Runes-based `t()` (`src/lib/i18n/index.ts`) reads `settings.appLang` reactively; 16 language dictionaries. `en` is the reference dictionary defining `TranslationKey` (missing keys are compile errors).
**Media Session:** OS lock-screen/media-hub integration via `services/media-session.ts` (web) + `services/native-media-session.ts` (Capacitor), driven from the player store.

---

*Architecture analysis: 2026-07-03*
