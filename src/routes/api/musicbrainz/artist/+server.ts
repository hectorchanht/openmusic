// MusicBrainz artist-identity edge proxy (quick-260831-re9, spike 010).
//
// THIS is the route that collapses the three artist pages. Measured 2026-09-01: 陳奕迅, 陈奕迅 and
// "Eason Chan" all resolve to mbid 86119d30-… at score 100; 周傑倫 and 周杰伦 both to a223958d-….
// So a single lookup gives one canonical identity for what Deezer splits across three profiles —
// no heuristic name-merging, which would also have risked pulling tribute acts into a real artist.
//
// It also returns the locale-tagged aliases, which map directly onto settings.artistLang:
//   en → Eason Chan · zh_Hant → 陳奕迅 · zh_Hans → 陈奕迅   (each primary:true)
//
// One upstream call (artist search with inc=aliases is not supported on /artist/?query=, so this
// searches then reads the top hit's aliases from the same response when present, else returns the
// canonical name only — the display layer falls back to canonical, never blank).
import type { RequestHandler } from './$types';
import { corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import { MB_WS, mbFetch, normalizeLocale, isMbid } from '$lib/proxy/musicbrainz-shared';

// An artist's identity is effectively immutable → cache 24h on success.
const TTL = 86400;

interface MbAlias {
	name?: string;
	locale?: string | null;
	primary?: boolean | null;
}
interface MbArtist {
	id?: string;
	name?: string;
	country?: string | null;
	score?: number;
	aliases?: MbAlias[] | null;
}
interface MbArtistSearch {
	artists?: MbArtist[];
}

/** Client-facing shape. `names` is locale → display name, already app-normalized. */
export interface MbArtistIdentity {
	mbid: string | null;
	name: string | null;
	country: string | null;
	names: Record<string, string>;
}

const EMPTY: MbArtistIdentity = { mbid: null, name: null, country: null, names: {} };

// MusicBrainz's search scores 0-100. Below this the "match" is usually a different artist, and a
// wrong identity is far worse than no identity (it would show the wrong discography entirely).
const MIN_SCORE = 90;

function jsonResult(body: MbArtistIdentity, origin: string | null, ttl?: number): Response {
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
	const name = (url.searchParams.get('name') ?? '').trim();
	if (!name) return jsonResult(EMPTY, origin);

	const cache = edgeCache();
	const cacheReq = new Request(url.toString());
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) return jsonResult((await hit.json()) as MbArtistIdentity, origin, TTL);
	}

	// `name` is sent ONLY as an encoded query VALUE to the fixed ws/2 host — never as host/path.
	const searchUrl = `${MB_WS}/artist/?query=${encodeURIComponent(name)}&fmt=json&limit=1&inc=aliases`;
	const data = await mbFetch<MbArtistSearch>(searchUrl);
	const top = data?.artists?.[0];

	// A miss OR a low-confidence match → empty, and the caller keeps its existing source. Not
	// cached: a 503-exhausted retry looks identical here and must not be pinned for a day.
	if (!top || !isMbid(top.id) || (top.score ?? 0) < MIN_SCORE) return jsonResult(EMPTY, origin);

	const names: Record<string, string> = {};
	for (const a of top.aliases ?? []) {
		const loc = normalizeLocale(a?.locale);
		const n = (a?.name ?? '').trim();
		if (!loc || !n) continue;
		// primary wins for a locale; otherwise first-seen. MB flags one primary per locale.
		if (a?.primary || !(loc in names)) names[loc] = n;
	}

	const body: MbArtistIdentity = {
		mbid: top.id,
		name: (top.name ?? '').trim() || null,
		country: top.country ?? null,
		names
	};

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
};
