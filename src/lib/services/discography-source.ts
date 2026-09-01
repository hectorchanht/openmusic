// Where an artist's discography comes from (quick-260831-re9). Impure (fetches) and therefore kept
// OUT of discography.ts, which stays pure + node-testable for the ordering/filtering rules.
//
// One function, two callers: the artist page's album shelf and the full discography page. Before
// this module they each carried their own copy of the same three-branch effect; a third copy was
// about to be added for MusicBrainz, so the branching lives here instead.
//
// SOURCE ORDER — deliberately gated on script, not applied globally:
//
//   CJK artist name  → MusicBrainz → Deezer → Last.fm
//   everything else  → Deezer → Last.fm            (byte-identical to the previous behaviour)
//
// The gate exists because the defect is specific to CJK. Measured 2026-09-01: Deezer showed 陳奕迅
// 5 albums where MusicBrainz has 102 release-groups (57 albums/EPs), and Deezer's only populated
// 周杰倫 profile titles everything in English ("Greatest Works Of Art" for 最偉大的作品). For Western
// artists Deezer is good and already wired, so routing them through MusicBrainz would be churn and
// regression risk for no gain — and MusicBrainz's ~1 req/s budget is better spent where it helps.
import { deezerArtistAlbums } from '$lib/services/deezer';
import { getArtistTopAlbums, type DiscoveryAlbum } from '$lib/services/lastfm';
import { mbArtist, mbAlbums } from '$lib/services/musicbrainz';
import { detectLang } from '$lib/i18n/detect';
import { sortByReleaseDesc, type DiscographyEntry } from '$lib/services/discography';

/** Obvious upstream stub names that must never render as an album card. */
export function isStubAlbumName(raw: string | null | undefined): boolean {
	const s = (raw ?? '').trim().toLowerCase();
	if (!s) return true;
	return s === '(null)' || s === 'null' || s === 'undefined' || s === 'unknown album' || s === 'unknown';
}

/** True when a name is CJK (Chinese/Japanese/Korean) and therefore better served by MusicBrainz.
 *  Reuses the app's existing classifier rather than a second script regex. */
export function isCjkName(name: string): boolean {
	const tag = detectLang(name ?? '');
	return tag === 'zh-Hant' || tag === 'zh-Hans' || tag === 'ja' || tag === 'ko';
}

/** What a discography load produced, plus which source won (for display-name decisions). */
export interface DiscographyLoad {
	entries: DiscographyEntry[];
	source: 'musicbrainz' | 'deezer' | 'lastfm' | 'none';
	/** MusicBrainz canonical identity, when that path was taken — drives the locale-aware name. */
	mbid: string | null;
	names: Record<string, string>;
	canonicalName: string | null;
}

const EMPTY: DiscographyLoad = { entries: [], source: 'none', mbid: null, names: {}, canonicalName: null };

/**
 * Load an artist's FULL discography (every record type), newest first. Never throws — each source
 * degrades to the next, and a total miss returns an empty load so the caller renders its empty
 * state rather than a stuck skeleton.
 *
 * Filtering to albums+EPs is NOT done here: the shelf and the discography page want different
 * subsets of the same list, so they apply `filterByType` themselves.
 */
export async function loadDiscography(name: string): Promise<DiscographyLoad> {
	const clean = (name ?? '').trim();
	if (!clean) return EMPTY;

	// --- MusicBrainz, CJK only -------------------------------------------------------------
	if (isCjkName(clean)) {
		const identity = await mbArtist(clean).catch(() => null);
		if (identity?.mbid) {
			const albums = await mbAlbums(identity.mbid).catch(() => []);
			if (albums.length) {
				const entries = sortByReleaseDesc(
					albums
						.filter((a) => !isStubAlbumName(a.title))
						.map(
							(a) =>
								({
									id: null,
									mbid: a.id,
									name: a.title,
									image: a.cover,
									releaseDate: a.releaseDate,
									type: a.type
								}) satisfies DiscographyEntry
						)
				);
				return {
					entries,
					source: 'musicbrainz',
					mbid: identity.mbid,
					names: identity.names ?? {},
					canonicalName: identity.name
				};
			}
			// Identity found but no releases → still surface the identity so the page can render the
			// locale-correct name, and fall through to Deezer for the album list itself.
			const dz = await deezerEntries(clean);
			if (dz.length) {
				return {
					entries: dz,
					source: 'deezer',
					mbid: identity.mbid,
					names: identity.names ?? {},
					canonicalName: identity.name
				};
			}
		}
	}

	// --- Deezer ----------------------------------------------------------------------------
	const dz = await deezerEntries(clean);
	if (dz.length) return { ...EMPTY, entries: dz, source: 'deezer' };

	// --- Last.fm ---------------------------------------------------------------------------
	// Carries no id/date/type, so these entries keep their incoming (popularity) order and render
	// with the generic label — unchanged from before MusicBrainz existed.
	const lf = await getArtistTopAlbums(clean).catch((): DiscoveryAlbum[] => []);
	const lfEntries = lf
		.filter((a) => !isStubAlbumName(a.name))
		.map(
			(a) =>
				({ id: null, mbid: null, name: a.name, image: a.image, releaseDate: null, type: null }) satisfies DiscographyEntry
		);
	if (lfEntries.length) return { ...EMPTY, entries: lfEntries, source: 'lastfm' };

	return EMPTY;
}

/** Deezer branch, shared by the two places above that can reach it. */
async function deezerEntries(name: string): Promise<DiscographyEntry[]> {
	const dzAlbums = await deezerArtistAlbums(name).catch(() => []);
	if (!dzAlbums.length) return [];
	return sortByReleaseDesc(
		dzAlbums
			.filter((a) => !isStubAlbumName(a.title))
			.map(
				(a) =>
					({
						id: a.id,
						mbid: null,
						name: a.title,
						image: a.cover,
						releaseDate: a.release_date,
						type: a.record_type
					}) satisfies DiscographyEntry
			)
	);
}
