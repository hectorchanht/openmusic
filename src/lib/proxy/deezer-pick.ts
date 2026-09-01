// Deezer artist-hit picker (debug/upnext-diverse-fallback-kuwo-dead, 2026-08-31).
//
// WHY THIS EXISTS: `https://api.deezer.com/search/artist?q=<name>` does NOT rank by popularity.
// For any name with namesakes it returns low-fan impostor profiles FIRST, and those profiles are
// empty shells — no related artists, no albums, a blank picture hash. Both /api/deezer/related and
// /api/deezer/artist used to take `data[0]&limit=1` blindly, so both silently resolved the wrong
// artist. Live-measured on 2026-08-31:
//
//   q=Drake     → data[0] = id 67927442  (111 fans)      … real Drake    = id 246791 (24,068,325)
//   q=Coldplay  → data[0] = id 316813311 (91 fans)       … real Coldplay = id 892    (18,367,520)
//
// Consequences that were live in production: `artist/67927442/related` returns {"data":[],"total":0}
// so similar.ts's Deezer artist fallback was permanently dry, and the artist page rendered
// "91 Fans · 0 Albums" with a blank avatar for Coldplay (the picture hash on those shells is
// d41d8cd98f00b204e9800998ecf8427e — the MD5 of the empty string).
//
// The fix is to ask for several hits and choose, rather than trusting position 0.

/** The subset of a Deezer artist search hit this picker reads. All fields optional/null-safe. */
export interface DeezerArtistHit {
	id?: number | string;
	name?: string;
	nb_fan?: number;
}

/** How many hits to request so the picker has something to choose between. */
export const DEEZER_ARTIST_SEARCH_LIMIT = 10;

/** Normalize for name comparison: casefold, strip accents/punctuation/whitespace. */
function norm(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Choose the artist a human meant from a Deezer `search/artist` result list.
 *
 * Ranking: an EXACT normalized name match wins over a non-exact one (so "Coldplay" is never beaten
 * by "Coldplay Metal Tribute", which can out-fan a shell profile); within each group the highest
 * `nb_fan` wins. Ties and missing `nb_fan` fall back to the upstream order, so the behaviour for a
 * single-hit response is identical to the old `data[0]`.
 *
 * Returns the chosen hit's id, or null when the list has nothing usable.
 */
export function pickBestArtistId(hits: DeezerArtistHit[], query: string): string | null {
	const wanted = norm(query ?? '');
	let best: DeezerArtistHit | null = null;
	let bestExact = false;
	let bestFans = -1;

	for (const h of hits ?? []) {
		if (h?.id === undefined || h?.id === null) continue;
		const exact = wanted.length > 0 && norm(h.name ?? '') === wanted;
		const fans = typeof h.nb_fan === 'number' && Number.isFinite(h.nb_fan) ? h.nb_fan : 0;
		// Exact-match group dominates; inside a group, more fans wins. Strict > keeps upstream
		// order for ties, so a single-hit list behaves exactly like the old data[0] read.
		if (best === null || (exact && !bestExact) || (exact === bestExact && fans > bestFans)) {
			best = h;
			bestExact = exact;
			bestFans = fans;
		}
	}

	return best === null || best.id === undefined || best.id === null ? null : String(best.id);
}
