# Phase 30: Carrier-Free Share Links (`/{type}/{artist}/{title}` + `/api/og`) - Pattern Map

**Mapped:** 2026-08-07
**Files analyzed:** 18 (7 create + 11 modify) — corrected against the repo, see §File Classification
**Analogs found:** 16 / 18 (2 have no analog)

> Complement to `30-RESEARCH.md`, not a replacement. RESEARCH owns *what to build* (§B.6 encoder,
> §C.9 skeleton, §C.12 extraction table, §F.19 call-site inventory). This file owns *which existing
> file each new file copies its shape from*, with `file:line` excerpts. Where the two disagree the
> repo wins and it is called out under **CORRECTION**.

---

## File Classification

### CREATE

| New File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/routes/api/og/+server.ts` | route (edge endpoint) | request-response + **streaming** | **hybrid**: `src/routes/api/deezer/search/+server.ts` (shell) + `src/routes/api/ytmusic/stream/[videoId]/+server.ts:107-133` (body pass-through) | exact (split) |
| `src/lib/proxy/deezer-cover.ts` | proxy module (pure) | transform + never-throw fetch | `src/lib/proxy/edge-cache.ts` (module shape) + `src/lib/services/itunes-cover.ts:88-100` (never-throw fetch) | role-match |
| `src/lib/proxy/og-cover.ts` | proxy module (pure) | tiered resolve chain | `src/lib/services/fallback.ts` / `itunes-cover.ts` tier posture | role-match |
| `src/routes/(app)/song/[artist]/[title]/+page.ts` | route loader | request-response (pure derive) | `src/routes/(app)/song/[slug]/+page.ts` | exact |
| `src/routes/(app)/song/[artist]/[title]/+page.svelte` | component (page) | render-only + client-side resolve | `src/routes/(app)/song/[slug]/+page.svelte` | exact |
| `src/routes/(app)/album/[artist]/[name]/+page.ts` | route loader | request-response (pure derive) | `src/routes/(app)/song/[slug]/+page.ts` (**not** `album/[name]/+page.ts`) | exact |
| `src/routes/(app)/album/[artist]/[name]/+page.svelte` | component (page) | render-only | `src/routes/(app)/song/[slug]/+page.svelte` | exact |

**Wave 0 tests (CREATE):**

| New Test | Role | Analog | Match |
|---|---|---|---|
| `src/routes/api/og/og-endpoint.test.ts` | test (endpoint) | `src/routes/api/deezer/search/deezer-endpoint.test.ts` | exact |
| `src/lib/proxy/deezer-cover.test.ts` | test (pure module) | `src/lib/proxy/http.test.ts` + `src/lib/services/share.test.ts` | exact |
| loader tests (5: 2 new + 3 legacy) | test (pure fn) | **none exists** — see §No Analog Found | none |
| `PageOg` assertion path | test (component) | **none exists** (no jsdom project) — see §No Analog Found | none |

### MODIFY

| File | Role | What changes | Analog for the change |
|---|---|---|---|
| `src/lib/services/share.ts` | service (pure) | `songShareUrl:181-193`, `entityCardUrl:208-228`, new `encodePathSegment`/`decodePathSegment`, `buildOg:291-304` grows `type` | its own `slugify` / `buildOg` neighbours |
| `src/lib/services/share.test.ts` | test | §F.20 rewrite | itself (`:38-67` slugify block is the shape) |
| `src/routes/api/deezer/search/+server.ts` | route | rewire to `$lib/proxy/deezer-cover` | `src/routes/api/ytmusic/search/+server.ts:14-17` (thin route + `$lib/proxy/*` helpers) |
| `src/routes/(app)/song/[slug]/+page.ts` | route loader | add `og.type` only — carriers stay verbatim | itself |
| `src/routes/(app)/song/[slug]/+page.svelte` | component | `<img>` swap at `:66` | `src/lib/services/api-base.ts:26-29` (`apiUrl`) |
| `src/routes/(app)/album/[name]/+page.ts` | route loader | delete `decodeURIComponent` at `:22`; add `og.type` | `song/[slug]/+page.ts:46-58` (never decodes) |
| `src/routes/(app)/artist/[name]/+page.ts` | route loader | delete `decodeURIComponent` at `:22`; add `og.type`; **also the new-shape handler** | same |
| `src/routes/(app)/album/[name]/+page.svelte` | component | delete `decodeURIComponent` at `:50`; `shareAlbum` at `:428-439` | — |
| `src/lib/components/PageOg.svelte` | component | origin from `page.url.origin`; `og:type` from prop | itself `:10-20` |
| **`src/lib/components/TrackMenu.svelte`** `:174-182` | component | drop `cover` + `s2tConvertLines` from `songShareUrl` call | — |
| **`src/routes/(app)/artist/[name]/+page.svelte`** `:171-179` | component | same for `entityCardUrl` | — |

**CORRECTIONS to the file list in the task prompt:**

1. **`src/lib/proxy/og-cover.ts` is REQUIRED, not optional** (RESEARCH §C.9 calls it optional). Two
   hard constraints force it: (a) `+server.ts` may only export HTTP verbs
   (`ytmusic/stream/[videoId]/+server.ts:30-33` documents exactly this, learned the hard way), and
   (b) OG-EP-01 must unit-test tier order / miss-vs-error / deadline. Tiers unreachable from a test
   = no Wave 0. It also carries `safeItunesImageUrl`, `safeKuwoImageUrl` and the inlined `/og.svg`
   string — **do not add a third `og-fallback.ts`**; 1.9 KB of constant does not earn a module.
2. **Three share *call sites* are missing from the prompt's MODIFY list** and are not optional —
   changing `songShareUrl`/`entityCardUrl` signatures breaks `pnpm check` without them:
   `TrackMenu.svelte:182`, `album/[name]/+page.svelte:439`, `artist/[name]/+page.svelte:179`
   (verified by grep this session; each also holds the `s2tConvertLines` calls §E.17 deletes).
3. **`src/app.d.ts` should NOT be modified.** Every existing route `await`s `cache.put`
   (`deezer/search/+server.ts:216`, `ytmusic/search/+server.ts:77`). Copy that and `platform.ctx`
   never enters the picture. `<!-- ponytail: awaited cache.put blocks the crawler on the write;
   switch to ctx.waitUntil (uncomment app.d.ts:21) only if a deployed p95 shows it matters -->`
4. **`artist/[name]/+page.ts` is a MODIFY-only route with no new sibling** — its path shape is
   unchanged, so the one file is simultaneously the new and the legacy handler. It must accept a
   bare `/artist/Nirvana` *and* `/artist/Nirvana?c=&dn=`.
5. **`src/lib/proxy/` has no `.test.ts` naming precedent problem** — `http.test.ts` and
   `ytmusic.test.ts` already live there. `deezer-cover.test.ts` is idiomatic.

---

## Pattern Assignments

### 1. `src/routes/api/og/+server.ts` (route, request-response + streaming)

**Analogs: TWO. `/api/og` is a deezer-shaped shell around a ytmusic-stream-shaped body.**

#### Analog A — `src/routes/api/deezer/search/+server.ts` (the shell)

**Header comment** (`:1-23`) — the house shape: decision-ref tag on line 1, an explicit
"mirrors X VERBATIM" posture list, then a **LIVE PROBE block** recording the upstream facts the
route is built on. RESEARCH §C.13 already measured the equivalent facts for all three tiers —
transcribe them into this header.

```ts
// Deezer cover/search edge proxy (quick-260606-wv8, WV8-01).
//
// Deezer becomes the PRIMARY cover source for the home discovery tiles. This route mirrors
// the /api/lastfm/discovery posture VERBATIM (own-origin CORS, OPTIONS 204 preflight,
// caches.default edge cache keyed by the OWN-ORIGIN Request, fetchWithRetry + native
// AbortSignal.timeout, a safeImageUrl host allow-list) — but carries NO secret: ...
//
// LIVE Deezer probe (2026-06-06, curl vs api.deezer.com — the facts this route is built on):
//  - GET https://api.deezer.com/search?q=<term> → { data: [...], total }. A no-match returns
//    { data: [], total: 0 } — a CLEAN 200 with NO error envelope. No API key is required.
```

**Imports** (`:24-26`) — exactly three, all `$lib/proxy/*`:

```ts
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
```

**Response-shaping helper + CORS** (`:58-65`) — one local builder, CORS spread first, TTL optional:

```ts
function jsonResult(result: DeezerCover, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(result satisfies DeezerCover), { status: 200, headers });
}
```

→ `/api/og`'s equivalent is `imageResponse(body, contentType, origin)` and `ogFallback(origin)`.
Note `satisfies` (not `as`) — CLAUDE.md rule, and the only cast style in the file.

**Zero-work short-circuit** (`:169-171`) — the pattern for OG-EP-01's "no query terms → fallback,
zero subrequests":

```ts
const q = (url.searchParams.get('q') ?? '').trim();
// Empty/missing q → empty result with NO upstream fetch (T-wv8-01 short-circuit).
if (!q) return jsonResult({ cover: null, artistPicture: null }, origin);
```

**Passthrough-only upstream construction** (`:177-179`) — the T-wv8-01 comment is the one to
re-tag as the SSRF note in `/api/og`:

```ts
// Passthrough-only upstream: q is encodeURIComponent'd into the fixed search string — no
// command/template construction (T-wv8-01).
const upstream = `${DEEZER_SEARCH}?q=${encodeURIComponent(q)}&limit=${limit}`;
```

**Cache read + WR-01 CORS re-application** (`:181-203`) — the exact sequence both `/api/og` cache
layers copy. Read the comment, not just the code: the stored entry is deliberately CORS-free.

```ts
// Cache key = the OWN-ORIGIN request (NEVER the upstream api.deezer.com URL — T-wv8-06).
// Guarded for the dev runtime (`vite dev` has no Cache API) so local dev still hits live.
const cache = edgeCache();
const cacheReq = new Request(url.toString());

if (cache) {
	const hit = await cache.match(cacheReq);
	if (hit) {
		// Re-apply CORS for THIS request's origin (WR-01). The cached entry stores a
		// CORS-FREE body, so a cross-origin (preview vs prod) hit never receives a prior
		// requester's Access-Control-Allow-Origin.
		...
	}
}
```

> **⚠️ DEVIATION — do not copy line 184.** This route hand-rolls `new Request(url.toString())`
> instead of calling `ownOriginCacheKey(url)`, which is the extracted helper living two files away
> (`edge-cache.ts:37-39`). The route's own comment at `:55-57` acknowledges the `quick-260713-mqv`
> extraction but the key line was never switched. Five newer routes DO use the helper:
> `ytmusic/search/+server.ts:45`, `ytmusic/lyrics/+server.ts:53`, `similar/+server.ts:63`,
> `lastfm/info/+server.ts:283`, `lastfm/similar-tracks/+server.ts:158`. `api/[source]/[...path]`
> also hand-rolls it (`:70`).
> **`/api/og` MUST use `ownOriginCacheKey(url)`.** It is the majority pattern, it is what CONTEXT
> locks, and layer 1 needs the `URL | string` overload the helper already provides.

**Cache write on success only** (`:210-222`) — the miss-vs-error discipline OG-EP-01 depends on:

```ts
	if (cache) {
		// Cache a CORS-FREE copy (origin re-applied per request on a hit, WR-01).
		const cached = new Response(JSON.stringify(result satisfies DeezerCover), { status: 200,
			headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` } });
		await cache.put(cacheReq, cached);
	}
	return jsonResult(result, origin, TTL);
} catch {
	// Upstream error / malformed JSON / non-ok-throw → best-effort empty (NO cache write).
	return jsonResult({ cover: null, artistPicture: null }, origin);
}
```

**`OPTIONS`** (`:225-228`) — keep it even though `hooks.server.ts:26-28` already answers preflight.
Every proxy route has it and every endpoint test asserts it:

```ts
// CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-wv8-02).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
```

#### Analog B — `src/routes/api/ytmusic/stream/[videoId]/+server.ts:107-133` (the body)

This is the repo's only streaming byte-proxy and the exact primitive OG-EP-02 needs. Note the
header handling: a **fresh header object with an explicit allowlist**, never a blind copy — which
is also what makes `Set-Cookie` structurally impossible in the cached copy (§C.10).

```ts
	const res = await fetchWithRetry(
		streamUrl,
		{ redirect: 'follow', signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS), headers: upstreamHeaders },
		1
	);
	// itag 140 is always AAC/mp4 — set the content-type explicitly (the download flow + <audio> rely
	// on it). Propagate range headers only when present so 206 + <audio> seeking work end-to-end.
	const outHeaders: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'audio/mp4'
	};
	const contentLength = res.headers.get('content-length');
	if (contentLength != null) outHeaders['Content-Length'] = contentLength;

	return new Response(res.body, { status: res.status, headers: outHeaders });
} catch {
	return new Response('ytmusic: upstream error', { status: 502, headers: corsHeaders(origin) });
}
```

**Differences `/api/og` must apply on top:**
- `retries = 0`, not `1` (2.5 s deadline can't afford `http.ts:91-95`'s 150–300 ms backoff).
- `Content-Type` is **validated** (`^image/`), not asserted — three upstream hosts, all JPEG, but
  a CDN error page must fall through to the branded fallback (never-throw shape).
- Never a `502`. `/api/og` returns 200 + `/og.svg` on every fault (OG-EP-01).
- Add `Cache-Control: public, max-age=86400, immutable` and the bounded `clone()` for the cache
  write (§C.10, `CACHE_BYTES_CAP`).

#### Analog C — closed-set input validation: `src/routes/api/[source]/[...path]/+server.ts:28-30, 37-39`

The `type=song|album|artist` gate. Note the user-defined type predicate — CLAUDE.md's stated
type-guard style, and it narrows for free:

```ts
function isKnownSource(source: string): source is SourceId {
	return Object.prototype.hasOwnProperty.call(PROXIES, source);
}
...
if (!isKnownSource(params.source)) {
	return new Response('unknown source', { status: 404, headers: corsHeaders(origin) });
}
```

→ `/api/og` **coerces** rather than 404s (`type` outside the set → `'song'`), because the route
never fails. Write it as `const OG_TYPES = ['song', 'album', 'artist'] as const` + a predicate.

---

### 2. `src/lib/proxy/deezer-cover.ts` (proxy module, transform + never-throw fetch)

**Analog A — module shape: `src/lib/proxy/edge-cache.ts` (entire file, 39 lines).** This is the
canonical `$lib/proxy` pure module and the closest structural sibling: a *no-behavior-change
extraction*, exactly what OG-EP-03 is. Copy its four moves:

```ts
// Shared Cloudflare edge-cache accessor for the /api/* proxy routes (quick-260713-mqv).
//
// Consolidates the EdgeCache/EdgeCacheStorage narrowing + the `edgeCache()` accessor that was
// copy-pasted across 11 proxy routes (a CLAUDE.md Anti-Pattern: cache-write duplication). This
// is a pure no-behavior-change extraction — every consumer's caching behavior, TTLs, CORS
// re-application and cache-key construction stay exactly as they were.
```

1. Line 1 = purpose + quick-task ID. Line 3+ = **why the extraction exists**, naming the
   duplication it kills. `deezer-cover.ts`'s version names the `+server.ts`-verb-only constraint
   (`svelte-server-endpoint-only-verb-exports`) as the forcing reason.
2. Interfaces above functions; the narrowing interface exported, the storage shim private
   (`:13-19`) → mirrors "export `DeezerCover`/`DeezerHit`, keep `DzAlbum`/`DzResult` private"
   (§C.12).
3. `/** … */` JSDoc on **every** export, carrying the threat/decision ref
   (`:31-36`: `T-09-05 / T-2os-02 / T-wv8-06`). Do not ship a bare `export function`.
4. Named exports only, no default. `import type` for type-only.

**Analog B — never-throw async boundary: `src/lib/services/itunes-cover.ts:83-100`.** `$lib/proxy/`
has no never-throw fetch today (`fetchWithRetry` deliberately throws, `http.ts:79`), so
`fetchDeezerCover` imports its posture from services. This is the shape:

```ts
/**
 * Bounded, never-throws GET → parsed top result's artworkUrl100, upgraded to 600x600.
 * Returns null on: already-aborted caller signal, non-ok response, empty results, missing
 * artworkUrl100, malformed JSON, abort/timeout, or any thrown error.
 */
async function fetchTopArtwork(url: string, signal?: AbortSignal): Promise<string | null> {
	if (signal?.aborted) return null;
	try {
		// RAW fetch (not apiFetch — fetch→apiFetch audit): `url` is an ABSOLUTE cross-origin
		// itunes.apple.com URL. apiFetch prepends the /api base (apiUrl) → would corrupt it.
		const res = await fetch(url, { signal: combinedSignal(signal) });
		if (!res.ok) return null;
		const data = (await res.json()) as ItunesResponse;
		const art = data?.results?.[0]?.artworkUrl100;
		return upgradeArtwork(art);
	} catch {
		// Non-ok / abort / timeout / malformed JSON / network failure → miss → gradient.
```

Note the **enumerated null-return list in the JSDoc** — copy that literally for `fetchDeezerCover`,
and state the two-valued return (`null` = error, `{ cover: null, … }` = clean miss) that lets
`/api/og` distinguish miss from error.

Also note the mandatory `// RAW fetch (not apiFetch — fetch→apiFetch audit): …` tag. Every raw
`fetch` in this repo carries it (`http.ts:60-61`, `api-base.ts:197-198`). `/api/og`'s tier fetches
and image fetch each need one.

**Analog C — the code being moved, verbatim.** `safeImageUrl` (`deezer/search/+server.ts:74-86`).
Both guards are load-bearing; keep them in all three `safe*ImageUrl` functions:

```ts
function safeImageUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	if (/[)\s"'\\(]/.test(raw)) return null; // CSS url() + attribute breakers
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.toLowerCase();
		const ok = host === 'cdn-images.dzcdn.net' || host.endsWith('.dzcdn.net');
		return ok ? u.href : null;
	} catch {
		return null;
	}
}
```

Its 6-line JSDoc (`:67-73`) explains *why the CSS-breaker reject exists* — move that comment with
the code. Deleting it deletes a decision record (CLAUDE.md).

---

### 3. `src/lib/proxy/og-cover.ts` (proxy module, tiered resolve)

**Analog A — the `AbortSignal.any` feature-detect: `src/lib/services/itunes-cover.ts:69-81`.**
Copy this verbatim for `tierSignal()` (RESEARCH §C.9); it is already the repo's answer to
"per-tier budget under one overall deadline":

```ts
/**
 * Combine the caller's AbortSignal (if any) with a per-call timeout so a hung request always
 * settles. Returns null if the caller's signal is ALREADY aborted (the caller should not even
 * fetch). Uses AbortSignal.any when available, else falls back to the timeout signal alone
 * (still bounded — the caller's pre-fetch `aborted` check already short-circuits the common case).
 */
function combinedSignal(caller?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	if (!caller) return timeout;
	const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
	return typeof anyFn === 'function' ? anyFn([caller, timeout]) : timeout;
}
```

Note the cast style: an inline structural type on the global, **not** `as any` (zero `as any` in
production source — CLAUDE.md).

**Analog B — upstream-URL builders stay pure and injectable.** `itunes-cover.ts:44-56`
`buildItunesSearchUrl` (reuse as-is) and `proxy/kuwo.ts:15-43` `kuwoProxy.buildUrl`:

```ts
export const kuwoProxy: ProxyAdapter = {
	id: 'kuwo',
	buildUrl(path: string, searchParams: URLSearchParams, _env: Env | undefined): string {
		const type = (path || 'search').replace(/^\/+|\/+$/g, '');
		if (!ALLOWED_TYPES.has(type)) throw new Error(`kuwo: unsupported path "${type}"`);
		const upstream = new URL(KUWO_BASE);
		if (type === 'search') {
			// search: ?name={kw}&page=1&limit={n} (legacy:2124).
			const name = searchParams.get('name');
			if (name !== null) upstream.searchParams.set('name', name);
			...
```

Call it as `kuwoProxy.buildUrl('search', new URLSearchParams({ name, limit: '1' }), undefined)`.
It **throws** on an unsupported path — wrap the kuwo tier's whole body in the never-throw `try`.

**Analog C — kuwo response contract + drift guard: `src/lib/sources/kuwo.ts:62-68, 82`.** The
kuwo tier reads exactly the field the client adapter reads, and inherits the drift posture:

```ts
const json = (await res.json()) as KuwoSearchResponse | null;

// Contract-drift guard (legacy:2129 returned 0; we THROW so the fan-out records a
// typed per-source error rather than silently dropping the source).
if (!json || json.code !== 200 || !Array.isArray(json.data)) {
	throw new Error('kuwo: contract-drift (expected {code:200,data:[]} search body)');
}
...
	cover: it.pic || null,
```

→ In `/api/og` the drift case becomes `{ kind: 'error' }` (not a throw, not a miss) so it is never
negative-cached. Empty `data` array = `{ kind: 'miss' }` = cacheable.

---

### 4. `src/routes/(app)/song/[artist]/[title]/+page.ts` (route loader, pure derive)

**Analog: `src/routes/(app)/song/[slug]/+page.ts` — the whole 59-line file. This is the better
template; do NOT use `album/[name]` or `artist/[name]`.**

**Header comment** (`:1-21`) — five mandatory blocks, in this order. RESEARCH §"Code Examples"
already drafted the Phase-30 version of this header; it is faithful to the original, use it.

```ts
// SSR-safe SONG share route (D-02, refined by quick-260614-1w3). A crawler hitting
// /song/{slug}?n={title}&a={artist} gets a per-song OG card baked into the SSR HTML (SHARE-01),
// ...
// D-01/D-03: this is a UNIVERSAL `+page.ts` with `ssr = true` — a per-route SSR opt-in. The root
// +layout.ts stays ssr=false; NEVER a +page.server.ts (that would break the adapter-static native
// build — Pitfall 5 / T-24-09).
//
// DQ-1/DQ-2 ... carrier semantics ...
//
// T-24-08 / SSRF: OG is built ONLY from the query params + the slug, never an arbitrary server-side
// fetch. ... og:image is EMITTED into a meta tag (never fetched server-side) ...
//
// Plain strings (NOT t()) — load runs server-side where the reactive i18n lookup is unsafe (same
// note as the album/artist loads).
import { buildOg } from '$lib/services/share';
import type { PageLoad } from './$types';
```

**Per-route opt-in + the pure sync load** (`:25-28, 46-58`):

```ts
// Per-route SSR opt-in (D-01): the song-share surface renders server-side so crawlers see the OG
// head; prerender stays off (the slug space is unbounded / dynamic).
export const ssr = true;
export const prerender = false;

export const load: PageLoad = ({ params, url }) => {
	// DQ-1: n/a are the authoritative readable carriers (standard URL-decoding via searchParams).
	const n = url.searchParams.get('n') ?? '';
	...
	const displayTitle = n || titleFromSlug(params.slug ?? '') || 'openmusic';
	const og = buildOg({ title: displayTitle, artist: a || undefined, cover: c || null });

	return { og, name: n, artist: a };
};
```

Four properties to replicate exactly:
- **synchronous** (no `async`, no `await`, no `fetch`) — this is what makes it unit-testable in the
  node project and what keeps T-24-08 true.
- **no `decodeURIComponent(params.…)`** — the one thing `album/[name]` and `artist/[name]` get
  wrong (Pitfall 1). This loader is the proof the correct form already exists in-repo.
- **fallback chain to a non-empty title** (`n || derived || 'openmusic'`) — the new loader's
  equivalent is `decodePathSegment(params.title) || 'openmusic'`.
- returns `{ og, name, artist }` — the `+page.svelte` contract. Keep the key names so the page
  component is a near-copy.

**Contrast — why NOT `album/[name]/+page.ts`:**

| | `song/[slug]/+page.ts` | `album/[name]/+page.ts` |
|---|---|---|
| decodes `params` | no ✅ | **yes — `:22`, live 500 on `%`** ❌ |
| header restates the `+page.server.ts` ban | yes `:5-7` | yes `:12-17` |
| `+page.svelte` SSR-safe *by construction* | yes (lazy store imports) | no — relies on an "SSR-safety audit (24-04)" comment; the page imports stores at module top |
| returns display data for the page | yes `{ og, name, artist }` | no — `{ og }` only; the page re-derives from `page.params` |

The new 2-segment routes are crawler landing pages, i.e. the `song/[slug]` species. Copy that one.

---

### 5. `src/routes/(app)/song/[artist]/[title]/+page.svelte` (component, render-only)

**Analog: `src/routes/(app)/song/[slug]/+page.svelte` — the whole file, including the `<style>`
block.** The SSR-safety-by-construction contract is stated in the header and enforced by the
import list; both must be reproduced.

```svelte
<script lang="ts">
	// SSR-safe SONG share page (D-02), SSR-safe BY CONSTRUCTION. ...
	//
	// SSR-SAFETY (Pitfall 4): the ONLY module-top imports are PageOg, `browser`, `onMount`, and the
	// page data type. There is NO top-level store import and NO store METHOD call at module scope —
	// the player store (which pulls the whole client graph) is imported LAZILY inside onMount under a
	// `browser` guard, so SSR never compiles the store graph in. i18n is likewise lazy-imported
	// client-side (its index imports the settings store), keeping this page store-free during SSR.
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import PageOg from '$lib/components/PageOg.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const title = $derived(data.name || data.og.title);
	const artist = $derived(data.artist);
	let status = $state<'idle' | 'resolving' | 'playing' | 'notfound'>('idle');
```

**Lazy store import + the supersede-aware resolve** (`:33-60`) — copy verbatim, including the
`pendingTrack` nuance (a `null` return is ambiguous between miss and supersede):

```ts
	async function resolveAndPlay() {
		if (!browser || !data.name) { status = 'notfound'; return; }
		status = 'resolving';
		// Lazy imports keep SSR store-free (both pull the client store graph).
		const { player } = await import('$lib/stores/player.svelte');
		try { const { t } = await import('$lib/i18n'); notFoundMsg = t('home.unplayable'); } catch { /* … */ }
		const tr = await player.playStub(data.artist, data.name, null, 'home-discovery');
		// Mirror the home idiom: playStub returns null for BOTH a genuine miss AND a supersede; a
		// supersede leaves pendingTrack pointing at the newer song (don't flag notfound then).
		if (tr === null && player.pendingTrack == null) status = 'notfound';
		else status = 'playing';
	}

	onMount(() => {
		retry = () => void resolveAndPlay();
		void resolveAndPlay();
	});
```

**The `<img>` swap target** (`:66` + `:96-107`) — what OG-PAGE-01 replaces, in both the new page
and the legacy one:

```svelte
	<div class="cover cover--placeholder" aria-hidden="true"></div>
```
```css
	.cover { width: 240px; height: 240px; max-width: 70vw; border-radius: 16px;
	         object-fit: cover; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); }
	.cover--placeholder { background: linear-gradient(135deg, #2a2a36, #14141a); }
```

`.cover` already carries `object-fit: cover`, so `<img class="cover">` needs no new CSS — keep
`.cover--placeholder` as the `onerror` fallback class (RESEARCH §F.18 recommends taking the
fallback; the CSS for it already exists, so it is ~2 lines).

**The `<img src>` must go through `apiUrl` — `src/lib/services/api-base.ts:20-29`** (Pitfall 7):

```ts
/**
 * Resolve an own-origin `/api/*` path against the configured API base.
 *
 * Returns `path` unchanged when `VITE_API_BASE` is unset/empty (web: same-origin relative),
 * and `BASE + path` when it is set (native: absolute cross-origin to the deployed proxy).
 */
export function apiUrl(path: string): string {
	const BASE = import.meta.env.VITE_API_BASE ?? '';
	return BASE + path;
}
```

`apiUrl` is pure and store-free, so importing it at module top does **not** break the SSR-safety
contract above. Use `apiUrl()` for the `<img>`; keep `data.og.image` (absolute, origin-derived) for
the meta tag only.

---

### 6. `src/lib/components/PageOg.svelte` (component, render-only)

**Analog: itself.** `:10-20` is the block to change; `:1-9` and `:23-28` are the comments to
preserve and extend.

```svelte
	// T-gln-02: all values are bound via `content={...}` (Svelte escapes attribute bindings), never
	// {@html}. The image is constrained to an https URL by buildOg; a null cover falls back to the
	// static /og.svg so the card always has an image.
	import { page } from "$app/state";

	let { og }: { og: { title: string; description: string; image: string | null } } = $props();

	const SITE = "https://openmusic.lol";
	const FALLBACK_IMG = `${SITE}/og.svg`;
	const url = $derived(`${SITE}${page.url.pathname}`);
	const image = $derived(og.image ?? FALLBACK_IMG);
```
```svelte
	<meta property="og:type" content="music.song" />
```

Patterns to preserve while editing:
- `$props()` destructure with an inline object type (runes, no `export let`).
- `$derived(...)` for every computed value — not `$:`.
- Every value bound `content={...}`, never `{@html}` (T-gln-02). Keep this when adding `og:type`.
- The prop type widens to `{ …; type?: OgType }` with a `'music.song'` default so no caller breaks
  mid-refactor (RESEARCH §F.18). `OgType` is exported from `share.ts` beside `buildOg`.

> **⚠️ STYLE DEVIATION.** `PageOg.svelte` uses **double quotes** for imports and string literals.
> It is one of only 2 of 15 components that do (the other is `Nowbar.svelte`); the other 13 use
> single quotes, and CLAUDE.md names single quotes as the rule (double **only** in
> `src/lib/i18n/*`). Write new/edited lines in single quotes per the repo contract; **do not
> mass-reformat** the untouched lines — that is churn in a file the phase is already editing.

---

### 7. `src/lib/services/share.ts` — where `encodePathSegment` / `decodePathSegment` belong

**Verdict: in `share.ts`, immediately after `slugify`. Do not create a new module.**

Four repo facts settle it:

1. **`share.ts` is already the SSR-importable pure module for exactly this job.** All three entity
   loaders import from it (`song/[slug]/+page.ts:22`, `album/[name]/+page.ts:9`,
   `artist/[name]/+page.ts:9`) and it is proven to run under the edge SSR path. It has no
   `$app/environment` import and no module-top `location` read — every `location` access is
   function-local and guarded (`:157`, `:182`, `:216`):
   ```ts
   const base = typeof location !== 'undefined' ? location.origin : '';
   ```
   `encodePathSegment`/`decodePathSegment` touch neither, so they are strictly safer than what
   already ships there.
2. **The producer and the consumer are both already in this file's blast radius.**
   `songShareUrl:181` and `entityCardUrl:208` call the encoder; the loaders call the decoder. A new
   module would be imported by exactly the same set of files, plus one more import line each. YAGNI.
3. **`src/lib/services/` has no one-concern-per-module convention.** `share.ts` already holds four
   unrelated concerns (base64 queue token, slugify, share-URL builders, OG derivation) and is the
   repo's stated "pure functions extracted and exported for testability" pattern (CLAUDE.md).
4. **Testing follows for free.** `share.test.ts` already exists, already imports the sibling pure
   functions, and §F.20 rewrites it anyway. A separate module would need a second test file with a
   duplicate import header for two ~4-line functions.

**Naming/JSDoc analog — `slugify`'s neighbours + `isHttpsUrl:306-309`:**

```ts
/** True only for an absolute https:// URL (the only cover shape we surface to crawlers). */
export function isHttpsUrl(url: string | null | undefined): boolean {
	return typeof url === 'string' && /^https:\/\/\S+$/.test(url);
}
```

camelCase verb-first names, single named export each, `?? ''` input coercion (never a throw on
`null`/`undefined` — `parseEntityParam:274-279` states this: *"Returns `null` on no-match — mirrors
isStub's pure-validator discipline, NEVER throws"*). RESEARCH §B.6's drafted pair already matches
this shape and carries the two guards' rationale in the JSDoc — ship it as written.

`buildOg:291-304` is the analog for growing an `og:type`: an input-object param, a small returned
object literal, and a comment recording *why* the shape is what it is (`quick-260723-r4p`).

---

### 8. `src/routes/api/og/og-endpoint.test.ts` (test, endpoint)

**Analog: `src/routes/api/deezer/search/deezer-endpoint.test.ts` — the whole file. Also
`lastfm-info-endpoint.test.ts`, `similar-endpoint.test.ts`, `ytmusic-routes.test.ts`,
`ytmusic/stream/[videoId]/stream.test.ts` follow the identical shape (5 sibling precedents).**

> **🔴 REGRESSION HARNESS — `deezer-endpoint.test.ts` MUST NOT BE EDITED.** It imports only
> `{ GET, OPTIONS } from './+server'` (`:3`) and never touches an internal helper, so it passing
> **unchanged** is the entire proof that the OG-EP-03 extraction is behavior-preserving. An executor
> who edits this file to make it pass has deleted the requirement. Make it an explicit task
> constraint (VALIDATION.md:70).

**Lifecycle + `fakeEvent`** (`:17-35`) — copy structurally:

```ts
beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fakeEvent(search: Record<string, string>, env?: Env) {
	const url = new URL('https://openmusic.lol/api/deezer/search');
	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
	return {
		url,
		// Most cases pass platform: undefined to PROVE the proxy works with NO key/secret.
		platform: env ? { env } : undefined,
		request: new Request(url, { headers: { origin: 'https://openmusic.lol' } })
	};
}
```

The `platform: undefined` comment is a real assertion for `/api/og` too — all three tiers are
keyless, so every case should run with `platform: undefined`.

**Handler invocation** (`:66-67`) — the `as any` + eslint-disable pair is the house form. This is
the ONLY sanctioned `as any` (CLAUDE.md: tests only):

```ts
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
```

**In-memory `caches.default` harness** (`:279-310`) — the pattern OG-EP-02 copies for **both**
layers. Note `hit.clone()` on match and `res.clone()` on put — required, since a `Response` body is
single-use:

```ts
	it('serves the second identical request from caches.default WITHOUT a second upstream fetch', async () => {
		const fetchSpy = vi.fn(async () => new Response(FULL_PAYLOAD, { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		const store = new Map<string, Response>();
		const cacheStub = {
			match: vi.fn(async (req: Request) => { const hit = store.get(req.url); return hit ? hit.clone() : undefined; }),
			put: vi.fn(async (req: Request, res: Response) => { store.set(req.url, res.clone()); })
		};
		vi.stubGlobal('caches', { default: cacheStub });

		const mk = () => fakeEvent({ q: 'Jay Chou Simple Love' });
		const res1 = await GET(mk() as any);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(cacheStub.put).toHaveBeenCalledTimes(1);
		const res2 = await GET(mk() as any);
		expect(fetchSpy).toHaveBeenCalledTimes(1); // no second upstream fetch
		expect(cacheStub.match).toHaveBeenCalledTimes(2);
		// cache hit re-applies CORS for THIS origin
		expect(res2.headers.get('Access-Control-Allow-Origin')).toBe('https://openmusic.lol');
	});
```

**Cache-key assertion** (`:312-330`) and **no-write-on-error** (`:332-345`) — one-for-one mappable
to OG-EP-02's requirements:

```ts
		let cacheKeyUrl = '';
		const cacheStub = { match: vi.fn(async () => undefined), put: vi.fn(async (req: Request) => { cacheKeyUrl = req.url; }) };
		...
		expect(cacheKeyUrl).toContain('openmusic.lol/api/deezer/search');
		expect(cacheKeyUrl).not.toContain('api.deezer.com');
```
```ts
		const putSpy = vi.fn(async () => { });
		vi.stubGlobal('caches', { default: { match: vi.fn(async () => undefined), put: putSpy } });
		await GET(event as any);
		expect(putSpy).not.toHaveBeenCalled();
```

**`describe` grouping** — one block per behavioral contract, each named
`'/api/<route> — <contract>'`: reshape · empty/no-match/error-graceful (never throws) ·
host allow-list · Cache-Control + Cache API · CORS. `/api/og` adds a **tier-order** block and a
**deadline** block.

**Also copy the "per-tier fetch stub" idiom from `capturedUpstream`** (`:57-63`) — the tier-order
assertion is "capture every upstream URL in call order, assert the sequence and the count":

```ts
			vi.fn(async (input: RequestInfo | URL) => {
				capturedUpstream = String(input);
				return new Response(FULL_PAYLOAD, { status: 200 });
			})
```

**Hard constraint: `vite.config.ts:7` sets `expect: { requireAssertions: true }`** — every `it()`
must contain at least one `expect`, or the suite fails.

---

### 9. `src/lib/proxy/deezer-cover.test.ts` (test, pure module)

**Analogs: `src/lib/proxy/http.test.ts` (same directory, same kind) and
`src/lib/services/share.test.ts:38-67` (pure-function block shape):**

```ts
describe('slugify', () => {
	it('lowercases ASCII, collapses punctuation/space to single hyphens, trims', () => {
		expect(slugify('Hello World!!', 'A B')).toBe('hello-world-a-b');
	});
	...
	it('handles empty inputs without throwing', () => {
		expect(slugify('', '')).toBe('');
	});
});
```

One flat `import { … } from './deezer-cover'` at the top, one `describe` per exported function,
one `it` per behavior, `it('… without throwing')` for the null/empty edge. This is where the
`safeDeezerImageUrl` / `reshapeDeezerSearch` cases become **directly** reachable — previously they
were only observable through the route, which is the value OG-EP-03 adds.

---

### 10. Loader tests (2 new + 3 legacy routes) — no analog; here is the concrete shape

**No loader test exists in this repo.** Verified: every test under `src/routes/` is a `+server.ts`
endpoint test (9 files, listed in §Metadata). Nothing imports a `+page.ts`.

The closest analogs are the two halves already covered: **`deezer-endpoint.test.ts:26-35`** (import
the route module directly, hand it a hand-built event object) and **`share.test.ts`** (pure
function, direct assertions). A loader test is exactly the intersection:

```ts
// src/routes/(app)/song/[artist]/[title]/loader.test.ts
import { describe, it, expect } from 'vitest';
import { load, ssr, prerender } from './+page';

function ev(params: Record<string, string>, search = '') {
	const url = new URL(`https://openmusic.lol/song/${params.artist}/${params.title}${search}`);
	return { params, url };
}

describe('song/[artist]/[title] loader', () => {
	it('opts into SSR and out of prerender', () => {
		expect(ssr).toBe(true);
		expect(prerender).toBe(false);
	});
	it('decodes both segments and never re-decodes a literal %', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const out = load(ev({ artist: 'Post Malone', title: '50% Off' }) as any) as any;
		expect(out.name).toBe('50% Off');
	});
});
```

**Four constraints this imposes — they are design constraints on the loader, not just the test:**

1. **The loader must be importable standalone.** It is, provided the only route-generated import
   stays `import type { PageLoad } from './$types'` — a *type* import, erased before the node
   project sees it (`song/[slug]/+page.ts:23` is already this). A **value** import from `./$types`,
   or any `$app/*` runtime import, would make the module unloadable outside a SvelteKit render.
   `$lib/*` aliases resolve fine (the `sveltekit()` plugin is in the test project's `extends`,
   `vite.config.ts:10`).
2. **The loader must stay synchronous and fetch-free.** No `async`, no `event.fetch`, no store
   import. Already true of `song/[slug]`; keep it true. This is also what T-24-08 requires, so the
   test and the threat model agree.
3. **`params` must be supplied ALREADY DECODED** — the test must not pass `50%25%20Off`, because
   SvelteKit's `decode_params` has run by the time `load` sees it. Passing the encoded form would
   bake in the very bug (Pitfall 1) the test exists to prevent. Put that in a comment; it is the
   single most likely executor mistake here.
4. **Co-location in a bracketed route dir works** — precedent:
   `src/routes/api/ytmusic/stream/[videoId]/stream.test.ts` runs today under
   `include: ['src/**/*.{test,spec}.{js,ts}']`. Name the file `loader.test.ts` (not `+…`) so
   SvelteKit ignores it as a route file.

**The three legacy-loader tests are the OG-COMPAT-01 regression gate.** Each must assert:
the query carriers still populate `og`, **and** `load` does not throw for a `%`-bearing
`params.name` (the currently-live 500). That second assertion fails against today's code — write it
before the `decodeURIComponent` deletion, watch it fail, then delete the decode.

---

### 11. `PageOg` assertion path — no analog

No component test exists anywhere in the repo and there is no jsdom project (`vite.config.ts:8-21`
declares one `node` project; the comment at `:14-17` explains that even `*.svelte.test.ts` runs
headless there and is only viable for "pure enough" logic). A `<svelte:head>` render assertion is
not reachable.

**Two viable substitutes, in ladder order:**

1. **Push the assertable logic out of the component.** `og.type` is decided in the loader, not in
   `PageOg` — so the loader tests (§10) already cover "exactly one `og:type`, correct per surface".
   The component keeps only `page.url.origin || SITE_FALLBACK`, which is one `??`-shaped expression.
   This is the lazy answer and it needs no new test file.
2. **The `curl` head check** (VALIDATION.md:56) as the executable gate:
   `curl -s $DEV/song/A/B | grep -c 'og:type'` → `1`, plus `grep 'og:url'` showing the dev origin.
   Proves what no unit test can (the tags are in the **server** HTML). `$DEV` must be RESOLVED, not
   assumed: `.claude/launch.json` / `preview_start` serves **:4321** (`--strictPort`), a bare
   `pnpm dev` serves **:5173**. Both are real.

Recommendation: (1) + (2). Do not stand up a jsdom project for one component.

---

## Shared Patterns

### Own-origin CORS — never per-route, never `*`
**Source:** `src/hooks.server.ts:19-41` (the single seam) + `src/lib/proxy/http.ts:30-40`
**Apply to:** `/api/og` — inherits automatically. **Add no second mechanism.**

```ts
	if (pathname.startsWith('/api/')) {
		const origin = event.request.headers.get('origin');
		// CORS preflight: answer 204 here; do NOT resolve() into route logic (workerd).
		if (event.request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders(origin) });
		}
		const response = await resolve(event);
		for (const [key, value] of Object.entries(corsHeaders(origin))) response.headers.set(key, value);
```

Consequence for the cache write (`:32` comment + §C.14): the hook sets `Vary: Origin` **after** the
route returns, so the copy written inside the route is header-clean and CORS-free. That is why
`cache.put` never trips the `Vary: *` / `Set-Cookie` restrictions.

### Edge cache accessor + key
**Source:** `src/lib/proxy/edge-cache.ts:21-39`
**Apply to:** both `/api/og` cache layers

```ts
export function edgeCache(): EdgeCache | null {
	if (typeof caches === 'undefined') return null;
	return (caches as unknown as EdgeCacheStorage).default ?? null;
}

export function ownOriginCacheKey(url: URL | string): Request {
	return new Request(url.toString());
}
```

The `typeof caches` guard exists exactly once in the repo, on purpose. `edgeCache()` returning
`null` under `vite dev` (`:26-28`) is why Pitfall 8 exists — a live `curl` never exercises the
cache. Layer 1's synthetic key uses the `string` overload; layer 2 uses the `URL` overload.

### Bounded fetch + native timeout
**Source:** `src/lib/proxy/http.ts:1-7, 44-80`
**Apply to:** every `/api/og` upstream call — **with `retries = 0`**

```ts
// - fetchWithRetry: bounded retry on 429/5xx using the NATIVE AbortSignal.timeout
//   (RESEARCH "Don't Hand-Roll" — do NOT hand-roll setTimeout + AbortController).
```

`backoff` is 150 ms → 300 ms → … (`:91-95`), which does not fit the 2.5 s deadline. Pass `0`.
`fetchWithRetry` **throws** after the budget (`:79`), so every tier body needs its own `try`.

### Never-throw boundary returning a sentinel
**Source:** `src/lib/services/itunes-cover.ts:83-100`; contract statements at
`deezer/search/+server.ts:219-222`, `ytmusic/search/+server.ts:89-92`
**Apply to:** `deezer-cover.ts`, `og-cover.ts`, and `/api/og`'s `GET` (which must never 500)

Sentinel per layer: tier → `{ kind:'hit'|'miss'|'error' }`; `fetchDeezerCover` → `null` on fault vs
`{ cover:null }` on clean miss; the route → a 200 + `/og.svg`. **A `catch` must never write cache**
— that discipline is stated in three routes and is a graded OG-EP-02 requirement.

### Comment density with decision refs
**Apply to:** every file this phase touches

The phase's IDs are `OG-PATH-01/02`, `OG-EP-01/02/03`, `OG-ZH-01`, `OG-COMPAT-01`, `OG-PAGE-01`,
`OG-VERIFY-01`, plus new threat tags (`T-og-01` short-circuit, `T-og-02` byte cap). Existing refs
in the touched files — `DQ-1`, `DQ-2`, `D-01`, `D-03`, `D-07`, `T-24-08`, `T-24-09`, `T-gln-02`,
`WR-01`, `quick-260723-r4p`, `quick-260723-ry1`, `quick-260713-mqv` — **must not be deleted**
(CLAUDE.md). When a comment becomes wrong, correct it and keep the tag: e.g.
`song/[slug]/+page.svelte:19` ("The cover is never carried") is already stale and OG-PAGE-01 makes
it doubly so.

### Streaming pass-through with an explicit header allowlist
**Source:** `src/routes/api/ytmusic/stream/[videoId]/+server.ts:107-130`
**Apply to:** `/api/og`'s image response — see §1 Analog B for the excerpt. Build a **fresh**
`Record<string, string>`; never spread `upstream.headers`.

---

## Conventions

Derived with `gsd-tools verify conventions --derive` (the same module `gsd-code-reviewer` runs),
scoped to `src/lib/proxy` (11 files) and re-run over `src/lib/services` (70) and repo-wide (265).

| Axis | Dominant | Share | Entropy | Status |
|---|---|---|---|---|
| file-name casing (`src/lib/proxy`) | — (camel 6 / kebab 3 / other 2) | 55% | 0.906 | contested hotspot |
| identifier casing (`src/lib/proxy`) | `camel` | 100% | 0.000 | **named contract** |
| export style (repo-wide) | `esm` | 100% | 0.000 | **named contract** |
| import style (repo-wide) | `esm` | 100% | 0.000 | **named contract** |

Repo-wide for reference: identifier casing `camel` 70% (contested, entropy 0.634 — the tail is
`Pascal` 256 for types/components and `CONSTANT` 128 for module constants), export/import style
`esm` 100%.

**Contested hotspots (author's choice)**

- **file-name casing is a measurement artifact, not a real split.** The derivation buckets
  single-word lowercase names (`http.ts`, `kuwo.ts`, `qq.ts`) as `camel` and route files
  (`+page.ts`, `+server.ts`, `*.svelte.ts`) as `other`, so a directory that is 100% consistent
  reads as 55%. The actual rule is deterministic **by directory and kind** and is written down in
  CLAUDE.md: `PascalCase.svelte` components · kebab-case pure `.ts` · `<name>.svelte.ts` runes
  stores · `+page.ts` / `+server.ts` routes · co-located `<name>.test.ts`. New Phase-30 files
  follow it with zero ambiguity: `deezer-cover.ts`, `og-cover.ts`, `og-endpoint.test.ts`,
  `loader.test.ts`.
- **identifier casing repo-wide reads contested for the same reason** — `camel` functions/locals,
  `Pascal` types, `CONSTANT` module constants are three *rules*, not three *variants*. Per-scope
  the axis is clean (100% camel in `src/lib/proxy`, 98% in `src/lib/services`).
- **There is no CJS↔ESM dual-resolver split here.** openmusic is `"type": "module"` end to end;
  export/import style is 100% ESM on every axis with zero entropy, so the prototype
  `bin/lib/**` (CJS) vs `sdk/src/**` (ESM) contested-by-design pattern has no analogue in this
  repo. Nothing to match per-directory.
- **One genuine local deviation, flagged in §6:** `PageOg.svelte` and `Nowbar.svelte` use double
  quotes; the other 13 components and CLAUDE.md use single (double is reserved for
  `src/lib/i18n/*`). Match the repo contract on new lines; leave untouched lines alone.

Style facts no tool derives (there is no formatter/linter — `svelte-check` is the only gate):
**tabs** for indentation, single quotes, `import type` for type-only imports, named exports only,
`satisfies`/`as const` over casts, zero `as any` outside tests.

---

## No Analog Found

| File | Role | Data Flow | Reason | Planner action |
|---|---|---|---|---|
| loader tests (5 files) | test (pure fn) | — | No `+page.ts` is tested anywhere; all 9 route tests are `+server.ts` endpoint tests | Use the synthesized shape in §10. It is the intersection of two real patterns (`deezer-endpoint.test.ts:26-35` + `share.test.ts`), and it imposes 4 design constraints on the loaders — treat those as task acceptance criteria |
| `PageOg` assertion path | test (component) | — | No component test exists; no jsdom project (`vite.config.ts:8-21`) | §11: move the assertable logic into the loader (covered by §10) + the `curl` head check. Do not add a jsdom project |
| the `/api/og` tier chain itself | service (pure) | tiered resolve | No multi-upstream *sequential-preference* resolver exists edge-side. `services/fallback.ts` and `cover-backfill.ts` are client-side; `catalog.searchAll` is a parallel `allSettled` fan-out, i.e. the opposite shape | Follow RESEARCH §C.9's `resolveCoverTiered` sketch. Every *primitive* it needs has an analog (§3); only the sequencing is new |

Everything else in the phase is a composition of in-repo patterns. RESEARCH's closing line holds:
*"The only genuinely new code is the tier chain, the two encode/decode helpers, and the route
files."*

---

## Metadata

**Analog search scope:** `src/routes/api/**` (20 `+server.ts`, 9 `*.test.ts`), `src/lib/proxy/**`
(11), `src/routes/(app)/{song,album,artist}/**`, `src/lib/services/{share,api-base,itunes-cover}.ts`,
`src/lib/components/PageOg.svelte`, `src/lib/sources/kuwo.ts`, `src/hooks.server.ts`,
`src/app.d.ts`, `vite.config.ts`.

**Files read in full:** `deezer/search/+server.ts`, `deezer-endpoint.test.ts`,
`ytmusic/search/+server.ts`, `ytmusic/stream/[videoId]/+server.ts`, `proxy/edge-cache.ts`,
`proxy/http.ts`, `proxy/kuwo.ts`, `song/[slug]/+page.ts`, `song/[slug]/+page.svelte`,
`album/[name]/+page.ts`, `artist/[name]/+page.ts`, `PageOg.svelte`, `api-base.ts`, `app.d.ts`,
`hooks.server.ts`, `vite.config.ts`. Targeted ranges: `share.ts:140-309`, `share.test.ts:1-80`,
`itunes-cover.ts:40-100`, `sources/kuwo.ts:55-94`, `api/[source]/[...path]/+server.ts:1-80`.

**Verified by command, not assumption:** `ownOriginCacheKey` call sites (grep, 5 routes + 2
hand-rolled), share call sites (grep: `TrackMenu.svelte:182`, `album/[name]/+page.svelte:439`,
`artist/[name]/+page.svelte:179`), route test inventory (`find`), component quote style (per-file
count), convention axes (`gsd-tools verify conventions --derive`).

**Untouchable file:** `src/routes/api/deezer/search/deezer-endpoint.test.ts` — must pass with zero
edits (OG-EP-03 proof).

**Pattern extraction date:** 2026-08-07
