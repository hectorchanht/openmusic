// Deezer album-info edge proxy (Phase 17, ENRICH-04 / D-16). A near-exact clone of
// related/+server.ts — the proven two-call own-origin proxy (search-by-title → fetch-by-id),
// edge Cache API, corsHeaders + OPTIONS, never-throws (empty shape on miss).
//
// Two upstream calls:
//   1. search/album?q=<title artist>&limit=1 → first hit's album.id
//   2. album/{id}  → { cover_xl, release_date, nb_tracks, fans, label, genres.data[], duration }
//
// Output is a null-safe reshape. NO secret, NO env read (Deezer public API, same posture as
// /api/deezer/search + /api/deezer/related). The client NEVER calls api.deezer.com directly
// (CORS + no-key posture); it always goes through this proxy.
//
// Security (V5 / T-17-11): `encodeURIComponent` the user-influenced title+artist; the upstream
// host is a fixed constant. T-17-13: cache ONLY a successful reshape with a bounded TTL — a hard
// miss returns the empty shape WITHOUT a long TTL. T-17-10: every upstream field optional + null-safe.
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';

const DEEZER_ALBUM_SEARCH = 'https://api.deezer.com/search/album';
const DEEZER_ALBUM_BYID = 'https://api.deezer.com/album';

// Album data changes rarely → cache 24h on success (D-16: long TTL).
const TTL = 86400;

// edgeCache() shared from $lib/proxy/edge-cache (quick-260713-mqv).

/** Client-facing reshape (mirrors DeezerAlbumInfo in deezer.ts). */
interface AlbumResult {
	cover: string | null;
	releaseDate: string | null;
	tracks: number | null;
	fans: number | null;
	label: string | null;
	genres: string[];
	duration: number | null;
}

const EMPTY: AlbumResult = {
	cover: null,
	releaseDate: null,
	tracks: null,
	fans: null,
	label: null,
	genres: [],
	duration: null
};

function jsonResult(body: AlbumResult, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(body satisfies AlbumResult), { status: 200, headers });
}

// Upstream shapes — we only read the fields we need; all optional (untrusted JSON, T-17-10).
interface DzAlbumHit {
	id?: number;
	title?: string;
}
interface DzSearchResp {
	data?: DzAlbumHit[];
}
interface DzAlbum {
	id?: number;
	title?: string;
	cover_xl?: string;
	release_date?: string;
	nb_tracks?: number;
	fans?: number;
	label?: string;
	duration?: number;
	genres?: { data?: { name?: string }[] };
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const title = (url.searchParams.get('title') ?? url.searchParams.get('album') ?? '').trim();
	const artist = (url.searchParams.get('artist') ?? '').trim();
	if (!title) return jsonResult(EMPTY, origin); // empty shape, no long cache

	// Combine title + artist for a better hit (album titles are not unique on their own).
	const query = `${title} ${artist}`.trim();

	// Cache key = own-origin request (T-wv8-06 — never the upstream URL).
	const cache = edgeCache();
	const cacheReq = new Request(url.toString());
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			const cached = (await hit.json()) as AlbumResult;
			return jsonResult(
				{
					cover: cached.cover ?? null,
					releaseDate: cached.releaseDate ?? null,
					tracks: cached.tracks ?? null,
					fans: cached.fans ?? null,
					label: cached.label ?? null,
					genres: Array.isArray(cached.genres) ? cached.genres : [],
					duration: cached.duration ?? null
				},
				origin,
				TTL
			);
		}
	}

	try {
		// 1. Resolve album TITLE+ARTIST → album.id (V5: encodeURIComponent guards SSRF).
		const searchUrl = `${DEEZER_ALBUM_SEARCH}?q=${encodeURIComponent(query)}&limit=1`;
		const searchRes = await fetchWithRetry(searchUrl, { signal: AbortSignal.timeout(8000) }, 2);
		const id = ((await searchRes.json()) as DzSearchResp)?.data?.[0]?.id;
		// Miss → empty shape, do NOT long-cache (T-17-13: negative TTL is worse UX).
		if (id === undefined || id === null) return jsonResult(EMPTY, origin);

		// 2. Fetch album by id and reshape (T-17-10: every field optional + null-safe).
		const byIdUrl = `${DEEZER_ALBUM_BYID}/${encodeURIComponent(String(id))}`;
		const byIdRes = await fetchWithRetry(byIdUrl, { signal: AbortSignal.timeout(8000) }, 2);
		// WR-04 / T-17-13: a non-ok by-id response is a transient failure — empty shape, NO cache.
		if (!byIdRes.ok) return jsonResult(EMPTY, origin);
		const dz = (await byIdRes.json()) as DzAlbum;
		// WR-04 / T-17-13: Deezer signals quota/rate-limit as HTTP 200 with an `{"error":{…}}`
		// body — it parses fine and every field coalesces to null. A real entity always carries
		// an id; without one this is NOT a successful reshape → empty shape, NO cache, no TTL.
		if (dz?.id == null) return jsonResult(EMPTY, origin);
		const out: AlbumResult = {
			cover: dz?.cover_xl ?? null,
			releaseDate: dz?.release_date ?? null,
			tracks: dz?.nb_tracks ?? null,
			fans: dz?.fans ?? null,
			label: dz?.label ?? null,
			genres: (dz?.genres?.data ?? [])
				.map((g) => (g?.name ?? '').trim())
				.filter((s): s is string => !!s),
			duration: dz?.duration ?? null
		};
		// Cache ONLY a successful reshape (T-17-13/T-17-14).
		if (cache) {
			const cached = new Response(JSON.stringify(out satisfies AlbumResult), {
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
