---
phase: 39-fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she
reviewed: 2026-09-26T04:27:25Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - src/lib/components/CompactRow.svelte
  - src/lib/config/defaults.ts
  - src/lib/proxy/charts.ts
  - src/lib/proxy/safe-image-url.test.ts
  - src/lib/proxy/safe-image-url.ts
  - src/lib/services/chart-parse.test.ts
  - src/lib/services/chart-parse.ts
  - src/lib/services/charts.test.ts
  - src/lib/services/charts.ts
  - src/lib/services/deezer.ts
  - src/lib/services/discovery.ts
  - src/lib/services/home-charts.test.ts
  - src/lib/services/home-charts.ts
  - src/lib/services/home-layout.test.ts
  - src/lib/services/home-layout.ts
  - src/lib/services/shuffle.ts
  - src/lib/stores/settings-persist.svelte.test.ts
  - src/lib/stores/settings.svelte.ts
  - src/routes/(app)/+page.svelte
  - src/routes/(app)/settings/data/+page.svelte
  - src/routes/(app)/settings/home/+page.svelte
  - src/routes/api/charts/+server.ts
  - src/routes/api/charts/charts-endpoint.test.ts
  - src/routes/api/deezer/chart/+server.ts
  - src/routes/api/deezer/chart/deezer-chart-endpoint.test.ts
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
  convention: 6
status: issues_found
---

# Phase 39: Code Review Report

**Reviewed:** 2026-09-26T04:27:25Z
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

Reviewed the phase-39 diff (`35d052d..HEAD`): the new `/api/charts` edge route and its helpers, the pure parsers and fusion, the client chart services, the home chart planner, the settings migration, the home page orchestration, and the Deezer genre branch.

The new edge route is solid. The query is a closed allowlist, the cache key is a canonical own-origin key built only from the validated query, empty results are never cached, serve-stale is correct, and the YouTube global-fallback echo guard runs before any row is read. Image allowlists are dot-anchored, and look-alike hosts and apex domains are rejected. Resolvers run before persisted region and genre values reach the planner. The settings migration is idempotent, guarded by a version number, and persisted. All 8 phase test files pass (287 tests). As instructed, passing tests are not treated as proof of correctness.

The defects are in the places that were not built to the new route's standard:
1. **Home page:** pressing Randomize while the cold chart fetch is still running can trigger the D-06 fallback grid early and drop pools from the cache (WR-01).
2. **`/api/deezer/chart` genre branch:** it caches an empty or error body for an hour at the edge and in the browser, which breaks the phase's own "empty is never cached" rule (WR-02).
3. **`/api/deezer/chart` cache key:** it is still the raw request URL, so the newly added `genre` param widens a cache-key and upstream-amplification hole that `/api/charts` was deliberately built to avoid (WR-03).

I found no `$effect` self-invalidation (the home page has none), no calls that bypass the `apiFetch` governor, and no SSRF or injection path.

## Warnings

### WR-01: Randomize during the cold chart fetch triggers the D-06 fallback early and loses the chart pools

**File:** `src/routes/(app)/+page.svelte:780-795, 884-905, 1184`
**Issue:** On the default layout the classic sections are hidden, so `classicVisible` is false. That keeps the Randomize button enabled while the cold `refresh()` is still waiting on `runChartTasks` (`disabled={loading && classicVisible}`). Here is what happens if the user presses it before any pool has arrived:
- `refresh(true,false,true)` bumps `refreshGen`, calls `redrawPicks()` over empty pools, and runs `saveCache()` with `fetchedAt: poolsFetchedAt`, which is still `0`.
- It skips the classic block and calls `hasAnyContent()`. With no pools yet, and no library content on a fresh profile, that returns false. The page then runs `buildDiversePicks()` and sets `useFallback = true`. It also calls `player.setQueue(diverse, 'home-discovery')` and persists `useFallback: true`.
- The chart pools then arrive. `chartGen` was not bumped, so they are written, but the fallback grid covers every section. Nothing resets `useFallback` during this session, because the cold `refresh()` stops at `if (gen !== refreshGen) return;` (line 791) before reaching the fallback gate or `saveCache()`.
- On the next launch, `applyCache` sees the cached fallback and calls `player.setQueue(cached.fallback)` again (line 1138), replacing the restored queue. Only after that does `revalidatePools()` clear the flag.

Even when some pools have already arrived (no fallback), any pool that arrives after the Randomize save is never persisted. `poolsFetchedAt` is never stamped, so the cache is written with `fetchedAt: 0` and the next launch does a full revalidate. `revalidatePools()` has the same early return (line 620) after live pools have already been written.

**Fix:** The smallest fix is to keep Randomize disabled while chart placeholders are showing, since that is exactly the window where `hasAnyContent()` gives a wrong answer:
```svelte
<button class="more" onclick={() => refresh(true, false, true)}
	disabled={(loading && classicVisible) || anyPlaceholder}>
```
Also persist the landed pools even when the fetch was overtaken:
```ts
await runChartTasks(tasks, ++chartGen, () => true, true);
poolsFetchedAt = Date.now();          // stamp before the refreshGen check
if (gen !== refreshGen) { saveCache(); return; }
```

### WR-02: The Deezer genre-chart branch caches an empty or error response for 1 h at the edge and in the browser

**File:** `src/routes/api/deezer/chart/+server.ts:131-149`
**Issue:** The genre branch never checks `res.ok` or whether the result is empty:
- `fetchWithRetry` returns the final non-OK response once its retries run out.
- Deezer answers quota and error cases with a JSON body such as `{"error":{...}}`, sometimes with a 200 status.
- That body has no `data`, so `reshapeChart` returns `{ tracks: [], artists: [] }`.
- That empty result is then `cache.put` with `max-age=3600` and sent to the client with `Cache-Control: public, max-age=3600`.

`deezerGenreChart` deliberately throws on an empty list so its 6 h memo never stores a blank shelf, and its docstring says so. But its next `apiFetch` is answered from the browser's HTTP cache with the same empty body for an hour. The genre shelf therefore stays blank for up to 1 h per device and per PoP. `/api/charts` handles this correctly: it stores nothing and sends no TTL on an empty answer. The existing tests only cover an upstream that throws, not a 200 or 4xx carrying an error body.
**Fix:**
```ts
const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
if (!res.ok) return jsonResult(EMPTY, origin);
// ...reshape...
if (!result.tracks.length) return jsonResult(result, origin); // no cache.put, no ttl
```
Add an endpoint test: a genre upstream answering `200 {"error":{...}}` must produce zero `cache.put` calls and no `Cache-Control` header.

### WR-03: `/api/deezer/chart` still uses the raw request URL as its cache key, and the new `genre` param widens the hole

**File:** `src/routes/api/deezer/chart/+server.ts:110-114`
**Issue:** `cacheReq = new Request(url.toString())` keys the edge cache on the full raw query:
- Unrelated junk params (`&z=1`, `&z=2`, …) each create a new cache entry.
- Non-canonical spellings of an allowlisted id pass the gate but get their own key. `Number('0x74')`, `Number('1.16e2')` and `Number(' 116 ')` all equal 116.
- Non-allowlisted values (`genre=999`) fall through to `/chart` under their own key.

Every such miss is a subrequest to Deezer from the shared Workers egress IP, where Deezer enforces a limit of roughly 50 requests per 5 s. Anyone can therefore bypass the cache and burn that budget for every user's top hits, genre shelves and cover lookups that go through Deezer. The problem already existed through `limit`, but this phase added a param without adopting the canonical-key discipline it built for `/api/charts`. That route even has a test named "junk extra params cannot mint a new key". The phase brief lists this exact class ("query params must be allowlisted; cache key must be own-origin").
**Fix:** Build the key from the validated values only, using the same helper as `/api/charts`:
```ts
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
const cacheReq = ownOriginCacheKey(
	`${url.origin}/api/deezer/chart/_k?v=1&limit=${limit}${genre !== null ? `&genre=${genre}` : ''}`
);
```

## Info

### IN-01: `resolveChartRegion` parses language subtags by hand and misreads extension subtags

**File:** `src/lib/services/home-layout.ts` (`resolveChartRegion`, the `navLang.split(/[-_]/)…find(/^[a-z]{2}$/i)` block)
**Issue:** The code takes the first 2-letter subtag after the language as the region. For tags with a Unicode extension, that picks the extension key instead. For example, `en-u-ca-gregory` resolves to `ca` (Canada) and `de-u-co-phonebk` resolves to `co`. This is rare for `navigator.language`, but the standard library already parses these tags correctly.
**Fix:**
```ts
let sub: string | undefined;
try { sub = new Intl.Locale(navLang).region?.toLowerCase(); } catch { /* bad tag */ }
if (isChartRegion(sub)) return sub;
```

### IN-02: A full `revalidatePools()` gives failed refetches a fresh timestamp

**File:** `src/routes/(app)/+page.svelte:631-637`
**Issue:** `merged` keeps the old pool for any key whose refetch came back empty, and it is saved with `fetchedAt: Date.now()`. That stale pool is then treated as fresh for another 6 h. The `onlyMissing` branch on the next launch only covers keys with no pool at all, so a flaky upstream can leave a shelf showing a chart more than 12 h old.
**Fix:** Keep a per-key timestamp, or only stamp `fetchedAt` fresh when every planned key refetched successfully. Otherwise keep the old `fetchedAt`, so the next launch retries.

### IN-03: Chart fetches cannot be cancelled and keep holding governor slots after the user leaves Home

**File:** `src/routes/(app)/+page.svelte:483-501, 573-583`
**Issue:** `fetchTask` never passes an `AbortSignal`. When a newer `chartGen` supersedes a fetch, or the page unmounts, the requests still run until the client's 6 s timeout. Up to 4 groups run at once, and chart-songs has 2 tasks, so up to 5 chart requests are in flight. They hold 5 of the 8 global `apiFetch` slots while the user taps a song on another tab, which can delay the play resolve by up to 6 s during a hanging Apple call.
**Fix:** Create one `AbortController` per `runChartTasks` call, abort it on `onDestroy` and on a new `chartGen`, and pass its signal through `fetchTask` into the `charts.ts` calls, which already accept a signal.

### IN-04: The home-cache guard only checks the top level of the object, so a corrupt v3 blob can break Home

**File:** `src/routes/(app)/+page.svelte:439-443, 718-731, 1137`
**Issue:**
- `loadCache` checks `v`, `fetchedAt`, `picks` and the three `pools` records, but not their contents. Duplicate indices in a persisted `picks` entry (for example `[0,0]`) make `sampled()` return the same row twice. The keyed `{#each}` / `CompactPager` then throws `each_key_duplicate`, and the Home render stays broken until the cache is cleared.
- A v3 blob without `fallback` makes `cached.fallback.length` (line 1137) throw inside `onMount`. That happens before `requestAnimationFrame(revealShelves)`, so only `REVEAL_INITIAL` (3) shelves ever mount.

Reaching either case takes storage corruption or tampering. T-39-29 claims the persisted picks are safe, though.
**Fix:** In `sampled()`, remove duplicates with `[...new Set(idx)]`. In `loadCache`, also require `Array.isArray(v.fallback)`, or use `(cached.fallback ?? []).length`.

## Conventions

### CV-01: The CompactRow album variant uses a private copy of the shared placeholder gradient

**File:** `src/lib/components/CompactRow.svelte:97-100, 122`
**Deviation:** The new `album` variant calls the local `fallbackGradient()`. It is character-for-character the same as `coverGradient()`.
**Convention:** CLAUDE.md "Shared Primitives": the placeholder cover gradient must be imported from `services/cover-gradient.ts` (`coverGradient`), never inlined again.
**Suggested fix:** Import `coverGradient`, delete `fallbackGradient`, and use it in all three variants.

### CV-02: `/api/charts` adds back a private `jsonResult` alias

**File:** `src/routes/api/charts/+server.ts:24-25`
**Deviation:** `const jsonResult = (body, origin, ttl) => jsonResponse(body, origin, { ttl })` is another route-local `jsonResult` wrapper.
**Convention:** Shared Primitives: `proxy/http.ts` `jsonResponse` replaced the 18 `jsonResult`/`jsonPassthrough` copies.
**Suggested fix:** Call `jsonResponse({ items }, origin, { ttl: items.length ? CHART_CLIENT_TTL_S : undefined })` directly.

### CV-03 – CV-06: Silent catch blocks (from the shared convention checker)

The `verify conventions` rule pack flagged these catch blocks as swallowing errors:
- `src/lib/proxy/charts.ts:166` (new: best-effort `writeChartEntry`)
- `src/lib/services/discovery.ts:160`, `src/lib/stores/settings.svelte.ts:465` and `:536` (lines this phase did not change)

**Convention:** architectural-split, catch style.
**Suggested fix:** None needed. CLAUDE.md explicitly endorses "silent-catch with graceful degradation" and try/catch around every localStorage access, and each block has a comment explaining why. These are advisory only.

---

_Reviewed: 2026-09-26T04:27:25Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
