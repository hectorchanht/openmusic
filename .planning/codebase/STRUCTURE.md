# Codebase Structure

**Analysis Date:** 2026-07-03

> NOTE: Root `CLAUDE.md` is STALE (describes a legacy `index.html`). The live app is a **SvelteKit + Vite** PWA under `src/`. This document maps the real layout.

## Directory Layout

```
openmusic/
├── src/
│   ├── routes/                     # SvelteKit routes (pages + API endpoints)
│   │   ├── +layout.svelte          # Root layout — mounts the ONE <audio>, attach/restore player
│   │   ├── +layout.ts              # ssr=false, prerender=false (SPA)
│   │   ├── (app)/                  # Main app route-group (tab shell)
│   │   │   ├── +layout.svelte      # Tab nav, Nowbar/NowPlaying, toast host, offline banner
│   │   │   ├── +page.svelte        # Home (discovery shelves)
│   │   │   ├── search/             # Search screen
│   │   │   ├── library/            # Library (liked / playlists / downloads)
│   │   │   ├── album/[name]/       # Album detail
│   │   │   ├── artist/[name]/      # Artist detail
│   │   │   ├── song/[slug]/        # Shareable song page (OG)
│   │   │   ├── charts/             # top / tags/[tag] / countries/[country]
│   │   │   └── settings/           # about, appearance, data, general, home, lastfm, playback, translation, activity
│   │   ├── api/                    # Cloudflare Worker proxy endpoints (+server.ts)
│   │   │   ├── [source]/[...path]/ # Catch-all proxy: netease/qq/kuwo/joox
│   │   │   ├── deezer/             # album/artist/artist-albums/chart/related/search
│   │   │   ├── lastfm/             # discovery/info
│   │   │   ├── audius/             # search + stream/[id]
│   │   │   ├── fivesing/           # search + url
│   │   │   ├── jamendo/ similar/ translate/
│   │   └── spike/                  # Throwaway experiment page
│   ├── lib/
│   │   ├── stores/                 # Svelte 5 runes singletons (*.svelte.ts) — reactive state
│   │   ├── services/               # Pure/async logic (.ts) — node-testable
│   │   ├── sources/                # Client source adapters (search/resolve → Track)
│   │   ├── proxy/                  # Server-side proxy adapters + registry (edge URL builders)
│   │   ├── components/             # Svelte UI components
│   │   ├── actions/                # Svelte use: actions (gestures, lazy cover, tap feedback)
│   │   ├── gestures/               # Pure gesture math (velocity tracker)
│   │   ├── i18n/                   # 16 language dicts + reactive t()
│   │   ├── search/                 # Autocomplete + search-history pure logic
│   │   ├── history/                # Play-history pure logic
│   │   ├── diagnostics/            # Action-log pure logic
│   │   ├── util/                   # artist-split, haptics
│   │   └── config/                 # defaults.ts (single source of truth for prefs)
│   ├── app.html                    # HTML shell
│   ├── app.css                     # Global styles + CSS custom properties (design tokens)
│   ├── app.d.ts                    # App.Platform.env types (JOOX_TOKEN, LASTFM_KEY/SECRET)
│   ├── hooks.server.ts             # Single CORS seam for /api/*
│   └── service-worker.ts           # PWA offline caching
├── static/                         # favicon.svg, og.svg, icons/, manifest.webmanifest, robots, sitemap
├── android/                        # Capacitor Android native shell
├── build/                          # adapter-static output (native build)
├── svelte.config.js                # Dual-adapter switch (cloudflare | static), runes:true
├── vite.config.ts                  # Vite + Vitest (single node "server" project)
├── wrangler.jsonc                  # Cloudflare Pages config + public vars
├── capacitor.config.ts             # Capacitor Android config
└── tsconfig.json
```

## Directory Purposes

**`src/lib/stores/` (state — `*.svelte.ts`):**
- Purpose: Svelte 5 runes singleton classes; the reactive seam between UI and logic.
- Key files: `player.svelte.ts` (3017L — central playback engine), `library.svelte.ts`, `settings.svelte.ts` (leaf), `history.svelte.ts`, `names.svelte.ts` (display-name translation), `overlays.svelte.ts` (back-to-close stack), `cover-version.svelte.ts` (reactive cover-cache wrapper), `sleepTimer.svelte.ts`, `online.svelte.ts`, `searchSession.svelte.ts`, `searchHistory.svelte.ts`, `toast.svelte.ts`, `actionLog.svelte.ts`.

**`src/lib/services/` (logic — `.ts`, no runes):**
- Purpose: Pure/async business logic, node-testable under Vitest.
- Key files: `catalog.ts` (searchAll/ensureTrackDetails fan-out), `dedupe.ts` + `dedupe-deezer.ts`, `discovery.ts` (resolveStub, mapWithConcurrency), `picks.ts`, `similar.ts`, `cover-backfill.ts` (Deezer→iTunes→CN chain), `cover-cache.ts` (localStorage cover store), `deezer.ts`, `itunes-cover.ts`, `lastfm.ts`, `lrc.ts` (lyrics parse + quality infer), `score-match.ts` + `score-context.ts`, `match-key.ts`, `media-session.ts` + `native-media-session.ts` + `media-store.ts`, `blob-store.ts` (IndexedDB), `downloads-queue.ts`, `sleep-timer.ts`, `translate.ts`, `share.ts`, `home-layout.ts`, `enrich-merge.ts`, `fallback.ts`, `color.ts`, `ttl-cache.ts`, `sw-cache.ts`, `api-base.ts`.

**`src/lib/sources/` (client adapters):**
- Purpose: Per-platform `search()`/`resolve()`; normalize upstream JSON → canonical `Track`.
- Key files: `types.ts` (`Track`, `SourceAdapter`, `makeUid`), `registry.ts` (the ONLY adapter enumeration), `netease.ts`, `qq.ts`, `kuwo.ts`, `joox.ts`, `fivesing.ts`, `jamendo.ts`, `audius.ts`, `quality.ts`, `__fixtures__/` (test JSON).

**`src/lib/proxy/` (edge adapters):**
- Purpose: Server-side upstream URL builders + secret injection, used by `/api/[source]/[...path]`.
- Key files: `proxy-types.ts` (`ProxyAdapter`, `Env`), `proxy-registry.ts` (netease/qq/kuwo/joox), per-source `netease.ts`/`qq.ts`/`kuwo.ts`/`joox.ts`, `http.ts` (`fetchWithRetry`, `corsHeaders`, `sleep`).

**`src/lib/components/`:**
- Purpose: Svelte UI.
- Key files: `NowPlaying.svelte` (1652L — expanded player), `Nowbar.svelte` (mini-player, docked+embed), `TrackMenu.svelte`, `CompactRow.svelte` + `CompactPager.svelte`, `HomeGridPager.svelte`, `TagChips.svelte`, `SleepTimerSheet.svelte`, `ToastHost.svelte`, `PageOg.svelte`, `Logo.svelte`, `track-menu-gate.ts`.

**`src/lib/actions/` (Svelte `use:` actions):**
- Purpose: DOM behaviors attached via `use:`.
- Key files: `lazyCover.ts` (scroll-triggered cover resolve), `tapBounce.ts` (tap feedback), `longpress.ts`, `dragClose.ts`, `dragReorder.ts` + `chipReorder.ts`, `dragScroll.ts`, `coverSwipe.ts`, `swipeAction.ts` + `swipeRemove.ts`, `marquee.ts`, `focusTrap.ts`, `inflightGuard.ts`.

## Key File Locations

**Entry Points:**
- `src/routes/+layout.svelte`: mounts the single `<audio>`, calls `player.attach()` + `player.restore()`.
- `src/routes/(app)/+layout.svelte`: tab shell; `library.load()`, `settings.load()`, overlay/online init.

**Configuration:**
- `svelte.config.js`: dual-adapter build switch, `runes:true` project-wide.
- `vite.config.ts`: Vite + single node Vitest project.
- `wrangler.jsonc` / `capacitor.config.ts`: deploy targets.
- `src/lib/config/defaults.ts`: single source of truth for all settings defaults + `QueueContext` type.
- `src/app.d.ts`: `App.Platform.env` secret types.

**Core Logic:**
- `src/lib/stores/player.svelte.ts`: playback engine.
- `src/lib/services/catalog.ts`: search fan-out + lazy resolve.
- `src/lib/sources/registry.ts` + `types.ts`: source adapter contracts.
- `src/routes/api/[source]/[...path]/+server.ts`: edge proxy.
- `src/hooks.server.ts`: CORS seam.

**Testing:**
- Co-located `*.test.ts` / `*.svelte.test.ts` beside the code under test.
- `src/lib/sources/__fixtures__/*.json`: upstream response fixtures.

## Naming Conventions

**Files:**
- Runes-using modules (stores, reactive wrappers): `*.svelte.ts` (e.g. `player.svelte.ts`, `cover-version.svelte.ts`).
- Pure logic: `.ts` (e.g. `catalog.ts`, `dedupe.ts`). NEVER `.svelte.ts` unless it uses `$state`/`$derived`/`$effect`.
- Components: PascalCase `.svelte` (e.g. `NowPlaying.svelte`).
- Tests: co-located `<name>.test.ts` or `<name>.svelte.test.ts`.
- SvelteKit routes: `+page.svelte` / `+page.ts` / `+layout.svelte` / `+server.ts`; dynamic segments `[param]` / `[...rest]`; route groups `(app)`.
- Kebab-case for multi-word service files (`cover-backfill.ts`, `dedupe-deezer.ts`, `score-match.ts`).

**Directories:**
- Lowercase; grouped by ROLE not feature (`stores/`, `services/`, `sources/`, `components/`, `actions/`).

**Identifiers:**
- Stores exported as lowercase singletons: `export const player = new Player()`.
- Track uid: colon form `${source}:${songid}` via `makeUid()`.
- localStorage keys namespaced `openmusic:<domain>:v<N>` (`openmusic:player:v1`, `openmusic:library:v1`, `openmusic:cover-cache:v1`).
- i18n dicts named by BCP-47-ish code (`en.ts`, `zh-Hans.ts`, `zh-Hant.ts`).

## Where to Add New Code

**New music source:**
- Client adapter: `src/lib/sources/<id>.ts` implementing `SourceAdapter` → add one line to `src/lib/sources/registry.ts`.
- Edge proxy (if path-based): `src/lib/proxy/<id>.ts` → add to `src/lib/proxy/proxy-registry.ts`. (Sources with dedicated routes like `fivesing` skip the proxy registry and add `src/routes/api/<id>/**/+server.ts`.)
- Add `<id>` to the `SourceId` union in `src/lib/sources/types.ts`.

**New page / screen:**
- Route: `src/routes/(app)/<name>/+page.svelte` (+ `+page.ts` if a `load` is needed).
- Reusable UI: `src/lib/components/<Name>.svelte`.

**New store (reactive state):**
- `src/lib/stores/<name>.svelte.ts` — a class with `$state` fields, exported as a singleton. Keep it a LEAF where possible (import only from services / pure modules to avoid cycles; do not import `player`/`library` into a low-level store).

**New pure logic:**
- `src/lib/services/<name>.ts` (business logic) or `src/lib/util/<name>.ts` (small helpers). Keep `.ts` (no runes) so it stays node-testable. Co-locate `<name>.test.ts`.

**New API endpoint:**
- `src/routes/api/<path>/+server.ts`. CORS is applied automatically by `src/hooks.server.ts` — do not re-add `*`. Read secrets from `platform.env`.

**New gesture/DOM behavior:**
- `src/lib/actions/<name>.ts` (a `use:` action). Pure math goes in `src/lib/gestures/`.

## Special Directories

**`.svelte-kit/`:**
- Purpose: SvelteKit generated types + build artifacts.
- Generated: Yes. Committed: No.

**`build/`:**
- Purpose: `adapter-static` output for the Capacitor native build.
- Generated: Yes.

**`android/`:**
- Purpose: Capacitor Android native shell (wraps the SPA).
- Generated: Partially (Gradle project); committed.

**`static/`:**
- Purpose: PWA assets served as-is (icons, manifest, og.svg, favicon, robots, sitemap).
- Generated: No. Committed: Yes.

**`src/lib/sources/__fixtures__/`:**
- Purpose: Recorded upstream JSON responses for adapter tests.
- Committed: Yes.

---

*Structure analysis: 2026-07-03*
