// Production stall-fallback byte proxy — the shared handler (Hector 2026-11-19, option ii).
//
// POSTURE: the primary playback path stays DIRECT — the edge never touches audio bytes in
// normal playback (deliberate legal hygiene, see the media-cache audit). This handler exists
// ONLY as a rescue: the player re-attaches through it after a slow-source track has proven it
// cannot sustain direct playback (see $lib/services/proxy-rescue for the trigger). Bytes are
// therefore relayed/cached only for tracks that actually stalled for a real listener.
//
// SOURCE-GENERIC BY SHAPE: the handler knows nothing about any provider. A route wires it by
// supplying `resolveUrl(id, level)` (the provider's EXISTING server-side resolve seam — never
// a client-supplied URL) and a stable `cacheKey`. Kuwo is the only wired source in this ship;
// qq/joox/kugou/migu adopt it later by adding a route, not by touching this file.
//
// STREAM-TEE (the spike's lesson, audit §D finding 2): a cache MISS never buffers the whole
// object before responding — the upstream body is tee'd, one branch streams to the client as
// bytes arrive (fast first byte), the other branch is stored into the Cloudflare Cache API
// under the stable uid|tier key. Warmth is per-PoP (audit §D finding 3): a HIT is the fastest
// path measured (886 KB/s vs direct's 25.8–271 KB/s variance band), and a MISS still usually
// beats the device→China-CDN leg because the edge→CDN leg is the shorter haul.
//
// RANGE CORRECTNESS (audit §D finding 1): 
//   - HIT + Range → sliced from the cached full object (206, exact Content-Range).
//   - MISS + a partial Range (start > 0, a bounded end, or a suffix) → the client's Range is
//     forwarded upstream and the 206 streams straight through (no tee — a partial body must
//     never be stored as the full object), while a background full-object fetch warms the
//     cache for the next listener (best effort, waitUntil).
//   - MISS + no Range (or an open-ended `bytes=0-`, the media element's initial attach) →
//     the stream-tee path above, answered 200 with the full length + Accept-Ranges, so the
//     element learns the size and can seek via later Range requests.
import { edgeCache, type EdgeCache } from './edge-cache';

/** Cache-API TTL for a stored object: 30 days. The bytes behind a uid|tier NEVER change
 *  (cache-until-death doctrine, Hector 2026-11-19) — eviction is Cloudflare's natural LRU,
 *  and a stale entry is impossible in content terms (same key = same encode forever). */
export const BYTE_PROXY_TTL_S = 30 * 24 * 3600;
/** Browser-facing freshness for proxy responses: a rescued track's URL is stable per
 *  uid|tier, so a replay can be served by the browser's own media cache for a week. */
export const BYTE_PROXY_BROWSER_TTL_S = 7 * 24 * 3600;

export interface ByteProxyDeps {
	/** Provider track id, ALREADY validated by the route (digits/shape per provider). */
	id: string;
	/** Quality tier token, ALREADY whitelisted by the route. */
	level: string;
	/** The provider's server-side resolve seam: uid|tier → signed upstream URL, or null.
	 *  This is the ONLY way an upstream URL enters the handler — the request itself never
	 *  carries one (no open relay). */
	resolveUrl: (id: string, level: string) => Promise<string | null>;
	/** Stable own-origin Cache API key URL for this uid|tier. */
	cacheKey: string;
	/** Injectable for tests; defaults to the real edge cache (null under `vite dev`). */
	cache?: EdgeCache | null;
	/** Injectable for tests; defaults to the global fetch. */
	fetchImpl?: typeof fetch;
	/** Injectable for tests; defaults to platform ctx waitUntil at the route. Background
	 *  cache writes (tee branch, partial-range warm) ride on this so they outlive the
	 *  response without delaying it. Without it they are fire-and-forget. */
	waitUntil?: (p: Promise<unknown>) => void;
	ttlSec?: number;
}

export interface ParsedRange {
	/** Byte offset the range starts at; null for a suffix range (`bytes=-N`). */
	start: number | null;
	/** Inclusive end offset; null = open-ended (to EOF). */
	end: number | null;
	/** Suffix length for `bytes=-N`; null otherwise. */
	suffix: number | null;
}

/** Parse a SINGLE-range `Range` header. Multi-range and malformed headers return null
 *  (treated as "no range" — the full-object path — which every media element accepts). */
export function parseRangeHeader(header: string | null): ParsedRange | null {
	if (!header) return null;
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m) return null;
	if (m[1] === '' && m[2] === '') return null;
	if (m[1] === '') {
		const suffix = Number(m[2]);
		return Number.isFinite(suffix) && suffix > 0 ? { start: null, end: null, suffix } : null;
	}
	const start = Number(m[1]);
	if (!Number.isFinite(start)) return null;
	if (m[2] === '') return { start, end: null, suffix: null };
	const end = Number(m[2]);
	return Number.isFinite(end) && end >= start ? { start, end, suffix: null } : null;
}

/** True when the range covers the whole object from byte 0 (no range at all, or the media
 *  element's open-ended initial attach `bytes=0-`) — the only MISS shape that may tee,
 *  because the upstream body IS the full object. */
export function isFullRange(range: ParsedRange | null): boolean {
	return !range || (range.suffix === null && range.start === 0 && range.end === null);
}

/** Resolve a parsed range against a known object length. Null = unsatisfiable (→ 416). */
export function resolveRange(range: ParsedRange, length: number): { start: number; end: number } | null {
	if (length <= 0) return null;
	let start: number;
	let end: number;
	if (range.suffix !== null) {
		start = Math.max(0, length - range.suffix);
		end = length - 1;
	} else {
		start = range.start ?? 0;
		end = range.end === null ? length - 1 : Math.min(range.end, length - 1);
	}
	if (start >= length || end < start) return null;
	return { start, end };
}

function clientHeaders(contentType: string, state: 'HIT' | 'MISS' | 'PASS', contentLength?: string | null): Headers {
	const h = new Headers({
		'content-type': contentType,
		'accept-ranges': 'bytes',
		'x-om-proxy': state,
		'cache-control': `public, max-age=${BYTE_PROXY_BROWSER_TTL_S}`
	});
	if (contentLength) h.set('content-length', contentLength);
	return h;
}

function storedHeaders(contentType: string, contentLength: string | null, ttlSec: number): Headers {
	const h = new Headers({
		'content-type': contentType,
		'accept-ranges': 'bytes',
		'cache-control': `public, max-age=${ttlSec}, s-maxage=${ttlSec}`
	});
	if (contentLength) h.set('content-length', contentLength);
	return h;
}

/** Serve a Range from a fully-buffered object (the HIT path). 416 when unsatisfiable. */
function serveRangeFromBuffer(buf: ArrayBuffer, range: ParsedRange, contentType: string): Response {
	const resolved = resolveRange(range, buf.byteLength);
	if (!resolved) {
		return new Response(null, {
			status: 416,
			headers: { 'content-range': `bytes */${buf.byteLength}`, 'x-om-proxy': 'HIT' }
		});
	}
	const slice = buf.slice(resolved.start, resolved.end + 1);
	const headers = clientHeaders(contentType, 'HIT', String(slice.byteLength));
	headers.set('content-range', `bytes ${resolved.start}-${resolved.end}/${buf.byteLength}`);
	return new Response(slice, { status: 206, headers });
}

/**
 * Handle one byte-proxy GET. Never throws: resolve/upstream failures answer 502 (the
 * player's error/failover chain owns a dead rescue exactly like a dead direct URL).
 */
export async function handleByteProxy(request: Request, deps: ByteProxyDeps): Promise<Response> {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const cache = deps.cache === undefined ? edgeCache() : deps.cache;
	const ttl = deps.ttlSec ?? BYTE_PROXY_TTL_S;
	const range = parseRangeHeader(request.headers.get('range'));
	const cacheReq = new Request(deps.cacheKey);
	const keepAlive = (p: Promise<unknown>) => {
		const guarded = p.catch(() => {
			/* background cache work is best-effort — it must never surface as a request error */
		});
		if (deps.waitUntil) deps.waitUntil(guarded);
	};

	// ── HIT: serve from the edge cache ──────────────────────────────────────────────
	if (cache) {
		const hit = await cache.match(cacheReq).catch(() => undefined);
		if (hit) {
			const contentType = hit.headers.get('content-type') ?? 'audio/mpeg';
			if (!range) {
				// Stream the cached body straight through — no buffering on the hot path.
				return new Response(hit.body, {
					status: 200,
					headers: clientHeaders(contentType, 'HIT', hit.headers.get('content-length'))
				});
			}
			const buf = await hit.arrayBuffer();
			return serveRangeFromBuffer(buf, range, contentType);
		}
	}

	// ── MISS: resolve the signed URL server-side (the request never carries one) ────
	const signedUrl = await deps.resolveUrl(deps.id, deps.level).catch(() => null);
	if (!signedUrl) return new Response('proxy: resolve failed', { status: 502 });

	const warmCacheInBackground = () => {
		if (!cache) return;
		keepAlive(
			(async () => {
				const full = await fetchImpl(signedUrl);
				if (!full.ok || !full.body) return;
				await cache.put(
					cacheReq,
					new Response(full.body, {
						status: 200,
						headers: storedHeaders(
							full.headers.get('content-type') ?? 'audio/mpeg',
							full.headers.get('content-length'),
							ttl
						)
					})
				);
			})()
		);
	};

	// ── MISS + partial Range: forward it upstream, stream the 206 through ──────────
	// A partial body must never be stored as the full object, so no tee here; a separate
	// background full fetch warms the cache for the next listener instead.
	if (!isFullRange(range)) {
		const upstream = await fetchImpl(signedUrl, {
			headers: { range: request.headers.get('range') ?? '' }
		}).catch(() => null);
		if (!upstream || (!upstream.ok && upstream.status !== 206)) {
			return new Response('proxy: upstream failed', { status: 502 });
		}
		warmCacheInBackground();
		const headers = clientHeaders(
			upstream.headers.get('content-type') ?? 'audio/mpeg',
			'PASS',
			upstream.headers.get('content-length')
		);
		const contentRange = upstream.headers.get('content-range');
		if (contentRange) headers.set('content-range', contentRange);
		return new Response(upstream.body, { status: upstream.status, headers });
	}

	// ── MISS + full object: STREAM-TEE — client branch streams as bytes arrive, ─────
	// the cache branch is stored under the stable key. First byte is fast (the spike's
	// buffered design paid up to 102 s here; this path pays one upstream TTFB).
	const upstream = await fetchImpl(signedUrl).catch(() => null);
	if (!upstream || !upstream.ok || !upstream.body) {
		return new Response('proxy: upstream failed', { status: 502 });
	}
	const contentType = upstream.headers.get('content-type') ?? 'audio/mpeg';
	const contentLength = upstream.headers.get('content-length');
	if (cache) {
		const [clientBranch, cacheBranch] = upstream.body.tee();
		keepAlive(
			cache.put(
				cacheReq,
				new Response(cacheBranch, { status: 200, headers: storedHeaders(contentType, contentLength, ttl) })
			)
		);
		return new Response(clientBranch, {
			status: 200,
			headers: clientHeaders(contentType, 'MISS', contentLength)
		});
	}
	return new Response(upstream.body, {
		status: 200,
		headers: clientHeaders(contentType, 'MISS', contentLength)
	});
}
