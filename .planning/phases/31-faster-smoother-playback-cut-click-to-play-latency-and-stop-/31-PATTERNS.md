# Phase 31: Faster, smoother playback — Pattern Map

**Mapped:** 2026-08-09
**Files analyzed:** 19 (5 new, 14 modified — 15 of the modified are i18n dictionaries counted as one row)
**Analogs found:** 18 / 19

Every file in this phase has a close in-repo analog. This is a re-route phase, not a greenfield one: the planner should copy the excerpts below verbatim and change only the payload.

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/routes/api/resolve/+server.ts` | NEW | route (edge endpoint) | request-response + cache-aside | `src/routes/api/deezer/search/+server.ts` | **exact** (JSON + `caches.default` + GET/OPTIONS) |
| `src/lib/proxy/resolve-cache.ts` | NEW | proxy helper (pure, edge-side) | transform / cache read-write | `src/routes/api/og/+server.ts:126-169` (`readResolveCache`/`writeResolveCache`) + `src/lib/proxy/deezer-cover.ts` (C-16 extraction precedent) | **exact** |
| `src/lib/services/resolve-cache-client.ts` | NEW | service (pure, client) | request-response, never-throw | `src/lib/services/deezer.ts` | **exact** |
| `src/routes/api/resolve/resolve-endpoint.test.ts` | NEW | test | — | `src/routes/api/og/og-endpoint.test.ts:746-782` | **exact** |
| `src/lib/proxy/edge-cache.ts` | mod | proxy interface | — | itself (`:13-16`) | **exact** (1-line member add) |
| `src/app.d.ts` | mod | config / ambient types | — | itself (`:21` — the commented-out line) | **exact** |
| `src/lib/services/catalog.ts` | mod | service | request-response | itself (`ensureTrackDetails:288-336`, the `resolveByName` branch at `:304-307`) | **exact** |
| `src/lib/services/blob-store.ts` | mod | service | file-I/O | itself (`get:216-233` — the never-throw read boundary) | **exact** |
| `src/lib/services/download-track.ts` | mod | service | file-I/O / batch | itself (`opts?: { persist?: boolean }` at `:58`) | **exact** |
| `src/lib/stores/player.svelte.ts` | mod | store (runes singleton) | event-driven | itself — 5 in-file idioms (see Pattern Assignments) | **exact** |
| `src/lib/stores/player.svelte.test.ts` | mod | test | — | itself (`:3926` strike describe, `:1015` mirrored constants) | **exact** |
| `src/lib/services/catalog.test.ts` | mod | test | — | itself | **exact** |
| `src/lib/i18n/en.ts` + 14 locales | mod | config (dictionary) | — | `en.ts:330-337` (`toast.skipped` family) | **exact** |
| `src/lib/components/TrackMenu.svelte` | mod | component | event-driven | itself (`gated():63-77`, `versionGen`/`versionAc` plain guards at `:53-55`) | **exact** |
| `src/routes/(app)/search/+page.svelte` | mod | route (page) | event-driven | itself (`void refreshArtistTiles(kw, results)` at `:353`, `onlongpress` at `:693`) | **exact** |

**Correction to RESEARCH.md:** there are **15** locale dictionaries, not 16 (`ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant` — verified via `src/lib/i18n/index.ts:12-26`, which imports exactly 15). CLAUDE.md also says 16. Budget 15 file edits per new key, not 16.

---

## Pattern Assignments

### `src/routes/api/resolve/+server.ts` (route, request-response + cache-aside) — NEW

**Analog:** `src/routes/api/deezer/search/+server.ts` — copy its whole skeleton. It is the JSON edge-cache template (`/api/og` is the *streaming* template and is the wrong shape here).

**Route skeleton + CORS-free store / CORS-per-hit** (`deezer/search/+server.ts:29-99`):
```ts
function jsonResult(result: DeezerCover, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(result satisfies DeezerCover), { status: 200, headers });
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const q = (url.searchParams.get('q') ?? '').trim();
	// Empty/missing q → empty result with NO upstream fetch (T-wv8-01 short-circuit).
	if (!q) return jsonResult({ cover: null, artistPicture: null }, origin);

	// Cache key = the OWN-ORIGIN request (NEVER the upstream URL — T-wv8-06).
	// Guarded for the dev runtime (`vite dev` has no Cache API) so local dev still hits live.
	const cache = edgeCache();
	const cacheReq = new Request(url.toString());

	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			// Re-apply CORS for THIS request's origin (WR-01). The cached entry stores a
			// CORS-FREE body, so a cross-origin hit never receives a prior requester's ACAO.
			const cached = (await hit.json()) as DeezerCover;
			return jsonResult({ ...cached }, origin, DEEZER_COVER_TTL);
		}
	}

	const result = await fetchDeezerCover(q, AbortSignal.timeout(8000), 2, 'xl', limit);
	// null = upstream error / malformed JSON / abort → best-effort empty (NO cache write, so the
	// next request retries instead of pinning the fault for the whole TTL).
	if (!result) return jsonResult({ cover: null, artistPicture: null }, origin);

	if (cache) {
		// Cache a CORS-FREE copy (origin re-applied per request on a hit, WR-01).
		const cached = new Response(JSON.stringify(result satisfies DeezerCover), {
			status: 200,
			headers: {
				'content-type': 'application/json',
				'Cache-Control': `public, max-age=${DEEZER_COVER_TTL}`
			}
		});
		await cache.put(cacheReq, cached);
	}
	return jsonResult(result, origin, DEEZER_COVER_TTL);
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-wv8-02).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
```

Deltas the planner applies to this skeleton:
1. `new Request(url.toString())` → `ownOriginCacheKey(...)` with a **synthetic versioned namespace URL** (see the `/api/og` excerpt below) — the raw request URL is not a safe key here because `k` may arrive with variant casing/order.
2. `await cache.put(...)` → `platform?.ctx?.waitUntil(cache.put(key, forCache).catch(() => {}))` (Anti-pattern: awaiting the write on the hot path).
3. Add `export const POST` for the D-09 bust. **Delete-only, never write** (threat: unauthenticated shared-state write — see RESEARCH § Known Threat Patterns).
4. Length-cap `k` at ingress (`/api/og`'s `MAX_TERM_CHARS = 200` is the in-repo precedent).

**Synthetic versioned cache key** (`src/routes/api/og/+server.ts:296-300`) — the exact shape D-06(a) needs:
```ts
// LAYER 1 (resolve) — NORMALIZED synthetic own-origin key: matchKey() strips case, spaces and
// punctuation, so query-order variants AND the hyphen-for-space share loss share one entry.
const resolveKey = ownOriginCacheKey(
	`${url.origin}/api/og/_resolve?k=${encodeURIComponent(matchKey(artist, title))}&t=${type}`
);
```
`/api/og/_resolve` is **not a real route** — it is a pure key namespace. Mirror it as `/api/resolve/_k?v=1&k=…`. `matchKey` is `src/lib/services/match-key.ts:37`.

**`OPTIONS` note:** `src/hooks.server.ts:26-28` already answers every `/api/*` preflight with a 204 *before* resolving the route, and merges CORS onto every response. The per-route `OPTIONS` export is still the sibling convention (`deezer/search:97`, `og:327`) — keep it for parity, but know it is belt-and-braces.

---

### `src/lib/proxy/resolve-cache.ts` (proxy helper, pure edge-side) — NEW

**Analog:** `src/routes/api/og/+server.ts:126-169`. Copy the three-valued read contract and the negative-caching rule verbatim — they map 1:1 onto D-06(c) ("kuwo has it, netease is dry").

**Three-valued read + best-effort degradation** (`og/+server.ts:126-144`):
```ts
/**
 * Read the resolve layer. THREE-VALUED, mirroring resolveCoverTiered's contract:
 * `undefined` = cache miss (go resolve), a string = cached hit, `null` = cached KNOWN-NONE.
 * Cache reads are best-effort — a broken Cache API degrades to "miss", never to a 500.
 */
async function readResolveCache(
	cache: EdgeCache | null,
	key: Request
): Promise<string | null | undefined> {
	if (!cache) return undefined;
	try {
		const hit = await cache.match(key);
		if (!hit) return undefined;
		const body = (await hit.json()) as { cover?: string | null } | null;
		return body?.cover ?? null;
	} catch {
		return undefined;
	}
}
```

**Negative caching — the D-06(c) rule, already written down** (`og/+server.ts:146-169`):
```ts
/**
 * Write the resolve layer. `null` IS written — a clean all-tier miss is a genuine "this cover does
 * not exist", so negative-caching it makes the repeat crawl cost ZERO subrequests. An `'ERROR'`
 * never reaches here: a fault must be retried next request, not pinned for the whole TTL (the same
 * discipline deezer/search/+server.ts's no-cache-write-on-error branch documents).
 */
async function writeResolveCache(cache: EdgeCache | null, key: Request, cover: string | null) {
	if (!cache) return;
	try {
		await cache.put(
			key,
			new Response(JSON.stringify({ cover }), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			})
		);
	} catch {
		// Caching is best-effort; a failed write only costs the next request a re-resolve.
	}
}
```
Read that comment as the D-06(c) spec: **"netease is dry" is a clean negative → cache it. "netease threw" is a fault → write nothing.**

**Why this file exists at all (C-16):** `src/routes/api/deezer/search/+server.ts:12-13` records the rule in-code:
> `The upstream call itself … now lives in $lib/proxy/deezer-cover so /api/og can share ONE implementation (OG-EP-03) — a +server.ts may only export HTTP verbs, so a shared helper cannot live here (svelte-server-endpoint-only-verb-exports).`

`src/lib/proxy/deezer-cover.ts` is the extraction precedent to mirror for structure.

---

### `src/lib/services/resolve-cache-client.ts` (service, never-throw) — NEW

**Analog:** `src/lib/services/deezer.ts`. This is the D-08 / C-10 contract, and `deezer.ts`'s header states it as a posture spec:

**The posture comment to copy** (`deezer.ts:10-24`):
```ts
// POSTURE (mirrors the prior never-throws cover client this supersedes):
//  - Every network path NEVER throws: a non-ok response / { cover:null } / malformed JSON /
//    abort / any throw all return null. A null → the caller leaves the gradient (never a broken
//    image, never blocks first paint — callers fire this post-paint, capped + cached).
//  - WR-03 / T-17-13 cache posture: only SUCCESSFUL responses are cached. Failures (non-ok,
//    timeout, caller abort, malformed JSON) REJECT inside the cached() factory — never stored —
//    and are mapped to the null/[] sentinel OUTSIDE the cache, so the next call retries instead
//    of pinning "no result" for the 7d/6h TTL.
//  - Every call is bounded by AbortSignal.timeout(FETCH_TIMEOUT_MS) AND honors a caller signal
//    (short-circuits to null immediately if the caller's signal is already aborted)
```

**The exported-boundary sentinel mapping** (`deezer.ts:257-273` — the canonical throw-inside / null-outside split):
```ts
export async function deezerArtist(name: string, signal?: AbortSignal): Promise<DeezerArtistInfo | null> {
	if (signal?.aborted) return null;
	const clean = (name ?? '').trim();
	if (!clean) return null;
	// WR-03 / T-17-13: a timeout/abort/non-ok must NOT pin "no artist info" for 7 days —
	// the failure rejects inside cached() (never stored) and maps to null OUTSIDE the cache,
	// so the next visit retries instead of hiding the Deezer section all session.
	return cached(`dz:artist:${clean}`, TTL_ARTIST, async () => {
		const url = `${ARTIST_PATH}?${new URLSearchParams({ name: clean }).toString()}`;
		const res = await apiFetch(url, { signal: combinedSignal(signal) }); // governed; abort/timeout REJECT
		if (!res.ok) throw new Error(String(res.status));
		return (await res.json()) as DeezerArtistInfo;
	}).catch(() => null); // never throws → caller leaves section absent (D-14)
}
```

**The `apiFetch` opt-in + caller-signal-plus-timeout combinator** (`deezer.ts:115-137`) — copy this, it is how a new caller joins the governor rather than bypassing it:
```ts
function combinedSignal(caller?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	if (!caller) return timeout;
	const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
	return typeof anyFn === 'function' ? anyFn([caller, timeout]) : timeout;
}

async function fetchDeezerOrThrow(term: string, signal?: AbortSignal): Promise<DeezerCover> {
	const res = await apiFetch(buildDeezerSearchUrl(term), { signal: combinedSignal(signal) });
	if (!res.ok) throw new Error(String(res.status));
	return (await res.json()) as DeezerCover;
}
```
Opting into the governor is literally *just* `apiFetch(path, init)` instead of `fetch` — see `src/lib/services/api-base.ts:233-242`. `apiFetch` takes an **own-origin path** (`/api/…`), never an absolute URL.

⚠️ **Do NOT wrap the resolve read in `cached()` (`ttl-cache`).** `catalog.ts:298` documents that `searchAll`'s client TTL cache deliberately caches **search metadata only — never resolved (short-lived) audio URLs**. D-06(b) breaks that rule at the *edge* layer only. Use the never-throw shape from `deezer.ts` **without** the `cached()` wrapper for the URL layer.

⚠️ **D-09's report is a POST** — `apiFetch` (`api-base.ts:237-242`) only dedupes body-less GETs, so a POST always reaches the server. Add a client-side per-uid one-shot guard (plain field, not `$state`).

---

### `src/routes/api/resolve/resolve-endpoint.test.ts` (test) — NEW

**Analog:** `src/routes/api/og/og-endpoint.test.ts:746-782`. Copy `stubCache()` + `fakeEvent()` verbatim, then add the two members RESEARCH flags.

**`stubCache()`** (`og-endpoint.test.ts:746-762`):
```ts
/** In-memory caches.default (the harness at deezer-endpoint.test.ts:279-347). */
function stubCache() {
	const store = new Map<string, Response>();
	const putKeys: string[] = [];
	const cacheStub = {
		match: vi.fn(async (req: Request) => {
			const hit = store.get(req.url);
			return hit ? hit.clone() : undefined;
		}),
		put: vi.fn(async (req: Request, res: Response) => {
			putKeys.push(req.url);
			store.set(req.url, res.clone());
		})
		// ADD for D-09:
		// delete: vi.fn(async (req: Request) => store.delete(req.url))
	};
	vi.stubGlobal('caches', { default: cacheStub });
	return { store, putKeys, cacheStub };
}
```

**`fakeEvent()`** (`og-endpoint.test.ts:764-782`):
```ts
function fakeEvent(
	search: Record<string, string>,
	origin = 'https://openmusic.lol',
	env?: Record<string, string>
) {
	const url = new URL('https://openmusic.lol/api/og');
	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
	return {
		url,
		platform: env ? { env } : undefined,   // ADD for waitUntil: ctx: { waitUntil: vi.fn((p) => p) }
		request: new Request(url, { headers: { origin } })
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callGET = (event: ReturnType<typeof fakeEvent>) => GET(event as any);
```
Note `as any` is the sanctioned test-only escape hatch (C-07 bans it in production source only).

**Assertion style to copy** (`og-endpoint.test.ts:787-813`) — every test asserts the **subrequest count** (`expect(calls).toHaveLength(0)`), which is exactly how D-07's "second identical request = HIT with zero upstream calls" is proven. `vite.config.ts` sets `expect: { requireAssertions: true }`, so no assertion-free test.

---

### `src/lib/proxy/edge-cache.ts` (proxy interface) — MODIFY

**Analog:** itself. One member, matching the existing doc-comment density.

**Current** (`edge-cache.ts:13-16`):
```ts
export interface EdgeCache {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}
```
Add `delete(request: Request): Promise<boolean>` as a proper interface member (C-07: never a cast). The file header (`:1-12`) explains **why** the narrowing interface exists — do not "fix" it by reaching for `@cloudflare/workers-types`' `CacheStorage` (the DOM lib shadows it).

`edgeCache()` at `:26-29` is the **only** `typeof caches` guard in the repo (`quick-260713-mqv`). The new route must call it, never re-guard.

---

### `src/app.d.ts` (config / ambient types) — MODIFY

**Analog:** itself — the change was pre-announced in a comment at `:21`:
```ts
			};
			// ctx?: ExecutionContext;  // add if waitUntil() is needed for caching later
```
Uncomment it. `ExecutionContext` comes from `@cloudflare/workers-types` (already in `tsconfig.json` `types`). Use `ctx`, not the adapter's `@deprecated` `context` alias. Match the surrounding comment density (each existing field carries a threat-ref comment, e.g. `T-5ug-01`).

---

### `src/lib/services/catalog.ts` (service, request-response) — MODIFY

**Analog:** itself. The cache-first read goes exactly where the `resolveByName` branch goes, and copies its never-throw fall-through structure.

**Insertion point + the fall-through idiom to mirror** (`catalog.ts:288-311`):
```ts
export async function ensureTrackDetails(
	track: Track,
	signal?: AbortSignal,
	quality?: DefaultQuality
): Promise<Track> {
	if (track.detailsLoaded && track.audioUrl && (track.lrc || !track.lrcUrl)) {
		return track;            // ← readiness guard: a cache hit that fills audioUrl + detailsLoaded
	}                            //   makes EVERY downstream caller short-circuit. This is what
	const sig = signal ?? new AbortController().signal;   //   makes pre-warm "free".

	// ◄── D-08 CACHE-FIRST READ SLOTS IN HERE (after sig normalisation, before resolveByName)

	// RESOLVE-02: … On a null return (every source missed or the signal aborted) fall through by
	// returning the unresolved stub: the caller (player.play) treats an audioUrl-less result as a
	// failed resolve and routes to its existing error/fallback path (never-throw).
	if (track.resolveByName && !track.detailsLoaded) {
		const named = await resolveNameStub(track.artist, track.title, sig);
		return named ?? track;     // ← copy this `?? fallthrough` shape for the cache hit
	}

	// WR-07: `quality` threads an explicit per-call tier to the adapter …
	const resolved = await SOURCES[track.source].resolve(track, sig, quality);
```

**AbortSignal threading:** `sig` is already threaded into every downstream call and re-checked after each await (`:328` `!sig.aborted`, `:331`). The cache call must accept and honour the same `sig`.

**Cache write** goes after `SOURCES[…].resolve` succeeds with a truthy `audioUrl` — fire-and-forget, mirroring the `void`-prefixed background calls elsewhere. Never awaited, never allowed to reject into the caller.

⚠️ **Pitfall 6 (open design question, not settled):** the serial cache read adds an edge round-trip to every cold play. RESEARCH § Open Questions #1 recommends serial-with-`AbortSignal.timeout(~400ms)` first, then measure.

---

### `src/lib/services/blob-store.ts` (service, file-I/O) — MODIFY (D-13)

**Analog:** itself. The D-13 size check belongs at the `get` boundary so all three player call sites inherit it (the lazy fix *is* the root-cause fix).

**The read boundary to extend** (`blob-store.ts:212-233`):
```ts
/**
 * Read the Blob for `uid`. Resolves to the Blob (cache hit), null (miss), or null on any
 * error. Never throws.
 */
export async function get(uid: string): Promise<Blob | null> {
	if (!uid) return null;
	if (Capacitor.isNativePlatform()) return nativeGet(uid);
	const db = await openDb();
	if (!db) return null;
	return new Promise<Blob | null>((resolve) => {
		try {
			const req = txStore(db, 'readonly').get(uid);
			req.onsuccess = () => {
				const v = req.result as Blob | undefined;
				resolve(v instanceof Blob ? v : null);   // ← D-13 size/type gate goes HERE
			};
			req.onerror = () => resolve(null);
			…
```
Note there are **two** read paths — `nativeGet(uid)` at `:122` (Capacitor) returns early at `:218` and needs the same gate, or the gate must wrap both. The `blobStore` namespace export is at `:255`.

Because a rejected-as-too-small blob returns `null`, all three player sites already handle it correctly today (`play():2532` and `restore():491` fall through to `ensureTrackDetails` on a null). **D-13 alone fixes the "bad bytes" case for zero-byte blobs at zero call-site cost.** D-12 is only needed for a blob that is plausibly-sized but still corrupt.

---

### `src/lib/services/download-track.ts` (service, file-I/O) — MODIFY (D-12, Pitfall 4)

**Analog:** itself. The options pattern already exists — extend it, don't fork a second download path.

**Existing option shape** (`download-track.ts:53-58`):
```ts
/**
 * Download ONE song: resolve→addDownload→fetch→(persist)→save. Isolation-safe, never-throws,
 * never-navigates. `opts.persist` defaults TRUE; `persist:false` (the album bulk path) skips
 * …
 */
export async function downloadTrack(track: Track, opts?: { persist?: boolean }): Promise<DownloadResult> {
```
and its use at `:109`: `if (opts?.persist !== false) { … }`.

Add `save?: boolean` the same way (`if (opts?.save !== false) return saveBlobToDisk(...)`) so D-12's background re-download is `downloadTrack(track, { persist: true, save: false })`. The file's header comment says ONE download orchestration is the point — honour it.

---

### `src/lib/stores/player.svelte.ts` (runes store, event-driven) — MODIFY

**Analog:** itself. Five in-file idioms to copy; every one of them is a post-mortem artefact, so match the comment density (C-08).

**(1) `driveSrc()` — the provenance flag site** (`:1166-1193`):
```ts
	/**
	 * SINGLE AUDIO.SRC AUTHORITY + RE-DRIVE BRAKE (debug-song-click-lrc-flood-noplay). The one place a
	 * playback stream is attached to `<audio>` for a network/CDN track. Returns true after setting the
	 * src; returns FALSE (and STOPS via haltRunawayRecovery) when the SAME uid has been re-driven
	 * SRC_REDRIVE_CAP times within SRC_REDRIVE_WINDOW_MS with no real `playing` between …
	 * Callers MUST bail their own play/re-resolve when this returns false.
	 */
	private driveSrc(uid: string, url: string): boolean {
		if (!this.audio) return false;
		const now = Date.now();
		this.driveBurst =
			uid === this.lastDriveUid && now - this.lastDriveAt < Player.SRC_REDRIVE_WINDOW_MS
				? this.driveBurst + 1
				: 0;
		this.lastDriveUid = uid;
		this.lastDriveAt = now;
		if (this.driveBurst >= Player.SRC_REDRIVE_CAP) {
			logAction('src.redrive-brake', { uid, burst: this.driveBurst });
			this.driveBurst = 0;
			this.haltRunawayRecovery();
			return false;
		}
		this.audio.src = url;
		return true;
	}
```
`driveBurst` / `lastDriveUid` / `lastDriveAt` are **plain class fields, not `$state`** — this is the C-02 template for the new `lastSrcKind: 'url' | 'download-blob' | 'prebuffer-blob'` field. It is internal, never UI-read.

**(2) The direct-assign site the flag must ALSO cover** (`play():2568`, inside the offline-blob early branch):
```ts
			if (library.isDownloaded(track.uid)) {
				const offlineBlob = await blobStore.get(track.uid).catch(() => null);
				if (myGen !== this.playGen) return; // CR-02: superseded mid-IDB-read — discard
				if (offlineBlob && this.audio) {
					…
					this.audio.src = this.cachedBlobUrl;   // ← BYPASSES driveSrc (:2568)
					this.armStall();
```
`restore():525` is the mirror of this. Per RESEARCH Open Question #3: **set the flag at all four sites; do not migrate these to `driveSrc()` this phase.** Note the `if (myGen !== this.playGen) return;` line — that is the generation-guard idiom (C-09) to reuse verbatim in every new async path.

**(3) The `audio.error` ceiling block — where the D-12 blob branch goes AFTER** (`:1660-1691`):
```ts
			if (this.rapidErrorBurst >= Player.RAPID_ERROR_CAP || this.errorBurst >= Player.FAILURE_CAP) {
				logAction('error.ceiling', { uid: this.current?.uid, rapid: this.rapidErrorBurst, burst: this.errorBurst });
				this.errorBurst = 0;
				this.rapidErrorBurst = 0;
				this.reresolveBurst = 0;
				// D-12: never-stop wins over explicit repeat — break a repeat-one loop on a failing track.
				if (this.repeatMode === 'one') { this.repeatMode = 'off'; this.persist(); }
				this.playing = false;
				if (this.current) this.strikeUnplayable(this.current.uid);
				// SYSTEMIC-FAILURE CEILING (debug-nowbar-frozen-audius-spam): … once
				// SYSTEMIC_SKIP_CAP distinct tracks fail back-to-back the outage is systemic, so STOP.
				if (++this.failoverSkips >= Player.SYSTEMIC_SKIP_CAP) {
					this.haltRunawayRecovery();
					return;
				}
				this.next();     // ← D-18 GAP: skips with NO emitSkipNotice
				return;
			}
```
This block must keep winning — insert the D-12 branch immediately *after* it and *before* the seek branch (`:1702`). `++this.failoverSkips` before `SYSTEMIC_SKIP_CAP` is the shape every **new** skip path added by D-15/D-18 must copy (D-17's only cross-track backstop).

**(4) `strikeUnplayable` / `clearStrike` / `handleDefinitiveFailure` — the D-15/D-16 edit surface** (`:828-896`):
```ts
	/** Confirmed-definitive-failure strikes required before a uid is promoted into unplayableUids
	 *  (the over-aggressive-skip fix). Private static for tunability. */
	private static STRIKE_CAP = 2;                                    // ← D-16 raises this

	private strikeUnplayable(uid: string): boolean {
		const n = (this.unplayableStrikes.get(uid) ?? 0) + 1;
		this.unplayableStrikes.set(uid, n);
		if (n >= Player.STRIKE_CAP) {
			logAction('mark-dead', { uid });
			this.unplayableUids.add(uid);
			return true;
		}
		return false;
	}

	/** Drop a uid's accumulated strikes (a recovery point: a real `playing`, an explicit retry, or a
	 *  full session reset). … */
	private clearStrike(uid: string): void {
		this.unplayableStrikes.delete(uid);
	}

	private handleDefinitiveFailure(uid: string): void {
		const reachedCap = this.strikeUnplayable(uid);
		if (!reachedCap) return; // sub-cap: transient-equivalent this round, nothing further to do
		const budgetLeft = (this.retryResolveAttempts.get(uid) ?? 0) < Player.RETRY_RESOLVE_MAX;
		if (budgetLeft) {
			this.unplayableUids.delete(uid);
			this.scheduleRetryResolve(uid);
		}
	}
```
`handleDefinitiveFailure` is the **single decision point** for a definitive prefetch-walk failure — D-15's cross-source retry belongs here (or immediately before its `strikeUnplayable` call), not scattered across `prefetchNext`'s two call sites (`:2142`, `:2155`). `unplayableStrikes` is a plain `Map`, not `$state`; only `unplayableUids` (the SvelteSet driving the ✗ row) is reactive — copy that split.

**(5) `emitSkipNotice()` — the D-14/D-18 toast channel; do NOT invent one** (`:3500-3526`):
```ts
	/**
	 * Emit a batched auto-skip notice (D-02). N consecutive skips within SKIP_BURST_WINDOW_MS
	 * collapse into ONE notice carrying the running `count` …
	 */
	private emitSkipNotice(title: string) {
		this.skipBurst++;
		this.notice = {
			kind: 'skip',
			// WR-03: emit the REAL toast key the host renders (singular vs the batched plural),
			// not a phantom `player.notice.skip` token that exists in no dictionary.
			msg: this.skipBurst > 1 ? 'toast.skippedMany' : 'toast.skipped',
			count: this.skipBurst,
			title
		};
		if (this.skipBurstTimer) clearTimeout(this.skipBurstTimer);
		this.skipBurstTimer = setTimeout(() => {
			this.skipBurst = 0;
			this.skipBurstTimer = null;
			// WR-04: clear the channel when the burst window closes …
			if (this.notice?.kind === 'skip') this.notice = null;
		}, Player.SKIP_BURST_WINDOW_MS);
	}
```
D-14's corrupt-download toast is a **new `kind`** on `PlayerNotice` (or a reuse of `kind:'skip'` with a different `msg`) — see Shared Patterns § Toast channel.

---

### `src/lib/stores/player.svelte.test.ts` (test) — MODIFY

**Analog:** itself. Two things to copy:

**Module mocks already in place** (`:14-27`) — every dependency this phase touches is already mockable:
```ts
vi.mock('$lib/services/catalog', () => ({ ensureTrackDetails: vi.fn(), searchAll: vi.fn() }));
vi.mock('$lib/services/fallback', () => ({ tryFallback: vi.fn(), fallbackOrder: vi.fn(() => []) }));
vi.mock('$app/environment', () => ({ browser: true }));
// WR-02/CR-02: mock the IDB blob store so the offline-blob read in reresolveCurrent/play can be a
// DEFERRED promise (controls the await window the gen re-check guards). Defaults to a miss.
vi.mock('$lib/services/blob-store', () => ({
	blobStore: { get: vi.fn(async () => null), put: vi.fn(), del: vi.fn() }
}));
```
D-13's test is one line on top of this: `blobStore.get.mockResolvedValue(new Blob([]))`.

**Hand-mirrored constants** (`:198-205`, `:1015-1016`):
```ts
const Player_FAILURE_CAP = 5;
const Player_SYSTEMIC_SKIP_CAP = 5;
const Player_STALL_TIMEOUT_MS = 15000;
const Player_PREFETCH_PLAYBACK_DELAY_MS = 5000;
…
	const Player_RETRY_RESOLVE_MAX = 2;
	const Player_RETRY_RESOLVE_DELAY_MS = 4000;
```
⚠️ **There is currently no `Player_STRIKE_CAP` mirror** — the strike suite at `:3926` hardcodes the value inline. D-16's raise means editing the strike describe block (`:3919-…`) and the HUO-RETRY suite (`:1001-1100`), both of which drive the walk "to STRIKE_CAP" with a literal loop count. **No compiler check catches a stale mirror.** Adding an explicit `const Player_STRIKE_CAP = N;` at the top with the others is the lazy prophylactic.

---

### `src/lib/i18n/*.ts` (config dictionary × 15) — MODIFY

**Analog:** `src/lib/i18n/en.ts:326-337` — the exact toast family the new keys join:
```ts
	"toast.playingNext": "Playing next",
	"toast.addedToQueue": "Added to queue",
	"toast.preparingDownload": "Preparing download…",
	"toast.noAudio": "No audio available",
	"toast.skipped": "Couldn't play · {title} — skipped",
	"toast.skippedMany": "{count} songs skipped",
	"toast.playbackStopped": "Playback stopped — couldn't load songs",
	"toast.retry": "Retry",
	"toast.offlineNoDownloads": "You're offline — no downloaded songs to play",
	"toast.downloaded": "Downloaded · added to Library",
	"toast.openedAudio": "Opened audio · added to Library",
	"toast.downloadFailedKeptInLibrary": "Couldn't save · kept in Library",
```
**Double quotes on key AND value.** No formatter enforces it. `{title}` / `{count}` are the existing interpolation slots. `en` is the reference locale — `TranslationKey` is derived from it, so a key added to `en` alone makes the other 14 a compile error, and `i18n.test.ts` guards key-set parity.

**D-18 note:** `toast.skipped` already reads "Couldn't play · {title} — skipped", which is *exactly* D-18's requested copy. D-18 may need **zero** new keys — it needs the three silent skip paths routed into the existing `emitSkipNotice`. Only D-14 (corrupted download) needs a genuinely new key.

---

### `src/lib/components/TrackMenu.svelte` (component, event-driven) — MODIFY (D-03 pre-warm trigger 2)

**Analog:** itself. This is the **single seam** for D-03's second trigger — TrackMenu is mounted from 7 route pages (`(app)/+page`, `search`, `library`, `album/[name]`, `artist/[name]`, `charts/tags/[tag]`, `charts/countries/[country]`), so one `$effect` here covers all of them. Hooking the pre-warm at each page's `onlongpress` would be 7 diffs for the same behaviour.

**The existing resolve-on-demand shape to copy** (`TrackMenu.svelte:63-77`):
```ts
	async function gated(key: string, run: (resolved: Track) => void | Promise<void>) {
		if (!track) return;
		if (!shouldStartResolve(inFlight, key)) return; // D-03: a second tap while spinning is a no-op
		if (isGatedReady(track)) return void run(track); // fast path: already resolved, run on the stub now
		inFlight = new Set(inFlight).add(key);
		try {
			const resolved = await ensureTrackDetails(track);
			if (!resolved.audioUrl) { toast.show(t('toast.noAudio')); return; }
			await run(resolved);
		} catch {
			toast.show(t('toast.noAudio')); // never a stuck spinner on throw
		} finally {
			const next = new Set(inFlight); next.delete(key); inFlight = next;
		}
	}
```
The pre-warm is this minus the spinner and minus the toast: `if (open && track) void ensureTrackDetails(track).catch(() => {})`, guarded by a uid dedupe.

**Plain (non-reactive) supersedence guards — the C-02 template in a component** (`TrackMenu.svelte:53-55`):
```ts
	let versionsOpen = $state(false);
	let versionAc: AbortController | null = null;
	let versionGen = 0;         // PLAIN, not $state — a supersedence token the UI never reads
```
The header comment at `:44-46` names it: *"versionGen/versionAc are PLAIN (non-reactive) supersedence guards (house idiom)"*.

⚠️ **Read the existing boundary comment before writing this** (`TrackMenu.svelte:40-47`):
> *"the cross-source variants are discovered on demand — but ONLY when the user taps the Play-from-source row (openVersions), **NEVER on menu open (no background fan-out; T-26-10-02)**."*

That rule is about **cross-source fan-out**, not a single-track resolve. D-03 authorises exactly one `ensureTrackDetails` on menu open. The planner MUST add a comment distinguishing the two, or the next reader will read D-03 as a T-26-10-02 violation and revert it.

---

### `src/routes/(app)/search/+page.svelte` (route page, event-driven) — MODIFY (D-03 pre-warm trigger 1)

**Analog:** itself.

**Fire-and-forget-with-race-guard, the shape to copy** (`search/+page.svelte:353` and `:360-365`):
```ts
			// kyf: derive artist tiles from the settled result set (race-guarded inside).
			void refreshArtistTiles(kw, results);
			…
			void dedupeBestWithDeezer(interleaved, settings.preferredSource, ac.signal).then((boosted) => {
				if (myAc.signal.aborted || kw !== q.trim()) return;   // supersede guard AFTER the await
				results = rankList(boosted, kw);
				persistSession();
			});
```

**Pitfall 5 is visible right here — `results` is reassigned FOUR times per query** (`:344` per-partial, `:348` final, `:363` Deezer boost), and `results[0]`'s identity changes across them. An `$effect` on `results[0]` fires 4–8× per search. The mandated guard is a plain `lastPrewarmedUid` module/component field (not `$state`), with `apiFetch`'s GET dedupe as the second line. **Do not add a debounce timer.**

**Longpress handler** (`search/+page.svelte:693`) — the trigger-2 site the TrackMenu `$effect` replaces:
```svelte
					onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); menuTrack = t; menuOpen = true; }}
```

---

## Shared Patterns

### Never-throw service boundary (D-08 / C-10)
**Source:** `src/lib/services/deezer.ts:10-24` (posture comment) + `:257-273` (implementation)
**Apply to:** `resolve-cache-client.ts` (both read and report), any new client-side async helper.
Rule: throw *inside*, `.catch(() => null)` at the *exported* boundary. A `null` means "no data — fall back," never a rejection into the render tree.

### `apiFetch` governor opt-in
**Source:** `src/lib/services/api-base.ts:233-242`; caller example `deezer.ts:134`
**Apply to:** the pre-warm resolve (indirectly, via `ensureTrackDetails`), the cache read, the D-09 report.
```ts
const res = await apiFetch(url, { signal: combinedSignal(signal) }); // governed; abort/timeout REJECT
```
Opting in is the whole integration. **Do NOT add a second throttle/debounce** — `api-base.ts:36-51` names composed local bounds as the `api-fetch-flood-freeze` root cause.
**Exception to document:** any raw `fetch` (edge-side, or media bytes) MUST carry the audit comment: `// RAW fetch (not apiFetch — fetch→apiFetch audit)` — precedent at `og/+server.ts:182-184`.

### Edge cache access + key construction
**Source:** `src/lib/proxy/edge-cache.ts:26-39`
**Apply to:** `api/resolve/+server.ts`, `lib/proxy/resolve-cache.ts`.
```ts
export function edgeCache(): EdgeCache | null {
	if (typeof caches === 'undefined') return null;
	return (caches as unknown as EdgeCacheStorage).default ?? null;
}

/**
 * … The cache key MUST be the own-origin URL, NEVER the secret-bearing upstream URL …
 */
export function ownOriginCacheKey(url: URL | string): Request {
	return new Request(url.toString());
}
```
Exactly ONE `typeof caches` guard in the repo (`quick-260713-mqv`). Never re-guard, never build the key `Request` inline.

### CORS: store CORS-free, re-apply per hit (WR-01)
**Source:** `src/routes/api/og/+server.ts:113-124` (`withCors`) + `deezer/search:56-72`
**Apply to:** the new route.
The `cache.put` body is a **fresh `Response` with an explicit header allow-list** (`content-type` + `Cache-Control` only). Never `cache.put` the response object that passed through `src/hooks.server.ts:33-37` — it carries `Vary: Origin` (fragments the entry) and could carry `Set-Cookie`.

### Generation-guard idiom (C-09)
**Source:** `src/lib/stores/player.svelte.ts:2534`
```ts
	const offlineBlob = await blobStore.get(track.uid).catch(() => null);
	if (myGen !== this.playGen) return; // CR-02: superseded mid-IDB-read — discard
```
**Apply to:** every new async path in the player store. Snapshot before the first `await`, re-check after **every** `await`.
**Exception the plan must state:** D-12's background re-download is deliberately **not** `playGen`-guarded (the user has moved on and that's fine) — it needs a **uid-keyed one-shot dedupe** instead.

### Reactive vs plain field split (C-02)
**Source:** `player.svelte.ts:1179-1184` (`driveBurst`/`lastDriveUid`/`lastDriveAt`, plain) vs `:147` (`notice = $state<PlayerNotice | null>(null)`); component form at `TrackMenu.svelte:53-55`.
**Apply to:** the new `lastSrcKind` provenance flag, the pre-warm `lastPrewarmedUid`, the report one-shot set, any new strike counter — **all plain**. Only a field the UI reads is `$state`.

### Toast channel — store emits `TranslationKey`, layout host renders (C-04)
**Source:** `player.svelte.ts:110-125` (`PlayerNotice`) + `:3506-3526` (`emitSkipNotice`) + `src/routes/(app)/+layout.svelte:54-66` (the host `$effect`)
```ts
export interface PlayerNotice {
	kind: 'skip' | 'stopped';
	/** A REAL TranslationKey the UI may render directly via t() (WR-03) … */
	msg: TranslationKey;
	reason?: 'loop-guard' | 'offline';
	count?: number;
	title?: string;
	action?: () => void;
}
```
The host at `(app)/+layout.svelte:54` reads `player.notice` one-way and calls `t()`. **Never localize in the store.** D-14 adds a `kind` (or reuses `'skip'` with a new `msg`) — either way the store sets only the key + interpolation slots.
Note `(app)/+layout.svelte:63-66` warns that `t()` must NOT be tracked in that effect, and that the store clears `'skip'` notices when the burst window closes. A new notice kind that is never cleared will re-toast on a language switch.

### Logging / diagnostics (D-14, D-17 regression detection)
**Source:** `player.svelte.ts:1661` (`logAction('error.ceiling', {...})`), `:858` (`mark-dead`), `:1186` (`src.redrive-brake`)
**Apply to:** every new failure branch. Structured `logAction(event, fields)` — never on a per-frame path. Already mocked call-through in the test file (`player.svelte.test.ts:56-59`), so the D-14 log entry is directly assertable.

---

## Conventions

Derived repo-wide over `src/lib` (190 files) via `gsd-tools verify conventions --derive --scope src/lib`.

| Axis | Dominant | Share | Entropy | Status |
|------|----------|-------|---------|--------|
| file-name casing | *(none)* | 48% | 0.944 | **contested hotspot** |
| identifier casing | `camel` | 95% | 0.194 | **named contract** |
| export style | `esm` | 100% | 0.000 | **named contract** |
| import style | `esm` | 100% | 0.000 | **named contract** |

**Named contracts (must match):** `camelCase` identifiers (`PascalCase` only for types/classes/components), ESM `export`/`import` throughout, **named exports only** — no default exports in `$lib`.

**Contested hotspots (author's choice).** `file-name-casing` is contested at 48% dominance and that is **intentional and per-directory deterministic**, exactly like the prototype CJS↔SDK dual-resolver split. Here the split is a **runes/pure/component tri-split**, and each subtree is internally consistent:

| Subtree | Convention | Why |
|---------|------------|-----|
| `src/lib/components/**` | `PascalCase.svelte` | Svelte component convention |
| `src/lib/stores/**` | `camelCase.svelte.ts` | the `.svelte.ts` suffix is REQUIRED for the Vite plugin to transform runes |
| `src/lib/services/**`, `src/lib/proxy/**` | `kebab-case.ts` | pure, node-testable logic |

Contested only when measured repo-wide; unambiguous within any one directory. **Match the directory's local style, do not "normalize."** For this phase that resolves to: `src/lib/proxy/resolve-cache.ts` and `src/lib/services/resolve-cache-client.ts` (kebab), no new store file, no new component file.

Two further manual conventions no tool derives:
- **Tabs** for indentation; **single quotes** in TS/JS — **except** `src/lib/i18n/*.ts`, which uses **double quotes on every key AND value**.
- **High comment density is load-bearing.** Comments are decision records tagged `D-NN` / `quick-NNNNNN-xxx` / `T-xx-NN`. Every new site in this phase gets a phase-31 `D-NN` tag; never delete an existing decision-ref comment.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `platform.ctx.waitUntil(...)` usage in the new route | route | fire-and-forget write | **No in-repo caller exists.** `/api/og` and `deezer/search` both `await` `cache.put` inline; `src/app.d.ts:21` has the type commented out. Use RESEARCH § Code Examples (`platform?.ctx?.waitUntil(cache.put(key, forCache).catch(() => {}))`) — verified against `node_modules/@sveltejs/adapter-cloudflare/ambient.d.ts`, not against an in-repo precedent. Also has **no test analog**: `fakeEvent()` builds no `ctx`. |

Everything else has a same-role, same-data-flow analog.

---

## Metadata

**Analog search scope:** `src/routes/api/**`, `src/lib/proxy/**`, `src/lib/services/**`, `src/lib/stores/**`, `src/lib/components/**`, `src/lib/i18n/**`, `src/routes/(app)/**`
**Files read for excerpts:** 16 (`edge-cache.ts`, `deezer/search/+server.ts`, `og/+server.ts`, `og-endpoint.test.ts`, `app.d.ts`, `hooks.server.ts`, `catalog.ts`, `deezer.ts`, `api-base.ts`, `player.svelte.ts` ×6 ranges, `player.svelte.test.ts`, `blob-store.ts`, `download-track.ts`, `en.ts`, `TrackMenu.svelte`, `search/+page.svelte`)
**Conventions derivation:** `gsd-tools verify conventions --derive --scope src/lib` (190 files, 4 axes)
**Pattern extraction date:** 2026-08-09
