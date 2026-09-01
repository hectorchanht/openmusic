// MusicBrainz album-tracklist edge proxy (quick-260831-re9, spike 010).
//
// Returns a release-group's ordered tracklist in the ORIGINAL script. Measured 2026-09-01 for
// 最偉大的作品: 最伟大的作品 / 说好不哭 / 不爱我就拉倒 / Mojito / 等你下课 / 我是如此相信 — where the
// Deezer-sourced path gave English titles.
//
// A release-GROUP is the abstract album; the tracklist lives on a concrete RELEASE, so this makes
// ONE call to `release?release-group=…&inc=recordings`, taking the first release. Different
// releases of the same group (regional pressings, deluxe editions) can differ in script and in
// bonus tracks — spike 010 saw a Traditional group title (最偉大的作品) whose release and tracks
// were Simplified. Taking the first release is a deliberate simplification.
// ponytail: first-release-wins; if edition mismatches are reported, select by country/date instead.
import type { RequestHandler } from './$types';
import { corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import { MB_WS, mbFetch, isMbid } from '$lib/proxy/musicbrainz-shared';

const TTL = 86400;
const MAX_TRACKS = 60;

interface MbTrack {
	position?: number;
	title?: string;
	recording?: { title?: string };
}
interface MbMedium {
	tracks?: MbTrack[];
}
interface MbRelease {
	title?: string;
	'artist-credit'?: { name?: string }[];
	media?: MbMedium[];
}
interface MbReleases {
	releases?: MbRelease[];
}

/** Client-facing shape — identical to /api/deezer/album-tracks so the album page treats them
 *  interchangeably. */
export interface MbTrackRow {
	artist: string;
	title: string;
	position: number | null;
}
export interface MbTracksResult {
	tracks: MbTrackRow[];
}

const EMPTY: MbTracksResult = { tracks: [] };

function jsonResult(body: MbTracksResult, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(body), { status: 200, headers });
}

export const OPTIONS: RequestHandler = ({ request }) =>
	new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const rgid = (url.searchParams.get('rgid') ?? '').trim();
	if (!isMbid(rgid)) return jsonResult(EMPTY, origin);
	// The artist name the caller already knows; used when a track carries no own artist-credit.
	const fallbackArtist = (url.searchParams.get('artist') ?? '').trim();

	const cache = edgeCache();
	const cacheReq = new Request(url.toString());
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			const cached = (await hit.json()) as MbTracksResult;
			return jsonResult({ tracks: cached.tracks ?? [] }, origin, TTL);
		}
	}

	// `inc=artist-credits` is REQUIRED alongside recordings: with recordings alone MusicBrainz
	// omits artist-credit entirely, every row fails the artist guard below, and the endpoint
	// silently returns zero tracks (observed exactly that during this task's first live probe).
	const data = await mbFetch<MbReleases>(
		`${MB_WS}/release?release-group=${rgid}&inc=recordings+artist-credits&fmt=json&limit=1`
	);
	const release = data?.releases?.[0];
	if (!release) return jsonResult(EMPTY, origin); // transient/miss → NOT cached

	const credited = (release['artist-credit'] ?? []).map((c) => (c?.name ?? '').trim()).filter(Boolean).join(', ');
	const artist = credited || fallbackArtist;

	const tracks: MbTrackRow[] = [];
	for (const medium of release.media ?? []) {
		for (const t of medium?.tracks ?? []) {
			const title = (t?.title ?? t?.recording?.title ?? '').trim();
			// Without BOTH an artist and a title the row cannot become a resolvable stub — drop it
			// rather than render something the player can never play.
			if (!title || !artist) continue;
			const pos = Math.floor(Number(t?.position));
			tracks.push({ artist, title, position: Number.isFinite(pos) && pos > 0 ? pos : null });
			if (tracks.length >= MAX_TRACKS) break;
		}
		if (tracks.length >= MAX_TRACKS) break;
	}

	const body: MbTracksResult = { tracks };
	if (cache && tracks.length) {
		await cache.put(
			cacheReq,
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			})
		);
	}
	return jsonResult(body, origin, tracks.length ? TTL : undefined);
};
