// Deezer album-tracklist edge proxy (quick-260831-qkx).
//
// WHY: the album page used to re-resolve its tracklist by NAME through Last.fm
// `album.getInfo` (album/[name]/+page.svelte). The artist shelf had the album's Deezer id in hand
// and threw it away, so every album detail view paid a fresh name-match — and a name match that
// misses returns nothing, which is the reported "many of the time are empty inside".
//
// Matching by name is genuinely unreliable, not merely slower. Live 2026-09-01: a Deezer album
// SEARCH for `artist:"Coldplay" album:"Parachutes"` returns a completely different record (a
// single by "bEzii"). Fetching by the id taken from the ARTIST'S OWN discography returns the real
// thing — `album/301663/tracks` → all 10 Parachutes tracks, in album order. So the id must come
// from /api/deezer/artist-albums; this route deliberately offers no name-search fallback, because
// a name search is exactly the failure mode it exists to remove.
//
// One upstream call: album/{id}/tracks?limit=<N>.
//
// Security: `id` is validated as a POSITIVE INTEGER before it is interpolated into the fixed
// upstream path — it is never passed through as a raw path segment (T-23-16 parity with
// artist-albums). NO secret, NO env read (Deezer's public API is keyless). Never forwards an
// upstream status or body.
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';

const DEEZER_ALBUM_BYID = 'https://api.deezer.com/album';

// A published album's tracklist is immutable in practice → cache the success path 24h.
const TTL = 86400;

// Deezer caps a tracks page at 50; no album needs more than one page in practice, and a hard cap
// keeps a malicious `limit` from turning into a large upstream fetch.
const MAX_TRACKS = 50;

interface DzTrackItem {
	title?: string;
	title_short?: string;
	track_position?: number;
	artist?: { name?: string };
}
interface DzTracksResponse {
	data?: DzTrackItem[];
	error?: unknown;
}

/** Client-facing reshape — the ordered {artist,title} pairs the album page turns into stubs. */
export interface DeezerAlbumTrack {
	artist: string;
	title: string;
	position: number | null;
}
export interface DeezerAlbumTracksResult {
	tracks: DeezerAlbumTrack[];
}

const EMPTY: DeezerAlbumTracksResult = { tracks: [] };

function jsonResult(
	result: DeezerAlbumTracksResult,
	origin: string | null,
	ttl?: number
): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(result), { status: 200, headers });
}

function reshape(it: DzTrackItem | undefined): DeezerAlbumTrack | null {
	if (!it) return null;
	const artist = (it.artist?.name ?? '').trim();
	const title = (it.title ?? it.title_short ?? '').trim();
	// An incomplete pair cannot become a resolvable stub — drop it rather than render a dead row.
	if (!artist || !title) return null;
	const pos = Math.floor(Number(it.track_position));
	return { artist, title, position: Number.isFinite(pos) && pos > 0 ? pos : null };
}

export const OPTIONS: RequestHandler = ({ request }) =>
	new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');

	// Validate BEFORE the id reaches the upstream path (T-23-16).
	const albumId = Math.floor(Number(url.searchParams.get('id')));
	if (!Number.isFinite(albumId) || albumId <= 0) return jsonResult(EMPTY, origin);

	const limit = Math.min(MAX_TRACKS, Math.max(1, Number(url.searchParams.get('limit')) || MAX_TRACKS));

	// Cache key = the OWN-ORIGIN request (never the upstream URL).
	const cache = edgeCache();
	const cacheReq = new Request(url.toString());
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			const cached = (await hit.json()) as DeezerAlbumTracksResult;
			return jsonResult({ tracks: Array.isArray(cached.tracks) ? cached.tracks : [] }, origin, TTL);
		}
	}

	try {
		const tracksUrl = `${DEEZER_ALBUM_BYID}/${albumId}/tracks?limit=${limit}`;
		const res = await fetchWithRetry(tracksUrl, { signal: AbortSignal.timeout(8000) }, 2);
		// WR-05: fetchWithRetry RETURNS (does not throw) a 429/5xx once its budget is exhausted, and
		// Deezer signals quota errors as 200 + {"error":{…}}. Both are TRANSIENT — return empty
		// WITHOUT a cache write, or one rate-limit window pins "no tracks" at the edge for a day.
		if (!res.ok) return jsonResult(EMPTY, origin);
		const data = (await res.json()) as DzTracksResponse;
		if (data.error) return jsonResult(EMPTY, origin);

		const list = Array.isArray(data?.data) ? data.data : [];
		const tracks = list.map(reshape).filter((t): t is DeezerAlbumTrack => t !== null);
		const result: DeezerAlbumTracksResult = { tracks };

		// Only cache a genuinely useful answer; an empty list stays uncached so a transient miss
		// is not pinned for 24h (no-negative-caching posture, T-17-13).
		if (cache && tracks.length) {
			await cache.put(
				cacheReq,
				new Response(JSON.stringify(result), {
					status: 200,
					headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
				})
			);
		}
		return jsonResult(result, origin, tracks.length ? TTL : undefined);
	} catch {
		// Upstream error / malformed JSON / timeout → best-effort empty, NO cache write. The album
		// page falls back to its existing Last.fm tracklist path.
		return jsonResult(EMPTY, origin);
	}
};
