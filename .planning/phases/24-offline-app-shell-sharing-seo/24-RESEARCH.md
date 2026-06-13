# Phase 24: Offline App-Shell & Sharing/SEO - Research

**Researched:** 2026-06-13
**Domain:** SvelteKit native service worker (offline app-shell) + per-route SSR OG/SEO on Cloudflare Pages, dual-adapter (Cloudflare/Capacitor) constraint
**Confidence:** HIGH (SvelteKit SW + per-route SSR mechanics verified against official docs; codebase seams read directly) / MEDIUM (iOS Safari PWA quirks; CJK slug library choice) / LOW (none material)

## Summary

Phase 24 ships two independent infra capabilities that should be planned as **two separate waves/spikes** (the roadmap suggests this; the only shared file they touch is `+layout.ts`/build config, and even that is minimal). Research confirms the central feasibility assumptions in `24-CONTEXT.md` hold:

1. **Offline half (OFFL-01..03):** SvelteKit's native `src/service-worker.ts` convention is the right tool (not vite-pwa, per the locked decision). The `$service-worker` module exports `build`, `files`, `prerendered`, and `version`; `version` is a hash that changes on every build, so a `cache-${version}` name + an `activate` handler that deletes non-matching caches gives free stale-shell eviction on deploy `[CITED: svelte.dev/docs/kit/service-workers]`. The `/api/*` + audio-CDN bypass is a one-line early-return in the `fetch` handler. **OFFL-02 needs ZERO service-worker involvement** — downloaded songs already play offline today via `blobStore.get(uid)` → `URL.createObjectURL` in `player.svelte.ts` (verified in code, lines 377-451, 1379-1477). **OFFL-03 already has a working offline branch** in the player (`handleOffline()`, `runFallback` offline gate) and a pure `buildOfflineQueue()` builder; OFFL-03's net-new work is per-surface inline offline states + a reactive online/offline store, NOT plumbing.

2. **Sharing/SEO half (SHARE-01..03):** The riskiest assumption — "a child route can re-enable SSR while the root layout has `ssr = false`" — is **CONFIRMED by official docs**: "Child layouts and pages override values set in parent layouts" `[CITED: svelte.dev/docs/kit/page-options]`. So `export const ssr = true` in an entity route opts that subtree back into SSR. The album/artist `+page.ts` loads already build `og`; they just need `ssr = true` added and an SSR-safe `+page.svelte` (the real risk — see Pitfall 4). `buildOg`, `PageOg.svelte`, base64url `?play=` token (`btoa`/`atob` work in Workers) all exist and are reused.

**Primary recommendation:** Plan two waves. **Wave A (Offline):** add `src/service-worker.ts` (version-keyed precache + `/api/*`/audio bypass), add a reactive `online` store, add per-surface inline offline empty-states. **Wave B (SEO/Share):** add `export const ssr = true` to entity routes, render `PageOg` SSR-side, add a `/song/[slug]` SSR entity route (or reuse `?play=` landing), add a CJK→ASCII slugifier. **Guard both halves against the `BUILD_TARGET=native` adapter-static build** — this is the single hardest constraint and is addressed concretely below.

> **CRITICAL DISCREPANCY for the planner:** `24-CONTEXT.md` and the dispatch brief repeatedly say the static build is gated by `BUILD_TARGET=static`. **The actual code uses `BUILD_TARGET=native`** (`svelte.config.js` line 10: `process.env.BUILD_TARGET === 'native'`; `package.json` `build:native` script). All guards must check `BUILD_TARGET=native`, not `static`. `[VERIFIED: codebase grep — svelte.config.js, package.json]`

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| App-shell precache + offline boot (OFFL-01) | Browser / Service Worker | CDN / Static | SW intercepts navigation + asset requests; static build emits the shell files the SW caches |
| `/api/*` + audio-CDN cache bypass (OFFL-01) | Browser / Service Worker | — | A fetch-handler early-return; nothing server-side decides this |
| Offline playback from downloads (OFFL-02) | Browser / App layer (player + IndexedDB) | — | Already pure app-layer: `blobStore.get` → `createObjectURL`. **No SW role.** |
| Online/offline detection + inline degraded states (OFFL-03) | Browser / App layer (reactive store + per-surface UI) | — | `navigator.onLine` + `online`/`offline` events, consumed by route components |
| Per-entity OG/SEO HTML (SHARE-01/03) | Frontend Server (SSR at edge) | CDN (crawler fetches) | Crawlers don't run JS — the `<svelte:head>` tags must be in server HTML |
| Readable share-link slug + decode (SHARE-02) | Browser (build URL) + Frontend Server (decode `+page.ts`) | — | Slug built client-side on share; id decoded in universal `load` (runs both sides) |
| OG image URL selection (SHARE-01) | Frontend Server (SSR) | CDN (image hosting) | `buildOg` picks https cover or `/og.svg` fallback at load time |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Per-route SSR subtree, NOT a global SSR flip. Root `src/routes/+layout.ts` keeps `ssr = false`; only entity routes opt back in.
- **D-02:** Entity routes that get SSR: `(app)/album/[name]`, `(app)/artist/[name]`, and a song-share surface (research/planner decides: dedicated `(app)/song/[...]` SSR route vs SSR share-landing).
- **D-03:** SSR must be Cloudflare-only and must NOT break the `adapter-static` Capacitor SPA build. Server routes / `ssr=true` must be guarded/absent in the `BUILD_TARGET=native` build. **Hard constraint — verify both builds.**
- **D-04:** URL pattern: readable ASCII slug + stable id, e.g. `/song/qing-fei-de-yi-qq123` (`/{type}/{slug}-{source}{id}`). The `{source}{id}` is the authoritative decode key; slug is cosmetic, ignored on decode.
- **D-05:** CJK titles slugified to ASCII (pinyin or transliteration/strip). Links never percent-encoded CJK.
- **D-06:** Keep the existing base64url `?play=` payload (`share.ts` v2: current track + capped queue, QUEUE_CAP=30) as the optional queue carrier layered on top of the readable path. Do not embed expiring audio URLs.
- **D-07:** OG image = resolved cover CDN URL when solid https, else static `/og.svg` fallback. Reuse `buildOg`. No new edge image rendering.
- **D-08:** Edge-composed OG cards deferred to backlog.
- **D-09:** Per-surface inline offline states + promote Downloads. Global offline indicator; each online-only screen renders an inline offline empty-state; Library/Downloads stay usable. No forced redirect.
- **D-10:** Avoid stuck loaders / dead screens offline; offline-aware surfaces short-circuit to their inline offline state. Keep it simple — "don't bloat."
- **Locked:** Native service worker at `src/service-worker.ts` (SvelteKit convention), NOT vite-pwa.

### Claude's Discretion
- SW precache manifest contents (app-shell-only vs shell + key static); version-keying / activate-eviction mechanism; runtime cache strategy boundaries (the `/api/*` + audio bypass is locked; the rest is implementation).
- iOS Safari PWA + SW + background-audio interaction specifics.
- Exact slugify algorithm (pinyin lib vs transliterate-and-strip) — D-05 locks ASCII-readable, not the library.
- Whether song sharing needs a dedicated `(app)/song/[...]` SSR route vs an SSR share-landing.

### Deferred Ideas (OUT OF SCOPE)
- Edge-composed OG cards (cover + title/artist overlay at the edge) — backlog (D-08).
- Background offline sync / pre-download of "up next" while online — OFFL-02 is play-what's-already-downloaded only.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OFFL-01 | App shell loads offline via SW; never caches `/api/*` or audio CDN; evicts stale shells on deploy | SvelteKit `$service-worker` `version`-keyed `cache-${version}` + `activate` eviction (CITED official docs). `/api/*` + audio bypass = fetch-handler early-return. Build emits `build`/`files` for precache. |
| OFFL-02 | Downloaded songs playable end-to-end offline | ALREADY WORKS — `player.svelte.ts` reads `blobStore.get(uid)` → `createObjectURL` before CDN (verified lines 377-451, 1379-1477). No SW needed; verify path holds with SW present. |
| OFFL-03 | Online-only surfaces degrade gracefully; offline state, downloads promoted, no dead screens/stuck loaders | Player already has `handleOffline()` + offline gate + `buildOfflineQueue()`. Net-new: a reactive `online` store (`navigator.onLine` + `online`/`offline` events) consumed by route components for inline empty-states. |
| SHARE-01 | Share link OG metadata describes THAT entity, server-rendered for crawlers | Per-route `ssr = true` (child overrides root, CITED) + existing `buildOg` + `PageOg.svelte`. Album/artist `+page.ts` already produce `og`. |
| SHARE-02 | Short recognizable links (readable slug + stable id), replacing opaque token | Extend `share.ts` `slugify` (currently CJK-preserving — must change to ASCII per D-05). New `/{type}/{slug}-{source}{id}` route(s); `?play=` retained as queue carrier (D-06). |
| SHARE-03 | Every page carries proper SEO meta (title/description/canonical) | Root `+layout.svelte` already emits site-default title/description/canonical + OG fallback. SSR subtree makes entity-specific tags crawler-visible. Non-entity pages: client-rendered meta is fine (see Pitfall 6). |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@sveltejs/kit` | 2.63.0 (installed; 2.65.0 latest) | Native service worker via `src/service-worker.ts` + `$service-worker` module; per-route `ssr` page option | Framework-native; no extra dep. `[VERIFIED: npm registry]` installed version from package.json |
| `@sveltejs/adapter-cloudflare` | 7.2.8 (installed, latest) | Edge SSR for entity routes (Workers runtime) | Already the default adapter. `[VERIFIED: npm registry]` |
| `@sveltejs/adapter-static` | 3.0.10 (installed) | `BUILD_TARGET=native` SPA build — must keep emitting a pure SPA with no server routes | Already installed; the dual-adapter constraint owner. |

### Supporting (CJK→ASCII slug — pick ONE; all ASSUMED until user confirms)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pinyin-pro` | 3.28.1 | Convert CJK title → pinyin (readable, e.g. 情非得已 → `qing-fei-de-yi`) | Best readability for the D-04 example. ~930 KB unpacked but tree-shakeable; pure JS, Workers-safe (no native binding). `[ASSUMED]` — pure-JS confirmed via repo, not slop-verified |
| `transliteration` | 2.6.1 | General Unicode→ASCII transliteration (handles CJK + other scripts) | If you want one lib for all scripts, not just Chinese. Smaller, less Chinese-accurate. `[ASSUMED]` |
| (none — strip-to-id) | — | Drop non-ASCII entirely, slug becomes just the id segment when title is all-CJK | Zero-dep, smallest. D-04 says slug is cosmetic — a CJK-only title degrades to `/song/-qq123`, still works. **Recommended default if bundle size matters** |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native `src/service-worker.ts` | `vite-plugin-pwa` / Workbox | LOCKED OUT by decision. vite-pwa adds a build dep + its own SW lifecycle that fights the dual-adapter build; native SW is one file + `$service-worker`. |
| `pinyin-pro` | Strip-to-id (no lib) | Strip is zero-dep and Worker-light but yields blank slugs for all-CJK titles (still functional — id is authoritative). pinyin gives nicer URLs at a bundle cost. **Recommend strip-to-id default; pinyin-pro if the team wants pretty CJK URLs.** |
| Edge OG card image | Static `/og.svg` + raw cover URL | LOCKED to fallback-or-cover (D-07/D-08). No `@cloudflare/pages-plugin-vercel-og` / satori this phase. |

**Installation (only if pinyin chosen):**
```bash
pnpm add pinyin-pro
```
*(If strip-to-id is chosen, NO new dependency — extend `share.ts` `slugify` only.)*

**Version verification:** `@sveltejs/kit@2.65.0`, `@sveltejs/adapter-cloudflare@7.2.8`, `pinyin-pro@3.28.1`, `transliteration@2.6.1`, `slugify@1.6.9` all confirmed present on npm `[VERIFIED: npm view]`. Installed SvelteKit is 2.63.0 (2 minors behind; service-worker + page-options API is stable across these).

## Package Legitimacy Audit

> slopcheck was **not available** in this research session (no install attempted to avoid executing unverified tooling per documentation_lookup guidance). All net-new packages below are therefore tagged `[ASSUMED]` and the planner MUST gate any install behind a `checkpoint:human-verify` task. Note: the **recommended path (strip-to-id) adds NO new package** and sidesteps this entirely.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `pinyin-pro` | npm | mature (3.x) | high (widely used CN-tooling lib) | github.com/zh-lx/pinyin-pro `[VERIFIED: npm view repository.url]` | unavailable | `[ASSUMED]` — verify before install; gate behind checkpoint |
| `transliteration` | npm | mature (2.x) | high | github.com/dzcpy/transliteration | unavailable | `[ASSUMED]` — verify before install |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck not run).
**Packages flagged as suspicious [SUS]:** none.
**Preferred outcome:** strip-to-id (zero new packages) — no audit needed.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌──────────────────────────────────────────────┐
                          │              BROWSER (PWA / tab)               │
                          │                                                │
   user navigates ───────▶│  SvelteKit client router                      │
                          │        │                                       │
                          │        ▼                                       │
                          │  ┌─────────────────────┐                       │
   asset / nav request ──▶│  │  service-worker.ts  │  (OFFL-01)            │
                          │  │  fetch handler:     │                       │
                          │  │   ├ /api/* ?  ──────┼──── bypass ───────┐   │
                          │  │   ├ audio CDN? ─────┼──── bypass ───────┤   │
                          │  │   ├ in ASSETS? ─────┼─▶ cache-${version}│   │
                          │  │   └ else ───────────┼─▶ network→cache   │   │
                          │  └─────────────────────┘                   │   │
                          │        │ cache miss / online               │   │
                          │        ▼                                   ▼   │
                          │  online store (navigator.onLine) ──▶ inline    │
                          │   (OFFL-03)                          offline   │
                          │                                       state    │
                          │  player.svelte.ts ──▶ blobStore.get(uid)       │
                          │   (OFFL-02)            └▶ createObjectURL ▶▶ <audio>
                          └──────────�│──────────────────────│──────────────┘
                                     │ /api/* (proxy)        │ audio bytes (206)
                                     ▼                       ▼
                          ┌────────────────────┐   ┌────────────────────┐
                          │ Cloudflare Worker  │   │  source CDN (audio)│
                          │ /api/[source]/...  │   │  direct, never SW- │
                          │ (metadata proxy)   │   │  cached            │
                          └────────────────────┘   └────────────────────┘

   crawler / chat-app unfurl (SHARE-01) ─── GET /song|album|artist/<slug>-<id> ──▶
                          ┌──────────────────────────────────────────────┐
                          │       Cloudflare Worker (edge SSR)            │
                          │  entity route: export const ssr = true        │
                          │   +page.ts load → buildOg() → data.og         │
                          │   +page.svelte → PageOg → <svelte:head> OG    │
                          │  renders crawler-visible HTML  (NOT in native │
                          │  build — guarded so adapter-static = pure SPA)│
                          └──────────────────────────────────────────────┘
```

### Recommended Project Structure (net-new / changed files)
```
src/
├── service-worker.ts                      # NEW — OFFL-01 precache + bypass + version eviction
├── lib/
│   ├── stores/
│   │   └── online.svelte.ts               # NEW — OFFL-03 reactive navigator.onLine store
│   └── services/
│       └── share.ts                       # CHANGE — slugify→ASCII (D-05); add entity-link builder + parser
├── routes/
│   ├── +layout.ts                         # UNCHANGED — root stays ssr=false (D-01)
│   └── (app)/
│       ├── album/[name]/+page.ts          # CHANGE — add `export const ssr = true` (guarded)
│       ├── artist/[name]/+page.ts         # CHANGE — add `export const ssr = true` (guarded)
│       └── song/[slug]/+page.ts +page.svelte  # NEW (option A) — SSR song entity route (D-02)
└── (static SPA fallback for BUILD_TARGET=native must still build)
```

### Pattern 1: Version-keyed precache + activate eviction (OFFL-01)
**What:** Use `$service-worker`'s `version` (changes every build) as the cache name; delete all caches that don't match on `activate`.
**When to use:** Always — this is the canonical SvelteKit SW shape.
**Example (canonical, adapt the fetch handler for bypass):**
```typescript
// Source: svelte.dev/docs/kit/service-workers [CITED]
/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';

const self = globalThis.self as unknown as ServiceWorkerGlobalScope;
const CACHE = `cache-${version}`;            // version changes per build → new cache per deploy
const ASSETS = [...build, ...files];         // app bundle + static/

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);   // OFFL-01 stale-shell eviction on deploy
    }
  })());
});
```

### Pattern 2: `/api/*` + audio-CDN bypass in the fetch handler (OFFL-01, the locked requirement)
**What:** Return early (let the network handle it untouched) for cross-origin audio and own-origin `/api/*`.
**Why:** `/api/*` are live proxy calls (search/detail/lyrics) that must never be served stale; audio responses are huge + range-requested (206) and must stream directly to `<audio>` (PLAY-04 = browser→CDN direct).
```typescript
// Adapt the canonical fetch handler. CITED base + project bypass logic.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;                 // canonical: ignore non-GET
  const url = new URL(request.url);

  // BYPASS 1 — own-origin API proxy (never cache live metadata)
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;

  // BYPASS 2 — audio CDN bytes. Audio is cross-origin + range-requested (206).
  // Belt-and-suspenders: skip any cross-origin request AND any Range request.
  if (url.origin !== location.origin) return;           // crawler covers audio CDNs (cross-origin)
  if (request.headers.has('range')) return;             // range req (206) — never cache

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (ASSETS.includes(url.pathname)) {
      const hit = await cache.match(url.pathname);
      if (hit) return hit;
    }
    try {
      const res = await fetch(request);
      if (res.status === 200) cache.put(request, res.clone());
      return res;
    } catch {
      const hit = await cache.match(request);
      if (hit) return hit;
      throw new Error('offline and not cached');
    }
  })());
});
```
> **Note:** because audio is cross-origin (source CDNs) and `/api/*` is the only same-origin dynamic surface, `if (url.origin !== location.origin) return;` already excludes audio. The explicit `range` guard is defense-in-depth. Confirm in code that no audio is ever served same-origin (it is not — `player.svelte.ts` sets `audio.src` to the resolved CDN URL or a local `blob:` URL; `blob:` URLs never hit the SW fetch handler).

### Pattern 3: Per-route SSR opt-in while root is `ssr=false` (SHARE-01/03)
**What:** Child page/layout re-enables SSR.
**Confirmed:** "Child layouts and pages override values set in parent layouts" `[CITED: svelte.dev/docs/kit/page-options]`.
```typescript
// src/routes/(app)/album/[name]/+page.ts  (universal load already builds `og`)
export const ssr = true;     // overrides root +layout.ts `ssr = false` for THIS route only
export const prerender = false;
// existing load() unchanged — buildOg(...) result lands in SSR <svelte:head> via PageOg
```
**Use universal `+page.ts` with `ssr = true`, NOT `+page.server.ts`.** Reasons: (a) the existing `og` loads are universal and pure (`buildOg` is import-safe both sides); (b) `+page.server.ts` is a *server-only* file that the `adapter-static` build cannot emit — adding one would break `BUILD_TARGET=native` (Pitfall 5). `ssr=true` on a universal load gives crawler-visible HTML on Cloudflare while still degrading to CSR in the static build (where the universal load just runs client-side).

### Pattern 4: Reactive online/offline store (OFFL-03)
```typescript
// src/lib/services/online.svelte.ts  (or stores/) — SSR-guarded runes singleton
import { browser } from '$app/environment';

class Online {
  isOnline = $state(browser ? navigator.onLine : true);   // SSR/prerender → assume online
  init() {
    if (!browser) return () => {};
    const on = () => (this.isOnline = true);
    const off = () => (this.isOnline = false);
    addEventListener('online', on);
    addEventListener('offline', off);
    this.isOnline = navigator.onLine;
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }
}
export const online = new Online();
```
Consumed by online-only surfaces (search, charts, artist, album discovery) to short-circuit to an inline offline empty-state (D-09/D-10) instead of firing a fetch that hangs. `navigator.onLine` is a coarse signal (true ≠ guaranteed reachable) but is exactly what "don't bloat" (D-10) calls for; pair the inline state with the existing `try/catch` fetch failure handling.

### Anti-Patterns to Avoid
- **Caching `/api/*` or audio in the SW** — explicitly forbidden by OFFL-01; would serve stale metadata and break range-streamed audio.
- **Global `ssr=true` flip** — forbidden by D-01; would break the native SPA build and force every store to be SSR-safe.
- **Adding a `+page.server.ts` to an entity route** — breaks the `adapter-static` (`BUILD_TARGET=native`) build (no server routes allowed). Use universal `+page.ts` + `ssr=true`.
- **vite-pwa / Workbox** — locked out; fights the dual-adapter build.
- **Percent-encoded CJK in the share path** — D-05 forbids; slugify to ASCII.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| App-shell precache + cache versioning | Custom Workbox config / manual file list | `$service-worker` `build`/`files`/`version` + canonical install/activate | SvelteKit injects the exact build manifest + a per-build hash; hand-rolling drifts from the real output |
| Stale-cache eviction on deploy | Manual cache-busting query strings | `version`-keyed cache name + `activate` delete-others | `version` already changes every build (CITED); free, correct eviction |
| Offline playback of downloads (OFFL-02) | New SW caching of audio / Cache API audio store | Existing `blobStore` + `createObjectURL` path in `player.svelte.ts` | ALREADY SHIPPED and verified; the SW must NOT touch audio |
| Offline up-next while offline | New offline queue logic | Existing `buildOfflineQueue()` + `player.handleOffline()` | Already pure + wired (downloads-queue.ts) |
| OG tag rendering | New head component | Existing `PageOg.svelte` + root layout `{#if !page.data?.og}` gate | Already escapes attribute bindings (T-gln-02); just needs SSR to reach crawlers |
| Share token encode/decode | New serialization | Existing `share.ts` v2 base64url (`btoa`/`atob` Workers-safe) | Already capped (QUEUE_CAP=30), pure, server-importable |

**Key insight:** ~70% of Phase 24 is *wiring + guarding existing primitives*, not net-new code. The two genuinely new artifacts are `src/service-worker.ts` and the entity share route + ASCII slugifier. Everything else (offline playback, offline queue, OG building, token codec) already exists and was read in this session.

## Runtime State Inventory

> SHARE-02 changes the share-link *shape*. This is a URL-contract change, so old links in the wild matter.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Library lives in `localStorage` `openmusic:library:v1`; downloads blobs in IndexedDB `openmusic-blobs` (store `tracks`, key=uid). **Neither stores share URLs** — share links are ephemeral, not persisted. | None — no migration |
| Live service config | No external service stores the slug shape. Cloudflare Pages serves whatever routes exist. `static/sitemap.xml` lists `/`, `/search`, `/library`, `/settings` only (no entity URLs). | Optionally add entity routes to sitemap (SHARE-03 nicety, not required) |
| OS-registered state | PWA `manifest.webmanifest` `start_url: "/"`, `scope: "/"` — unaffected by new routes (scope covers them). | None |
| Secrets/env vars | `BUILD_TARGET` (build-time, value `native`), `VITE_API_BASE` (native build → `https://openmusic.lol`). No secret references the slug/SW. | None — but every guard must read `BUILD_TARGET === 'native'` (NOT `static`) |
| Build artifacts | Old `cache-${version}` SW caches in users' browsers will be auto-evicted by the new SW's `activate` on first load. Capacitor `build/` SPA output must still be a pure SPA. | Verify both `pnpm build` and `pnpm build:native` succeed |
| Existing share links | Current links are `/?t=<slug>&play=<payload>` on the HOMEPAGE (`shareUrl` in share.ts). The new `/{type}/{slug}-{id}` is a NEW shape. | **Old `/?play=` links MUST keep working** — `(app)/+page.ts` already decodes `?play=`; do not remove it (D-06 keeps `?play=` as queue carrier). New shape is additive. |

**Backward-compat contract (verified):** `(app)/+page.ts` decodes `?play=` and `decodeShare` accepts both v2 and legacy v1 tokens (share.ts lines 106-127). The new entity routes are additive; the homepage `?play=` path is untouched. No breakage.

## Common Pitfalls

### Pitfall 1: Service worker breaks the `adapter-static` (Capacitor) build
**What goes wrong:** A `src/service-worker.ts` is emitted by BOTH adapters. In the Capacitor native shell (file:// or capacitor:// origin), a web SW registering against `location.origin` may misbehave or be unnecessary (Capacitor has its own native shell + offline file serving).
**Why it happens:** SvelteKit auto-registers the SW whenever `src/service-worker.ts` exists, for any adapter.
**How to avoid:** Two options — (a) guard registration: set `kit.serviceWorker.register` conditionally in `svelte.config.js` (`register: process.env.BUILD_TARGET !== 'native'`) so the native build never auto-registers the web SW `[CITED: svelte.dev/docs/kit/service-workers — register option]`; or (b) inside `service-worker.ts`, no-op when `build.length === 0`. **Recommend (a)** — cleanest, keeps the native shell purely native. Confirm `kit.serviceWorker.register: false` still lets the file exist without registering.
**Warning signs:** SW errors in the Capacitor WebView console; offline assets served from the wrong origin.

### Pitfall 2: `version` doesn't change → stale shell never evicts
**What goes wrong:** If `config.kit.version.name` is pinned to a constant, `version` (and thus `cache-${version}`) never changes, so `activate` never deletes the old cache and users get a stale shell forever.
**Why it happens:** Misunderstanding that `version` defaults to a content hash. By default SvelteKit derives `version` from a timestamp/hash that changes per build `[CITED: svelte.dev/docs/kit/service-workers]`.
**How to avoid:** Leave `kit.version` at its default (do NOT pin it), OR set `kit.version.name` to `Date.now().toString()` / a git SHA in `svelte.config.js` so every Cloudflare Pages deploy gets a fresh value. Verify by building twice and diffing the cache name.
**Warning signs:** After a deploy, users still see old UI; DevTools → Application → Cache Storage shows one stale `cache-*` entry that never rotates.

### Pitfall 3: Cloudflare Pages serves the SW with caching that delays updates
**What goes wrong:** If `/service-worker.js` itself is cached long by the browser/CDN, users won't fetch the new SW promptly, delaying eviction.
**Why it happens:** Cloudflare Pages does not cache HTML by default but DOES set long `Cache-Control` for hashed `_app/*` assets `[CITED: WebSearch — svelte.dev adapter-cloudflare + community]`. The SW script is served at a stable path (`/service-worker.js`), and browsers cap SW script caching at 24h max by spec, but a CDN `immutable` header could interfere.
**How to avoid:** Cloudflare Pages + SvelteKit's generated `_headers` handle `_app/*` immutability correctly out of the box; the SW script is NOT under `_app/`. Browsers bypass HTTP cache for SW updates after 24h regardless. No action needed in the common case — but verify with `wrangler pages dev .svelte-kit/cloudflare` (the project's `pnpm preview`) that `/service-worker.js` is served with a short/no-store cache. Add a `_headers` rule for `/service-worker.js` (`Cache-Control: no-cache`) only if the dev verification shows a long TTL.
**Warning signs:** SW updates lag a deploy by hours; `navigator.serviceWorker.controller` reports an old script URL hash.

### Pitfall 4: Entity `+page.svelte` is NOT SSR-safe → SSR build/render crashes
**What goes wrong:** Adding `ssr = true` to `album/[name]/+page.ts` makes `album/[name]/+page.svelte` render on the server. That component imports `player`, `library`, `settings`, `overlays`, `names` stores at module top (verified) and uses many client-only actions (`dragClose`, `longpress`, `swipeAction`, `lazyCover`). If any of these touch `window`/`document`/`navigator`/`IndexedDB` at module-eval or component-init time (not inside `onMount`/`$effect`/`browser` guards), SSR throws.
**Why it happens:** The whole app was built `ssr=false`, so component code was never exercised server-side. The `.svelte.ts` store singletons are constructed at import time.
**How to avoid (this is the real work of SHARE-01):**
  - Verified GOOD: `player.svelte.ts`, `library.svelte.ts`, `blob-store.ts` all guard with `import { browser } from '$app/environment'` and do browser work in methods called from `onMount`/`$effect`/`init()`, not at module top. Store *construction* (the `class { ... = $state() }`) is SSR-safe (runes work server-side; `$state` is fine in SSR).
  - RISK: Svelte `use:` actions (`dragClose`, `longpress`, etc.) only run client-side (actions never run during SSR) — safe. But any top-level `const x = localStorage.getItem(...)` in a `+page.svelte` `<script>` would crash. Audit each entity `+page.svelte` `<script>` top-level for direct `window`/`document`/`localStorage`/`navigator` access.
  - Strategy: render a minimal SSR shell. The crawler only needs `<svelte:head>` (PageOg) + basic title/text. Wrap interactive/client-only subtrees in `{#if browser}` or move their setup into `onMount`. Consider a thin SSR-rendered header (title/cover) + a CSR-hydrated body.
  - **Concrete recommendation:** For the **song** share surface (D-02), create a NEW minimal `(app)/song/[slug]/+page.svelte` that renders ONLY the OG head + a static entity card + a "play" CTA, and is SSR-safe by construction — rather than retrofitting the heavy album/artist pages first. For album/artist, do the SSR-safety audit as a discrete task with a verification step (`pnpm build` + crawler curl).
**Warning signs:** `ReferenceError: window is not defined` / `document is not defined` / `localStorage is not defined` during `pnpm build` or on first edge render; 500 from the Worker on the entity route.

### Pitfall 5: `+page.server.ts` or server-only imports break `BUILD_TARGET=native`
**What goes wrong:** `adapter-static` with `fallback: 'index.html'` cannot emit server routes. Any `+page.server.ts`, `+server.ts` reached by a static route, or `$app/server` import fails `vite build` under `BUILD_TARGET=native`.
**Why it happens:** Static SPA = no server runtime.
**How to avoid:** Use universal `+page.ts` + `ssr=true` ONLY (Pattern 3). `ssr=true` on a universal load is harmless to adapter-static — in the static build the load just runs client-side (SSR is effectively ignored because there's no server to render on; the fallback `index.html` is shipped). **Verify both builds in a single task:** `pnpm build` (Cloudflare, SSR entity routes present) AND `pnpm build:native` (static SPA, must succeed). The brief's `BUILD_TARGET=static` is wrong — it's `native`.
**Warning signs:** `build:native` errors about prerendering/server routes; static build tries to prerender an entity route and fails on a dynamic param.

### Pitfall 6: Expecting crawler-visible SEO on non-SSR pages
**What goes wrong:** SHARE-03 says "every page" carries SEO meta. But only the SSR-subtree routes emit crawler-visible meta; `ssr=false` pages (search, library, settings, charts) ship a near-empty HTML body — crawlers see only the root layout's site-default title/description/canonical (which ARE in `app.html`/root layout `<svelte:head>`, rendered... no — root layout is also `ssr=false`).
**Why it happens:** With root `ssr=false`, even the root `+layout.svelte` `<svelte:head>` (site title/description/canonical) does NOT render to server HTML — it's client-only. So a crawler hitting `/search` sees only what's hard-coded in `app.html` (`viewport`, manifest, theme-color, the CF analytics script) — NO title/description.
**How to avoid:** Reconcile SHARE-03 with D-01. Realistic interpretation: (a) entity routes (SSR subtree) get full crawler-visible per-entity meta; (b) for the generic shell pages, put a **static default `<title>` + `<meta name="description">` + canonical directly in `app.html`** so even the pure-SPA pages have baseline crawler-visible SEO without any SSR. This satisfies "every page carries proper SEO meta" at the HTML level. **Surface this to the planner: "every page" cannot mean per-page-dynamic SSR meta on `ssr=false` routes without flipping D-01 — the achievable target is per-entity SSR meta + a static site-default in `app.html`.** Confirm with the user if dynamic meta on shell pages is actually required (it usually isn't — those pages aren't shared/unfurled).
**Warning signs:** `curl -A "facebookexternalhit" https://site/search` returns HTML with no `<title>`/`og:*`.

### Pitfall 7: iOS Safari PWA + SW + background-audio quirks
**What goes wrong:** On iOS standalone PWAs: Cache API quota is small (~50 MB) and script-writable storage can be evicted after ~7 days of non-use; SWs run but have very restricted background execution; background audio has a history of WebKit bugs.
**Why it happens:** WebKit's aggressive storage eviction + suspension policy.
**How to avoid:** App-shell precache is small (HTML/JS/CSS, well under 50 MB) — safe. Do NOT rely on the SW for audio (OFFL-02 uses IndexedDB blobs, which have a larger quota than Cache API but are ALSO subject to the 7-day eviction on iOS for non-installed PWAs — flag this as a known limitation, not a Phase 24 regression). Background audio is driven by the `<audio>` element + MediaSession (already shipped, PLAY-05), independent of the SW. Test matrix: installed iOS PWA cold-start offline (shell loads), play a downloaded track offline, lock screen mid-play (audio continues — existing behavior), force-quit + reopen offline.
**Warning signs:** Downloaded blobs vanish after a week on iOS; offline shell fails to load after long disuse on iOS (storage evicted) — both are WebKit platform behavior, document as known constraints.

## Code Examples

### Build the readable entity share URL (SHARE-02, extend share.ts)
```typescript
// Source: derived from existing share.ts shareUrl + D-04 pattern. [ASSUMED — new code]
// /{type}/{slug}-{source}{id}  e.g. /song/qing-fei-de-yi-qq123
import { slugify } from '$lib/services/share'; // NOTE: change slugify to ASCII-only (D-05)

export function entityShareUrl(type: 'song' | 'album' | 'artist', t: { title: string; artist: string; source: string; songid: string }): string {
  const base = typeof location !== 'undefined' ? location.origin : '';
  const slug = slugify(t.title, t.artist);            // ASCII; may be '' for all-CJK if strip-to-id
  const id = `${t.source}${t.songid}`;                // authoritative decode key (D-04)
  const path = slug ? `${slug}-${id}` : id;
  return `${base}/${type}/${path}`;
}
```

### Parse the entity path back to a stable id (decode, SSR-safe / pure)
```typescript
// Source: derived. Slug is cosmetic; only the trailing <source><id> is authoritative (D-04). [ASSUMED]
// param looks like "qing-fei-de-yi-qq123" — split off the trailing source+id.
const SOURCE_RE = /-(netease|qq|kuwo|joox|kugou|migu)([A-Za-z0-9]+)$/;
export function parseEntityParam(param: string): { source: string; id: string } | null {
  const m = param.match(SOURCE_RE);
  return m ? { source: m[1], id: m[2] } : null;
}
```
> **Decision for the planner:** the authoritative key format `{source}{id}` must be robustly separable from the slug. The example regex anchors on the known source-id list. Alternative: encode as `-{source}-{id}` (extra dash) for cleaner splitting, e.g. `/song/qing-fei-de-yi--qq-123`. Confirm the exact delimiter before implementing — D-04's example `qq123` has no separator between source and numeric id, which works only if source names are a fixed enum (they are: netease/qq/kuwo/joox/kugou/migu).

### Slugify to ASCII (strip-to-id variant — zero dep, recommended default)
```typescript
// Source: derived from existing share.ts slugify (which currently PRESERVES CJK — must change). [ASSUMED]
export function slugify(title: string, artist: string): string {
  const raw = `${title ?? ''} ${artist ?? ''}`.trim().toLowerCase();
  return raw
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')                       // EVERYTHING non-ASCII-alnum → '-' (drops CJK)
    .replace(/-+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60).replace(/-+$/g, '');
}
// If pinyin-pro is chosen: run pinyin(title, { toneType:'none', type:'array' }).join(' ')
// through this same ASCII pipeline BEFORE the strip, so 情非得已 → "qing fei de yi" → "qing-fei-de-yi".
```
> **Behavior change to flag:** the EXISTING `share.ts` `slugify` deliberately PRESERVES CJK (lines 75-84, "CJK-safe: CJK codepoints are preserved"). D-05 REVERSES this — CJK must become ASCII. This is a contract change to an existing exported pure function with existing tests; the planner must update `slugify`'s tests and check all callers (`shareUrl`). Confirm no caller depends on CJK preservation.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| vite-plugin-pwa / Workbox for SW | SvelteKit native `src/service-worker.ts` + `$service-worker` | Stable since SvelteKit 1.0 | One file, no build plugin; locked by decision |
| `+page.server.ts` for SSR data | Universal `+page.ts` + `ssr=true` page option | Page-options stable | Keeps adapter-static build alive (no server-only files) |
| CJK-preserving slug (current share.ts) | ASCII slug (pinyin or strip) | This phase (D-05) | Readable, copy-paste-clean links; reverses current behavior |

**Deprecated/outdated:**
- Manual `navigator.serviceWorker.register` in app code — SvelteKit auto-registers from `src/service-worker.ts`; only override via `kit.serviceWorker.register` config.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pinyin-pro@3.28.1` / `transliteration@2.6.1` are legit, Workers-safe, pure-JS | Standard Stack | If native binding or slop → install fails / security; MITIGATED by recommending zero-dep strip-to-id default + checkpoint gate |
| A2 | iOS evicts IndexedDB blobs + Cache API after ~7 days non-use; ~50 MB Cache quota | Pitfall 7 | If wrong, offline reliability claims are off; sourced from multiple 2025-2026 PWA-limitation articles (MEDIUM) |
| A3 | `kit.serviceWorker.register` accepts a boolean to disable auto-registration per build | Pitfall 1 | If the option shape differs, native-build guard needs the in-SW `build.length===0` no-op fallback instead |
| A4 | Setting `ssr=true` on a universal `+page.ts` is harmless to the adapter-static build (load runs client-side, fallback shipped) | Pattern 3 / Pitfall 5 | If adapter-static errors on `ssr=true`, the song route must be excluded from the native build via route-group/config — MUST verify `pnpm build:native` |
| A5 | Album/artist `+page.svelte` have no top-level browser-API access that crashes SSR (only store imports, which are construction-safe) | Pitfall 4 | If they do, SSR render 500s — the SSR-safety audit task must precede flipping `ssr=true`; mitigated by recommending a fresh minimal `/song` route first |
| A6 | Cloudflare Pages does not long-cache `/service-worker.js` in a way that blocks updates | Pitfall 3 | If it does, add `_headers` `Cache-Control: no-cache` for the SW path — verify via `pnpm preview` |
| A7 | The `{source}{id}` key is unambiguously separable from the slug given the fixed source enum | Code Examples | If a source name ever becomes non-enum, the regex split breaks — recommend an explicit delimiter |

## Open Questions

1. **Song share surface: dedicated `/song/[slug]` route vs SSR share-landing? (D-02)**
   - What we know: album/artist already have routes + `og` loads. Songs are shared today via homepage `?play=`.
   - What's unclear: whether to add a new SSR `(app)/song/[slug]/+page.ts/.svelte` or make the homepage `?play=` route SSR.
   - Recommendation: **Add a minimal SSR `(app)/song/[slug]/+page.svelte`** (SSR-safe by construction, renders OG + entity card + play CTA, then optionally redirects/hydrates into the player). Cleaner than retrofitting the heavy homepage and avoids making `/` SSR. Keep `?play=` as the queue carrier appended to it (D-06).

2. **`slugify` ASCII strategy: pinyin lib vs strip-to-id?**
   - What we know: D-05 locks ASCII-readable, not the library. D-04's example (`qing-fei-de-yi`) is pinyin output.
   - What's unclear: whether the team wants pretty pinyin URLs (bundle cost + a dep) or accepts blank-slug-degrades-to-id (zero dep).
   - Recommendation: Default to **strip-to-id** (zero dep, ships immediately); offer `pinyin-pro` as a follow-up if pretty CJK URLs are desired. The example URL implies pinyin — confirm with user.

3. **SHARE-03 "every page" scope — does it require dynamic SSR meta on shell pages?**
   - What we know: root layout is `ssr=false`, so its `<svelte:head>` site-default does NOT reach crawlers (Pitfall 6).
   - Recommendation: Add static site-default `<title>`/`<meta description>`/canonical to `app.html` for baseline crawler SEO on all pages; reserve dynamic per-entity meta for the SSR subtree. Confirm shell pages don't need dynamic meta.

4. **`version` source on Cloudflare Pages — default hash vs git SHA?**
   - Recommendation: leave `kit.version` default (changes per build) OR pin to the CF Pages `CF_PAGES_COMMIT_SHA` env for determinism. Verify the cache name rotates across two deploys.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@sveltejs/kit` | SW + SSR page options | ✓ | 2.63.0 | — |
| `@sveltejs/adapter-cloudflare` | edge SSR | ✓ | 7.2.8 | — |
| `@sveltejs/adapter-static` | native SPA build (must keep working) | ✓ | 3.0.10 | — |
| `wrangler` | local SW/SSR verification (`pnpm preview`) | ✓ | 4.98.0 | — |
| `vitest` | unit tests for slugify/share/SW helpers | ✓ | 4.1.3 | — |
| `pinyin-pro` (if chosen) | CJK slug | ✗ | 3.28.1 (npm) | strip-to-id (zero dep) — **preferred** |
| Real iOS device | iOS PWA offline + background-audio validation | ? (manual) | — | Document as manual test; cannot automate |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `pinyin-pro` — fallback is the zero-dep strip-to-id slugifier (recommended default).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.3 |
| Config file | `vite.config.*` / vitest config (project uses `vitest`); existing tests colocated (`*.test.ts`) |
| Quick run command | `pnpm test:unit` (watch) / `pnpm test` (`vitest --run`) |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OFFL-01 | fetch handler bypasses `/api/*` + cross-origin/audio; caches ASSETS; version-keyed cache | unit (extract a pure `shouldBypass(url, request)` + `cacheNameFor(version)` helper from the SW) | `pnpm test src/lib/.../sw-cache.test.ts` | ❌ Wave 0 — extract SW logic into testable pure helpers |
| OFFL-02 | downloaded blob plays offline | existing path | covered by `player.svelte.test.ts` (blobStore stubbed) | ✅ (verify still green with SW present) |
| OFFL-03 | online store flips on `online`/`offline`; offline-only surfaces short-circuit | unit (store) | `pnpm test src/lib/services/online.test.ts` | ❌ Wave 0 |
| OFFL-03 | offline up-next builder | unit | existing `downloads-queue` builder | ✅ (buildOfflineQueue tested) |
| SHARE-01 | `buildOg` https-guard + fallback | unit | existing share.ts tests | ✅ (verify; extend for entity) |
| SHARE-01 | crawler sees OG in SSR HTML | integration (manual/curl) | `curl -A facebookexternalhit <url>` via `pnpm preview` | ❌ manual — document |
| SHARE-02 | ASCII slugify (incl. CJK→ascii or strip); entityShareUrl; parseEntityParam round-trip | unit | `pnpm test src/lib/services/share.test.ts` | ✅ exists — MUST update (CJK behavior reversed) + add entity tests |
| SHARE-03 | static site-default meta present in app.html; entity routes emit per-entity meta SSR | integration (curl) | manual | ❌ manual |
| Both | `pnpm build` AND `pnpm build:native` both succeed | build smoke | `pnpm build && pnpm build:native` | ❌ Wave 0 — add as a verification gate task |

### Sampling Rate
- **Per task commit:** `pnpm test src/lib/services/<changed>.test.ts`
- **Per wave merge:** `pnpm test` (full) + `pnpm build && pnpm build:native`
- **Phase gate:** full suite green + both builds green + manual crawler curl + manual iOS offline smoke before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Extract SW bypass + cache-name logic into a pure, importable helper (`src/lib/services/sw-cache.ts`) so OFFL-01 is unit-testable without a SW runtime; `service-worker.ts` becomes a thin caller.
- [ ] `src/lib/services/online.svelte.ts` (or `.ts` for the pure part) — OFFL-03.
- [ ] Update `src/lib/services/share.test.ts` for the reversed CJK→ASCII slug behavior + add `entityShareUrl`/`parseEntityParam` tests.
- [ ] Add a build-smoke gate task: `pnpm build && pnpm build:native` (the D-03 dual-adapter hard constraint).
- [ ] SSR-safety audit task for album/artist `+page.svelte` BEFORE flipping `ssr=true` (or sidestep with a fresh minimal `/song` route).

## Security Domain

> `security_enforcement` not present in config.json — treated as enabled (default). Phase 24 is mostly client/edge infra; the relevant ASVS surface is narrow.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth in this phase |
| V3 Session Management | no | No sessions; share links are stateless |
| V4 Access Control | no | Public content only |
| V5 Input Validation | yes | Validate the entity-route param (slug + id) before use; the existing `/api/*` proxy already validates `params.source` against `PROXIES` (404 unknown). Entity-param parse must reject malformed ids; `decodeShare` already bounds + validates the token (T-gln-01) |
| V6 Cryptography | no | base64url is encoding, not crypto — no secrets in share links (D-06: no expiring URLs, no tokens) |

### Known Threat Patterns for SvelteKit edge SSR + SW + share links
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Open redirect via slug/id param | Tampering | Decode reads id only against a fixed source enum; never `goto(rawParam)`. (App already defends this in `(app)/+layout.svelte` w87 redirect.) |
| XSS via OG/meta injection from track title | Tampering/Info disclosure | `PageOg.svelte` binds via `content={...}` (Svelte escapes attribute bindings), never `{@html}` — already enforced (T-gln-02). Keep entity OG values bound, not interpolated into raw HTML. |
| SSRF / data leak via SSR load fetching attacker-controlled URL | Info disclosure | Entity loads build OG from params + own data only; do NOT fetch arbitrary URLs server-side. `buildOg` only surfaces https cover URLs (isHttpsUrl guard). |
| Cache poisoning of `/api/*` via SW | Tampering | SW explicitly BYPASSES `/api/*` (OFFL-01) — never cached, so no poisoning surface. |
| DoS via oversized share token | DoS | `share.ts` QUEUE_CAP=30 + try/catch decode already bounds it (T-gln-01). |

## Sources

### Primary (HIGH confidence)
- `svelte.dev/docs/kit/service-workers` — `$service-worker` exports (build/files/version), canonical install/activate/fetch example, `kit.serviceWorker.register` option, non-GET ignore, version-based cache naming. `[CITED]`
- `svelte.dev/docs/kit/page-options` — child layouts/pages override parent page options (confirms per-route `ssr=true` over root `ssr=false`); static evaluation of boolean options; universal vs server load. `[CITED]`
- Codebase (read directly this session): `src/lib/services/share.ts`, `src/routes/+layout.ts`, `src/routes/+layout.svelte`, `svelte.config.js`, `package.json`, `src/lib/services/blob-store.ts`, `src/lib/services/downloads-queue.ts`, `src/lib/stores/player.svelte.ts` (offline + blob paths), `src/routes/(app)/+page.ts`, `album/[name]/+page.ts`, `artist/[name]/+page.ts`, `(app)/+layout.svelte`, `album/[name]/+page.svelte`, `src/app.html`, `static/manifest.webmanifest`, `static/robots.txt`, `static/sitemap.xml`, `api/[source]/[...path]/+server.ts`. `[VERIFIED: codebase]`
- npm registry: `@sveltejs/kit@2.65.0`, `@sveltejs/adapter-cloudflare@7.2.8`, `pinyin-pro@3.28.1`, `transliteration@2.6.1`. `[VERIFIED: npm view]`

### Secondary (MEDIUM confidence)
- WebSearch (SvelteKit + Cloudflare caching): Cloudflare Pages `_headers` controls static assets; HTML not cached by default; `_app/*` immutable. `svelte.dev/docs/kit/adapter-cloudflare`, Cloudflare community threads.
- WebSearch (iOS PWA limitations 2025-2026): ~50 MB Cache API quota, ~7-day script-writable storage eviction, restricted SW background execution, historical background-audio bugs. magicbell.com, brainhub.eu, vinova.sg.

### Tertiary (LOW confidence)
- None material. CJK slug library bundle sizes (`pinyin-pro` ~930 KB unpacked) from `npm view dist.unpackedSize` — tree-shaking reduces actual cost; not independently profiled.

## Metadata

**Confidence breakdown:**
- SW lifecycle / `$service-worker` / version eviction: HIGH — official docs + canonical example.
- Per-route SSR override: HIGH — explicitly confirmed in official page-options docs; resolves the riskiest CONTEXT assumption (it IS feasible).
- OFFL-02 (offline blob playback): HIGH — read the working code path; no SW work needed.
- Dual-adapter guard: MEDIUM-HIGH — mechanism clear (universal `ssr=true`, no `+page.server.ts`, guard SW register), but MUST be verified by running both builds (A4/A5).
- SSR-safety of existing entity `+page.svelte`: MEDIUM — needs an audit task; recommend a fresh minimal `/song` route to de-risk.
- CJK slug library: MEDIUM — versions verified, but `[ASSUMED]` until slopcheck; zero-dep fallback recommended.
- iOS PWA quirks: MEDIUM — multiple 2025-2026 sources agree; exact quotas vary by iOS version.

**Build-target discrepancy:** brief says `BUILD_TARGET=static`; **code uses `BUILD_TARGET=native`** — all guards must use `native`.

**Research date:** 2026-06-13
**Valid until:** 2026-07-13 (30 days — SvelteKit SW/page-options API is stable; re-check iOS quotas and any SvelteKit minor bump before a later phase).
