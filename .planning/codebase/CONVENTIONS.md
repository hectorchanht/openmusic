# Coding Conventions

**Analysis Date:** 2026-07-03

> NOTE: The root `CLAUDE.md` is STALE (it describes an old vanilla `index.html` player and claims "no test framework"). The LIVE app is **SvelteKit 2 + Svelte 5 (runes) + Vite + TypeScript**, all under `src/`. Everything below reflects the real, current codebase.

## Language & Runtime

- **TypeScript, strict everywhere.** `tsconfig.json` sets `"strict": true`, plus `checkJs: true`, `allowJs: true`, `forceConsistentCasingInFileNames: true`, `moduleResolution: "bundler"`. Node `>=22` (`package.json` `engines`).
- **Svelte 5 runes mode is forced** for all first-party files. `svelte.config.js` sets `compilerOptions.runes` true for everything outside `node_modules`. Legacy `export let` / reactive `$:` are NOT used in app code — use `$state`/`$derived`/`$effect`/`$props`.
- No prettier config, no eslint config, no biome. **There is NO automated formatter or linter.** The only quality gate is `svelte-check` (type checking) via `pnpm check`. Style is enforced by convention + review, not tooling.
- Indentation is **tabs** (see any `.ts` under `src/lib/`).
- Single quotes for TS/JS string literals everywhere EXCEPT `src/lib/i18n/*.ts` (see i18n rule below).

## Runes Usage (Svelte 5)

Counts across `src/`: `$state` ~254, `$derived` ~65, `$effect` ~54, `$props` ~14.

**Stores are runes-singleton classes in `*.svelte.ts` files.** Pattern (`src/lib/stores/settings.svelte.ts`, `src/lib/stores/player.svelte.ts`, `src/lib/stores/library.svelte.ts`):

```typescript
class Settings {
  appLang = $state<AppLang>(GENERAL_DEFAULTS.appLang);
  enabledSources = $state<Partial<Record<SourceId, boolean>>>({ ...PLAYBACK_DEFAULTS.enabledSources });
  // ...
}
export const settings = new Settings(); // module-scope singleton export
```

- **Public reactive fields** use `$state<T>(initial)` with an explicit generic.
- **Internal, non-reactive counters/guards use PLAIN class fields, NOT `$state`.** This is a deliberate, documented convention: state the UI never reads reactively (loop-guard budgets, generation counters, debounce timers) must be plain fields. See `player.svelte.ts` `consecutiveFailures`, `errorBurst`, `playGen`, `pendingGen`, `prefetchArmedForSrc` — each carries a comment explaining "Plain field — internal, never reactive."
- Components use `$props()` for inputs, `$derived` for computed view state, `$effect` for DOM/side-effect wiring.

**Imperative-vs-reactive boundary:** Stores emit RAW structured data on `$state` fields; UI reads them one-way. Stores NEVER import UI and NEVER localize text — e.g. `player.notice` (`src/lib/stores/player.svelte.ts`) carries a `PlayerNotice` with a `TranslationKey`, and a layout-level toast host maps it to a localized string via `t()`. Keep this separation: store → reactive field → host renders.

**Generation-guard idiom** (pervasive, especially `player.svelte.ts`): a monotonic counter (`playGen`, `pendingGen`) is bumped at the top of an async entry point; after each `await`, the code re-reads the counter and bails if a newer call superseded it. Use this for any async resolve that can be superseded by a newer user action (tap a different song, new play). Tests drive it with DEFERRED promises to control settle order.

## Naming Patterns

**Files:**
- Runes stores: `<name>.svelte.ts` (e.g. `player.svelte.ts`, `settings.svelte.ts`). The `.svelte.ts` suffix is REQUIRED so the SvelteKit Vite plugin transforms runes.
- Pure services/logic: `<name>.ts` (e.g. `fallback.ts`, `deezer.ts`, `cover-backfill.ts`), kebab-case.
- Components: `PascalCase.svelte` (e.g. `NowPlaying.svelte`, `TrackMenu.svelte`, `CompactRow.svelte`).
- Actions (Svelte `use:` directives): `camelCase.ts` (e.g. `lazyCover.ts`, `tapBounce.ts`, `swipeAction.ts`).
- Tests: `<name>.test.ts` colocated next to the file under test. `.svelte.test.ts` for runes-backed store tests.
- Route handlers: `+server.ts`, `+layout.svelte`, `+layout.ts` (SvelteKit convention).

**Functions:** `camelCase`. Pure exported helpers are common and are documented as "Pure — exported for testability" (e.g. `fallbackOrder` in `src/lib/services/fallback.ts`).

**Variables/consts:** `camelCase` for locals; `SCREAMING_SNAKE_CASE` for module-level constants and tunables (e.g. `FETCH_TIMEOUT_MS`, `PENDING_KEY_SEP`). Class-level tunables use `private static UPPER_SNAKE` (e.g. `FAILURE_CAP`, `PREFETCH_MAX_CANDIDATES`, `PROBE_TIMEOUT_MS` in `player.svelte.ts`).

**Types:** `PascalCase` interfaces/type aliases (`Track`, `SourceId`, `PlayerNotice`, `PendingTrack`, `QueueContext`, `SourceAdapter`). Union string literals used heavily for enums (`repeatMode: 'off' | 'one'`, `Theme = 'dark' | 'light'`).

## Import Organization

- **Always use path aliases, not deep relative paths.** `$lib/...` used ~458 times, `$app/...` ~40 times. Relative `../` imports are rare (~19, mostly within a single subdir like `src/lib/sources/`).
  - `$lib/stores/...`, `$lib/services/...`, `$lib/sources/...`, `$lib/i18n`, `$app/environment` (the `browser` flag), `$app/...`.
- **Type-only imports use `import type`** (e.g. `import type { SourceId, Track } from '$lib/sources/types'`, `import type { TranslationKey } from '$lib/i18n'`). Documented rationale: a type-only import gives compile-time key safety without a runtime dependency (see `player.svelte.ts` comment on the `TranslationKey` import, WR-03).
- Order (observed, not tool-enforced): framework/`$app` first, then `$lib` services/stores/sources, then type-only imports, then local relative.

## Error Handling

Two dominant patterns:

**1. Never-throw services (return a sentinel).** All data/enrichment services (`src/lib/services/deezer.ts`, `itunes-cover.ts`, `lastfm.ts`, `fallback.ts`, `downloads-queue.ts`, `media-store.ts`) are documented "NEVER throws." The internal fetch helper THROWS on non-ok/abort/malformed, but the exported function maps any rejection to a null / empty-array / empty-object sentinel:

```typescript
// src/lib/services/deezer.ts
return cached(key, TTL, async () => {
  const res = await fetch(apiUrl(url), { signal: combinedSignal(signal) });
  if (!res.ok) throw new Error(String(res.status)); // REJECT inside factory → not cached
  return reshape(await res.json());
}).catch(() => EMPTY_CHART);                          // map failure to sentinel OUTSIDE cache
```

A null return means "no data — leave the seeded gradient / fall back to another source," NEVER a broken image or a thrown error into the render tree. When adding a new enrichment service, follow this: throw internally so a transient failure is never cached, map to a sentinel at the exported boundary. ~48 `catch` clauses live in `src/lib/services/`.

**2. Silent-catch with graceful degradation.** Search adapters and background enrichers swallow per-source failures so partial results still render (`Promise.allSettled` fan-out). Exception: `src/lib/sources/netease.ts` intentionally THROWS on contract drift (non-array body) so `catalog`'s `Promise.allSettled` records a typed per-source error rather than silently returning zero results — a deliberate deviation from the legacy swallow-and-return-0.

**3. Soft-fail flags (don't trust a 200).** The `/api/translate` upstream can echo originals back with a 200 (a silent "no-op" failure). The fix: the service returns a `complete` boolean and ONLY persists fully-translated batches. See `src/lib/services/translate.ts` + `translate.test.ts` (`translateLinesEx` returns `{ out, complete }`; caller gates persistence on `complete`, retries incomplete). When integrating a flaky upstream, add an explicit success flag rather than treating HTTP 200 as truth.

## Type Safety

- **Zero `as any` in production source** (`src/**/*.ts` excluding tests). All 61 `as any` occurrences are in `*.test.ts` files (stubbing globals/mocks).
- Only **6** `@ts-expect-error` in the entire tree (no `@ts-ignore`).
- Prefer `satisfies` (~17 uses) and `as const` (~14) over casts for narrowing.
- Type guards are user-defined predicates, e.g. `const httpsOnly = (u?: string | null): u is string => ...` in `player.svelte.ts`.

## SSR / Browser Guards

Since the app SSRs (Cloudflare) and also builds as a Capacitor SPA, browser-only APIs must be guarded. Stores import `{ browser } from '$app/environment'` and early-return under `!browser`:

```typescript
// src/lib/stores/settings.svelte.ts — "Persisted to localStorage, SSR-guarded."
if (!browser) return;   // top of load()/persist()
```

Guarded stores: `settings`, `names`, `actionLog`, `searchHistory`, `searchSession`, `overlays`, `online`, `toast`, `player`. Any new store touching `localStorage`, `window`, `document`, `Image`, `IntersectionObserver`, or Media Session MUST gate on `browser` (or feature-detect, like `player.ms` accessor which enforces SSR + feature detection before every Media Session call, MS-05).

## i18n — DOUBLE QUOTES Convention

`src/lib/i18n/*.ts` locale dictionaries (`en.ts`, `zh-Hans.ts`, `zh-Hant.ts`, plus `ar/de/es/fr/hi/id/it/pt/ru/th/tr/vi.ts`) use **double quotes for every key AND value** — a manual, formatter-less convention (no tool enforces it; en/zh-Hans/zh-Hant were historically single-quoted and were normalized). Verified: 0 single-quoted string-literal lines across the three primary dictionaries.

```typescript
// src/lib/i18n/en.ts
"nav.home": "Home",
"offline.indicator": "You're offline",
```

Rules for locale files:
- Double quotes only (keys and values).
- **All locale files MUST expose an IDENTICAL key set** (documented in `en.ts` header; `en` is the reference/source locale and selecting it is a visual no-op). `src/lib/i18n/i18n.test.ts` guards key-set parity.
- The store/service layer stays i18n-free: it emits `TranslationKey`s, the UI calls `t(key)`.

## Comments

**High comment density is the house style.** Comments are load-bearing decision records, not noise. Two tagging systems:

- **Quick-task IDs:** `quick-NNNNNN-xxx` (e.g. `quick-260704-20e`, `quick-260630-sgw`) — ~337 references across `src/`. Each marks WHY a line exists, tied to a `.planning/quick/` task.
- **Decision refs:** short uppercase tags like `D-09`, `PLAY-08`, `COVER-01`, `WR-03`, `CR-02`, `FIX-A`, `MS-05` (~65 distinct) — tie code to design decisions/pitfalls in the phase plans.

Conventions:
- File-top block comment explains the file's purpose, its classification, and key constraints (see `player.svelte.ts` lines 1–11, `fallback.ts` lines 1–14).
- Every non-obvious field/const/function has a JSDoc `/** ... */` or `//` comment stating intent AND the failure mode it prevents.
- When you fix a bug or make a non-obvious choice, ADD a comment with the quick-task ID or decision ref. Do not remove existing decision-ref comments — they are the project's design memory.

## Function & Module Design

- **Pure functions are extracted and exported for testability.** Logic that can be pure (queue math, ordering, parsing, scoring) lives in a `.ts` with pure exports (`fallbackOrder`, `decideEndedAction`, `buildDiversePicks`, `parseLRC`, matching/scoring in `score-match.ts`). Runes stores are thin callers of these pure helpers — e.g. "the throw-prone artwork/position/state logic lives in the pure, node-tested `media-session.ts`; this store is a thin caller."
- Stores avoid circular deps by staying LEAF where possible (settings imports nothing from player/library; `actionLog` is imported BY player, never the reverse).
- `AbortSignal` is threaded through async services for supersedence/timeout; combine caller signal with a per-call timeout (`combinedSignal` in `deezer.ts`).
- Exports: named exports throughout (singletons like `export const player = new Player()`; helpers as named `export function`). No default exports in `$lib`.

---

*Convention analysis: 2026-07-03*
