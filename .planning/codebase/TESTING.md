# Testing Patterns

**Analysis Date:** 2026-07-03

> NOTE: Root `CLAUDE.md` claims "no test framework present." That is STALE. The live app has a large **vitest** suite: **67 test files**, ~**999** `it()`/`test()` cases, ~**15,350** lines of test code.

## Test Framework

**Runner:**
- **vitest** `^4.1.3` (`package.json`), config in `vite.config.ts` (root).
- Uses the `vitest/config` `defineConfig` with the `@sveltejs/kit/vite` plugin so `.svelte.ts` runes files are transformed for tests.

**Assertion Library:**
- vitest built-in `expect`. **`test.expect.requireAssertions: true`** is set in `vite.config.ts` — every test MUST make at least one assertion or it fails. Do not write assertion-less tests.

**Environment:**
- **Single `node` project** (`environment: 'node'`). There is NO jsdom / happy-dom client project. Include glob: `src/**/*.{test,spec}.{js,ts}` (covers `*.svelte.test.ts` too — the SvelteKit Vite plugin transforms `$state` runes for node, and the runes-backed logic is pure enough to unit-test headless).

**Run Commands:**
```bash
pnpm test                       # vitest --run (whole suite, one-shot)
pnpm test:unit                  # vitest (watch mode)
pnpm exec vitest run <file>     # run ONE file, e.g.:
pnpm exec vitest run src/lib/stores/player.svelte.test.ts
pnpm check                      # svelte-kit sync && svelte-check (type gate — run this too)
pnpm check:watch                # svelte-check --watch
```
`pnpm check` is a SEPARATE gate from tests: it runs `svelte-check` (type errors, unused, a11y). Both must pass. There is no eslint/prettier step.

## Test File Organization

**Location:** Colocated — the test sits next to the file under test (`src/lib/services/deezer.ts` → `src/lib/services/deezer.test.ts`). Route-handler tests live beside the `+server.ts` in the route dir (`src/routes/api/proxy.test.ts`, `src/routes/api/deezer/search/deezer-endpoint.test.ts`).

**Naming:**
- `<name>.test.ts` for plain modules.
- `<name>.svelte.test.ts` for runes-backed store tests (7 of them): `player`, `library`, `settings`, `online`, `searchHistory`, `searchSession`, `sleepTimer` under `src/lib/stores/`. The `.svelte.test.ts` suffix ensures the runes transform runs.

**Coverage map (where tests live):**
```
src/lib/stores/*.svelte.test.ts        # runes stores (player is the giant one)
src/lib/services/*.test.ts             # ~25 service tests (deezer, lastfm, cover-*, catalog, lrc, translate, ...)
src/lib/sources/*.test.ts              # per-source adapters (netease, qq, kuwo, joox, audius) + quality/registry
src/lib/actions/*.test.ts              # use: directives (lazyCover, swipe*, longpress, dragReorder, marquee, ...)
src/lib/search|history|gestures|diagnostics/*.test.ts   # pure logic modules
src/lib/i18n/{detect,i18n}.test.ts     # locale detection + key-set parity
src/routes/api/**/*.test.ts            # server route handlers + proxy token boundary
```

## Test Structure

Standard vitest `describe`/`it`, with `beforeEach`/`afterEach` reset hooks:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  fetchMock.mockReset();
  memStore.clear();
  vi.resetModules();     // re-import the module fresh so module-scope state resets
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('localStorage', localStorageMock); // re-stub after restore
});
```

- `describe` blocks are named after the behavior + its decision ref, e.g. `describe('player.playStub — optimistic resolve-on-tap (FIX-A)', ...)`, `describe('player resilience — loop-guard + skip-on-failure (PLAY-07/08)', ...)`. This ties tests directly to the design decisions in the phase plans.
- **Small factory helpers** build fixtures, e.g. `mk(source, songid, artist, title): Track` in `player.svelte.test.ts` returns a fully-populated `Track`. Reuse/define such a helper rather than inlining object literals.
- `vi.resetModules()` in `beforeEach` + late `await import('./module')` INSIDE each test is used when a module has module-scope state that must be re-initialized per test (see `translate.test.ts`).

## Mocking

**Framework:** vitest `vi.mock` / `vi.fn` / `vi.mocked` / `vi.stubGlobal`.

**Mocking `fetch` / API layer** — mock the app's fetch wrapper, not global fetch, and hand back a minimal `Response`:
```typescript
// src/lib/services/translate.test.ts
const fetchMock = vi.fn();
vi.mock('./api-base', () => ({ apiFetch: (...a: unknown[]) => fetchMock(...a) }));
function jsonRes(body: unknown) { return { json: async () => body } as Response; }
fetchMock.mockResolvedValue(jsonRes({ translated: [...], flags: [...] }));
```

**In-memory `localStorage`** — a `Map`-backed `Storage` stub, installed via `vi.stubGlobal`, is the standard way to test persistence headless (identical pattern in `player.svelte.test.ts`, `translate.test.ts`, and the store tests):
```typescript
const memStore = new Map<string, string>();
const localStorageMock: Storage = { get length(){...}, clear, getItem, key, removeItem, setItem };
vi.stubGlobal('localStorage', localStorageMock);
```

**Partial mocks that keep the rest real** — use `importOriginal` and spread, so unrelated exports of the same module stay live (avoids collateral breakage in other suites):
```typescript
// src/lib/stores/player.svelte.test.ts
vi.mock('$lib/services/cover-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/services/cover-cache')>();
  return { ...actual, getCachedCoverByUid: vi.fn(() => null), getCachedCover: vi.fn(() => null) };
});
```
This is used to stub the sync cache readers (`getCachedCoverByUid`, `getCachedCover`), the async `resolveCoverForTrack` (from `cover-backfill`), and the `removeCoverBoth` evictor while leaving `setCachedCover`/`clearCoverCache`/`writeCoverBoth` real.

**Deferred promises to control settle order** — the generation-guard / supersedence tests mock async resolvers (`resolveStub`, `ensureTrackDetails`, `tryFallback`, `blobStore.get`) with DEFERRED promises so the test drives exactly WHEN each awaits settle, making timing-dependent guards deterministic. This is the canonical way to test the player's resolve-on-tap and prefetch races.

**Stubbing browser globals** (no jsdom) — controllable class stubs on `globalThis`:
```typescript
// src/lib/actions/lazyCover.test.ts
class MockIO { /* observe/unobserve/disconnect + trigger(isIntersecting) helper */ }
class MockImage { /* onload/onerror driven by an `imageBehavior` flag */ }
```
`IntersectionObserver`, `Image`, `MediaMetadata` (a `FakeMediaMetadata` hoisted to module scope to avoid the Svelte nested-class perf warning) are all hand-stubbed. Media Session artwork tests assert a FRESH metadata object was assigned on the async cover land.

**SSR flag flip** — many store/service tests `vi.mock('$app/environment', () => ({ browser: true }))` so the `!browser` early-returns in `persist()`/`restore()`/`load()` actually execute in node. When testing a browser-gated code path, flip `browser` ON and back it with the `localStorage` stub.

**What to mock:** the fetch/api-base wrapper, IDB blob store (`$lib/services/blob-store`), cover cache readers, resolve helpers (`resolveStub`, `ensureTrackDetails`), cross-source `tryFallback`, up-next generators (`buildSimilarQueue`, `buildDiversePicks`), and browser globals (`localStorage`, `Image`, `IntersectionObserver`, Media Session).

**What NOT to mock:** pure helpers under test (queue math, `fallbackOrder`, `decideEndedAction`, scoring, parsing) — call them directly. Keep `importOriginal` real for everything you aren't specifically overriding.

## Coverage Areas

**Well-tested (high confidence):**
- **Player store** — `src/lib/stores/player.svelte.test.ts` is 4163 lines / ~161 cases across 32 `describe` blocks: playStub optimism, prefetch/never-stop, delayed re-resolve, repeat, loop-guard + skip-on-failure, stall watchdog, offline gate, generation guards (CR-02/WR-02), `resolvedCover` single-field guarantee, self-heal (`healCover`), queue context, `setListQueue`, `removeFromQueue`/`clearQueue`, sleep-timer expiry, `flushPersist`, unplayable-uid strike counter, autoplay-rejection retry, background stream-error skip. Resilience machinery is the most exhaustively covered subsystem.
- **Enrichment services** — `catalog` (505 lines), `deezer` (462), `cover-backfill` (411), `cover-cache` (376), `lastfm` (354), `lrc` (308), `blob-store` (269), `home-layout` (267), `score-match` (258), `discovery`, `translate` (poison-cache / soft-fail flag), `enrich-merge`, `fallback`, `sw-cache`, `ttl-cache`, `match-key`, `media-session`, `share`, `similar`, `sleep-timer`.
- **Source adapters** — `joox` (330), `qq` (249), `netease`, `kuwo`, `audius`, plus `quality` and `registry`.
- **Server routes** — proxy token boundary (`proxy.test.ts` asserts the real JOOX token NEVER leaks into a response), deezer/lastfm/similar endpoints.
- **Actions** — `lazyCover`, `coverSwipe`, `swipeAction`, `longpress`, `dragReorder`, `dragScroll`, `marquee`, `swipeRemove`, `chipReorder`, `inflightGuard`.
- **i18n** — locale key-set parity + detection.

**Thin / untested (see optimization lens):**
- `src/lib/services/dedupe.ts` and `dedupe-deezer.ts` — **NO colocated test**, yet `dedupeBest`/`sameSongKey` are core to search-result merging AND the player's fallback/queue de-dupe. High-value, currently unguarded pure logic.
- `src/lib/services/picks.ts` — **NO test** (it IS mocked in `player.svelte.test.ts`, so its own build logic is unverified).
- `src/lib/services/native-media-session.ts`, `media-store.ts` — **NO test** (Capacitor bridge; hard to test headless, but the pure slices could be extracted).
- Stores with **NO test**: `names.svelte.ts` (translation-name cache — notable, drives displayed names), `actionLog.svelte.ts`, `toast.svelte.ts`, `overlays.svelte.ts`, `cover-version.svelte.ts` (partially exercised via player), `history.svelte.ts` (exercised indirectly via player).
- **`.svelte` components are not unit-tested** — no jsdom/testing-library project. Component behavior is only covered where its logic was extracted to a pure `.ts` (e.g. `track-menu-gate.ts` has `track-menu-gate.test.ts`; `autocomplete-logic.ts`, `history-logic.ts`, `velocity.ts`). Rendering/interaction of `NowPlaying.svelte`, `Nowbar.svelte`, `TrackMenu.svelte`, etc. is untested by automation.

## Test Types

- **Unit tests:** the vast majority — pure functions and runes stores exercised headless in node.
- **Integration tests:** server route handlers exercise the real `+server.ts` + `hooks.server.ts` (`src/routes/api/proxy.test.ts` imports the real `GET` and `handle`).
- **E2E tests:** none. No Playwright/Cypress. No jsdom component tests.

## Common Patterns

**SSR guard in tests** — flip `browser` on, provide backing `localStorage`:
```typescript
vi.mock('$app/environment', () => ({ browser: true }));
vi.stubGlobal('localStorage', localStorageMock);
```

**Soft-fail flag testing** (don't trust HTTP 200) — assert the `complete` gate and that a partially-failed batch is NOT persisted:
```typescript
// src/lib/services/translate.test.ts
fetchMock.mockResolvedValue(jsonRes({ translated: ['杜国华','周杰倫'], flags: [false, true] }));
const r = await translateLinesEx(['杜国华','周杰伦'], 'zh-Hant');
expect(r.complete).toBe(false);
expect(lsKeys().filter((k) => k.startsWith('openmusic:lyrics-tr:')).length).toBe(0);
```

**Never-throw / sentinel assertions** — assert `null`/`[]`/`{}` on failure, never a rejection:
```typescript
// deezer/lastfm-style
fetchMock.mockRejectedValue(new Error('boom'));
await expect(deezerChart()).resolves.toEqual({ tracks: [], artists: [] });
```

**Secret-leak boundary assertion** (`src/routes/api/proxy.test.ts`):
```typescript
expect(upstream).toContain(`token=${FAKE_TOKEN}`);
expect(upstream).not.toContain(REAL_TOKEN); // real JOOX token must never reach client artifacts
```

## Optimization Opportunities (quality/testing)

- **Untested core de-dupe** — add tests for `src/lib/services/dedupe.ts` (`dedupeBest`, `sameSongKey`) and `dedupe-deezer.ts`. They are mocked away in the player test, so their real logic is unverified despite being on every search/fallback/queue path.
- **`picks.ts` unverified** — mocked in player tests, no direct test; the diverse-picks builder feeds the home page and up-next.
- **`names.svelte.ts` store untested** — it drives displayed artist/title translation caching (a known past bug area per project memory: soft-fail echoes). Worth a persistence + soft-fail test mirroring `translate.test.ts`.
- **No component-level tests** — consider a jsdom/`@testing-library/svelte` project for `NowPlaying`/`Nowbar` to catch UI-swap regressions (a documented past incident: gating the now-playing swap on the `playing` event froze iOS playback). Currently only pure-logic extractions catch such issues.
- **Flaky-risk: timing-dependent player tests** rely on deferred-promise ordering + fake counters; they are deterministic today but fragile to refactors of the async guard order. Keep the deferred-promise discipline and avoid real timers (prefer `vi.useFakeTimers()` for watchdog/debounce windows).
- **`requireAssertions` is on** — any new test without an assertion fails the run; good, keep leaning on it.
- **No lint/format gate** — convention drift (quote style in i18n, tab indentation, import ordering) is only caught by review. A lightweight prettier + eslint-svelte config would close this gap; until then, match the nearest existing file exactly.

---

*Testing analysis: 2026-07-03*
