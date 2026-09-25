# Phase 39: Fresh chart homepage - Pattern Map

**Mapped:** 2026-09-25
**Files analyzed:** 27 (6 new source modules, 1 fixture dir, 5 new test files, 12 modified source files incl. 15 locale files as one row, 3 extended test files)
**Analogs found:** 26 / 27. The one gap is the fixture JSON set, which has a convention but no chart-specific analog.

> **Scope correction vs RESEARCH:** CONTEXT (2026-09-25, plan review) replaces "KKBOX with Apple fallback-on-empty" for Top Songs with **KKBOX + Apple blended by reciprocal-rank fusion (`fuseCharts`)**. That changes three things:
> 1. `planChartShelves` emits **two** fetch tasks for `chart-songs` when the region is hk/tw/sg (kkbox `song` + apple `songs`). The fused result goes into one pool.
> 2. RESEARCH Pattern 6's "KKBOX [] → one extra Apple call" is gone. Fusion covers it: an empty source means the shelf is the other source alone.
> 3. The cold request count for hk/tw/sg goes up by one.
>
> UI-SPEC §1.7 also requires **region-qualified pool keys** (`chart-songs:tw`, `chart-albums:hk`, …). That supersedes RESEARCH Pattern 6's bare `chart-songs` keys.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/routes/api/charts/+server.ts` (NEW) | route (edge proxy) | request-response + serve-stale | `src/routes/api/deezer/chart/+server.ts` + `src/routes/api/resolve/+server.ts` (waitUntil) | exact |
| `src/lib/proxy/charts.ts` (NEW) | utility (edge helpers: allowlist, upstream builders, `serveChart`) | request-response / cache I/O | `src/lib/proxy/resolve-cache.ts` | exact |
| `src/lib/services/chart-parse.ts` (NEW) | utility (pure parsers) | transform | `reshapeChart()` in `src/routes/api/deezer/chart/+server.ts` + `src/lib/services/match-key.ts` (pure-module shape) | role-match |
| `src/lib/services/charts.ts` (NEW) | service (client, never-throw) | request-response | `src/lib/services/deezer.ts` `deezerChart` | exact |
| `src/lib/services/home-charts.ts` (NEW): `planChartShelves`, `samplePicks`, `regionLabel`, **`fuseCharts`**, `HOME_CACHE_KEY` | utility (pure) | transform | `src/lib/services/home-layout.ts` (pure, imports nothing) + `match-key.ts` / `dedupe.ts groupVariants` (fusion key + Map grouping) + `discovery.ts shuffle` | role-match |
| `src/lib/proxy/safe-image-url.ts` (MOD) | utility (security allowlist) | transform | itself: `DEEZER_IMAGE_HOSTS` / `LASTFM_IMAGE_HOSTS` | exact |
| `src/routes/api/deezer/chart/+server.ts` (MOD, `?genre=`) | route | request-response | itself | exact |
| `src/lib/services/deezer.ts` (MOD, `deezerGenreChart`) | service | request-response | itself: `deezerChart` lines 102-111 | exact |
| `src/lib/services/home-layout.ts` (MOD) | utility (pure resolvers + migration) | transform | itself: `resolveSectionOrder` / `resolveSubset` / `migrateDensity` | exact |
| `src/lib/config/defaults.ts` (MOD) | config | — | itself: `HOME_DEFAULTS` lines 177-194 | exact |
| `src/lib/stores/settings.svelte.ts` (MOD) | store | CRUD (localStorage) | itself: home block in `load()` / `save()` / `resetHome()` | exact |
| `src/routes/(app)/+page.svelte` (MOD) | component (route page) | event-driven + batch fan-out | itself: `refresh()`, `topArtistsBlock`, `discoveryShelf`, `shelfBudget` | exact |
| `src/lib/components/CompactRow.svelte` (MOD, `variant="album"`) | component | event-driven | itself: `artist` variant lines 99-110 | exact |
| `src/routes/(app)/settings/home/+page.svelte` (REDESIGN) | component (settings page) | CRUD | itself + `settings/translation/+page.svelte` `.advanced` accordion | exact |
| `src/routes/(app)/settings/data/+page.svelte` (FIX `clearPicks`) | component | CRUD | itself lines 21-22, 155-159 | exact |
| `src/lib/i18n/*.ts` (15 files) | config (dictionaries) | — | `src/lib/i18n/en.ts` lines 27-37, 238-258 | exact |
| `src/lib/services/__fixtures__/charts/*.json` (NEW) | test fixture | — | `src/lib/sources/__fixtures__/*.json` + `kuwo.test.ts` import idiom | convention only |
| `src/lib/services/chart-parse.test.ts` (NEW) | test | transform | `src/lib/sources/kuwo.test.ts` (fixture import) + `match-key.test.ts` | role-match |
| `src/lib/services/home-charts.test.ts` (NEW) | test | transform | `src/lib/services/home-layout.test.ts` | exact |
| `src/lib/services/charts.test.ts` (NEW) | test | request-response | `src/lib/services/deezer.test.ts` + `similar.test.ts` (governor reset) | exact |
| `src/routes/api/charts/charts-endpoint.test.ts` (NEW) | test (route) | request-response | `src/routes/api/resolve/resolve-endpoint.test.ts` | exact |
| `src/routes/api/deezer/chart/deezer-chart-endpoint.test.ts` (NEW) | test (route) | request-response | `src/routes/api/resolve/resolve-endpoint.test.ts` | exact |
| `src/lib/services/home-layout.test.ts` (EXTEND) | test | transform | itself | exact |
| `src/lib/stores/settings-persist.svelte.test.ts` (EXTEND) | test (store round-trip) | CRUD | itself | exact |
| `src/lib/proxy/safe-image-url.test.ts` (EXTEND) | test | transform | itself | exact |
| `src/lib/i18n/i18n.test.ts` | test | — | unchanged, auto-covers key parity and quote style | n/a |

---

## Pattern Assignments

### `src/routes/api/charts/+server.ts` (route, request-response + serve-stale)

**Analog:** `src/routes/api/deezer/chart/+server.ts` (whole file) for posture, and `src/routes/api/resolve/+server.ts` for `platform?.ctx?.waitUntil`.

**Verb-only export rule** (resolve `+server.ts` lines 13-18). Copy this comment block verbatim into the header. `validateChartQuery`, `serveChart`, the parsers and all types live in `$lib/proxy/charts.ts` / `$lib/services/chart-parse.ts`:
```typescript
// THIS FILE EXPORTS ONLY HTTP VERBS. A top-level non-verb `export function` in a `+server.ts`
// 500s at REQUEST time ("Invalid export") and unit tests do NOT catch it, because they import
// the module directly (`svelte-server-endpoint-only-verb-exports`). Every helper therefore lives
// in $lib/proxy/resolve-cache.ts and $lib/proxy/resolve-edge.ts. `jsonResult` below is private
```
The deezer/chart route breaks this rule: it exports `interface DeezerChartItem` etc. at lines 26-40. Types are erased, so it works, but the new route should keep types in `$lib`.

**Imports** (deezer/chart lines 16-19 and resolve lines 21-23):
```typescript
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders, jsonResponse } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import { safeImageUrl as checkImageUrl, DEEZER_IMAGE_HOSTS } from '$lib/proxy/safe-image-url';
```

**Private JSON responder + empty sentinel** (deezer/chart lines 89-93):
```typescript
const jsonResult = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });
const EMPTY: DeezerChart = { tracks: [], artists: [] };
```
For charts: `jsonResponse({ items }, origin, { ttl: 1800 })` (RESEARCH Pattern 2: the browser cache must never outlive the client's 6 h pool TTL).

**Invalid-input short-circuit, zero cache touch, zero subrequest** (resolve lines 49-51):
```typescript
	// Nothing to look up → answer with ZERO cache touches and ZERO subrequests (the deezer/search
	// short-circuit).
	if (!a && !t) return jsonResult({ hit: false }, origin);
```
→ `const q = validateChartQuery(url.searchParams); if (!q) return jsonResult({ items: [] }, origin);`

**Background refill via waitUntil** (resolve lines 75-83):
```typescript
		if (entry?.songid && !urlIsFresh(entry, Date.now())) {
			const stale = entry;
			const mid = entry.songid;
			platform?.ctx?.waitUntil(
				(async () => {
					const fresh = await resolveUrlOnEdge(mid, AbortSignal.timeout(FILL_TIMEOUT_MS));
					if (fresh) await writeResolveEntry(cache, key, { ...stale, ...fresh });
				})().catch(() => {})
			);
```
Handler signature: `export const GET: RequestHandler = async ({ url, request, platform }) => {`. Always `platform?.ctx?.waitUntil`, never `context` (`src/app.d.ts` lines 32-34).

**OPTIONS** (deezer/chart lines 134-136, copy verbatim):
```typescript
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
```

---

### `src/lib/proxy/charts.ts` (edge utility: allowlist, upstream builders, serve-stale)

**Analog:** `src/lib/proxy/resolve-cache.ts`

**Header rationale + imports** (lines 3-7, 14-15). The edge importing a pure `$lib/services` module is established here:
```typescript
import { type EdgeCache, ownOriginCacheKey } from './edge-cache';
import { matchKey } from '$lib/services/match-key';
```
→ `import { parseAppleRss, parseKkbox, parseYtCharts } from '$lib/services/chart-parse';` and `import { CHART_REGIONS, KKBOX_REGIONS, YT_REGIONS } from '$lib/services/home-layout';`, so the region allowlist has one source of truth for edge and client.

**Version-in-key discipline** (lines 17-32, 136-148):
```typescript
export const RESOLVE_CACHE_VERSION = '3';
...
export function resolveCacheKey(origin: string, artist: string, title: string): Request {
	return ownOriginCacheKey(
		`${origin}/api/resolve/_k?v=${RESOLVE_CACHE_VERSION}&k=${encodeURIComponent(matchKey(artist, title))}`
	);
}
```
→ `CHART_CACHE_VERSION = '1'`; `chartCacheKey(origin, q)` = `${origin}/api/charts/_k?v=${CHART_CACHE_VERSION}&src=${q.src}&kind=${q.kind}&cc=${q.cc}`, built only from the **validated** query.

**Never-throw read** (lines 161-174):
```typescript
export async function readResolveEntry(cache: EdgeCache | null, key: Request) {
	if (!cache) return undefined;
	try {
		const hit = await cache.match(key);
		if (!hit) return undefined;
		const body = (await hit.json()) as ResolveEntry | null;
		return body ?? null;
	} catch {
		return undefined;
	}
}
```
→ `readChartEntry` returns `{ fetchedAt, items } | undefined`. Add a shape guard (`Array.isArray(body?.items) && typeof body.fetchedAt === 'number'`).

**Fresh-Response write, best-effort** (lines 197-228). Copy the T-31-03-04 comment:
```typescript
	try {
		await cache.put(
			key,
			new Response(JSON.stringify(entry), {
				status: 200,
				headers: {
					'content-type': 'application/json',
					'Cache-Control': cacheControl
				}
			})
		);
	} catch {
		// Caching is best-effort; a failed write only costs the next request a re-fill.
	}
```
→ `writeChartEntry`: `Cache-Control: public, max-age=172800`. **Never called with an empty `items`** (RESEARCH anti-pattern: an empty parse must not overwrite good stale data).

**Upstream fetch with bounded retry + native timeout** (`src/lib/proxy/http.ts` lines 57-85, usage at deezer/chart line 117):
```typescript
const res = await fetchWithRetry(DEEZER_CHART, { signal: AbortSignal.timeout(8000) }, 2);
```
→ Apple: `fetchWithRetry(url, { signal: AbortSignal.timeout(5000) }, 1)` (RESEARCH Pitfall 9: a 5 s total budget; a timed-out attempt is not retried). YT Charts: pass `ytChartsInit(cc, kind, signal)` (RESEARCH Code Example 3) as the `init`.

**Serve-stale core:** RESEARCH Code Example 4 (`serveChart(key, load, ctx)`). The repo has no native SWR analog. It combines the read/write pair above with resolve `+server.ts`'s waitUntil refill. Carry the ponytail note from resolve lines 103-106 ("no in-flight marker, so N concurrent … bounded").

**Pinned-constant posture:** `YT_CHARTS_CLIENT_VERSION = '2.0'`, commented like the ytmusic `ANDROID_VR` constant ("a 404 here = bump this").

---

### `src/lib/services/chart-parse.ts` (pure parsers, transform)

**Analog:** `reshapeChart()` in `src/routes/api/deezer/chart/+server.ts` lines 47-87, plus the module shape of `src/lib/services/match-key.ts` (a "Pure module: no runes, no `$state`, no `$app/*`" header, lines 20-21).

**Untrusted-JSON typing: optional-field interfaces, no `as any`** (deezer/chart lines 47-65):
```typescript
interface DzAlbum {
	cover_xl?: string;
	cover_big?: string;
	cover_medium?: string;
}
interface DzTrack {
	title?: string;
	artist?: DzArtist;
	album?: DzAlbum;
}
interface DeezerChartResponse {
	tracks?: { data?: DzTrack[] };
	artists?: { data?: DzArtist[] };
}
```
RESEARCH's sketches use `(data as any)` and `(e: any)` (Code Examples 2 and 5). Replace them with interfaces in this style. CLAUDE.md allows zero `as any` in production code.

**Reshape: slice → map → trim → safe image → filter blanks** (deezer/chart lines 68-86):
```typescript
	const tracks: DeezerChartItem[] = (data?.tracks?.data ?? [])
		.slice(0, limit)
		.map((t) => ({
			artist: (t.artist?.name ?? '').trim(),
			title: (t.title ?? '').trim(),
			image: safeImageUrl(t.album?.cover_xl ?? t.album?.cover_big ?? t.album?.cover_medium),
			mbid: null as null
		}))
		.filter((t) => t.artist && t.title);
```
Parsers take the image validator as a parameter (`img: (u?: string | null) => string | null`, RESEARCH Code Example 1), so the same pure parser serves the edge (`safeImageUrl(u, APPLE_IMAGE_HOSTS)`) and the client iTunes feed. Output shapes are exactly `DiscoveryTrack` / `DiscoveryArtist` (`src/lib/services/lastfm.ts` lines 168-181: `{artist,title,image,mbid}` / `{name,image,mbid}`). The new type is `ChartAlbum {name, artist, image}`.

**Normalization helper style:** a regex chain on `(s || '')` (match-key.ts lines 23-30). Use the same style for `stripLatinAlias`, `stripReleaseSuffix`, `resizeMzstatic` and `resizeYtThumb` (RESEARCH Code Example 1).

---

### `src/lib/services/charts.ts` (client service, never-throw, request-response)

**Analog:** `src/lib/services/deezer.ts` `deezerChart` (lines 26-53, 102-111)

**Imports + timeout binding** (lines 26-28, 40-44):
```typescript
import { cached } from './ttl-cache';
import { apiFetch } from './api-base';
import { combinedSignal as combineWithTimeout } from './abort-signal';
...
const FETCH_TIMEOUT_MS = 6000;
const combinedSignal = (caller?: AbortSignal) => combineWithTimeout(FETCH_TIMEOUT_MS, caller);
```

**Core pattern: WR-03 cache posture** (lines 102-111, copy exactly):
```typescript
export async function deezerChart(limit = 18, signal?: AbortSignal): Promise<DeezerChartResult> {
	if (signal?.aborted) return EMPTY_CHART;
	return cached(`dz:chart:${limit}`, TTL_RELATED, async () => {
		const url = `${CHART_PATH}?${new URLSearchParams({ limit: String(limit) }).toString()}`;
		const res = await apiFetch(url, { signal: combinedSignal(signal) }); // governed; abort/timeout REJECT
		if (!res.ok) throw new Error(String(res.status));
		const data = (await res.json()) as Partial<DeezerChartResult>;
		return { tracks: data.tracks ?? [], artists: data.artists ?? [] };
	}).catch(() => EMPTY_CHART);
}
```
→ One function per shelf kind (`chartSongs(src, cc)`, `chartArtists(cc)`, `chartAlbums(cc)`, `ytTrending(cc)`, `newReleases(cc)`, `regionTopSongs(cc)`, `genreChart(genreId)`). Each is `cached('ch:${src}:${kind}:${cc}', SIX_H, …).catch(() => [])`. The URL is `/api/charts?` + `URLSearchParams({src,kind,cc})`.

**Legacy iTunes genre feed (absolute URL through `apiFetch`):** `apiUrl()` returns absolute URLs untouched on both builds (`src/lib/services/api-base.ts` line 37, 32-D-13). Route `https://itunes.apple.com/${cc}/rss/topsongs/limit=100/genre=${id}/json` through `apiFetch` (RESEARCH Code Example 5). **Do not copy `itunes-cover.ts`'s raw-`fetch` reasoning.** That comment predates 32-D-13 and is stale (RESEARCH Pattern 4). Only the header-comment posture from `itunes-cover.ts` lines 13-26 carries over (never-throw, bounded, caller signal).

**Deezer-genre dispatch:** `genreChart` delegates Deezer ids to `deezerGenreChart` in `deezer.ts` (below) and iTunes ids to the iTunes path above. The id→source map lives in `home-layout.ts` `CHART_GENRES`.

---

### `src/lib/services/home-charts.ts` (pure: `planChartShelves`, `samplePicks`, `regionLabel`, `fuseCharts`, `HOME_CACHE_KEY`)

**Analog (module shape):** `src/lib/services/home-layout.ts` header lines 1-15. It is pure, imports no stores or `$app`, and is node-testable. It may import `home-layout.ts` (a leaf) and `match-key.ts`. It must NOT import `settings.svelte.ts`: pass `cfg` in, as `configSig()` reads settings on the page side.

**`samplePicks(len, n)`:** reuse `shuffle` (`src/lib/services/discovery.ts` lines 129-136) and do not write another Fisher-Yates (RESEARCH "Don't Hand-Roll"). The page-local `pickN` (`+page.svelte` lines 149-155) is the duplicate to avoid:
```typescript
export function shuffle<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}
```
→ `shuffle([...Array(len).keys()]).slice(0, n).sort((a, b) => a - b)` (UI-SPEC §1.5: chart-rank order).

Import caveat: `discovery.ts` imports `settings` (line 17) and `catalog` (line 13), so importing `shuffle` from it would drag a store into this pure module. Either move `shuffle` into a dependency-free module and re-export it from `discovery.ts` (the same move `home-layout.ts` lines 11-15 describe for the pools), or inline the 5-line sampler with a comment. The first option is preferred under the CLAUDE.md "Shared Primitives" rule.

**`fuseCharts(lists, k = 60)`: reciprocal-rank fusion.** There is no RRF in the repo. The closest analogs:
- Identity key: `matchKey(artist, title)` (`src/lib/services/match-key.ts` lines 23-39). Its `norm()` already drops bracketed groups (`/[（(【\[].*?[)）\]】]/g`), so `田馥甄 (Hebe)` and `田馥甄` produce the **same key without pre-stripping**. `stripLatinAlias` is still applied at parse time, for display.
  ```typescript
  function norm(s: string): string {
  	return (s || '')
  		.toLowerCase()
  		.replace(/[（(【\[].*?[)）\]】]/g, ' ') // drop (Live) / [Remaster] / 【...】
  		.replace(/\s*-\s*(remaster|live|acoustic|explicit|feat\.?|ft\.?).*$/i, ' ')
  		.replace(/[^\p{L}\p{N}]+/gu, '')
  		.trim();
  }
  export function matchKey(artist: string, title: string): string {
  	return `${norm(artist)}|${norm(title)}`;
  }
  ```
- Map grouping plus the blank-key guard: `dedupe.ts` `groupVariants` lines 96-107 (`const gk = !k || k === '|' ? t.uid : k;`). For fusion, skip a `'|'` key instead.
- Multi-list merge precedent: `catalog.ts` `interleave` lines 189-204 (per-source queues plus a `seen` Map). RRF replaces round-robin with a score sort.

Suggested contract: `fuseCharts(lists: DiscoveryTrack[][], k = 60): DiscoveryTrack[]`. Callers pass `[apple, kkbox]` in **display-precedence order**, so the first-seen item's `artist`/`title` wins (CONTEXT: "Apple's name when both exist"). `image` = the first non-null. Score = Σ `1/(k + rank)` with 1-based rank. Sort descending with a stable tie-break on first appearance. Cap at 50. With one empty list, the result is the other list in its original order. Add a `ponytail:` comment: `matchKey` does not fold Traditional/Simplified script or artist separators (`A & B` vs `A、B`), so such pairs stay separate entries. Upgrade path: `zh-convert` + a separator fold if duplicates show up.

**`planChartShelves(cfg)`:** node-tested "hidden ⇒ no task" guarantee (RESEARCH Pattern 6 + the correction at the top of this file). It mirrors `resolveSubset`'s allowlist-filter loop (`home-layout.ts` lines 179-194).

**`HOME_CACHE_KEY` constant:** export it here (as `openmusic:top-picks:v3`) plus a `LEGACY_HOME_CACHE_KEYS = ['openmusic:top-picks:v1', 'openmusic:top-picks:v2']` list. `+page.svelte` and `settings/data/+page.svelte` then share one constant (the CONTEXT "Folded in" fix). A route file cannot export it (SvelteKit route modules are not importable helpers).

**`regionLabel(cc, lang)`:** `Intl.DisplayNames` in try/catch with a `cc.toUpperCase()` fallback, memoized per lang (UI-SPEC §2.6). No analog; the platform API covers it.

---

### `src/lib/proxy/safe-image-url.ts` (MOD: add host lists)

**Analog:** the file itself, lines 53-63:
```typescript
/** Deezer art: cdn-images.dzcdn.net and sibling *.dzcdn.net shards. Apex not permitted (as before). */
export const DEEZER_IMAGE_HOSTS: ImageHostAllowlist = {
	exact: ['cdn-images.dzcdn.net'],
	suffix: ['.dzcdn.net']
};
```
Add `APPLE_IMAGE_HOSTS` (`suffix: ['.mzstatic.com']`), `KKBOX_IMAGE_HOSTS` (`exact: ['i.kfs.io']`) and `YOUTUBE_IMAGE_HOSTS` (`exact: ['i.ytimg.com', 'yt3.ggpht.com'], suffix: ['.googleusercontent.com']`). Keep the one-line doc comment per list, and keep the "apex not permitted" statement explicit. Do not touch `safeImageUrl()` itself (lines 34-51).

---

### `src/routes/api/deezer/chart/+server.ts` (MOD: `?genre=`)

**Analog:** the file itself, GET lines 95-132.

- Validate the genre against an allowlist from `home-layout.ts` (`DEEZER_GENRE_IDS`, e.g. the numeric Deezer ids of `CHART_GENRES`). An unknown genre falls through to today's `DEEZER_CHART` URL. Copy the limit clamp at lines 97-98:
  ```typescript
  const limitRaw = Number(url.searchParams.get('limit') ?? '18');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), 100) : 18;
  ```
- The upstream becomes `https://api.deezer.com/chart/${id}/tracks?limit=50` and its shape is `{ data: DzTrack[] }` (not `{ tracks: { data } }`). Add a small branch that feeds `{ tracks: { data: body.data } }` into `reshapeChart`, so the one reshape and one `safeImageUrl` binding (line 45) serve both.
- The cache key `new Request(url.toString())` (line 101) already separates entries by `genre`. Keep the 1 h TTL. Fix the comment at lines 115-116 ("/chart has no params we pass through"), which becomes false.

---

### `src/lib/services/deezer.ts` (MOD: `deezerGenreChart`)

**Analog:** `deezerChart`, lines 102-111 (quoted under `charts.ts` above). Key it `dz:chart:g${id}`, use `TTL_RELATED` (6 h, line 51), call `CHART_PATH?genre=${id}&limit=50`, and return `data.tracks ?? []`, `.catch(() => [])`.

---

### `src/lib/services/home-layout.ts` (MOD: sections, regions, genres, migration, listed-reorder helper)

**Analog:** the file itself.

**Section ids** (lines 123-133). Extend the tuple and keep the persisted-string warning comment (lines 113-122):
```typescript
export const HOME_SECTIONS = ['liked', 'downloads', 'radio', 'top-hits', 'top-artists', 'fav-artists', 'tags', 'countries', 'playlists', 'history'] as const;
export type HomeSectionId = (typeof HOME_SECTIONS)[number];
export const DEFAULT_SECTION_ORDER: HomeSectionId[] = [...HOME_SECTIONS];
```
New canonical/default order (UI-SPEC §3): `liked, downloads, radio, chart-songs, new-releases, chart-artists, chart-albums, yt-trending, genres, regions, top-hits, top-artists, tags, countries, fav-artists, playlists, history`, with the classic block placed right after the charts. `resolveSectionOrder` (lines 145-164) needs **no change**: it already appends missing ids.

**Allowlist resolver template** (`resolveSubset` lines 179-194): known-set filter, de-dupe, saved order preserved:
```typescript
	const known = new Set(pool);
	const seen = new Set<string>();
	const filtered: string[] = [];
	for (const item of saved) {
		if (known.has(item) && !seen.has(item)) {
			seen.add(item);
			filtered.push(item);
		}
	}
	return filtered.length ? filtered : [...pool];
```
→ `resolveChartGenres(saved)`: same loop, but **empty stays empty** (UI-SPEC UI-12: no fall-back-to-all). `resolveExtraRegions(saved, main)`: same loop, also drops `main`.

**Enum-guard migration template** (`migrateDensity` lines 263-268):
```typescript
export function migrateDensity(v: unknown): HomeDensity | undefined {
	if (v === 'compact') return 'list';
	if (v === 'comfortable') return 'pile';
	if (v === 'list' || v === 'pile' || v === 'grid') return v;
	return undefined;
}
```
→ `resolveChartRegion(saved: unknown, appLang)` (RESEARCH Code Example 6) and `migrateHomeLayout(order, hidden, density?)` (RESEARCH Code Example 7). Add the optional density carry-over `top-hits→chart-songs`, `top-artists→chart-artists`, `tags→genres`, `countries→regions` when no override exists (UI-SPEC UI-13).

**New pure helper for settings drag** (UI-SPEC §2.2): `reorderListed(order, listed, from, to)`. Classic ids keep their exact array index; the listed ids refill the remaining slots. The splice idiom to reuse is `reorderList` in `settings/home/+page.svelte` lines 113-118.

**Fixed-map lookup posture** (`LANDING_PATHS` lines 277-281: "ALWAYS looked up here, never taken from the raw persisted string"). Apply it to `LANG_REGION` and `CHART_GENRES` (id → `{src:'itunes', cc, id} | {src:'deezer', id}`).

---

### `src/lib/config/defaults.ts` (MOD)

**Analog:** `HOME_DEFAULTS` lines 177-194:
```typescript
export const HOME_DEFAULTS = {
	homeSectionOrder: [...DEFAULT_SECTION_ORDER] as HomeSectionId[],
	homeHidden: [] as string[],
	homeTags: [...DEFAULT_HOME_TAGS] as string[],
	...
	homeShowRandomize: true
} as const;
```
Add `homeChartRegion: 'auto' as 'auto' | ChartRegion` (mirror `bioLang: 'auto' as 'auto' | LyricsLang`, line 85), `homeExtraRegions: [] as string[]`, `homeChartGenres: [...DEFAULT_CHART_GENRES] as string[]` and `homeLayoutVersion: HOME_LAYOUT_VERSION`. Change `homeHidden` to `[...CLASSIC_SECTIONS] as string[]`. Import the new constants from `home-layout.ts` in the existing import block (lines 11-19).

---

### `src/lib/stores/settings.svelte.ts` (MOD: fields, load coercion, migration, save, reset)

**Analog:** the file itself.

**Field declarations** (lines 219-249). Each field is a `$state<T>` initialized from `HOME_DEFAULTS`:
```typescript
	homeSectionOrder = $state<string[]>([...HOME_DEFAULTS.homeSectionOrder]);
	homeHidden = $state<string[]>([...HOME_DEFAULTS.homeHidden]);
```

**Load coercion: TYPE guard only, value cleanup at render** (lines 369-385):
```typescript
				this.homeSectionOrder = Array.isArray(v.homeSectionOrder)
					? (v.homeSectionOrder as string[])
					: [...HOME_DEFAULTS.homeSectionOrder];
				this.homeHidden = Array.isArray(v.homeHidden)
					? (v.homeHidden as string[])
					: [...HOME_DEFAULTS.homeHidden];
```
Existing-user caveat: an old blob HAS `homeHidden: []`, so the type guard keeps `[]`. That is why the migration, not the default, must add the classic ids.

**Migration insertion point:** right after line 413 (`homeSectionDensity` coercion), still inside `if (raw)`. Set a local `migrated` flag. After the `try/catch` (line 424), and before `this.applyTheme()` at line 425, add `if (migrated) this.save();` (RESEARCH Pitfall 5: the save is required). The version gate follows the enum-guard style of lines 392-395:
```typescript
				this.homeLandingTab =
					v.homeLandingTab === 'home' || v.homeLandingTab === 'search' || v.homeLandingTab === 'library'
						? v.homeLandingTab
						: HOME_DEFAULTS.homeLandingTab;
```
`homeChartRegion` coerces through `CHART_REGIONS.includes` or `'auto'`, never a bare cast (contrast `bioLang` line 308, a bare cast this phase should not copy).

**The existing "why a migration needs a version marker" record** (lines 291-297). Cite it in the new comment. It is the in-repo statement of exactly this design:
```typescript
				// tap. A one-shot migration would also need its own persisted version marker —
				// without one it re-applies on every load and makes artist='same-list' impossible
				// to select.
```

**save() payload** (lines 472-482): append `homeChartRegion`, `homeExtraRegions`, `homeChartGenres`, `homeLayoutVersion`.

**resetHome()** (lines 608-622): add the four new fields from `d`. `homeHidden = [...d.homeHidden]` then yields the classic-hidden default automatically.

**Leaf rule:** the import at line 23 stays `from '$lib/services/home-layout'` only. Never import `home-charts.ts` or `charts.ts` here.

---

### `src/routes/(app)/+page.svelte` (MOD: orchestration, cache v3, new snippets)

**Analog:** the file itself.

**Cache key + versioned payload** (lines 92, 102-111, 371-389). Bump to v3 via the shared `HOME_CACHE_KEY`:
```typescript
	function loadCache(): ShelfCache | null {
		try {
			const raw = localStorage.getItem(CACHE_KEY);
			if (!raw) return null;
			const v: unknown = JSON.parse(raw);
			if (v && typeof v === 'object' && (v as ShelfCache).v === 2) return v as ShelfCache;
			return null;
		} catch {
			return null;
		}
	}
```
The v3 type adds `pools: Record<string, Item[]>`, `picks: Record<string, number[]>` and `fetchedAt: number`. Remove the v2 key on the first v3 save.

**configSig** (lines 363-369). Extend it with the resolved region, extras, genres and the **visible network-backed section set** (RESEARCH Pitfall 4):
```typescript
	function configSig(): string {
		return JSON.stringify({
			s: clampShelfSize(settings.homeShelfSize),
			t: resolveSubset(settings.homeTags, DISCOVERY_TAGS),
			c: resolveSubset(settings.homeCountries, DISCOVERY_COUNTRIES)
		});
	}
```

**Generation guard + capped fan-out** (lines 422-459). Keep the idiom and add the chart task list:
```typescript
	let refreshGen = 0;
	async function refresh(seedQueue = true, background = false, randomize = false) {
		buildLibraryShelves(randomize);
		const gen = ++refreshGen;
		...
			const [tagRows, countryRows] = await Promise.all([
				mapWithConcurrency(tagPool, FANOUT_CAP, (tag) =>
					getTagTopTracks(tag, perShelf, pg())
				),
				...
			]);
			if (gen !== refreshGen) return; // superseded by a newer refresh (WR-04)
```
Classic gating (RESEARCH Pitfall 1): wrap `deezerChart` (line 449) in "`top-hits` or `top-artists` visible". Pass `[]` for `tagPool` / `countryPool` when `tags` / `countries` are hidden. The pattern is the existing radio gate at lines 706-710:
```typescript
		if (!settings.homeHidden.includes('radio')) {
			void buildRadio(playHistory.entries, clampShelfSize(settings.homeShelfSize)).then((r) => {
				radioShelf = r;
			});
		}
```
Chart tasks assign state **as each lands** with the gen check (the `.then((r) => …)` shape above plus `if (gen !== refreshGen) return;`). `saveCache` runs after all tasks settle.

**D-06 fallback gate** (lines 345-357, 495). `hasAnyDiscovery` must include every new pool (RESEARCH Pitfall 2). **Cold skeleton condition** (line 784) needs the same extension plus "no placeholder rendered" (UI-SPEC §1.7).

**Mount revalidate** (lines 736-755). Keep `if (cached.cfg !== configSig()) void refresh(false, true);`. Add a pools-older-than-6h branch that writes the cache without assigning state (CONTEXT: stale refresh lands on the NEXT visit).

**Progressive mount budget** (lines 618-645). Extend `shelfCount`:
```typescript
	function shelfCount(id: HomeSectionId): number {
		if (id === 'tags') return tagShelves.length;
		if (id === 'countries') return countryShelves.length;
		if (id === 'playlists') return playlistShelves.length;
		return 1;
	}
```
→ `genres` returns the planned genre shelf count and `regions` the planned region count. Single chart sections return 1 while planned or non-empty, and 0 when unplanned or settled empty (UI-SPEC §1.7).

**Render loop** (lines 817-831). Add seven `{:else if id === '…'}` arms in the same style as `{:else if id === 'radio'}{@render radioBlock()}`.

**Song shelves:** reuse `discoveryShelf(items, density)` verbatim (lines 927-973). Tap and long-press already call `playStub(item)` (lines 553-556) and `tileMenu(item)` (lines 572-587). For `yt-trending`, UI-SPEC UI-15 needs a `null` cover. Add an optional `coverOverride` param to the page's `playStub` wrapper and do not fork the snippet:
```typescript
	async function playStub(item: DiscoveryTrack) {
		const tr = await player.playStub(item.artist, item.title, item.image, 'home-discovery');
		if (tr === null && player.pendingTrack == null) toast.show(t('home.unplayable'));
	}
```

**Artist shelf:** copy the `topArtistsBlock` body (lines 880-923) with `topArtists` → the chart-artists picks. Swap `titleNav` for `titleStatic`.

**Album shelf (new `albumShelf` snippet):** structurally copy `discoveryShelf` (lines 927-973) with `CompactRow variant="album"`. Tap is `goto(albumHref({ name, id: null, mbid: null, image, releaseDate: null, type: 'album' }, artist))` (`src/lib/services/discography.ts` lines 111-118). No `use:longpress`, which mirrors the artist tiles (lines 905-915: `use:tapBounce` only).

**Headings:** `titleNav` (lines 838-843) stays for classic shelves. The new `titleStatic` snippet joins `.subhead-nav`'s selector list in CSS (lines 1139-1155); do not copy the values:
```css
	.subhead-nav {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		margin: 14px 16px 14px 0;
		...
		cursor: pointer;
```
Move `cursor: pointer` and the hover rule (line 1158) to `.subhead-nav` only.

**Placeholders:** reuse `compactSkeletonColumn()` (lines 859-871) and the `.compact-skel-pager` wrapper (lines 787-790) for `list` density.

**Randomize** (line 780): new pools re-draw `picks` locally. The button's `disabled={loading}` and "Loading…" label apply only when a classic section is visible (UI-SPEC §1.7).

---

### `src/lib/components/CompactRow.svelte` (MOD: `variant="album"`)

**Analog:** the `artist` variant, lines 99-110:
```svelte
{#if variant === 'artist'}
	<button class="crow is-artist" use:tapBounce onclick={() => onopen?.()}>
		<span
			class="art round"
			style:background-image={effectiveCover ? `url(${effectiveCover})` : fallbackGradient(seed)}
		></span>
		<span class="meta">
			<span class="r-title" use:marquee><span class="marquee-inner">{title}</span></span>
		</span>
	</button>
```
→ The `album` variant uses square `.art` (no `round`) and adds the `r-sub` line from the track branch. It uses `onopen` and has no longpress, ⋮ or RowBadges. Extend `Props.variant` (line 30) to `'track' | 'artist' | 'album'` and add a line to the header comment (lines 4-9). Check whether `.crow.is-artist`'s CSS rule (quick-260919-et3) must also apply to the album row, since it is the same direct-child-of-pager-column situation.

---

### `src/routes/(app)/settings/home/+page.svelte` (REDESIGN)

**Analogs:** the file itself, and `src/routes/(app)/settings/translation/+page.svelte` for the accordion.

**Section label map** (lines 42-53). TypeScript forces every new id into this map (good):
```typescript
	const sectionLabel: Record<HomeSectionId, TranslationKey> = {
		'top-hits': 'settings.homeSectionTopHits',
		...
	};
```
Add a typed `Record<ChartGenre, TranslationKey>` for `home.genre.<id>` (UI-SPEC: no template-string key cast).

**Reorder / toggle / density handlers** (lines 55-85): `onReorder` becomes a call to the new pure `reorderListed()` from `home-layout.ts`; `toggleHidden` and `setSectionDensity` are unchanged.

**Chip multiselect + drag reorder** (lines 89-126, markup 304-330):
```svelte
	<div class="chips" use:chipReorder={{ onReorder: onReorderTag }}>
		{#each selectedTags as tag, i (tag)}
			<button class="chip on" data-chip-index={i} onclick={() => toggleTag(tag)}>{tag}</button>
		{/each}
		{#each unselectedTags as tag (tag)}
			<button class="chip" onclick={() => toggleTag(tag)}>{tag}</button>
		{/each}
	</div>
```
Use this template for More regions and Genres. Add `aria-pressed` to every chip (UI-SPEC §4).

**Row markup** (lines 266-300). Keep it, and replace `<span class="rlabel">` with the `.rtext` block (`.rlabel` + `.rsub`). Add `role="switch" aria-checked` to `.sw` (line 297).

**Accordion: single-select Chart region / multi-select More regions / Classic** (translation lines 281-294, CSS 350-374):
```svelte
	<details class="advanced">
		<summary>
			<Languages size={15} />
			{t('settings.translateApplyAll')}
			<SettingHint label={t('settings.translateApplyAll')} text={t('settings.translateApplyAllNote')} />
			<span class="cur">{sharedTarget === null ? t('settings.translateMixed') : langLabel(sharedTarget)}</span>
			<span class="chev" aria-hidden="true"><ChevronDown size={15} /></span>
		</summary>
		<div class="chips">
			{#each langs as l (l.v)}
				<button class="chip" class:on={sharedTarget === l.v} onclick={() => applyAll(l.v)} use:tapBounce>{langLabel(l.v)}</button>
			{/each}
		</div>
	</details>
```
Copy the `.advanced`, `.advanced summary`, `.cur`, `.advanced .chev`, `[open] .chev`, reduced-motion and `.advanced .chip` rules (translation lines 350-373) into this page's `<style>`. For the Classic accordion summary, use the Playback uppercase variant (`settings/playback/+page.svelte` line 322) per UI-SPEC §2.4. Add `.advanced .rrow { background: var(--color-bg); }`.

---

### `src/routes/(app)/settings/data/+page.svelte` (FIX `clearPicks`)

**Analog:** the file itself, lines 21-22 and 155-159:
```typescript
	const TOP_PICKS_KEY = 'openmusic:top-picks:v1';
	...
	function clearPicks() {
		try { localStorage.removeItem(TOP_PICKS_KEY); } catch { /* */ }
		try { localStorage.removeItem(HOME_LIBRARY_KEY); } catch { /* */ } // hhd: also reset library shelves
		flash(t('settings.picksCleared'));
	}
```
→ Replace the literal with `import { HOME_CACHE_KEY, LEGACY_HOME_CACHE_KEYS } from '$lib/services/home-charts'` and remove all of them. Add a decision-ref comment naming the v1/v2 no-op bug. Backups are unaffected: `backup-logic.ts` uses an exact-key allowlist (`BACKUP_EXACT_KEYS`, line 137), and `top-picks` keys are not in it.

---

### `src/lib/i18n/*.ts` (15 locale files)

**Analog:** `src/lib/i18n/en.ts` lines 27-37 (`home.*`) and 238-258 (`settings.home*`):
```typescript
	"home.topHits": "Top hits",
	"home.topArtists": "Top artists",
	"home.tagShelf": "{tag}",
	"home.countryShelf": "Top in {country}",
...
	"settings.homeSectionTopHits": "Top hits",
	"settings.homeCountriesLabel": "Countries",
```
Use **double quotes for keys and values**, `{region}` / `{n}` placeholders, and put new keys next to their siblings in the same block. UI-SPEC lists 36 new keys, 1 changed value (`settings.groupHomeDesc`) and 1 removed key (`settings.homeCountriesLabel`). All of these apply to all 15 files. `i18n.test.ts` enforces parity.

---

### Tests

**`src/routes/api/charts/charts-endpoint.test.ts` and `src/routes/api/deezer/chart/deezer-chart-endpoint.test.ts`.** Analog: `src/routes/api/resolve/resolve-endpoint.test.ts`.
- `stubCache()` lines 27-44 (in-memory `caches.default` with a `putKeys` log). Copy it verbatim.
- `stubUpstream(replies)` lines 49-62 (records every subrequest URL, `'THROW'` reply). For the YT POST, also record `init?.body`.
- `json(body)` lines 64-68. `fakeGet(search)` lines 103-120, carrying the `platform.ctx.waitUntil` spy plus the `waited[]` array:
  ```typescript
  function fakeGet(search: Record<string, string>, origin: string | null = ORIGIN) {
  	const url = new URL(`${ORIGIN}/api/resolve`);
  	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
  	const waited: Promise<unknown>[] = [];
  	return {
  		waited,
  		event: {
  			url,
  			platform: { ctx: { waitUntil: vi.fn((p: Promise<unknown>) => void waited.push(p)) } },
  			request: new Request(url, origin ? { headers: { origin } } : {})
  		}
  	};
  }
  ```
- `afterEach(() => vi.unstubAllGlobals())` (lines 140-142). The zero-work assertion style (lines 144-158) is `expect(cacheStub.match).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);`. Use it for invalid `src/kind/cc/genre`.
- Stale-entry cases: seed through the exported `writeChartEntry` with a back-dated `fetchedAt` (mirrors `seed()` lines 94-101).

**`src/lib/services/charts.test.ts`.** Analogs: `deezer.test.ts` lines 20-35 and `similar.test.ts` lines 76-85.
```typescript
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	__clearSearchCache();
});
function jsonResponse(body: unknown, ok = true): Response {
	// ...apiFetch GET dedupe calls resp.clone() — so a mock Response MUST expose clone()
	const make = (): Response =>
		({ ok, status: ok ? 200 : 500, json: async () => body, clone: make }) as unknown as Response;
	return make();
}
```
Also add `beforeEach/afterEach(__resetGovernor)` from `similar.test.ts` (`import { __resetGovernor } from './api-base'`).

**`src/lib/services/chart-parse.test.ts`.** Fixture import idiom from `src/lib/sources/kuwo.test.ts` lines 5-6: `import appleHkSongs from './__fixtures__/charts/apple-hk-songs.json';`. `src/lib/services/__fixtures__/` already exists (it holds audio fixtures and a README), so add a `charts/` subdir. The case style follows `match-key.test.ts` (pure input → output `expect`s).

**`src/lib/services/home-charts.test.ts` and `home-layout.test.ts` (extend).** Analog: `home-layout.test.ts` lines 1-22 (named imports from the module, a determinism header comment). **Pitfall 6:** the test at lines 24-38 pins the ten-id list. Update it deliberately to the new canonical order in the same plan that changes `HOME_SECTIONS`, and do not weaken it. For `fuseCharts`: a song on both lists outranks singletons, `田馥甄 (Hebe)` vs `田馥甄` merge, Apple's display name wins, one empty list returns the other unchanged, the result is capped at 50, and a blank key is skipped.

**`src/lib/stores/settings-persist.svelte.test.ts` (extend).** Analog: its own harness (lines 8-37: `vi.mock('$app/environment', () => ({ browser: true }))`, the `memStore` localStorage mock, `freshSettings()` via `vi.resetModules()`). Use the per-field trio of default / persisted-wins / corrupt-falls-back / `save()` writes / `reset*()` reverts (lines 39-81). Required new cases (RESEARCH Pitfall 5):
- an old blob without `homeLayoutVersion` migrates once and persists the version;
- un-hiding `top-hits` after the migration survives a second `freshSettings().load()`;
- `resetHome()` returns the new layout.

**`src/lib/proxy/safe-image-url.test.ts` (extend).** Analog: its own lines 8-44. Mirror "accepts exact + subdomain", "rejects lookalike" (`evil-mzstatic.com`, `notkfs.io`) and "apex not permitted" for the three new lists.

---

## Shared Patterns

### Never-throw service boundary (WR-03)
**Source:** `src/lib/services/deezer.ts` lines 98-111. `src/lib/services/ttl-cache.ts` lines 27-38 caches on success only.
**Apply to:** every function in `charts.ts`, plus `deezerGenreChart`.
Failures throw INSIDE `cached()` so they are never stored. `.catch(() => [])` sits OUTSIDE.

### Edge posture (CORS, cache, timeout, image allowlist)
**Source:** `src/routes/api/deezer/chart/+server.ts` (entire file). `src/lib/proxy/http.ts` `corsHeaders` lines 30-45 (never `*`), `jsonResponse` lines 117-129. `src/lib/proxy/edge-cache.ts` `edgeCache()` lines 34-37 (the single `typeof caches` guard; returns null under vite dev and vitest).
**Apply to:** `/api/charts`, the `/api/deezer/chart` genre branch.

### Allowlist at the trust boundary
**Source:** `home-layout.ts` `resolveSubset` (lines 179-194), `LANDING_PATHS` (lines 272-281), `clampShelfSize` (lines 212-218).
**Apply to:** edge `validateChartQuery` (src/kind/cc/genre), client `resolveChartRegion` / `resolveExtraRegions` / `resolveChartGenres`, the settings `load()` coercion. No raw user string ever reaches an upstream URL or body.

### Generation guard
**Source:** `+page.svelte` lines 413-414, 422-428, 450, 459, 516. Also `tileMenu`'s `menuGen` (lines 564-578).
**Apply to:** every chart task assignment in `refresh()`, including per-shelf-as-it-lands assignment.
Keep `refreshGen` a plain field, not `$state` (CLAUDE.md).

### Capped fan-out + governor
**Source:** `discovery.ts` `mapWithConcurrency` (lines 159-184), `FANOUT_CAP = 4` (`+page.svelte` line 85), `apiFetch` (`api-base.ts` line 262).
**Apply to:** the chart task list (genre and region shelves especially), and the iTunes absolute-URL calls. Do not add another limiter (memory `api-fetch-flood-freeze`).

### Image URL validation
**Source:** `src/lib/proxy/safe-image-url.ts` `safeImageUrl` lines 34-51.
**Apply to:** all Apple/KKBOX/YT parse output at the edge, and the client iTunes feed (the same pure fn with `APPLE_IMAGE_HOSTS`).

### Hidden = zero requests
**Source:** `+page.svelte` lines 706-710 (the radio gate: today's only instance).
**Apply to:** every classic fetch and every chart task (`planChartShelves`), with a node test.

### Decision-ref comments
Tag every non-obvious choice `39-D-xx` (RESEARCH uses this prefix). Keep all existing refs (`WR-04`, `quick-260606-w87`, `D-06`, …) when editing `refresh()`, `load()` and `home-layout.ts`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `serveChart()` in `src/lib/proxy/charts.ts` | utility | serve-stale cache | No SWR in the repo. Build it from `resolve-cache.ts` read/write plus the resolve route's `waitUntil` refill, per RESEARCH Code Example 4 |
| `fuseCharts()` in `src/lib/services/home-charts.ts` | utility | transform (rank fusion) | No RRF anywhere. Key from `matchKey`, group like `dedupe.ts groupVariants`; the merge loop is new (contract above) |
| `regionLabel()` | utility | transform | Uses the platform `Intl.DisplayNames`, per UI-SPEC §2.6 |
| `src/lib/services/__fixtures__/charts/*.json` | fixture | — | Must be captured from live upstreams (trimmed). Keep YT `perspectiveMetadata.requestParams.chartParams.countryCode` in both `yt-hk-tracks.json` and `yt-cn-global.json` |

## Conventions

Derived with `gsd-tools verify conventions --derive --scope src/lib`.

| Axis | Dominant | Share | Entropy | Status |
|---|---|---|---|---|
| File-name casing | none (other 148 / kebab 81 / camel 69) | 49.7% | 0.947 | contested hotspot |
| Identifier casing | camelCase | 95.6% | 0.188 | named contract |
| Export style | ESM `export` | 100% | 0 | named contract |
| Import style | ESM `import` | 100% | 0 | named contract |

**Contested hotspots (author's choice).** The prototype of an intentional contested split is the GSD **CJS<->SDK dual resolver**: `bin/lib/**` is CJS `module.exports`/`require`, while `sdk/src/**` is ESM. Each half is internally consistent within its own directory and contested only repo-wide.

This repo's file-name split works the same way, per directory. Its rules are in CLAUDE.md, not a tool:
- `$lib/services`, `$lib/proxy`: kebab `.ts` → `chart-parse.ts`, `home-charts.ts`, `charts.ts`.
- `$lib/stores`: `*.svelte.ts`.
- `$lib/components`: PascalCase `.svelte`.
- `$lib/actions`: camelCase.

Match the directory's local style. The "other" bucket is mostly the `.svelte.ts` / `.test.ts` compound suffixes.

## Metadata

**Analog search scope:** `src/routes/api/**`, `src/lib/proxy/**`, `src/lib/services/**`, `src/lib/stores/settings*`, `src/lib/config/defaults.ts`, `src/routes/(app)/{+page,settings/home,settings/data,settings/translation,settings/playback}`, `src/lib/components/CompactRow.svelte`, `src/lib/i18n/en.ts`, `src/lib/sources/__fixtures__`, `src/lib/backup/backup-logic*`
**Files scanned:** ~40 (26 read in full or in targeted ranges)
**Pattern extraction date:** 2026-09-25
