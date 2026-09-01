// MusicBrainz artist-albums edge proxy (quick-260831-re9, spike 010).
//
// Returns an artist's release-groups with ORIGINAL-SCRIPT titles — the fix for both reported
// defects. Measured 2026-09-01: 陳奕迅 → 72 release-groups (Deezer showed 5), and 周杰倫's titles
// come back as 最偉大的作品 / 周杰倫的床邊故事 / 太陽之子 where Deezer had "Greatest Works Of Art" /
// "Jay Chou's Bedtime Stories" / "Children of the Sun".
//
// ONE upstream call regardless of album count: cover URLs are BUILT from each release-group id
// (Cover Art Archive), never fetched here. CAA was 8/8 on a Jay Chou sample, and the client
// renders covers as a layered background so a miss reveals the gradient rather than a blank tile.
import type { RequestHandler } from './$types';
import { corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import { MB_WS, mbFetch, isMbid, coverArtUrl } from '$lib/proxy/musicbrainz-shared';

// A discography changes rarely → 24h on success. Also keeps us far under MB's ~1 req/s limit.
const TTL = 86400;
// MB caps a page at 100. 陳奕迅 has 102 release-groups across all types, so a single page
// TRUNCATES — and "albums are missing" is the exact complaint this task exists to fix. Two pages
// (200) covers every artist we have seen; each extra page costs one more request against MB's
// ~1 req/s limit, which the 24h edge cache amortises to nothing.
const LIMIT = 100;
const MAX_PAGES = 2;

interface MbReleaseGroup {
	id?: string;
	title?: string;
	'first-release-date'?: string;
	'primary-type'?: string | null;
	'secondary-types'?: string[] | null;
}
interface MbReleaseGroups {
	'release-group-count'?: number;
	'release-groups'?: MbReleaseGroup[];
}

/** Client-facing shape — deliberately mirrors the Deezer artist-albums reshape so the artist page
 *  can map either source through the same DiscographyEntry. */
export interface MbAlbum {
	id: string;
	title: string;
	releaseDate: string | null;
	type: string | null;
	cover: string | null;
}
export interface MbAlbumsResult {
	albums: MbAlbum[];
}

const EMPTY: MbAlbumsResult = { albums: [] };

/** ISO-date guard: only YYYY-MM-DD becomes a sort key. MB also emits bare years ("2019") and
 *  YYYY-MM; those are widened to a full date so the client's single ISO comparator still works. */
function safeDate(raw: string | null | undefined): string | null {
	if (typeof raw !== 'string') return null;
	if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
	if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
	if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
	return null;
}

/** Map MB's primary/secondary types onto the app's record-type vocabulary (album|ep|single|
 *  compilation), so discography.ts filters and labels work identically for both sources. */
function mapType(rg: MbReleaseGroup): string | null {
	const secondary = (rg['secondary-types'] ?? []).map((s) => (s ?? '').toLowerCase());
	// A secondary type is the more specific signal: MB marks greatest-hits as
	// primary=Album + secondary=Compilation, and the app must treat that as a compilation.
	if (secondary.includes('compilation')) return 'compilation';
	if (secondary.includes('live')) return 'album'; // a live album is still an album
	const primary = (rg['primary-type'] ?? '').toLowerCase();
	if (primary === 'album' || primary === 'ep' || primary === 'single') return primary;
	return null;
}

function jsonResult(body: MbAlbumsResult, origin: string | null, ttl?: number): Response {
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
	const mbid = (url.searchParams.get('mbid') ?? '').trim();
	// Validate BEFORE the id reaches the upstream URL.
	if (!isMbid(mbid)) return jsonResult(EMPTY, origin);

	const cache = edgeCache();
	const cacheReq = new Request(url.toString());
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			const cached = (await hit.json()) as MbAlbumsResult;
			return jsonResult({ albums: cached.albums ?? [] }, origin, TTL);
		}
	}

	// No `type=` filter: we want EPs and singles too, so the discography page's own filter chips
	// stay the single place that decides what is shown.
	const groups: MbReleaseGroup[] = [];
	for (let page = 0; page < MAX_PAGES; page++) {
		const data = await mbFetch<MbReleaseGroups>(
			`${MB_WS}/release-group?artist=${mbid}&fmt=json&limit=${LIMIT}&offset=${page * LIMIT}`
		);
		// First page failing is fatal (nothing to show); a later page failing keeps what we have
		// rather than discarding a good partial discography.
		if (!data) {
			if (page === 0) return jsonResult(EMPTY, origin); // transient/miss → NOT cached
			break;
		}
		const batch = data['release-groups'] ?? [];
		groups.push(...batch);
		if (batch.length < LIMIT) break; // short page → discography exhausted
	}

	const albums: MbAlbum[] = [];
	for (const rg of groups) {
		const id = rg?.id;
		const title = (rg?.title ?? '').trim();
		if (!isMbid(id) || !title) continue;
		albums.push({
			id,
			title,
			releaseDate: safeDate(rg['first-release-date']),
			type: mapType(rg),
			cover: coverArtUrl(id)
		});
	}

	const body: MbAlbumsResult = { albums };
	if (cache && albums.length) {
		await cache.put(
			cacheReq,
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			})
		);
	}
	return jsonResult(body, origin, albums.length ? TTL : undefined);
};
