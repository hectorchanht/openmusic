// Last.fm discovery read proxy for LIST methods (Phase 9, DISCO-01/DISCO-04).
//
// Sibling of /api/lastfm/info (Phase 8): the /info route owns the single-entity
// getInfo contract; THIS route owns the list-shaped discovery methods
// (chart.getTopTracks/getTopArtists, tag.getTopTracks, geo.getTopTracks,
// artist.getTopAlbums) which all return a clean { items: [...] } shape that does NOT
// generalize from LastfmInfo's single-entity unwrap. Keeping them in a dedicated route
// keeps the two response contracts separate, allows per-method Cache-Control TTLs, and
// gets a focused no-leak test.
//
// The Phase-8 edge posture is copied VERBATIM (decision fork B): the optional
// LASTFM_KEY is read from platform.env, injected into the upstream URL on the edge, and
// NEVER reaches the client (threat T-09-01) or the logs (V7). An ABSENT key is a
// SUPPORTED state (T-09-02): with no key — or on any upstream error / Last.fm error
// (incl. code-29 rate-limit) / malformed JSON — we return a 200 { items: [] } so the
// client discovery service degrades silently and the home page falls back to
// buildDiversePicks (D-06). CORS is scoped to the own origin (never `*`, T-09-06).
//
// Edge-caching (NET-NEW to the repo): every successful read is wrapped in the
// Cloudflare Cache API (caches.default) keyed by the OWN-ORIGIN discovery Request — the
// secret-bearing upstream URL is NEVER the cache key (T-09-05). Per-method TTLs (charts
// ~1h, tags ~6h, artist.getTopAlbums ~24h) plus Cache-Control: public, max-age=<ttl>
// (safe — discovery is PUBLIC, key-only data with no user `sk`) so re-browsing home
// never re-hits Last.fm (Pitfall 11).
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import type { Env } from '$lib/proxy/proxy-types';

const LASTFM_ENDPOINT = 'https://ws.audioscrobbler.com/2.0/';

// Grey-star placeholder hash Last.fm returns when an entity has no real art. Filtered
// out so a discovery item's image is real-or-null (reuse of the Phase-8 guardrail).
const GREY_STAR_HASH = '2a96cbd8b46e442fc41c2b86b821562f';

// Allow-list of LIST methods this proxy supports (T-09-03). Anything else → empty list.
// (album.getinfo stays on /api/lastfm/info, which surfaces its tracklist — Task 2.)
const ALLOWED_METHODS = new Set([
	'chart.gettoptracks',
	'chart.gettopartists',
	'tag.gettoptracks',
	'geo.gettoptracks',
	'artist.gettopalbums'
]);

// Per-method edge-cache TTL (seconds). Charts churn hourly; tags are slow; an artist's
// top-albums is near-static (CONTEXT discretion + research). Default mirrors charts.
const TTL: Record<string, number> = {
	'chart.gettoptracks': 3600,
	'chart.gettopartists': 3600,
	'tag.gettoptracks': 21600,
	'geo.gettoptracks': 21600,
	'artist.gettopalbums': 86400
};
const DEFAULT_TTL = 3600;

/** A track item (chart/tag/geo top tracks). */
export interface DiscoveryTrackItem {
	artist: string;
	title: string;
	image: string | null;
	/** Upstream MusicBrainz release/release-group id (often empty → null). Used CLIENT-SIDE
	    to build a Cover Art Archive cover URL (FIX-B). A public id, not secret (T-nza-01). */
	mbid: string | null;
}
/** An artist/album item (chart top artists, artist.getTopAlbums). */
export interface DiscoveryNamedItem {
	name: string;
	image: string | null;
	/** Upstream MusicBrainz id (often empty → null); client-side CAA cover source (FIX-B). */
	mbid: string | null;
}
export type DiscoveryItem = DiscoveryTrackItem | DiscoveryNamedItem;

/** Clean client-facing list shape. Absent-key / error / miss all return { items: [] }. */
export interface LastfmList {
	items: DiscoveryItem[];
}

// edgeCache() (caches.default narrowing + `typeof caches` dev guard) is shared from
// $lib/proxy/edge-cache (quick-260713-mqv). Cache key stays the own-origin Request below.

function jsonList(items: DiscoveryItem[], origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify({ items } satisfies LastfmList), { status: 200, headers });
}

// ---- Last.fm response sub-shapes (only the fields we read) ----
interface LfmImage {
	'#text'?: string;
	size?: string;
}
interface LfmTrack {
	name?: string;
	artist?: { name?: string } | string;
	image?: LfmImage[];
	mbid?: string;
}
interface LfmNamed {
	name?: string;
	image?: LfmImage[];
	mbid?: string;
}

const SIZE_RANK: Record<string, number> = {
	small: 1,
	medium: 2,
	large: 3,
	extralarge: 4,
	mega: 5
};

/**
 * Validate an image URL before it leaves the edge (CR-01). The client interpolates it
 * into a CSS `background-image: url(${image})`; an embedded `)` / quote / whitespace
 * could inject a second `url()` layer (covert tracking pixel / CSP bypass). Defense-in-
 * depth (parity with the Phase-8 `safeLastfmUrl` bio guard): https:// only, on a
 * last.fm / fastly host, with no CSS-breaking characters.
 */
function safeImageUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	if (/[)\s"'\\(]/.test(raw)) return null; // CSS url() + attribute breakers
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.toLowerCase();
		const ok = host === 'last.fm' || host.endsWith('.last.fm') || host.endsWith('.fastly.net');
		return ok ? u.href : null;
	} catch {
		return null;
	}
}

/** Pick the largest non-placeholder, non-empty, SAFE image URL, or null (Phase-8 parity). */
function pickImage(images?: LfmImage[]): string | null {
	if (!Array.isArray(images)) return null;
	let best: { url: string; rank: number } | null = null;
	for (const img of images) {
		const raw = img?.['#text']?.trim();
		if (!raw) continue;
		if (raw.includes(GREY_STAR_HASH)) continue; // never the placeholder
		const url = safeImageUrl(raw); // CR-01: reject CSS-injection / off-domain URLs
		if (!url) continue;
		const rank = SIZE_RANK[(img.size ?? '').toLowerCase()] ?? 0;
		if (!best || rank >= best.rank) best = { url, rank };
	}
	return best ? best.url : null;
}

/** Last.fm returns an array OR a single object for a one-element list — normalize. */
function toArray<T>(v: T[] | T | undefined): T[] {
	if (v == null) return [];
	return Array.isArray(v) ? v : [v];
}

function artistName(a: LfmTrack['artist']): string {
	if (!a) return '';
	return (typeof a === 'string' ? a : a.name ?? '').trim();
}

function reshapeTracks(arr: LfmTrack[]): DiscoveryTrackItem[] {
	return arr.map((t) => ({
		artist: artistName(t.artist),
		title: (t.name ?? '').trim(),
		image: pickImage(t.image),
		// mbid is a plain MusicBrainz id (NOT a URL, NOT interpolated into CSS), so no
		// safeImageUrl allow-list applies — the client builds the CAA <img src> from it
		// (T-nza-02). Empty/whitespace → null so a no-mbid item keeps the gradient.
		mbid: (t.mbid ?? '').trim() || null
	}));
}

function reshapeNamed(arr: LfmNamed[]): DiscoveryNamedItem[] {
	return arr.map((n) => ({
		name: (n.name ?? '').trim(),
		image: pickImage(n.image),
		mbid: (n.mbid ?? '').trim() || null
	}));
}

interface LfmDiscoveryResponse {
	error?: number;
	tracks?: { track?: LfmTrack[] | LfmTrack };
	artists?: { artist?: LfmNamed[] | LfmNamed };
	topalbums?: { album?: LfmNamed[] | LfmNamed };
}

/** Reshape an upstream discovery envelope into the clean { items } per method. */
function reshape(method: string, data: LfmDiscoveryResponse): DiscoveryItem[] {
	if (method === 'chart.gettopartists') {
		return reshapeNamed(toArray(data.artists?.artist));
	}
	if (method === 'artist.gettopalbums') {
		return reshapeNamed(toArray(data.topalbums?.album));
	}
	// chart/tag/geo top tracks all share { tracks: { track: [...] } }.
	return reshapeTracks(toArray(data.tracks?.track));
}

export const GET: RequestHandler = async ({ url, platform, request }) => {
	const origin = request.headers.get('origin');

	// platform?.env is the verified Cloudflare-adapter path for bindings/secrets.
	const env = platform?.env as Env | undefined;
	const key = env?.LASTFM_KEY;

	// No key configured → supported empty list (D-06 fallback trigger). Do NOT throw,
	// do NOT fetch api_key=undefined upstream (T-09-02).
	if (!key) return jsonList([], origin);

	const method = (url.searchParams.get('method') ?? '').toLowerCase();
	if (!ALLOWED_METHODS.has(method)) return jsonList([], origin); // T-09-03 allow-list

	const ttl = TTL[method] ?? DEFAULT_TTL;

	// Client params — all encodeURIComponent'd passthrough only (T-09-03, no command
	// construction). The key is injected on the edge, never logged.
	const limit = url.searchParams.get('limit') ?? '';
	const tag = url.searchParams.get('tag') ?? '';
	const country = url.searchParams.get('country') ?? '';
	const artist = url.searchParams.get('artist') ?? '';
	const page = url.searchParams.get('page') ?? '';

	let upstream =
		`${LASTFM_ENDPOINT}?method=${method}` +
		`&api_key=${encodeURIComponent(key)}` +
		`&format=json`;
	if (limit) upstream += `&limit=${encodeURIComponent(limit)}`;
	if (tag) upstream += `&tag=${encodeURIComponent(tag)}`;
	if (country) upstream += `&country=${encodeURIComponent(country)}`;
	if (artist) upstream += `&artist=${encodeURIComponent(artist)}`;
	if (page) upstream += `&page=${encodeURIComponent(page)}`;

	// Cache key = the OWN-ORIGIN discovery Request (NOT the secret-bearing upstream URL —
	// keep the key out of the cache key, T-09-05). Guarded for the dev runtime (`vite dev`
	// has no Cache API) so local dev still returns the live shape.
	const cache = edgeCache();
	const cacheReq = new Request(url.toString());

	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			// Re-apply CORS for THIS request's origin (WR-01). The cached entry stores a
			// CORS-FREE body, so a cross-origin (e.g. preview vs prod) hit never receives a
			// prior requester's Access-Control-Allow-Origin. CF Cache API's Vary support is
			// unreliable, so we rebuild the response rather than relying on Vary: Origin.
			const cached = (await hit.json()) as LastfmList;
			return jsonList(cached.items ?? [], origin, ttl);
		}
	}

	try {
		// Bounded retry + native timeout (T-09-04, 429/5xx backoff is free). NEVER log key/URL.
		const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
		const data = (await res.json()) as LfmDiscoveryResponse;
		// Last.fm error (incl. code-29 rate-limit) → silent empty best-effort (T-09-04).
		if (data?.error) return jsonList([], origin);
		const items = reshape(method, data);
		if (cache) {
			// Cache a CORS-FREE copy (origin re-applied per request on hit, WR-01).
			const cached = new Response(JSON.stringify({ items } satisfies LastfmList), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` }
			});
			await cache.put(cacheReq, cached);
		}
		return jsonList(items, origin, ttl);
	} catch {
		// Upstream error / malformed JSON → best-effort empty (no cache write).
		return jsonList([], origin);
	}
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-09-06).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
