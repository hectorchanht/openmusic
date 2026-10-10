// MusicBrainz recording-artists edge proxy (quick-261009-ewf).
//
// Answers "who actually performed THIS recording?" — the ground truth behind a track's
// raw artist string. Now Playing's artist line is metadata text ("Earth, Wind & Fire"),
// and splitting it on `,`/`&` produced three phantom artists. The artist-identity route
// already handles the full string BEING a known artist; this route handles everything
// else: search the RECORDING by title + the raw artist string, and return its
// artist-credit array. That fixes mangled variants the identity check cannot see
// ("Earth Wind and Fire" — no comma — still resolves to the band's single credit),
// correctly attributes real multi-artist recordings (duets, feat. credits keep their
// joinphrases), and even corrects mislabeled metadata (a solo track whose source lists
// a composer in the artist field comes back as one credit).
//
// Matching rule (belt and suspenders): the top recording must BOTH score >= MIN_SCORE
// AND have an artist-credit phrase whose canonicalKey equals the queried artist string.
// A same-titled recording by a different act must never donate its credits.
//
// Never throws: any failure (non-ok, malformed, 503-exhausted retries, no confident
// hit) returns { artists: [] }, and the caller falls back to splitArtists().
// A confident hit is cached 24h (a recording's credits are effectively immutable); a
// miss is NOT cached — a 503-exhausted retry looks identical to a miss and must not be
// pinned for a day.
import type { RequestHandler } from './$types';
import { corsHeaders, jsonResponse } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import { MB_WS, mbFetch, isMbid, canonicalKey } from '$lib/proxy/musicbrainz-shared';

const TTL = 86400;
const MIN_SCORE = 85;
const LIMIT = 8;

interface MbCredit {
	name?: string;
	joinphrase?: string;
	artist?: { id?: string } | null;
}
interface MbRecording {
	id?: string;
	score?: number;
	'artist-credit'?: MbCredit[] | null;
}
interface MbRecordingSearch {
	recordings?: MbRecording[];
}

/** One performer credit. `joinphrase` is MusicBrainz's own separator (" & ", " feat. "). */
export interface MbRecordingArtist {
	name: string;
	mbid: string | null;
	joinphrase: string;
}

export interface MbRecordingArtists {
	artists: MbRecordingArtist[];
}

const EMPTY: MbRecordingArtists = { artists: [] };

const jsonResult = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

export const OPTIONS: RequestHandler = ({ request }) =>
	new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });

/**
 * Strip Lucene-quoting hazards from a query term. The title/artist are interpolated
 * inside double quotes in the query string, so a literal `"` (or backslash) in the
 * metadata would break the query syntax — drop them. Length-capped: MusicBrainz
 * truncates absurd queries anyway, and the cache key stays small.
 */
function cleanTerm(term: string): string {
	return term
		.replace(/["\\]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 200);
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const title = cleanTerm(url.searchParams.get('title') ?? '');
	const artist = cleanTerm(url.searchParams.get('artist') ?? '');
	if (!title || !artist) return jsonResult(EMPTY, origin);

	const cache = edgeCache();
	const cacheReq = new Request(url.toString());
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) return jsonResult((await hit.json()) as MbRecordingArtists, origin, TTL);
	}

	// `title`/`artist` travel ONLY as an encoded query VALUE to the fixed ws/2 host.
	const searchUrl =
		`${MB_WS}/recording/?query=` +
		encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`) +
		`&fmt=json&limit=${LIMIT}`;
	const data = await mbFetch<MbRecordingSearch>(searchUrl);

	const want = canonicalKey(artist);
	for (const rec of data?.recordings ?? []) {
		if ((rec.score ?? 0) < MIN_SCORE) continue;
		const credits = rec['artist-credit'] ?? [];
		const phrase = credits.map((c) => `${c.name ?? ''}${c.joinphrase ?? ''}`).join('');
		// The recording's canonical credit phrase must BE the queried artist string —
		// otherwise this is a same-titled recording by a different act.
		if (!phrase || canonicalKey(phrase) !== want) continue;
		const artists: MbRecordingArtist[] = credits
			.map((c) => ({
				name: (c.name ?? '').trim(),
				mbid: isMbid(c.artist?.id) ? (c.artist!.id as string) : null,
				joinphrase: c.joinphrase ?? ''
			}))
			.filter((a) => a.name);
		if (!artists.length) continue;
		const body: MbRecordingArtists = { artists };
		if (cache) {
			await cache.put(
				cacheReq,
				new Response(JSON.stringify(body), {
					status: 200,
					headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
				})
			);
		}
		return jsonResult(body, origin, TTL);
	}

	return jsonResult(EMPTY, origin);
};
