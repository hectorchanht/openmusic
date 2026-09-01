// Last.fm read proxy for metadata enrichment (Phase 8, ENRICH-03).
//
// Dedicated route (NOT the /api/[source]/[...path] catch-all — decision fork 1):
// mirrors the shipped /api/similar exactly. Reads the OPTIONAL LASTFM_KEY from
// platform.env, calls one of track/artist/album.getInfo, and returns a CLEAN,
// placeholder-filtered shape. The key is injected into the upstream URL on the edge
// and NEVER reaches the client (threat T-08-01, parity with JOOX_TOKEN / LASTFM_KEY
// on /api/similar). The key + upstream URL are NEVER logged (V7 / T-08-01).
//
// An ABSENT key is a SUPPORTED state (T-08-02): with no key — or on any upstream
// error / malformed JSON / Last.fm error-6 — we return a 200 all-empty shape so the
// client enrichment service degrades silently and playback is never blocked.
// CORS is scoped to the own origin via corsHeaders (never `*`, T-08-05).
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import type { Env } from '$lib/proxy/proxy-types';

const LASTFM_ENDPOINT = 'https://ws.audioscrobbler.com/2.0/';

// getInfo is bio/tags-static but listeners/playcount drift → cache the success path 6h (a
// freshness vs re-hit balance; shorter than the 24h recommendation TTLs). quick-260713-mqv.
const INFO_TTL = 21600;

// Grey-star placeholder hash Last.fm returns when an entity has no real art. A real
// cover must NEVER regress to this (ENRICH-02 / D-04 guardrail 2).
const GREY_STAR_HASH = '2a96cbd8b46e442fc41c2b86b821562f';

// Allow-list of read methods this proxy supports (T-08-03). Anything else → empty.
const ALLOWED_METHODS = new Set(['track.getinfo', 'artist.getinfo', 'album.getinfo']);

const MAX_TAGS = 5;

/** Clean client-facing shape. Absent-key / error / miss all return this all-empty. */
export interface LastfmInfo {
	tags: string[];
	bio: string | null;
	bioUrl: string | null;
	image: string | null;
	listeners: number | null;
	playcount: number | null;
	/**
	 * Ordered album tracklist (Phase 9, D-05) — populated ONLY for album.getinfo when
	 * the entity carries album.tracks.track[]. Left undefined for track/artist.getinfo
	 * and for albums with no tracks block, so the single-entity contract + EMPTY
	 * deep-equal are unaffected.
	 */
	tracks?: { artist: string; title: string }[];
	/** Last.fm's canonical entity name (quick-260831-s0c) — the artist-tile merge key. */
	name?: string;
}

const EMPTY: LastfmInfo = {
	tags: [],
	bio: null,
	bioUrl: null,
	image: null,
	listeners: null,
	playcount: null
};

// ttl is added ONLY on a cacheable success (Cache-Control emitted only when ttl != null) — the
// !key / bad-method / data.error / !entity / catch EMPTY returns pass no ttl so they carry no
// Cache-Control and are never written to caches.default (quick-260713-mqv).
function jsonInfo(info: LastfmInfo, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(info), { status: 200, headers });
}

// ---- Last.fm response sub-shapes (only the fields we read) ----
interface LfmImage {
	'#text'?: string;
	size?: string;
}
interface LfmTag {
	name?: string;
}
interface LfmTagBlock {
	tag?: LfmTag[] | LfmTag;
}
interface LfmWiki {
	summary?: string;
	content?: string;
}
interface LfmAlbumTrack {
	name?: string;
	artist?: { name?: string } | string;
}
interface LfmTrackBlock {
	track?: LfmAlbumTrack[] | LfmAlbumTrack;
}
interface LfmEntity {
	/** The canonical entity name Last.fm resolved the query to (quick-260831-s0c). */
	name?: string;
	listeners?: string | number;
	playcount?: string | number;
	stats?: { listeners?: string | number; playcount?: string | number };
	toptags?: LfmTagBlock;
	tags?: LfmTagBlock;
	image?: LfmImage[];
	album?: { image?: LfmImage[] };
	bio?: LfmWiki;
	wiki?: LfmWiki;
	/** album.getinfo only — the ordered tracklist (D-05). */
	tracks?: LfmTrackBlock;
}

const SIZE_RANK: Record<string, number> = {
	small: 1,
	medium: 2,
	large: 3,
	extralarge: 4,
	mega: 5
};

/**
 * Validate an image URL before it leaves the edge (CR-01, Phase-9 parity). The client
 * interpolates it into a CSS `background-image: url(${image})`; an embedded `)` / quote /
 * whitespace could inject a second `url()` layer. https:// only, last.fm / fastly host,
 * no CSS-breaking chars. (safeLastfmUrl above is bio-only and rejects the fastly art host.)
 */
function safeImageUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	if (/[)\s"'\\(]/.test(raw)) return null;
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

/** Pick the largest non-placeholder, non-empty, SAFE image URL, or null. */
function pickImage(images?: LfmImage[]): string | null {
	if (!Array.isArray(images)) return null;
	let best: { url: string; rank: number } | null = null;
	for (const img of images) {
		const raw = img?.['#text']?.trim();
		if (!raw) continue;
		if (raw.includes(GREY_STAR_HASH)) continue; // ENRICH-02: never the placeholder
		const url = safeImageUrl(raw); // CR-01: reject CSS-injection / off-domain URLs
		if (!url) continue;
		const rank = SIZE_RANK[(img.size ?? '').toLowerCase()] ?? 0;
		if (!best || rank >= best.rank) best = { url, rank };
	}
	return best ? best.url : null;
}

/** Top-N tag names from a tag block (handles array or single-object Last.fm shapes). */
function pickTags(block?: LfmTagBlock): string[] {
	if (!block?.tag) return [];
	const arr = Array.isArray(block.tag) ? block.tag : [block.tag];
	const out: string[] = [];
	for (const tg of arr) {
		const name = tg?.name?.trim();
		if (name && !out.includes(name)) out.push(name);
		if (out.length >= MAX_TAGS) break;
	}
	return out;
}

/** Strip HTML tags and collapse whitespace. */
function stripHtml(html: string): string {
	return html
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Take the first ~2-3 sentences of an already-stripped bio string (D-07). */
function firstSentences(text: string, max = 3): string {
	const parts = text.match(/[^.!?。！？]+[.!?。！？]?/g);
	if (!parts) return text;
	return parts
		.slice(0, max)
		.join('')
		.trim();
}

/**
 * Validate an attribution href before it leaves the edge (CR-01).
 * The bio HTML comes from Last.fm's API, but defense-in-depth: only ever hand the
 * client an `https://` URL on the last.fm domain. A `javascript:`/`data:`/off-domain
 * href (malicious or unexpected upstream content) would be a clickable XSS vector
 * once rendered as `href={bioUrl}` (Svelte does not sanitize href bindings).
 */
function safeLastfmUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.toLowerCase();
		if (host !== 'last.fm' && !host.endsWith('.last.fm')) return null;
		return u.href;
	} catch {
		return null;
	}
}

/** Extract bio summary text (HTML-stripped, first sentences) + the attribution URL. */
function pickBio(wiki?: LfmWiki): { bio: string | null; bioUrl: string | null } {
	const raw = wiki?.summary ?? wiki?.content;
	if (!raw) return { bio: null, bioUrl: null };
	// Attribution link: the <a href> inside the summary (Last.fm appends "Read more on Last.fm").
	const hrefMatch = raw.match(/<a\b[^>]*href=["']([^"']+)["']/i);
	const bioUrl = safeLastfmUrl(hrefMatch ? hrefMatch[1] : null); // CR-01: reject javascript:/off-domain
	// quick-260711-spt: Last.fm returns a BOILERPLATE-ONLY summary for artists with no wiki —
	// just `<a href=...>Read more on Last.fm</a>.` with no prose. stripHtml would collapse that
	// anchor text into a bogus one-line bio ("Read more on Last.fm."), which the artist page then
	// renders as a <p> ABOVE the real attribution link (duplicate line). Detect it: drop the
	// anchor element, and if no real letter/number text remains (unicode-aware for the CJK
	// catalog), treat it as no-bio so the About section hides.
	const withoutAnchor = stripHtml(raw.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' '));
	if (!/[\p{L}\p{N}]/u.test(withoutAnchor)) return { bio: null, bioUrl };
	const stripped = stripHtml(raw);
	const bio = stripped ? firstSentences(stripped) : null;
	return { bio: bio || null, bioUrl };
}

function toNumber(v: string | number | undefined): number | null {
	if (v == null) return null;
	const n = typeof v === 'number' ? v : Number.parseInt(v, 10);
	return Number.isFinite(n) ? n : null;
}

/**
 * Ordered album tracklist (D-05). Returns undefined (not []) when there is no tracks
 * block so album misses / track+artist getInfo keep the bare single-entity shape and
 * the existing EMPTY deep-equal assertions still hold. Handles Last.fm's array-or-single
 * quirk the same way pickTags does (a one-track album may return a single object).
 */
function pickTracks(block?: LfmTrackBlock): { artist: string; title: string }[] | undefined {
	if (!block?.track) return undefined;
	const arr = Array.isArray(block.track) ? block.track : [block.track];
	return arr.map((t) => {
		const artist =
			typeof t.artist === 'string' ? t.artist : t.artist?.name ?? '';
		return { artist: (artist ?? '').trim(), title: (t.name ?? '').trim() };
	});
}

/** Reshape one getInfo entity (track/artist/album) into the clean LastfmInfo shape. */
function reshape(entity: LfmEntity, isArtist = false): LastfmInfo {
	const { bio, bioUrl } = pickBio(entity.bio ?? entity.wiki);
	// Art: prefer the entity's own image[], else the embedded album image (track.getInfo).
	const image = pickImage(entity.image) ?? pickImage(entity.album?.image);
	const tags = pickTags(entity.toptags ?? entity.tags);
	const listeners = toNumber(entity.listeners ?? entity.stats?.listeners);
	const playcount = toNumber(entity.playcount ?? entity.stats?.playcount);
	const info: LastfmInfo = { tags, bio, bioUrl, image, listeners, playcount };
	// quick-260831-s0c: surface Last.fm's CANONICAL entity name — for artist.getinfo ONLY.
	// Last.fm already resolves every spelling of an artist to one entity: 周傑倫 / 周杰倫 / 周杰伦 /
	// "Jay Chou" all return the same record (identical listener counts, 122,572 measured
	// 2026-09-01), as do 陳奕迅 / "Eason Chan" (69,834). The search page derives its artist tiles
	// from raw per-source `track.artist` strings, so those spellings became THREE tiles for one
	// artist; exposing the name the avatar call ALREADY fetches gives a free merge key.
	// Deliberately NOT surfaced for track/album: their entities also carry a `name` (the track or
	// album title), which nothing consumes and which would change their long-standing response
	// shape — the album EMPTY deep-equal test caught exactly that.
	if (isArtist) {
		const canonical = (entity.name ?? '').trim();
		if (canonical) info.name = canonical;
	}
	// album.getinfo only: surface the ordered tracklist (D-05). Undefined otherwise so
	// the single-entity getInfo contract + EMPTY deep-equal are unchanged.
	const tracks = pickTracks(entity.tracks);
	if (tracks) info.tracks = tracks;
	return info;
}

export const GET: RequestHandler = async ({ url, platform, request }) => {
	const origin = request.headers.get('origin');

	// platform?.env is the verified Cloudflare-adapter path for bindings/secrets.
	const env = platform?.env as Env | undefined;
	const key = env?.LASTFM_KEY;

	// No key configured → supported empty state. Do NOT throw, do NOT fetch
	// api_key=undefined upstream (T-08-02).
	if (!key) return jsonInfo(EMPTY, origin);

	const method = (url.searchParams.get('method') ?? '').toLowerCase();
	if (!ALLOWED_METHODS.has(method)) return jsonInfo(EMPTY, origin); // T-08-03 allow-list

	const artist = url.searchParams.get('artist') ?? '';
	const track = url.searchParams.get('track') ?? '';
	const album = url.searchParams.get('album') ?? '';

	// Cache key = the OWN-ORIGIN request (NEVER the LASTFM_KEY-bearing upstream URL — T-08-01
	// parity; keep the key out of the cache key). Guarded for `vite dev` (no Cache API) so local
	// dev still hits live upstream (quick-260713-mqv).
	const cache = edgeCache();
	const cacheReq = ownOriginCacheKey(url);

	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			// Re-apply CORS for THIS request's origin (WR-01): the stored body is CORS-FREE, so a
			// cross-origin (preview vs prod) hit never receives a prior requester's ACAO header.
			const cached = (await hit.json()) as LastfmInfo;
			return jsonInfo(cached, origin, INFO_TTL);
		}
	}

	// Build the upstream URL — all client params are encodeURIComponent'd passthrough
	// only (T-08-03, no command construction). The key is injected on the edge.
	let upstream =
		`${LASTFM_ENDPOINT}?method=${method}` +
		`&api_key=${encodeURIComponent(key)}` +
		`&format=json&autocorrect=1`;
	if (artist) upstream += `&artist=${encodeURIComponent(artist)}`;
	if (method === 'track.getinfo' && track) upstream += `&track=${encodeURIComponent(track)}`;
	if (method === 'album.getinfo' && album) upstream += `&album=${encodeURIComponent(album)}`;

	try {
		// Bounded retry + native timeout (T-08-04). NEVER log the key or upstream URL.
		const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
		const data = (await res.json()) as { error?: number; track?: LfmEntity; artist?: LfmEntity; album?: LfmEntity };
		// Last.fm error-6 (not found) and friends → silent empty best-effort. NO cache write.
		if (data?.error) return jsonInfo(EMPTY, origin);
		const entity = data.track ?? data.artist ?? data.album;
		if (!entity) return jsonInfo(EMPTY, origin); // no entity → NO cache write
		const info = reshape(entity, entity === data.artist);
		if (cache) {
			// Cache a CORS-FREE copy of the success (origin re-applied per request on a hit, WR-01).
			// quick-260713-mqv.
			await cache.put(
				cacheReq,
				new Response(JSON.stringify(info), {
					status: 200,
					headers: {
						'content-type': 'application/json',
						'Cache-Control': `public, max-age=${INFO_TTL}`
					}
				})
			);
		}
		return jsonInfo(info, origin, INFO_TTL);
	} catch {
		// Upstream error / malformed JSON → best-effort empty. NO cache write.
		return jsonInfo(EMPTY, origin);
	}
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-08-05).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
