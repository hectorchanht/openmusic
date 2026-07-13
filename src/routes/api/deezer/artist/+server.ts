// Deezer artist-info edge proxy (Phase 17, ENRICH-04 / D-16). A near-exact clone of
// related/+server.ts — the proven two-call own-origin proxy (search-by-name → fetch-by-id),
// edge Cache API, corsHeaders + OPTIONS, never-throws (empty shape on miss).
//
// Two upstream calls:
//   1. search/artist?q=<name>&limit=1 → first hit's artist.id
//   2. artist/{id}                    → { picture_xl, nb_fan, nb_album } (live-verified shapes)
//
// Output is a null-safe reshape to { picture, fans, albums }. NO secret, NO env read (Deezer
// public API, same posture as /api/deezer/search + /api/deezer/related). The client NEVER calls
// api.deezer.com directly (CORS + no-key posture); it always goes through this proxy.
//
// Security (V5 / T-17-11): `encodeURIComponent` the user-influenced name; the upstream host is a
// fixed constant (never user-supplied). T-17-13: cache ONLY a successful reshape with a bounded
// TTL — a hard miss returns the empty shape WITHOUT a long TTL (a transient upstream failure
// pinned 24h is worse UX). T-17-10: every upstream field is optional + null-safe.
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';

const DEEZER_ARTIST_SEARCH = 'https://api.deezer.com/search/artist';
const DEEZER_ARTIST_BYID = 'https://api.deezer.com/artist';

// Artist data changes rarely → cache 24h on success (D-16: long TTL).
const TTL = 86400;

// edgeCache() shared from $lib/proxy/edge-cache (quick-260713-mqv).

/** Client-facing reshape (mirrors DeezerArtistInfo in deezer.ts). */
interface ArtistResult {
	picture: string | null;
	fans: number | null;
	albums: number | null;
}

const EMPTY: ArtistResult = { picture: null, fans: null, albums: null };

function jsonResult(body: ArtistResult, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(body satisfies ArtistResult), { status: 200, headers });
}

// Upstream shapes — we only read the fields we need; all optional (untrusted JSON, T-17-10).
interface DzArtistHit {
	id?: number;
	name?: string;
}
interface DzSearchResp {
	data?: DzArtistHit[];
}
interface DzArtist {
	id?: number;
	name?: string;
	picture_xl?: string;
	nb_fan?: number;
	nb_album?: number;
	radio?: boolean;
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const name = (url.searchParams.get('name') ?? url.searchParams.get('artist') ?? '').trim();
	if (!name) return jsonResult(EMPTY, origin); // empty shape, no long cache

	// Cache key = own-origin request (T-wv8-06 — never the upstream URL).
	const cache = edgeCache();
	const cacheReq = new Request(url.toString());
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			const cached = (await hit.json()) as ArtistResult;
			return jsonResult(
				{
					picture: cached.picture ?? null,
					fans: cached.fans ?? null,
					albums: cached.albums ?? null
				},
				origin,
				TTL
			);
		}
	}

	try {
		// 1. Resolve artist NAME → artist.id via search/artist (V5: encodeURIComponent guards SSRF).
		const searchUrl = `${DEEZER_ARTIST_SEARCH}?q=${encodeURIComponent(name)}&limit=1`;
		const searchRes = await fetchWithRetry(searchUrl, { signal: AbortSignal.timeout(8000) }, 2);
		const id = ((await searchRes.json()) as DzSearchResp)?.data?.[0]?.id;
		// Miss → empty shape, do NOT long-cache (T-17-13: negative TTL is worse UX).
		if (id === undefined || id === null) return jsonResult(EMPTY, origin);

		// 2. Fetch artist by id and reshape (T-17-10: every field optional + null-safe).
		const byIdUrl = `${DEEZER_ARTIST_BYID}/${encodeURIComponent(String(id))}`;
		const byIdRes = await fetchWithRetry(byIdUrl, { signal: AbortSignal.timeout(8000) }, 2);
		// WR-04 / T-17-13: a non-ok by-id response is a transient failure — empty shape, NO cache.
		if (!byIdRes.ok) return jsonResult(EMPTY, origin);
		const dz = (await byIdRes.json()) as DzArtist;
		// WR-04 / T-17-13: Deezer signals quota/rate-limit as HTTP 200 with an `{"error":{…}}`
		// body — it parses fine and every field coalesces to null. A real entity always carries
		// an id; without one this is NOT a successful reshape → empty shape, NO cache, no TTL.
		if (dz?.id == null) return jsonResult(EMPTY, origin);
		const out: ArtistResult = {
			picture: dz?.picture_xl ?? null,
			fans: dz?.nb_fan ?? null,
			albums: dz?.nb_album ?? null
		};
		// Cache ONLY a successful reshape (T-17-13/T-17-14).
		if (cache) {
			const cached = new Response(JSON.stringify(out satisfies ArtistResult), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			});
			await cache.put(cacheReq, cached);
		}
		return jsonResult(out, origin, TTL);
	} catch {
		return jsonResult(EMPTY, origin); // never throws → caller leaves section absent (D-14)
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
