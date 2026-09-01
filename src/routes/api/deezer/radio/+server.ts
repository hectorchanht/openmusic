// Deezer artist-radio edge proxy (debug/upnext-diverse-fallback-kuwo-dead, 2026-08-31).
//
// WHY: similar.ts's PRIMARY similar-songs path is Last.fm `track.getSimilar`, which is dry for any
// track without scrobble history — every brand-new release, and many CN songs (spike 002: 2/10 CN
// seeds dry). When it is dry the only remaining paths were "fetch N similar ARTISTS, then run one
// search per artist and keep its top track" (N+ upstream calls, and quality limited to each
// artist's single most-popular song) and a same-artist search. If those miss, Up-Next collapses to
// the buildDiversePicks grab-bag — the reported symptom.
//
// Deezer's `artist/{id}/radio` returns a ready-made taste-based track list in ONE call, with exact
// {artist, title} pairs — precisely the shape similar.ts's `nameStub` consumes. Live-verified
// 2026-08-31 for Drake: Future / Kanye West / Lil Baby / A$AP Rocky / Travis Scott / Young Thug.
// So this sits BETWEEN the Last.fm primary and the expensive per-artist search fallback: strictly
// better recommendations for strictly fewer calls.
//
// Two upstream calls, mirroring related/+server.ts exactly:
//   1. search/artist?q=<name>&limit=N → BEST hit's artist.id (pickBestArtistId, never data[0] —
//      Deezer's artist search does not rank by popularity; see deezer-pick.ts)
//   2. artist/{id}/radio?limit=<N>    → { data: [{ title, artist:{name}, album:{cover_*} }] }
//
// NO secret, NO env read (Deezer public API, same posture as /api/deezer/search + /related). The
// client never calls api.deezer.com directly (CORS + no-key posture).
//
// Security: `encodeURIComponent` the user-influenced name; both upstream hosts are fixed constants
// (never user-supplied). Cache ONLY a non-empty success with a bounded TTL — a hard miss returns
// the empty shape WITHOUT a long TTL, so a transient upstream failure is not pinned (T-17-13).
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import { pickBestArtistId, DEEZER_ARTIST_SEARCH_LIMIT } from '$lib/proxy/deezer-pick';

const DEEZER_ARTIST_SEARCH = 'https://api.deezer.com/search/artist';
const DEEZER_ARTIST_BYID = 'https://api.deezer.com/artist';

// A radio list is a recommendation graph, near-static → cache the success path 6h.
const TTL = 6 * 60 * 60;

interface DzArtistHit {
	id?: number;
	name?: string;
	/** Popularity, read by pickBestArtistId to skip namesake shell profiles. */
	nb_fan?: number;
}
interface DzSearchResp {
	data?: DzArtistHit[];
}
interface DzRadioResp {
	data?: {
		title?: string;
		title_short?: string;
		artist?: { name?: string };
		album?: { cover_medium?: string; cover_big?: string; cover?: string };
	}[];
}

/** Client-facing shape — deliberately identical to /api/lastfm/similar-tracks so similar.ts can
 *  map both through the same `nameStub`. `match` is omitted: a radio list is already ordered. */
interface RadioResult {
	tracks: { artist: string; title: string; image?: string }[];
}

const EMPTY: RadioResult = { tracks: [] };

function jsonResult(body: RadioResult, origin: string | null, ttl?: number): Response {
	return new Response(JSON.stringify(body), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			...(ttl ? { 'cache-control': `public, max-age=${ttl}` } : {}),
			...corsHeaders(origin)
		}
	});
}

export const OPTIONS: RequestHandler = ({ request }) =>
	new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const artist = (url.searchParams.get('artist') ?? '').trim();
	if (!artist) return jsonResult(EMPTY, origin);

	const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));

	// Cache key = own-origin request (never the upstream URL).
	const cache = edgeCache();
	const cacheReq = new Request(url.toString());
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			const cached = (await hit.json()) as RadioResult;
			return jsonResult({ tracks: cached.tracks ?? [] }, origin, TTL);
		}
	}

	try {
		// 1. Resolve artist NAME → artist.id, picking the real artist rather than a namesake shell.
		const searchUrl = `${DEEZER_ARTIST_SEARCH}?q=${encodeURIComponent(artist)}&limit=${DEEZER_ARTIST_SEARCH_LIMIT}`;
		const searchRes = await fetchWithRetry(searchUrl, { signal: AbortSignal.timeout(8000) }, 2);
		const searchData = (await searchRes.json()) as DzSearchResp;
		const id = pickBestArtistId(searchData?.data ?? [], artist);
		if (id === null) return jsonResult(EMPTY, origin);

		// 2. Fetch the artist's radio and reshape (every upstream field optional + null-safe).
		const radioUrl = `${DEEZER_ARTIST_BYID}/${encodeURIComponent(id)}/radio?limit=${limit}`;
		const radioRes = await fetchWithRetry(radioUrl, { signal: AbortSignal.timeout(8000) }, 2);
		const radioData = (await radioRes.json()) as DzRadioResp;

		const tracks: RadioResult['tracks'] = [];
		for (const t of Array.isArray(radioData?.data) ? radioData.data! : []) {
			const a = (t?.artist?.name ?? '').trim();
			const ti = (t?.title ?? t?.title_short ?? '').trim();
			if (!a || !ti) continue; // an incomplete pair cannot become a name stub — drop it
			const image = t?.album?.cover_big || t?.album?.cover_medium || t?.album?.cover;
			tracks.push(image ? { artist: a, title: ti, image } : { artist: a, title: ti });
		}

		const body: RadioResult = { tracks };
		// Cache ONLY a genuinely useful result; an empty list stays uncached so a transient
		// upstream failure is not pinned for 6h.
		if (cache && tracks.length) {
			await cache.put(cacheReq, jsonResult(body, origin, TTL));
		}
		return jsonResult(body, origin, tracks.length ? TTL : undefined);
	} catch {
		// never-throw: an upstream failure degrades to "no radio", and similar.ts falls through
		// to its remaining paths exactly as before this route existed.
		return jsonResult(EMPTY, origin);
	}
};
