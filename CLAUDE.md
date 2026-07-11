<!-- GSD:project-start source:PROJECT.md -->
## Project

**MusicSquare Mobile**

A mobile-first web music player that searches and streams tracks aggregated from multiple Chinese music platforms (Netease, QQ, Kuwo, JOOX, plus new sources). It began as a ground-up reskin of a former desktop single-page player (`index.html`, a vanilla-JS original that no longer lives in this repo): the proven data/fetch layer was reused, while the desktop three-panel UI was replaced with an app-like mobile interface inspired by YouTube Music and Spotify (bottom nav, expandable now-playing, background audio, installable PWA). Built with SvelteKit and deployed on Cloudflare.

**Core Value:** A user on their phone can search a song, tap it, and have it play instantly with a smooth, native-app-like experience — and keep playing when the screen locks.

**Spike findings for openmusic** (kuwo-first resolution, `track.getSimilar` up-next, inline-cover / API-call-reduction patterns, constraints, gotchas) → `Skill("spike-findings-openmusic")`

### Constraints

- **Tech stack**: SvelteKit + Vite — chosen for smooth animations / app-like UX and first-class Cloudflare deployment.
- **Deployment**: Cloudflare (Pages for the app, Workers for the API proxy) — must fit the Cloudflare free/edge model.
- **Compatibility**: Mobile browsers first (iOS Safari + Android Chrome), responsive up to desktop. iOS Safari background-audio/PWA quirks are a known constraint.
- **Dependencies**: Reuse existing music-source request logic and contracts rather than reinventing; upstream API shapes can change without notice.
- **Git**: `origin` pushes as GitHub user `hectorchanht` via SSH host `github-b` (`~/.ssh/hectorchanht`). `upstream` is the original fork.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

> Source of truth: `package.json`, `svelte.config.js`, `vite.config.ts`, `wrangler.jsonc`, `capacitor.config.ts`, `tsconfig.json`.

## Languages
- **TypeScript `~5.9`** — all app logic, sources, services, stores, API routes (`src/**/*.ts`). `tsconfig.json`: `strict`, `checkJs`, `moduleResolution: "bundler"`.
- **Svelte 5 (`5.56.2`)** — all UI + routes (`src/**/*.svelte`, `src/routes/**`). Runes mode FORCED project-wide via `svelte.config.js`.
- JavaScript (ESM) — config only (`svelte.config.js`, `vite.config.ts`); `"type": "module"`.
- Kotlin — Android MediaStore bridge under `android/` (Capacitor native shell).

## Runtime
- **Node.js `>=22`** for tooling (`.nvmrc`, CI, `engine-strict=true`).
- **Cloudflare Workers (workerd)** for the deployed edge — server routes run at the edge (`wrangler.jsonc`: `compatibility_flags: ["nodejs_compat"]`).
- Browser (iOS Safari + Android Chrome) for the client SPA/PWA; Android WebView (Capacitor) for the native APK.
- **Package manager: pnpm `8.15.5`** (pinned via `packageManager` + corepack). Lockfile `pnpm-lock.yaml` present; CI uses `--frozen-lockfile`.

## Frameworks
- **SvelteKit `2.63.0`** — app framework, routing, edge server endpoints.
- **Svelte `5.56.2`** (runes) + **Vite `8.0.16`** dev server / bundler (`@sveltejs/vite-plugin-svelte`).
- **Dual-adapter build switch** (`svelte.config.js`): `@sveltejs/adapter-cloudflare` (DEFAULT web → `.svelte-kit/cloudflare`, Cloudflare Pages) vs `@sveltejs/adapter-static` (`BUILD_TARGET=native` → `build/` SPA wrapped by the Capacitor Android shell).
- **Capacitor `8.4.0`** (`@capacitor/core`/`cli`/`android`) native shell — `appId: com.openmusic.app`, `appName: OpenMusic`, `webDir: build`.
- **Testing: Vitest `^4.1.3`** — single node/server test project (no jsdom); `src/**/*.{test,spec}.ts` + `*.svelte.test.ts`. ~67 test files, co-located with source.
- Type checking: `svelte-check` + `typescript ~5.9` (`pnpm check`). No prettier/eslint/biome — `svelte-check` is the only quality gate.

## Key Dependencies
- Runtime `dependencies` are Capacitor plugins + the icon lib only; the web app has NO third-party runtime npm deps (sources/proxy/services are hand-written over platform `fetch`/`URL`/`IndexedDB`/Cloudflare Cache).
- `@lucide/svelte` — icon components (per-icon imports for tree-shaking).
- `@capacitor/{app,filesystem,splash-screen,status-bar}`, `@jofr/capacitor-media-session` (lock-screen controls), `capacitor-blob-writer` (stream audio Blob to disk, no base64 bloat). Capacitor code is `browser`/`isNativePlatform()`-guarded — no-op on the web build.
- **Audio: native HTML `<audio>`** with `src` set directly to a CDN URL or a `blob:` URL from IndexedDB. No HLS/DASH, no MediaSource, no Web Audio.

## Configuration
- Server secrets live in Cloudflare (`wrangler pages secret put …`), typed in `src/lib/proxy/proxy-types.ts` `Env`: `JOOX_TOKEN` (required for JOOX), `LASTFM_KEY`/`LASTFM_SECRET` (optional). Local dev values in `.dev.vars`. Secrets are injected edge-side only — never in the client bundle.
- Public var baked into Pages config: `JAMENDO_CLIENT_ID` (`wrangler.jsonc` `vars`).
- Build-time `VITE_API_BASE` — unset on web (same-origin `/api/*`); set to `https://openmusic.lol` for the native build so the APK WebView resolves `/api/*` to the deployed proxy (`src/lib/services/api-base.ts`).
- localStorage keys namespaced `openmusic:<domain>:v<N>` (`openmusic:player:v1`, `openmusic:library:v1`, `openmusic:cover-cache:v1`).
- Build config: `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `wrangler.jsonc`, `capacitor.config.ts`.

## Build & Test Commands
- `pnpm dev` — Vite dev server (strictPort 4321).
- `pnpm build` — web build → `.svelte-kit/cloudflare` (adapter-cloudflare).
- `pnpm build:native` — `BUILD_TARGET=native VITE_API_BASE=https://openmusic.lol` → `build/` SPA.
- `pnpm check` — `svelte-kit sync` + `svelte-check` (typecheck).
- `pnpm test` — `vitest --run`; `pnpm test:unit` — watch.
- `pnpm apk` — `build:native` + `cap sync` + gradle `assembleDebug`.
- `pnpm deploy` — build + `wrangler pages deploy … --project-name openmusic` (primary domain `openmusic.lol`).
- Android CI: `.github/workflows/android-main.yml` (rolling prerelease on push to main) + `android-release.yml` (signed `assembleRelease`).
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Language & Runtime
- **TypeScript, strict everywhere** (`tsconfig.json`: `strict`, `checkJs`, `allowJs`, `moduleResolution: "bundler"`). Node `>=22`.
- **Svelte 5 runes mode is forced** for all first-party files. Use `$state`/`$derived`/`$effect`/`$props` — legacy `export let` / reactive `$:` are NOT used in app code.
- No formatter/linter (no prettier/eslint/biome). The only quality gate is `svelte-check` (`pnpm check`). Style is convention + review.
- Indentation is **tabs**. Single quotes for TS/JS literals EXCEPT `src/lib/i18n/*.ts` (double quotes — see below).

## Runes Usage (Svelte 5)
- **Stores are runes-singleton classes in `*.svelte.ts` files**, instantiated once and exported as a module-scope singleton (`export const player = new Player()`). Public reactive fields use `$state<T>(initial)` with an explicit generic.
- **Internal, non-reactive counters/guards use PLAIN class fields, NOT `$state`** — a deliberate convention (loop-guard budgets, generation counters, debounce timers the UI never reads reactively). See `player.svelte.ts` `consecutiveFailures`, `playGen`, `pendingGen`.
- **Imperative-vs-reactive boundary:** stores emit RAW structured data on `$state` fields; UI reads them one-way. Stores NEVER import UI and NEVER localize text — they emit a `TranslationKey`, and a layout host maps it via `t()`.
- **Generation-guard idiom** (pervasive in `player.svelte.ts`): a monotonic counter (`playGen`, `pendingGen`, `queueGen`) is bumped at the top of an async entry point; after every `await`, re-read the counter and bail if a newer call superseded it. Use for any async resolve a newer user action can supersede.

## Naming Patterns
- Runes stores: `<name>.svelte.ts` (suffix REQUIRED so the Vite plugin transforms runes). Pure services/logic: kebab-case `<name>.ts`. Components: `PascalCase.svelte`. Actions (`use:`): `camelCase.ts`. Tests: co-located `<name>.test.ts` / `.svelte.test.ts`. Routes: `+server.ts` / `+layout.svelte` / `+page.ts`.
- Functions/locals `camelCase`; module constants `SCREAMING_SNAKE_CASE`; class tunables `private static UPPER_SNAKE`. Types `PascalCase` (`Track`, `SourceId`, `QueueContext`); union string literals for enums (`repeatMode: 'off' | 'one'`).

## Import Organization
- **Always use path aliases, not deep relative paths** — `$lib/...`, `$app/...` (the `browser` flag is `$app/environment`). Relative `../` imports are rare.
- **Type-only imports use `import type`** (compile-time key safety without a runtime dependency).
- Named exports throughout; no default exports in `$lib`.

## Error Handling
- **Never-throw services (return a sentinel).** Data/enrichment services (`deezer.ts`, `itunes-cover.ts`, `lastfm.ts`, `fallback.ts`) throw internally so a transient failure is never cached, then map any rejection to a null / empty-array / empty-object sentinel at the exported boundary. A null return means "no data — fall back," never a broken image or a thrown error into the render tree.
- **Silent-catch with graceful degradation.** Search adapters swallow per-source failures (`Promise.allSettled` fan-out) so partial results still render. Exception: `netease.ts` intentionally THROWS on contract drift so `catalog`'s `allSettled` records a typed per-source error.
- **Soft-fail flags (don't trust a 200).** `/api/translate` can echo originals back with a 200; `translate.ts` returns a `complete` boolean and only persists fully-translated batches, retrying incomplete.

## Type Safety
- **Zero `as any` in production source** (all `as any` are in tests). Only 6 `@ts-expect-error`, no `@ts-ignore`. Prefer `satisfies` and `as const` over casts; type guards are user-defined predicates.

## SSR / Browser Guards
- App SSRs on Cloudflare and also builds as a Capacitor SPA. Stores import `{ browser } from '$app/environment'` and early-return under `!browser`. Any new store touching `localStorage`/`window`/`document`/`Image`/`IntersectionObserver`/Media Session MUST gate on `browser` (or feature-detect).

## i18n — DOUBLE QUOTES Convention
- `src/lib/i18n/*.ts` locale dictionaries use **double quotes for every key AND value** — a manual, formatter-less convention (no tool enforces it). All locale files MUST expose an IDENTICAL key set (`en` is the reference/source locale; `i18n.test.ts` guards key-set parity). The store/service layer stays i18n-free (emits `TranslationKey`s; UI calls `t(key)`).

## Comments
- **High comment density is the house style** — comments are load-bearing decision records. Two tagging systems: quick-task IDs (`quick-NNNNNN-xxx`) and decision refs (`D-09`, `PLAY-08`, `COVER-01`, `WR-03`, `MS-05`). When you fix a bug or make a non-obvious choice, ADD a comment with the quick-task ID or decision ref; do not remove existing decision-ref comments.

## Function & Module Design
- **Pure functions are extracted and exported for testability.** Queue math, ordering, parsing, scoring live in a `.ts` with pure exports (`fallbackOrder`, `decideEndedAction`, `parseLRC`, `score-match.ts`); runes stores are thin callers. Stores avoid circular deps by staying LEAF where possible (`settings` imports nothing from player/library). `AbortSignal` is threaded through async services for supersedence/timeout.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

**Overall:** Store-driven reactive Svelte 5 runes singletons over a pure service/adapter core, fronted by a Cloudflare edge proxy. All source under `src/`.

## System Overview (layers, top → bottom)

```text
ROUTES  src/routes/(app)/   home / search / library / album / artist / charts / song / settings/*
        Root layout mounts the ONE app-wide <audio>: src/routes/+layout.svelte (ssr=false SPA)
   ▼ components read stores, call store methods
COMPONENTS  src/lib/components/   NowPlaying (1652L) · Nowbar · TrackMenu · CompactRow · …
            ACTIONS src/lib/actions/  lazyCover · tapBounce · longpress · coverSwipe · dragClose …
   ▼ reactive $state reads + method calls (no prop drilling)
STORES  src/lib/stores/*.svelte.ts   player (central, ~3017L) · library · settings (leaf) · history ·
        names · overlays · cover-version · sleepTimer · online · searchSession · toast · actionLog
   ▼ pure/async function calls
SERVICES  src/lib/services/ (pure .ts, node-testable)  catalog (searchAll / ensureTrackDetails) ·
          dedupe · discovery · picks · similar · cover-backfill · cover-cache · deezer · itunes-cover ·
          lastfm · lrc · media-session · blob-store · score-match · fallback · …
   ▼ SourceAdapter.search()/resolve() via registry
SOURCES  src/lib/sources/   netease · qq · kuwo · joox · fivesing · jamendo · audius   (registry.ts)
   ▼ fetch same-origin /api/*
API PROXY (Cloudflare Workers, edge)  src/routes/api/   [source]/[...path] catch-all (netease/qq/kuwo/joox)
          + deezer/* · lastfm/* · similar · translate · audius · jamendo · fivesing
          CORS seam: src/hooks.server.ts ; JOOX_TOKEN injected edge-side only
   ▼
UPSTREAMS  CN music proxies, Deezer, iTunes, Last.fm, translate APIs + native <audio> + IndexedDB blob cache
```

## Key Files

| Concern | File |
|---------|------|
| App boot / the single `<audio>` (mounted once, survives nav); `player.attach()` + `player.restore()` | `src/routes/+layout.svelte` |
| App shell — tab nav, Nowbar/NowPlaying mount, toast host, offline banner; `library.load()`/`settings.load()`/`overlays.init()` | `src/routes/(app)/+layout.svelte` |
| Central playback engine (transport/queue state, resolve→play, cross-source fallback, never-stop guard, prefetch, media session, persistence) | `src/lib/stores/player.svelte.ts` |
| Search fan-out `searchAll()` + lazy `ensureTrackDetails()` | `src/lib/services/catalog.ts` |
| The ONLY client source-adapter enumeration | `src/lib/sources/registry.ts` |
| `Track` / `SourceAdapter` / `makeUid()` contracts | `src/lib/sources/types.ts` |
| Edge proxy catch-all (validates source, injects JOOX token edge-side) | `src/routes/api/[source]/[...path]/+server.ts` |
| Single CORS seam for every `/api/*` (allowlisted origin, never `*`) | `src/hooks.server.ts` |
| Settings defaults + `QueueContext` type (single source of truth) | `src/lib/config/defaults.ts` |

## Pattern Overview
- **Svelte 5 runes everywhere.** Stores are plain classes with `$state`/`$derived` fields, instantiated ONCE and exported as a singleton. Components read `player.current` directly and re-render — no `writable`/subscribe, no prop drilling. This replaces the legacy imperative-renderer model entirely.
- **`.svelte.ts` (runes) vs `.ts` (pure) split is deliberate and load-bearing** — pure logic stays node-testable under the single Vitest server project (no jsdom). The `cover-version.svelte.ts` / `cover-cache.ts` pair is the canonical "wrap, don't rewrite" example.
- **Registry-driven sources.** Adding a source = one client adapter (`src/lib/sources/<id>.ts`) + one proxy (`src/lib/proxy/<id>.ts`) + one registry line. Aggregation code NEVER names a source.
- **Lazy resolution.** Search returns lightweight `Track` stubs (`audioUrl:null, detailsLoaded:false`); `ensureTrackDetails()` resolves URL + lyrics on first play.
- **Generation guards** protect every async path against supersedence.
- **Client-rendered SPA** (`ssr=false`+`prerender=false`, required for the Capacitor static build); dual-adapter build switch swaps `adapter-cloudflare` → `adapter-static` on `BUILD_TARGET=native`.

## Key Abstractions
- **`Track`** (`src/lib/sources/types.ts`): one song in two phases — stub (post-search) and enriched (post-resolve). Identity `uid = ${source}:${songid}` (COLON form) via `makeUid()`; `displayIndex` is ORDERING ONLY, never identity.
- **Queue model:** `player.queue: Track[]` + `queueContext` (which surface started it) + `upNextAnchorUid`. Install via `setQueue()`/`setListQueue()`; manual inserts `playNext()`/`addToQueue()`; auto-grow `ensureAhead()`/regenerate.
- **Cover cache** (`src/lib/services/cover-cache.ts`, localStorage `openmusic:cover-cache:v1`): three disjoint key families in one flat record — `uid:<colon-uid>` (exact song) · `<matchKey>` (name layer, cross-uid bridge) · `artist:<matchKey>`. Read order everywhere: uid → name → null. `cover-version.svelte.ts` adds the reactive `coverVersion()` signal.
- **Cover resolution chain:** Deezer (`/api/deezer/search`) → iTunes (CORS-open) → CN (`searchAll → dedupeBest[0].cover`), first SOLID https wins; a resolve writes both cache layers + bumps version so tiles repaint live. **Self-heal:** a cover that errors while rendering triggers `healCover(uid)` (evict + re-resolve, one-shot per `${uid}|${url}`).
- **Generation guards:** `playGen` (bumped per `play()`; every await re-checks + bails a stale resolve), `queueGen` (per `setQueue()`), `pendingGen` (`playStub` overlay), `fallbackGen` (one cross-source failover per generation).

## The Audio Playback Lifecycle
1. `play()` sets `current`/`loading`/`resolvedCover` synchronously, bumps `playGen`, records history.
2. Offline-first: if `library.isDownloaded(uid)` and a blob exists, `audio.src = createObjectURL(blob)` and skip network.
3. Else `await ensureTrackDetails(track)`; gen-check; adopt cover; persist.
4. Set `audio.src`, `armStall()` (load watchdog), `audio.play()`; `prefetchNext()` arms the next track (gapless).
5. `playing` event = real output → reset failure counters, clear notice.
6. `error` → single same-src re-resolve, then cross-source `runFallback` (advance PAST a dead URL).
7. `ended` → `next()` (repeat-one loops; else advance / auto-grow).

## Architectural Constraints
- **Threading:** single-threaded event loop; all I/O is `async/await`. No Web Workers (`service-worker.ts` is PWA caching only).
- **Circular imports:** avoided by discipline — `settings` is a LEAF; `player` imports settings/library/history/names/actionLog one-way.
- **Runes files:** anything using `$state`/`$derived`/`$effect` MUST be `*.svelte.ts` or `*.svelte`; pure logic stays `.ts`.
- **Secrets:** `JOOX_TOKEN`, `LASTFM_SECRET` live ONLY in Cloudflare `platform.env`, injected edge-side in proxy adapters — never in the client bundle.
- **Audio engine:** native HTML `<audio>` (`referrerpolicy=no-referrer`); `src` set directly to a CDN or `blob:` URL. No MediaSource/HLS/Web Audio.
- **CORS:** all `/api/*` get allowlisted CORS via `hooks.server.ts` — never `*`.
- **SSR:** disabled app-wide; every store/service touching `localStorage`/`window`/`document` is `browser`-guarded.

## Anti-Patterns (known debt)
- **`player.svelte.ts` is a ~3017-line god object** — transport, queue, fallback, never-stop guard, prefetch, media session, cover self-heal, persistence in one class. Extract cohesive slices into pure services the store thin-calls (the media-session slice already models this).
- **`NowPlaying.svelte` at 1652 lines** — a re-render hotspot; split lyrics pane / up-next / transport into children that each subscribe to only the `$state` they need.
- **Cover-cache write duplication** — the https-only guard + write-both-layers + bump sequence is replicated across several call sites; route every writer through `cover-version.svelte.ts` `writeCoverBoth`.

## Error Handling
- **Strategy: isolate-and-degrade** — no error stops the app or the never-stop playback chain. Per-source search isolation (`Promise.allSettled`); cover chain per-tier never-throw (total miss leaves a gradient); playback never-stop routes a dead URL through single-retry → cross-source `runFallback` → skip, with a `FAILURE_CAP=5` loop-guard tripping a sticky Retry notice. localStorage access always try/catch. Store→UI errors surface via reactive fields (`player.error`, `player.notice`) read one-way by the layout toast host.

## Cross-Cutting Concerns
- **Logging:** verbose player action log via `logAction()` (`src/lib/stores/actionLog.svelte.ts`), viewable at Settings → Activity log; never on the `timeupdate` firehose.
- **i18n:** runes-based `t()` (`src/lib/i18n/index.ts`) reads `settings.appLang` reactively; 16 dictionaries; `en` defines `TranslationKey` (missing keys are compile errors).
- **Media Session:** OS lock-screen integration via `services/media-session.ts` (web) + `native-media-session.ts` (Capacitor), driven from the player store.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
