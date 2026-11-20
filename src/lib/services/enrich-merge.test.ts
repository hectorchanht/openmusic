import { describe, it, expect } from 'vitest';
import { mergeEnrichArtist, mergeEnrichAlbum } from './enrich-merge';
import type { EnrichResult } from './lastfm';
import type { DeezerArtistInfo, DeezerAlbumInfo } from './deezer';

// enrich-merge.ts (Phase 17, ENRICH-04 / D-15) is the PURE field-precedence helper that
// combines a Last.fm EnrichResult with the Deezer artist/album info reshape. The contract:
//  - Best-quality image wins regardless of source (prefer the Deezer hi-res picture/cover when
//    present; never downgrade a present value to null).
//  - Counts stay side-by-side when both sources have them (expose lastfm + deezer separately so
//    the page can label by source) — never silently drop one.
//  - Last.fm-only fields (tags, bio, bioUrl) pass through untouched (additive, Phase 8 rule).
//  - A null/empty Deezer input leaves the Last.fm result fully intact (graceful degradation).
//  - The helper is PURE: same inputs → same output, no side effects.

const LF_ARTIST: EnrichResult = {
	tags: ['electronic', 'house'],
	bio: 'A French electronic duo.',
	bioUrl: 'https://last.fm/music/Daft+Punk',
	lastfmArt: 'https://lastfm.example/lowres.jpg',
	listeners: 4200000,
	playcount: 99000000
};

const DZ_ARTIST: DeezerArtistInfo = {
	picture: 'https://cdn-images.dzcdn.net/images/artist/x/1000x1000.jpg',
	fans: 5160298,
	albums: 36
};

const LF_ALBUM: EnrichResult = {
	tags: ['classic', 'electro'],
	bio: 'The second studio album.',
	bioUrl: 'https://last.fm/music/Daft+Punk/Discovery',
	lastfmArt: 'https://lastfm.example/album-lowres.jpg',
	listeners: 1500000,
	playcount: 30000000
};

const DZ_ALBUM: DeezerAlbumInfo = {
	cover: 'https://cdn-images.dzcdn.net/images/cover/y/1000x1000.jpg',
	releaseDate: '2001-03-07',
	tracks: 14,
	fans: 333926,
	label: 'Virgin',
	genres: ['Electro', 'Dance'],
	duration: 3662
};

describe('mergeEnrichArtist — D-15 field precedence', () => {
	it('picks the Deezer hi-res picture over the lower-res lastfmArt when present', () => {
		const m = mergeEnrichArtist(LF_ARTIST, DZ_ARTIST);
		expect(m.image).toBe(DZ_ARTIST.picture);
	});

	it('keeps lastfmArt when Deezer picture is null (additive, never downgrades to null)', () => {
		const m = mergeEnrichArtist(LF_ARTIST, { picture: null, fans: 5160298, albums: 36 });
		expect(m.image).toBe(LF_ARTIST.lastfmArt);
	});

	it('surfaces BOTH lastfm listeners/playcount AND deezer fans when both exist', () => {
		const m = mergeEnrichArtist(LF_ARTIST, DZ_ARTIST);
		expect(m.lastfmListeners).toBe(LF_ARTIST.listeners);
		expect(m.lastfmPlaycount).toBe(LF_ARTIST.playcount);
		expect(m.deezerFans).toBe(DZ_ARTIST.fans);
		expect(m.albums).toBe(DZ_ARTIST.albums);
	});

	it('shows only the one count source that exists', () => {
		const m = mergeEnrichArtist(
			{ tags: [], bio: null, bioUrl: null, lastfmArt: null },
			DZ_ARTIST
		);
		expect(m.lastfmListeners).toBeNull();
		expect(m.lastfmPlaycount).toBeNull();
		expect(m.deezerFans).toBe(DZ_ARTIST.fans);
	});

	it('preserves Last.fm tags/bio/bioUrl unchanged (Deezer never overwrites these)', () => {
		const m = mergeEnrichArtist(LF_ARTIST, DZ_ARTIST);
		expect(m.tags).toEqual(LF_ARTIST.tags);
		expect(m.bio).toBe(LF_ARTIST.bio);
		expect(m.bioUrl).toBe(LF_ARTIST.bioUrl);
	});

	it('leaves the Last.fm result fully intact when Deezer is null (graceful degradation)', () => {
		const m = mergeEnrichArtist(LF_ARTIST, null);
		expect(m.image).toBe(LF_ARTIST.lastfmArt);
		expect(m.lastfmListeners).toBe(LF_ARTIST.listeners);
		expect(m.deezerFans).toBeNull();
		expect(m.albums).toBeNull();
		expect(m.tags).toEqual(LF_ARTIST.tags);
	});

	it('never throws on both-null inputs (returns an all-empty merged shape)', () => {
		const m = mergeEnrichArtist(null, null);
		expect(m.image).toBeNull();
		expect(m.tags).toEqual([]);
		expect(m.bio).toBeNull();
		expect(m.deezerFans).toBeNull();
	});

	it('is pure — same inputs produce a deep-equal output every call', () => {
		const a = mergeEnrichArtist(LF_ARTIST, DZ_ARTIST);
		const b = mergeEnrichArtist(LF_ARTIST, DZ_ARTIST);
		expect(a).toEqual(b);
		// inputs are not mutated
		expect(LF_ARTIST.tags).toEqual(['electronic', 'house']);
		expect(DZ_ARTIST.fans).toBe(5160298);
	});
});

describe('mergeEnrichAlbum — D-15 field precedence', () => {
	it('takes releaseDate/label/genres/tracks/duration from Deezer when present', () => {
		const m = mergeEnrichAlbum(LF_ALBUM, DZ_ALBUM);
		expect(m.releaseDate).toBe(DZ_ALBUM.releaseDate);
		expect(m.label).toBe(DZ_ALBUM.label);
		expect(m.genres).toEqual(DZ_ALBUM.genres);
		expect(m.tracks).toBe(DZ_ALBUM.tracks);
		expect(m.duration).toBe(DZ_ALBUM.duration);
	});

	it('picks the Deezer hi-res cover over the lower-res lastfmArt', () => {
		const m = mergeEnrichAlbum(LF_ALBUM, DZ_ALBUM);
		expect(m.cover).toBe(DZ_ALBUM.cover);
	});

	it('keeps lastfmArt cover when Deezer cover is null (never downgrades)', () => {
		const m = mergeEnrichAlbum(LF_ALBUM, { ...DZ_ALBUM, cover: null });
		expect(m.cover).toBe(LF_ALBUM.lastfmArt);
	});

	it('surfaces BOTH lastfm counts and deezer fans side-by-side', () => {
		const m = mergeEnrichAlbum(LF_ALBUM, DZ_ALBUM);
		expect(m.lastfmListeners).toBe(LF_ALBUM.listeners);
		expect(m.lastfmPlaycount).toBe(LF_ALBUM.playcount);
		expect(m.deezerFans).toBe(DZ_ALBUM.fans);
	});

	it('leaves missing Deezer fields absent (null/[]), never throws', () => {
		const m = mergeEnrichAlbum(LF_ALBUM, null);
		expect(m.cover).toBe(LF_ALBUM.lastfmArt);
		expect(m.releaseDate).toBeNull();
		expect(m.label).toBeNull();
		expect(m.genres).toEqual([]);
		expect(m.tracks).toBeNull();
		expect(m.duration).toBeNull();
		expect(m.deezerFans).toBeNull();
		// Last.fm fields intact
		expect(m.tags).toEqual(LF_ALBUM.tags);
		expect(m.bio).toBe(LF_ALBUM.bio);
	});

	it('never throws on both-null inputs (all-empty merged shape)', () => {
		const m = mergeEnrichAlbum(null, null);
		expect(m.cover).toBeNull();
		expect(m.releaseDate).toBeNull();
		expect(m.genres).toEqual([]);
		expect(m.tags).toEqual([]);
	});

	it('is pure — same inputs deep-equal + no mutation', () => {
		const a = mergeEnrichAlbum(LF_ALBUM, DZ_ALBUM);
		const b = mergeEnrichAlbum(LF_ALBUM, DZ_ALBUM);
		expect(a).toEqual(b);
		expect(DZ_ALBUM.genres).toEqual(['Electro', 'Dance']);
	});
});
