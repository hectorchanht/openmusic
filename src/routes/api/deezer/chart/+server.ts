// Deezer chart edge proxy (home top-hits + top-artists SOURCE).
//
// WHY: Last.fm chart items arrive WITHOUT cover URLs, forcing a per-tile cover backfill
// (dozens of fetches) that mostly failed at runtime. Deezer's /chart returns top tracks WITH
// `album.cover_*` and top artists WITH `picture_*` embedded — so ONE request yields a fully
// covered shelf and the backfill becomes a rare backup, not the norm (user directive).
//
// Mirrors the /api/deezer/search posture VERBATIM: own-origin CORS, OPTIONS 204 preflight,
// caches.default edge cache keyed by the OWN-ORIGIN Request, fetchWithRetry + AbortSignal.timeout,
// a safeImageUrl host allow-list (https + *.dzcdn.net). Carries NO secret — Deezer's public
// /chart needs no key, so there is NO platform.env read.
//
// Deezer /chart shape (only the fields read; all optional — untrusted JSON):
//   { tracks: { data: [ { title, artist: { name, picture_* }, album: { cover_* } } ] },
//     artists: { data: [ { name, picture_xl, picture_big } ] } }
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';

const DEEZER_CHART = 'https://api.deezer.com/chart';
// Charts shift slowly; an hour keeps re-browsing well under Deezer's ~50 req/5s rate cap.
const TTL = 3600;

/** A discovery track/artist item carrying its cover natively (parity with lastfm.ts shapes). */
export interface DeezerChartItem {
	artist: string;
	title: string;
	image: string | null;
	mbid: null;
}
export interface DeezerChartArtist {
	name: string;
	image: string | null;
	mbid: null;
}
export interface DeezerChart {
	tracks: DeezerChartItem[];
	artists: DeezerChartArtist[];
}

// edgeCache() shared from $lib/proxy/edge-cache (quick-260713-mqv).

/** https + *.dzcdn.net only, no CSS/attribute breakers — else null (tile keeps its gradient). */
function safeImageUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	if (/[)\s"'\\(]/.test(raw)) return null;
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.toLowerCase();
		return host === 'cdn-images.dzcdn.net' || host.endsWith('.dzcdn.net') ? u.href : null;
	} catch {
		return null;
	}
}

interface DzAlbum {
	cover_xl?: string;
	cover_big?: string;
	cover_medium?: string;
}
interface DzArtist {
	name?: string;
	picture_xl?: string;
	picture_big?: string;
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

/** Reshape the Deezer /chart envelope into covered track + artist items (empty arrays on miss). */
function reshapeChart(data: DeezerChartResponse, limit: number): DeezerChart {
	const tracks: DeezerChartItem[] = (data?.tracks?.data ?? [])
		.slice(0, limit)
		.map((t) => ({
			artist: (t.artist?.name ?? '').trim(),
			title: (t.title ?? '').trim(),
			image: safeImageUrl(t.album?.cover_xl ?? t.album?.cover_big ?? t.album?.cover_medium),
			mbid: null as null
		}))
		.filter((t) => t.artist && t.title);
	const artists: DeezerChartArtist[] = (data?.artists?.data ?? [])
		.slice(0, limit)
		.map((a) => ({
			name: (a.name ?? '').trim(),
			image: safeImageUrl(a.picture_xl ?? a.picture_big),
			mbid: null as null
		}))
		.filter((a) => a.name);
	return { tracks, artists };
}

function jsonResult(result: DeezerChart, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(result satisfies DeezerChart), { status: 200, headers });
}

const EMPTY: DeezerChart = { tracks: [], artists: [] };

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const limitRaw = Number(url.searchParams.get('limit') ?? '18');
	const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), 100) : 18;

	const cache = edgeCache();
	const cacheReq = new Request(url.toString());
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			const cached = (await hit.json()) as DeezerChart;
			return jsonResult(
				{ tracks: cached.tracks ?? [], artists: cached.artists ?? [] },
				origin,
				TTL
			);
		}
	}

	try {
		// /chart has no params we pass through (limit applied client-side in reshape); fixed URL,
		// no command/template construction. Bounded retry + native timeout.
		const res = await fetchWithRetry(DEEZER_CHART, { signal: AbortSignal.timeout(8000) }, 2);
		const data = (await res.json()) as DeezerChartResponse;
		const result = reshapeChart(data, limit);
		if (cache) {
			const cached = new Response(JSON.stringify(result satisfies DeezerChart), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			});
			await cache.put(cacheReq, cached);
		}
		return jsonResult(result, origin, TTL);
	} catch {
		// Upstream error / malformed JSON → empty (caller falls back to Last.fm chart).
		return jsonResult(EMPTY, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
