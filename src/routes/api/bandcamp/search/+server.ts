// Bandcamp search edge proxy (43).
//
// Upstream: POST bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic —
// not CORS-open and POST-only, so the call happens HERE and only parsed rows
// {id,title,artist,album,cover} cross to the client ($lib/proxy/bandcamp).
// Upstream has no pagination (≤ 50 rows), so there is no page/offset param:
// returning the full list satisfies the adapter's superset contract.
//
// Edge cache via cachedUpstreamJson (own-origin key, TTL 1h — catalogue moves
// slowly). A non-ok upstream throws → `empty` is served WITHOUT a cache write.
import type { RequestHandler } from './$types';
import { fetchWithRetry, jsonResponse, corsPreflight } from '$lib/proxy/http';
import { cachedUpstreamJson } from '$lib/proxy/edge-cache';
import { parseBandcampSearch, type BandcampRow } from '$lib/proxy/bandcamp';

const BC_SEARCH = 'https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic';
const TTL = 3600;

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	if (!q) return jsonResponse({ rows: [] as BandcampRow[] }, origin);

	return cachedUpstreamJson({
		origin,
		url,
		ttl: TTL,
		empty: { rows: [] as BandcampRow[] },
		fetchUpstream: async () => {
			const res = await fetchWithRetry(
				BC_SEARCH,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ search_text: q, search_filter: 't', full_page: false, fan_id: null }),
					signal: AbortSignal.timeout(8000)
				},
				1
			);
			if (!res.ok) throw new Error(`bandcamp search ${res.status}`);
			return { rows: parseBandcampSearch(await res.json()) };
		}
	});
};

export const OPTIONS: RequestHandler = ({ request }) => corsPreflight(request);
