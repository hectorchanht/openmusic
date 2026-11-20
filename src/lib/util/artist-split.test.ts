import { describe, it, expect } from 'vitest';
import { splitArtists } from './artist-split';

describe('splitArtists', () => {
	it('splits on a comma', () => {
		expect(splitArtists('周杰倫, 費玉清')).toEqual(['周杰倫', '費玉清']);
	});

	it('splits on an ampersand', () => {
		expect(splitArtists('A & B')).toEqual(['A', 'B']);
	});

	it('splits on the Chinese enumeration comma', () => {
		expect(splitArtists('甲、乙、丙')).toEqual(['甲', '乙', '丙']);
	});

	it('splits on a slash (explicit connector — AC/DC is intentional)', () => {
		expect(splitArtists('A / B')).toEqual(['A', 'B']);
		expect(splitArtists('AC/DC')).toEqual(['AC', 'DC']);
	});

	it('splits on feat. / ft. (all casings)', () => {
		expect(splitArtists('A feat. B')).toEqual(['A', 'B']);
		expect(splitArtists('A ft. B')).toEqual(['A', 'B']);
		expect(splitArtists('A Feat. B')).toEqual(['A', 'B']);
		expect(splitArtists('A FT. B')).toEqual(['A', 'B']);
		expect(splitArtists('A feat B')).toEqual(['A', 'B']);
		expect(splitArtists('A ft B')).toEqual(['A', 'B']);
	});

	it('splits on a standalone collab x / × (whitespace-bounded)', () => {
		expect(splitArtists('A x B')).toEqual(['A', 'B']);
		expect(splitArtists('A × B')).toEqual(['A', 'B']);
	});

	it('does NOT split an embedded x inside a name', () => {
		expect(splitArtists('Maxwell')).toEqual(['Maxwell']);
		expect(splitArtists('Sixx')).toEqual(['Sixx']);
	});

	it('decodes the HTML ampersand entity before splitting', () => {
		expect(splitArtists('A &amp; B')).toEqual(['A', 'B']);
	});

	it('trims each part', () => {
		expect(splitArtists('  A  ,  B  ')).toEqual(['A', 'B']);
	});

	it('returns a single name unchanged when there is no connector', () => {
		expect(splitArtists('Solo Artist')).toEqual(['Solo Artist']);
	});

	it('returns [] for empty / whitespace-only input', () => {
		expect(splitArtists('')).toEqual([]);
		expect(splitArtists('   ')).toEqual([]);
	});

	it('drops empties produced by adjacent connectors', () => {
		expect(splitArtists('A,,B')).toEqual(['A', 'B']);
		expect(splitArtists('A & & B')).toEqual(['A', 'B']);
	});

	it('dedupes exact repeats while preserving first-seen order', () => {
		expect(splitArtists('A & B & A')).toEqual(['A', 'B']);
	});
});
