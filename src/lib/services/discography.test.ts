import { describe, it, expect } from 'vitest';
import {
	sortByReleaseDesc,
	filterByType,
	isMainRelease,
	typeLabelKey,
	releaseYear,
	albumHref,
	fallbackCoverSeed,
	type DiscographyEntry
} from './discography';

// quick-260831-qkx. Reported: the artist page's album shelf is "not reliable and not exhaustive,
// many of the time are empty inside or not official album". Once the REAL Deezer discography
// arrives it is large and noisy — Coldplay's 123 releases are 17 albums, 5 EPs and 101 singles —
// so these ordering/filtering rules are what make it usable. Fixtures use real Coldplay data.
function e(over: Partial<DiscographyEntry> = {}): DiscographyEntry {
	return { id: 1, name: 'X', image: null, releaseDate: null, type: 'album', ...over };
}

describe('sortByReleaseDesc', () => {
	it('orders newest first', () => {
		const out = sortByReleaseDesc([
			e({ name: 'Parachutes', releaseDate: '2000-07-10' }),
			e({ name: 'Moon Music', releaseDate: '2024-10-04' }),
			e({ name: 'X&Y', releaseDate: '2005-06-07' })
		]);
		expect(out.map((x) => x.name)).toEqual(['Moon Music', 'X&Y', 'Parachutes']);
	});

	it('orders correctly WITHIN a year (not just by year)', () => {
		// Moon Music and its Full Moon Edition are two days apart — a year-only sort would tie them.
		const out = sortByReleaseDesc([
			e({ name: 'Moon Music', releaseDate: '2024-10-04' }),
			e({ name: 'Moon Music (Full Moon Edition)', releaseDate: '2024-10-06' })
		]);
		expect(out.map((x) => x.name)).toEqual(['Moon Music (Full Moon Edition)', 'Moon Music']);
	});

	it('puts UNDATED entries last, keeping their incoming order', () => {
		// Last.fm fallback rows carry no date. They must not be scrambled to the top by an empty
		// sort key, and their upstream (popularity) order is the only signal they have.
		const out = sortByReleaseDesc([
			e({ name: 'lf-a', releaseDate: null }),
			e({ name: 'dated', releaseDate: '2010-01-01' }),
			e({ name: 'lf-b', releaseDate: null })
		]);
		expect(out.map((x) => x.name)).toEqual(['dated', 'lf-a', 'lf-b']);
	});

	it('is stable for equal dates (upstream order preserved)', () => {
		const out = sortByReleaseDesc([
			e({ name: 'first', releaseDate: '2020-01-01' }),
			e({ name: 'second', releaseDate: '2020-01-01' })
		]);
		expect(out.map((x) => x.name)).toEqual(['first', 'second']);
	});

	it('does not mutate its input', () => {
		const input = [e({ name: 'a', releaseDate: '2000-01-01' }), e({ name: 'b', releaseDate: '2024-01-01' })];
		sortByReleaseDesc(input);
		expect(input.map((x) => x.name)).toEqual(['a', 'b']);
	});

	it('handles an empty list', () => {
		expect(sortByReleaseDesc([])).toEqual([]);
	});
});

describe('isMainRelease / filterByType', () => {
	it('counts albums and EPs as main releases', () => {
		expect(isMainRelease('album')).toBe(true);
		expect(isMainRelease('ep')).toBe(true);
	});

	it('excludes singles AND compilations — compilations are the "not official album" noise', () => {
		expect(isMainRelease('single')).toBe(false);
		expect(isMainRelease('compilation')).toBe(false);
	});

	it('KEEPS an untyped entry, so a Last.fm-only artist never renders a blank shelf', () => {
		expect(isMainRelease(null)).toBe(true);
	});

	it("excludes an unknown-but-typed release rather than guessing it is an album", () => {
		expect(isMainRelease('bootleg')).toBe(false);
	});

	const mixed = [
		e({ name: 'Moon Music', type: 'album' }),
		e({ name: 'an ep', type: 'ep' }),
		e({ name: 'a single', type: 'single' }),
		e({ name: 'a comp', type: 'compilation' }),
		e({ name: 'lf row', type: null })
	];

	it("'main' keeps albums, EPs and untyped rows", () => {
		expect(filterByType(mixed, 'main').map((x) => x.name)).toEqual(['Moon Music', 'an ep', 'lf row']);
	});

	it("'single' is the exact complement of 'main'", () => {
		expect(filterByType(mixed, 'single').map((x) => x.name)).toEqual(['a single', 'a comp']);
		expect(filterByType(mixed, 'main').length + filterByType(mixed, 'single').length).toBe(mixed.length);
	});

	it("'all' keeps everything", () => {
		expect(filterByType(mixed, 'all')).toHaveLength(5);
	});
});

describe('typeLabelKey / releaseYear', () => {
	it('maps each Deezer record type to its label key', () => {
		expect(typeLabelKey('album')).toBe('artist.typeAlbum');
		expect(typeLabelKey('ep')).toBe('artist.typeEp');
		expect(typeLabelKey('single')).toBe('artist.typeSingle');
		expect(typeLabelKey('compilation')).toBe('artist.typeCompilation');
	});

	it('returns null for an untyped/unknown release so the caller shows the generic label', () => {
		expect(typeLabelKey(null)).toBeNull();
		expect(typeLabelKey('bootleg')).toBeNull();
	});

	it('extracts the year, and refuses anything that is not an ISO date', () => {
		expect(releaseYear('2024-10-04')).toBe('2024');
		expect(releaseYear(null)).toBeNull();
		expect(releaseYear('2024')).toBeNull();
		expect(releaseYear('not-a-date')).toBeNull();
	});
});

describe('albumHref', () => {
	it('carries the Deezer id as dzid — this is what fixes "empty inside"', () => {
		const href = albumHref(e({ id: 301663, name: 'Parachutes' }), 'Coldplay');
		expect(href).toBe('/album/Parachutes?artist=Coldplay&dzid=301663');
	});

	it('omits dzid when there is no id, leaving the pre-existing URL byte-identical', () => {
		expect(albumHref(e({ id: null, name: 'Parachutes' }), 'Coldplay')).toBe(
			'/album/Parachutes?artist=Coldplay'
		);
	});

	it('encodes names and artists that contain URL-significant characters', () => {
		const href = albumHref(e({ id: 7, name: 'A/B & C' }), '陳奕迅');
		expect(href).toContain('A%2FB%20%26%20C');
		expect(href).toContain(encodeURIComponent('陳奕迅'));
		// the encoded name must not introduce a stray separator that breaks the query
		expect(href.split('?')).toHaveLength(2);
	});
});

describe('fallbackCoverSeed', () => {
	it('is deterministic — the same release renders the same gradient on both surfaces', () => {
		expect(fallbackCoverSeed('Parachutes')).toBe(fallbackCoverSeed('Parachutes'));
	});

	it('differs across names and is a valid CSS gradient', () => {
		expect(fallbackCoverSeed('Parachutes')).not.toBe(fallbackCoverSeed('X&Y'));
		expect(fallbackCoverSeed('X&Y')).toMatch(/^linear-gradient\(145deg, hsl\(\d+ 55% 32%\), hsl\(\d+ 55% 18%\)\)$/);
	});
});
