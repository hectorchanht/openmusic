# Phase 24: Offline App-Shell & Sharing/SEO - Pattern Map

**Mapped:** 2026-06-14
**Files analyzed:** 9 (4 new, 5 modified/reference)
**Analogs found:** 8 / 9 (the service worker has no direct analog — first SW in repo)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/service-worker.ts` (NEW) | service-worker / lifecycle | event-driven (install/activate/fetch) | none (no SW exists); thin caller of `sw-cache.ts` | no-analog (lifecycle); pure-core analog = `sleep-timer.ts` |
| `src/lib/services/sw-cache.ts` (NEW) | utility (pure helper) | transform (`shouldBypass`/`cacheNameFor`) | `src/lib/services/sleep-timer.ts` | role-match (pure node-testable helper) |
| `src/lib/services/sw-cache.test.ts` (NEW) | test | — | `src/lib/services/sleep-timer.test.ts` | exact |
| `src/lib/stores/online.svelte.ts` (NEW) | store (runes singleton) | event-driven (`online`/`offline`) | `src/lib/stores/history.svelte.ts` | role-match (browser-guarded singleton) |
| `src/lib/stores/online.svelte.test.ts` (NEW) | test | — | `src/lib/stores/settings.svelte.test.ts` | role-match |
| `src/lib/services/share.ts` (MODIFY) | utility (pure) | transform (slug/encode) | self (extend `slugify`, add `entityShareUrl`/`parseEntityParam`) | exact (in-place extension) |
| `src/routes/(app)/song/[slug]/+page.ts` + `+page.svelte` (NEW) | route (universal load + SSR page) | request-response (SSR OG) | `(app)/album/[name]/+page.ts` + `+page.svelte` | exact (load) / partial (svelte must be SSR-safe) |
| `src/routes/(app)/album/[name]/+page.ts`, `artist/[name]/+page.ts` (MODIFY) | route (SSR opt-in) | request-response | self (add `export const ssr = true`) | exact |
| `src/app.html` (MODIFY) | config (static HTML shell) | — | self + `src/routes/+layout.svelte` OG block | role-match (copy meta shape) |

> **Note on directory convention:** RESEARCH.md sketched `src/lib/stores/online.svelte.ts` in one place and `src/lib/services/online.svelte.ts` in another. The codebase convention is clear: runes singletons with `$state` live in `src/lib/stores/*.svelte.ts`; pure node-testable helpers live in `src/lib/services/*.ts`. So: `online.svelte.ts` → `src/lib/stores/` (it holds `$state`). `sw-cache.ts` → `src/lib/services/` (pure, no runes).

## Pattern Assignments

### `src/lib/services/sw-cache.ts` (pure utility, transform)

**Analog:** `src/lib/services/sleep-timer.ts` — the established "pure node-testable core that a thin runtime wrapper calls" pattern. The SW (`service-worker.ts`) is the wrapper; `sw-cache.ts` is the testable core (mirrors how `sleepTimer.svelte.ts` wraps `sleep-timer.ts`, and the player wraps `media-session.ts`).

**Module-doc + pure-function pattern** (`sleep-timer.ts` lines 1-34):
```typescript
// PURE sleep-timer helpers — NO runes, NO `$state`, NO `$app/environment`.
// This module is the node-Vitest-testable core ... The runes store and the player
// engine merely WRAP these helpers ...

/** A duration timer reaches its deadline at `now + minutes*60_000` ... */
export function computeDeadline(now: number, minutes: number): number {
  return now + minutes * 60_000;
}
```
Apply the same shape: `sw-cache.ts` exports pure `shouldBypass(url: URL, request: { method: string; headers: Headers })` and `cacheNameFor(version: string)`, with a `// PURE — no SW runtime, node-testable` header. Take STRUCTURAL inputs (a plain `{ method, headers }`), exactly as `canFadeVolume(audio: { volume: number })` (lines 52-63) takes a structural object so it stays node-testable with no DOM coupling.

**Bypass logic to encode** (from RESEARCH.md Pattern 2, lines 207-240) — `shouldBypass` returns true for: non-GET method; same-origin `/api/*`; any cross-origin request (covers all audio CDNs); any request carrying a `range` header.

---

### `src/lib/services/sw-cache.test.ts` (test)

**Analog:** `src/lib/services/sleep-timer.test.ts` (exact).

**Test structure** (`sleep-timer.test.ts` lines 1-22):
```typescript
import { describe, it, expect } from 'vitest';
import { computeDeadline, isExpired, remainingMs, ... } from './sleep-timer';

describe('computeDeadline', () => {
  it('adds minutes*60_000 to now for all six durations', () => {
    for (const m of [5, 10, 15, 30, 45, 60]) {
      expect(computeDeadline(1_000, m)).toBe(1_000 + m * 60_000);
    }
  });
  ...
});
```
One `describe` per exported function; boundary cases as separate `it`s. For `shouldBypass`, build fake `URL` + `{ method, headers: new Headers({ range: 'bytes=0-' }) }` inputs. Maps to OFFL-01 test row in RESEARCH.md (line 472).

---

### `src/lib/stores/online.svelte.ts` (store, event-driven)

**Analog:** `src/lib/stores/history.svelte.ts` — runes singleton with the `browser` SSR guard and an idempotent `load()`/init method called from a component lifecycle.

**Browser-guard + singleton pattern** (`history.svelte.ts` lines 6-30, 44-50):
```typescript
import { browser } from '$app/environment';

class History {
  entries = $state<HistoryEntry[]>([]);
  private loaded = false;

  load() {
    if (this.loaded || !browser) return;   // SSR guard + idempotent
    this.loaded = true;
    ...
  }
}
export const online = new History();   // module-level singleton export
```

**Concrete shape** (matches RESEARCH.md Pattern 4, lines 254-271): `isOnline = $state(browser ? navigator.onLine : true)` (SSR/prerender assumes online — required because entity routes now SSR), and an `init()` that attaches `online`/`offline` listeners only when `browser`, returns a teardown fn. Construct-time `$state` is SSR-safe (RESEARCH Pitfall 4, line 333). Export as `export const online = new Online();`.

---

### `src/lib/stores/online.svelte.test.ts` (test)

**Analog:** `src/lib/stores/settings.svelte.test.ts` (runes-store test). Verify `isOnline` flips on dispatched `online`/`offline` events; verify SSR default is `true`. Maps to OFFL-03 test row (RESEARCH.md line 474).

---

### `src/lib/services/share.ts` (MODIFY — pure utility)

**Analog:** itself. Three changes; all existing functions are pure (server-importable, no DOM) — preserve that.

**1. REVERSE `slugify` to ASCII** (current lines 75-84 PRESERVE CJK — D-05 reverses this):
```typescript
// CURRENT (preserves CJK — must change):
export function slugify(title: string, artist: string): string {
  const raw = `${title ?? ''} ${artist ?? ''}`.trim().toLowerCase();
  const slug = raw
    .replace(/[\s!-/:-@[-`{-~]+/g, '-')   // CJK survives this class
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 60).replace(/-+$/g, '');
}
```
Replace with the strip-to-ASCII pipeline (RESEARCH.md lines 387-399): `normalize('NFKD')` → strip accents → `replace(/[^a-z0-9]+/g, '-')` (drops CJK) → collapse/trim → `slice(0,60)`. **This breaks `share.test.ts` lines 43-49** (the "preserves CJK" test) — that test MUST be updated to assert ASCII output. Keep the existing keep-CJK doc-comment philosophy but invert it.

**2. ADD `entityShareUrl`** — model on existing `shareUrl` (lines 145-151), which already does the SSR `location` guard:
```typescript
export function shareUrl(current: Track, queue?: Track[]): string {
  const base = typeof location !== 'undefined' ? location.origin : '';   // SSR guard — REUSE
  const slug = slugify(current.title, current.artist);
  ...
}
```
`entityShareUrl(type, t)` → `${base}/${type}/${slug}-${source}${songid}` (RESEARCH.md lines 365-371). Reuse the same `typeof location !== 'undefined'` guard verbatim.

**3. ADD `parseEntityParam`** — pure regex split (RESEARCH.md lines 378-382), anchored on the fixed source enum. Mirror `isStub`'s pure-validator style (lines 57-67): return `null` on no-match. **Open Q for planner (RESEARCH.md Open Q1/A7):** confirm the `{source}{id}` delimiter — D-04 example `qq123` has no separator, which only works because source names are a fixed enum.

**Reuse `buildOg` unchanged** (lines 159-169) for the song entity OG. It already enforces https-only image + null→fallback (D-07).

---

### `src/routes/(app)/song/[slug]/+page.ts` + `+page.svelte` (NEW — SSR entity route)

**Analog (load):** `(app)/album/[name]/+page.ts` (exact). The album load is the template:
```typescript
// album/[name]/+page.ts — universal load builds `og` from params
import { buildOg } from '$lib/services/share';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params, url }) => {
  const name = decodeURIComponent(params.name ?? '');
  const og = buildOg({ title: `${name} · openmusic`, cover: null });
  og.description = ...;
  return { og };
};
```
For `song/[slug]/+page.ts`: call `parseEntityParam(params.slug)` to get `{source, id}`, build `og` from the slug's decoded title (or fall back to a generic title), add `export const ssr = true; export const prerender = false;` (RESEARCH.md Pattern 3, lines 245-251). The `(app)/+page.ts` (lines 14-26) shows the `decodeShare` + `buildOg` + `return { og }` composition for song data — reuse that exact pattern, swapping the `?play=` token decode for `parseEntityParam`.

**Analog (svelte head):** `PageOg.svelte` (used in `album/[name]/+page.svelte` line 34, 38-40):
```svelte
import PageOg from '$lib/components/PageOg.svelte';
let { data }: { data: PageData } = $props();
// data.og from the universal load → crawler-correct OG card in server HTML
```
Then `<PageOg og={data.og} />` in the template (when `data.og` present).

**CRITICAL — SSR-safety (RESEARCH Pitfall 4, lines 329-337):** Do NOT clone the heavy `album/[name]/+page.svelte` — it imports `player`, `library`, `settings`, `names`, `overlays` stores + many client-only actions at module top (verified lines 7-36). Build a MINIMAL SSR-safe `song/[slug]/+page.svelte`: OG head + static entity card + a play CTA, with interactive/store-dependent subtrees wrapped in `{#if browser}` or moved to `onMount`. Runes-store *construction* is SSR-safe; *method calls touching `localStorage`/`navigator`* are not.

---

### `src/routes/(app)/album/[name]/+page.ts`, `artist/[name]/+page.ts` (MODIFY — SSR opt-in)

**Analog:** self + RESEARCH.md Pattern 3 (lines 245-251). Add to each (the load already builds `og`):
```typescript
export const ssr = true;        // overrides root +layout.ts `ssr = false` for THIS route only
export const prerender = false;
```
**Guard (D-03, RESEARCH Pitfall 5 lines 339-343):** must NOT add a `+page.server.ts`. Universal `+page.ts` + `ssr=true` is harmless to `adapter-static` (`BUILD_TARGET=native`). Before flipping, run the SSR-safety audit on each `+page.svelte` (same risk as the song route). Verify BOTH `pnpm build` AND `pnpm build:native` succeed (RESEARCH line 480).

---

### `src/app.html` (MODIFY — static SEO default, D-11)

**Analog:** the static-default OG block in `src/routes/+layout.svelte` (lines 31-53) — but that block is client-only because root is `ssr=false` (RESEARCH Pitfall 6, lines 345-349), so crawlers on shell pages see nothing. D-11 fix: bake a static `<title>` + `<meta name="description">` + `<link rel="canonical">` directly into `app.html` `<head>` (alongside the existing `viewport`/`theme-color`/manifest meta at lines 4-13, before `%sveltekit.head%` at line 21).

**Existing app.html head shape to extend** (lines 3-21):
```html
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, ..." />
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#0b0b0f" />
  ...
  %sveltekit.head%   <!-- SSR/CSR head injected here; entity routes' PageOg lands here -->
</head>
```
Copy the title/description text from `+layout.svelte`'s `TITLE`/`DESC`/`SITE` constants (lines 13-32) so the static default matches the client-rendered default. `%sveltekit.head%` still wins for SSR entity routes (their `<svelte:head>` renders after).

---

### `src/service-worker.ts` (NEW — no direct analog)

**Analog:** none (first service worker in repo). Use the canonical SvelteKit shape from RESEARCH.md Pattern 1 (lines 179-202) + Pattern 2 (lines 207-240), as a THIN wrapper that delegates bypass/cache-name decisions to the pure `sw-cache.ts` helpers (the same wrapper/pure-core seam as `sleepTimer.svelte.ts` → `sleep-timer.ts`).

**Canonical skeleton** (RESEARCH.md lines 181-202):
```typescript
/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';
import { shouldBypass, cacheNameFor } from '$lib/services/sw-cache';

const self = globalThis.self as unknown as ServiceWorkerGlobalScope;
const CACHE = cacheNameFor(version);          // version changes per build → stale-shell eviction
const ASSETS = [...build, ...files];

self.addEventListener('install', (event) => { /* cache.addAll(ASSETS) */ });
self.addEventListener('activate', (event) => { /* delete caches !== CACHE */ });
self.addEventListener('fetch', (event) => {
  if (shouldBypass(new URL(event.request.url), event.request)) return;   // /api/*, cross-origin, range
  event.respondWith(/* cache-first for ASSETS, network→cache else */);
});
```

**Build guard (D-03, RESEARCH Pitfall 1, lines 311-315):** in `svelte.config.js` set `kit.serviceWorker.register = process.env.BUILD_TARGET !== 'native'` so the Capacitor static build never auto-registers the web SW. Reference the existing dual-adapter switch (`svelte.config.js` line 10: `const native = process.env.BUILD_TARGET === 'native'`).

---

## Shared Patterns

### Pure-core / thin-wrapper separation
**Source:** `src/lib/services/sleep-timer.ts` (pure) wrapped by `src/lib/stores/sleepTimer.svelte.ts` (runes); player wraps `media-session.ts`.
**Apply to:** `service-worker.ts` (wrapper) → `sw-cache.ts` (pure core). All throw-prone/branchy logic goes in the pure, node-tested module; the runtime file is a thin caller.
```typescript
// pure module header convention:
// PURE <name> helpers — NO runes, NO $state, NO $app/environment. node-Vitest-testable core.
```

### Browser/SSR guard for client-only state
**Source:** `src/lib/stores/history.svelte.ts` lines 6, 23, 45 (`import { browser } from '$app/environment'`; `if (!browser) return`).
**Apply to:** `online.svelte.ts` (init only in browser; SSR default `isOnline = true`). NOW LOAD-BEARING beyond convenience: entity routes SSR, so any store touched during their render must be construction-safe and method-guarded (RESEARCH Pitfall 4).

### SSR `location` guard in URL builders
**Source:** `share.ts` `shareUrl` line 146: `const base = typeof location !== 'undefined' ? location.origin : '';`
**Apply to:** new `entityShareUrl` — reuse verbatim.

### Per-page OG via universal load + PageOg
**Source:** `(app)/album/[name]/+page.ts` (build `og` in load) → `album/[name]/+page.svelte` line 34 (`<PageOg og={data.og} />`); root `+layout.svelte` lines 41-55 gates the static default behind `{#if !page.data?.og}`.
**Apply to:** new `song/[slug]` route; album/artist routes (already wired — just need `ssr=true`). The `{#if !page.data?.og}` gate guarantees exactly one OG set renders.

### Pure validator returns null on bad input
**Source:** `share.ts` `isStub` lines 57-67; `decodeShare` try/catch → `{current:null,...}` lines 106-127.
**Apply to:** `parseEntityParam` — return `null` on no-match; never throw. Mirrors the T-gln-01 input-validation discipline (RESEARCH Security V5, line 504).

### Vitest pure-helper test layout
**Source:** `src/lib/services/sleep-timer.test.ts` — `import { describe, it, expect } from 'vitest'`, one `describe` per exported fn, boundary cases as separate `it`s, colocated `*.test.ts`.
**Apply to:** `sw-cache.test.ts`; updated `share.test.ts` (reverse the CJK assertion at lines 43-49); `online.svelte.test.ts`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/service-worker.ts` | service-worker lifecycle | event-driven | First SW in the repo — no `install`/`activate`/`fetch` precedent. Use the CITED canonical SvelteKit shape (RESEARCH Pattern 1/2). The *pure-core* portion DOES have an analog (`sleep-timer.ts`); only the SW-runtime event wiring is net-new. |

## Metadata

**Analog search scope:** `src/lib/services/`, `src/lib/stores/`, `src/routes/(app)/album|artist/[name]/`, `src/routes/(app)/+page.ts`, `src/routes/+layout.{ts,svelte}`, `src/lib/components/PageOg.svelte`, `src/app.html`, `svelte.config.js`.
**Files scanned:** ~14 (read directly).
**Build-target note:** all guards use `BUILD_TARGET === 'native'` (verified in `svelte.config.js` line 10), NOT `static` — the dispatch brief's `BUILD_TARGET=static` is incorrect (confirmed by RESEARCH.md line 17 and direct read).
**Pattern extraction date:** 2026-06-14
