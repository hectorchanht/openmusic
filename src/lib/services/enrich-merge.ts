// enrich-merge — PURE field-precedence merge of a Last.fm EnrichResult with the Deezer
// artist/album info reshape (Phase 17, ENRICH-04 / D-15).
//
// D-15 contract:
//  - Best-quality image wins regardless of source. Deezer returns a hi-res `picture_xl` /
//    `cover_xl` (1000x1000), so when present it wins over the lower-res Last.fm art; when
//    Deezer is null we keep the Last.fm art — we NEVER downgrade a present value to null
//    (additive, Phase 8 rule).
//  - Counts stay side-by-side: Last.fm `listeners`/`playcount` and Deezer `fans` are exposed
//    SEPARATELY (lastfmListeners / lastfmPlaycount / deezerFans) so the page can render them
//    labeled by source when both exist and differ — we never silently drop one.
//  - Last.fm-only fields (tags, bio, bioUrl) pass through untouched (Deezer does not provide
//    these). Album-only Deezer fields (releaseDate, label, genres, tracks, duration) come from
//    Deezer when present, else absent (null / []).
//
// This file is PURE: no DOM, no fetch, no store imports, no side effects. Same inputs always
// produce a deep-equal output and the inputs are never mutated — so D-15 precedence is fully
// unit-testable.

import type { EnrichResult } from './lastfm';
import type { DeezerArtistInfo, DeezerAlbumInfo } from './deezer';

/** Merged artist view the artist page renders (Last.fm + Deezer, D-15). */
export interface MergedArtistInfo {
	/** Best-quality image: Deezer hi-res picture when present, else Last.fm art, else null. */
	image: string | null;
	/** Last.fm tags (additive, passed through unchanged). */
	tags: string[];
	/** Last.fm bio (additive). */
	bio: string | null;
	/** Last.fm bio attribution link (additive). */
	bioUrl: string | null;
	/** Last.fm monthly listeners (side-by-side with deezerFans). */
	lastfmListeners: number | null;
	/** Last.fm scrobble playcount (side-by-side with deezerFans). */
	lastfmPlaycount: number | null;
	/** Deezer fan count (side-by-side with the Last.fm counts). */
	deezerFans: number | null;
	/** Deezer album/discography count. */
	albums: number | null;
}

/** Merged album view the album page renders (Last.fm + Deezer, D-15). */
export interface MergedAlbumInfo {
	/** Best-quality cover: Deezer hi-res cover when present, else Last.fm art, else null. */
	cover: string | null;
	/** Last.fm tags (additive). */
	tags: string[];
	/** Last.fm bio (additive). */
	bio: string | null;
	/** Last.fm bio attribution link (additive). */
	bioUrl: string | null;
	/** Last.fm listeners (side-by-side with deezerFans). */
	lastfmListeners: number | null;
	/** Last.fm playcount (side-by-side with deezerFans). */
	lastfmPlaycount: number | null;
	/** Deezer fan count. */
	deezerFans: number | null;
	/** Deezer release date (YYYY-MM-DD). */
	releaseDate: string | null;
	/** Deezer record label. */
	label: string | null;
	/** Deezer genre names. */
	genres: string[];
	/** Deezer track count. */
	tracks: number | null;
	/** Deezer total duration in seconds. */
	duration: number | null;
}

/**
 * Best-quality image precedence: prefer the Deezer hi-res value when it is a non-empty string,
 * else fall back to the Last.fm art. Never downgrades a present value to null (additive).
 */
function bestImage(deezer: string | null | undefined, lastfm: string | null | undefined): string | null {
	const dz = (deezer ?? '').trim();
	if (dz) return dz;
	const lf = (lastfm ?? '').trim();
	return lf || null;
}

/**
 * Merge a Last.fm artist EnrichResult with the Deezer artist info, applying D-15 field
 * precedence. PURE — null inputs degrade gracefully to an all-empty merged shape.
 */
export function mergeEnrichArtist(
	lastfm: EnrichResult | null,
	deezer: DeezerArtistInfo | null
): MergedArtistInfo {
	return {
		image: bestImage(deezer?.picture, lastfm?.lastfmArt),
		tags: lastfm?.tags ? [...lastfm.tags] : [],
		bio: lastfm?.bio ?? null,
		bioUrl: lastfm?.bioUrl ?? null,
		lastfmListeners: lastfm?.listeners ?? null,
		lastfmPlaycount: lastfm?.playcount ?? null,
		deezerFans: deezer?.fans ?? null,
		albums: deezer?.albums ?? null
	};
}

/**
 * Merge a Last.fm album EnrichResult with the Deezer album info, applying D-15 field
 * precedence. PURE — null inputs degrade gracefully to an all-empty merged shape.
 */
export function mergeEnrichAlbum(
	lastfm: EnrichResult | null,
	deezer: DeezerAlbumInfo | null
): MergedAlbumInfo {
	return {
		cover: bestImage(deezer?.cover, lastfm?.lastfmArt),
		tags: lastfm?.tags ? [...lastfm.tags] : [],
		bio: lastfm?.bio ?? null,
		bioUrl: lastfm?.bioUrl ?? null,
		lastfmListeners: lastfm?.listeners ?? null,
		lastfmPlaycount: lastfm?.playcount ?? null,
		deezerFans: deezer?.fans ?? null,
		releaseDate: deezer?.releaseDate ?? null,
		label: deezer?.label ?? null,
		genres: Array.isArray(deezer?.genres) ? [...deezer.genres] : [],
		tracks: deezer?.tracks ?? null,
		duration: deezer?.duration ?? null
	};
}
