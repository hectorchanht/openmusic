// CCMixter search edge proxy (quick-261101-ccm).
//
// Upstream: GET ccmixter.org/api/query?f=xspf&t=search_uploads&search_type=any
// &search=<kw>&limit=&offset= → XSPF (no CORS headers upstream, hence this
// route). The XSPF is parsed HERE ($lib/proxy/ccmixter) into plain rows
// {id,title,artist,cover}; the media <location> deliberately does NOT cross
// to the client — playback re-derives it server-side in /api/ccmixter/stream
// from the upload id alone, so no caller ever supplies a fetch URL.
//
// XSPF <duration> is the file size in bytes (live-verified), never a duration;
// rows therefore carry no duration (Track.duration stays undefined — the
// unknown-neutral state scoreMatch never penalizes).
//
// Edge cache via cachedUpstreamJson (own-origin key, TTL 1h — the catalogue
// moves slowly; mirrors the jamendo/search posture).
import type { RequestHandler } from './$types';
import { fetchWithRetry, jsonResponse, corsPreflight } from '$lib/proxy/http';
import { cachedUpstreamJson } from '$lib/proxy/edge-cache';
import { parseCcmixterSearch, type CcmixterRow } from '$lib/proxy/ccmixter';

const CCMIXTER_API = 'https://ccmixter.org/api/query';
const TTL = 3600; // 1h — search metadata is stable enough

const jsonPassthrough = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');

	const search = (url.searchParams.get('search') ?? '').trim();
	if (!search) return jsonPassthrough({ rows: [] as CcmixterRow[] }, origin);

	// Clamp pagination so a hostile querystring can't fan out unbounded fetches.
	const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
	const offset = Math.min(10000, Math.max(0, Number(url.searchParams.get('offset')) || 0));

	const upstream =
		`${CCMIXTER_API}?f=xspf&t=search_uploads&search_type=any` +
		`&search=${encodeURIComponent(search)}&limit=${limit}&offset=${offset}`;

	return cachedUpstreamJson({
		origin,
		url,
		ttl: TTL,
		empty: { rows: [] as CcmixterRow[] },
		fetchUpstream: async () => {
			const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
			const xml = await res.text();
			return { rows: parseCcmixterSearch(xml) };
		}
	});
};

export const OPTIONS: RequestHandler = ({ request }) => corsPreflight(request);
