// Discography ordering + type filtering (quick-260831-qkx). PURE — no store, no DOM, no fetch —
// so both the artist-page shelf and the full discography page share ONE source of truth and the
// rules are node-testable.
//
// Reported problem: the artist page's album shelf was "not reliable and not exhaustive, many of
// the time are empty inside or not official album". Root cause was upstream (the shelf was fed
// the wrong Deezer artist — see 260831-qkx-PLAN.md), but once the REAL discography arrives it is
// large and noisy: Coldplay's 123 releases are 17 albums, 5 EPs and 101 singles. So the list needs
// ordering and type filtering to be usable at all.

/** A release as the UI renders it. `releaseDate`/`type` are absent on Last.fm-sourced fallback
 *  entries, which is why every rule below has to tolerate null. */
export interface DiscographyEntry {
	id: number | null;
	name: string;
	image: string | null;
	releaseDate: string | null;
	type: string | null;
}

/** The type filters the discography page offers. 'main' is the preset (albums + EPs). */
export type DiscographyFilter = 'all' | 'main' | 'single';

/** Record types that count as a "real" release for the shelf and the 'main' filter.
 *  Deezer's vocabulary is album | ep | single | compilation. Compilations are excluded: they are
 *  the "not official album" noise in the report (greatest-hits repackagings, label samplers). */
const MAIN_TYPES = new Set(['album', 'ep']);

/**
 * Sort newest-first by release date.
 *
 * Entries with NO date sort last (they are the Last.fm fallback rows, which carry no date) and
 * keep their incoming relative order, so the fallback path renders exactly as it does today
 * instead of being scrambled to the top by an empty sort key. The comparator is a stable
 * total order — equal dates keep upstream order, which for Deezer is already meaningful.
 */
export function sortByReleaseDesc<T extends { releaseDate: string | null }>(entries: T[]): T[] {
	// Decorate-sort-undecorate: Array.prototype.sort is stable per spec, but the index tiebreak
	// makes the "undated keep their order" guarantee explicit rather than implied.
	return entries
		.map((e, i) => ({ e, i }))
		.sort((a, b) => {
			const da = a.e.releaseDate;
			const db = b.e.releaseDate;
			if (da && db) return da === db ? a.i - b.i : (da < db ? 1 : -1); // ISO strings compare lexically
			if (da) return -1; // dated before undated
			if (db) return 1;
			return a.i - b.i; // both undated → incoming order
		})
		.map((x) => x.e);
}

/** True when a release counts as an album or EP (the shelf + 'main' filter membership test). */
export function isMainRelease(type: string | null): boolean {
	// A NULL type is kept: Last.fm fallback entries have no record_type, and hiding them would
	// blank the shelf entirely for any artist Deezer does not cover.
	return type === null || MAIN_TYPES.has(type);
}

/** Apply a discography filter. 'all' keeps everything; 'main' keeps albums + EPs; 'single'
 *  keeps everything that is NOT a main release (singles and compilations). */
export function filterByType<T extends { type: string | null }>(
	entries: T[],
	filter: DiscographyFilter
): T[] {
	if (filter === 'all') return entries;
	if (filter === 'main') return entries.filter((e) => isMainRelease(e.type));
	return entries.filter((e) => !isMainRelease(e.type));
}

/** The i18n key for a release-type label, or null when there is nothing meaningful to show
 *  (an untyped Last.fm fallback entry renders the generic album label, as it does today). */
export function typeLabelKey(type: string | null): string | null {
	switch (type) {
		case 'album':
			return 'artist.typeAlbum';
		case 'ep':
			return 'artist.typeEp';
		case 'single':
			return 'artist.typeSingle';
		case 'compilation':
			return 'artist.typeCompilation';
		default:
			return null;
	}
}

/** The 4-digit year for a label, or null. Kept separate from the sort key so a malformed date
 *  can never reach the DOM (the proxy already ISO-guards it; this is defence in depth). */
export function releaseYear(releaseDate: string | null): string | null {
	if (!releaseDate) return null;
	const m = /^(\d{4})-\d{2}-\d{2}$/.exec(releaseDate);
	return m ? m[1] : null;
}

/**
 * The album-page href for a release. Carries the Deezer album id as `dzid` when present, which is
 * what lets the album page fetch the REAL ordered tracklist instead of re-matching by name — the
 * fix for "many of the time are empty inside". Without an id (Last.fm fallback entries, deep
 * links) the URL is byte-identical to the one this page produced before quick-260831-qkx.
 */
export function albumHref(entry: DiscographyEntry, artistName: string): string {
	const base = '/album/' + encodeURIComponent(entry.name) + '?artist=' + encodeURIComponent(artistName);
	return entry.id ? base + '&dzid=' + encodeURIComponent(String(entry.id)) : base;
}

/**
 * Deterministic gradient placeholder for a release with no cover art. Hoisted out of the artist
 * page by quick-260831-qkx so the discography page renders IDENTICAL placeholders rather than
 * carrying a second copy of the hash. Same seed → same gradient, on both surfaces.
 */
export function fallbackCoverSeed(seed: string): string {
	const h = (seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
	return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
}
