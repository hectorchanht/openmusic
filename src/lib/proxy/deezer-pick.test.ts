import { describe, it, expect } from 'vitest';
import { pickBestArtistId, DEEZER_ARTIST_SEARCH_LIMIT } from './deezer-pick';

// debug/upnext-diverse-fallback-kuwo-dead (2026-08-31). Both fixtures below are the REAL
// `https://api.deezer.com/search/artist?q=<name>` responses measured that day, in upstream order —
// which is what makes the point: position 0 is a namesake shell in both, so the old
// `data[0]&limit=1` read resolved the wrong artist every time.
const DRAKE_HITS = [
	{ id: 67927442, name: 'Drake', nb_fan: 111 },
	{ id: 67926762, name: 'Drake', nb_fan: 84 },
	{ id: 285842041, name: 'Drake', nb_fan: 31 },
	{ id: 246791, name: 'Drake', nb_fan: 24068325 }, // the real one, FOURTH
	{ id: 303396411, name: 'Drake', nb_fan: 9 }
];

const COLDPLAY_HITS = [
	{ id: 316813311, name: 'Coldplay', nb_fan: 91 }, // shell: blank picture, 0 albums
	{ id: 892, name: 'Coldplay', nb_fan: 18367520 }, // the real one, SECOND
	{ id: 214011037, name: 'Coldplay Piano Covers', nb_fan: 658 },
	{ id: 4581886, name: 'Coldplay Metal Tribute', nb_fan: 6166 },
	{ id: 1547116, name: 'Karaoke - Coldplay', nb_fan: 404 }
];

describe('pickBestArtistId — the namesake-shell bug', () => {
	it('picks the real Drake (24M fans), not the 111-fan shell at position 0', () => {
		expect(pickBestArtistId(DRAKE_HITS, 'Drake')).toBe('246791');
	});

	it('picks the real Coldplay (id 892), not the 91-fan shell the artist page was rendering', () => {
		expect(pickBestArtistId(COLDPLAY_HITS, 'Coldplay')).toBe('892');
	});

	it('prefers an EXACT name match over a higher-fan near-match', () => {
		// "Coldplay Metal Tribute" (6166) out-fans the shell "Coldplay" (91) — but the exact-name
		// group must still win, or a tribute act would hijack the query.
		const noReal = COLDPLAY_HITS.filter((h) => h.id !== 892);
		expect(pickBestArtistId(noReal, 'Coldplay')).toBe('316813311');
	});

	it('is case- and punctuation-insensitive on the exact-match test', () => {
		const hits = [
			{ id: 1, name: 'Tribute to AC/DC', nb_fan: 900 },
			{ id: 2, name: 'ac dc', nb_fan: 10 }
		];
		expect(pickBestArtistId(hits, 'AC/DC')).toBe('2');
	});

	it('falls back to fan count when NOTHING matches the name exactly', () => {
		const hits = [
			{ id: 1, name: 'Some Cover Band', nb_fan: 5 },
			{ id: 2, name: 'Another Tribute', nb_fan: 500 }
		];
		expect(pickBestArtistId(hits, 'Nobody At All')).toBe('2');
	});

	it('behaves exactly like the old data[0] read for a single-hit response', () => {
		expect(pickBestArtistId([{ id: 42, name: 'Solo', nb_fan: 3 }], 'Solo')).toBe('42');
	});

	it('keeps upstream order on a tie (no reshuffling of equally-ranked hits)', () => {
		const hits = [
			{ id: 10, name: 'Same', nb_fan: 7 },
			{ id: 11, name: 'Same', nb_fan: 7 }
		];
		expect(pickBestArtistId(hits, 'Same')).toBe('10');
	});

	it('tolerates missing nb_fan / missing name / empty list (null-safe, never throws)', () => {
		expect(pickBestArtistId([], 'Drake')).toBeNull();
		expect(pickBestArtistId([{ name: 'No Id', nb_fan: 5 }], 'No Id')).toBeNull();
		expect(pickBestArtistId([{ id: 7 }], 'Whatever')).toBe('7');
		expect(pickBestArtistId([{ id: 8, name: 'X' }, { id: 9, name: 'X', nb_fan: 2 }], 'X')).toBe('9');
	});

	it('requests enough hits for the choice to be possible at all', () => {
		// The bug was structural: with limit=1 there is nothing to pick between, so the picker
		// cannot help unless the caller widens the search.
		expect(DEEZER_ARTIST_SEARCH_LIMIT).toBeGreaterThanOrEqual(5);
	});
});

// quick-261010-exact: the CJK impostor case. Deezer's search/artist?q=姜濤 (measured 2026-10-10)
// returns TWO profiles: a 13-fan exact-spelled "姜濤" (picture = Gin Lee's 沈慧雯 duet artwork)
// and the real "Keung To" (128 fans, real photo). Without aliases the impostor is unbeatable.
const KEUNG_TO_HITS = [
	{ id: 150054092, name: '姜濤', nb_fan: 13 }, // impostor, exact-spelled
	{ id: 126889862, name: 'Keung To', nb_fan: 128 } // the real artist, romanized profile
];

describe('pickBestArtistId — MusicBrainz alias variants count as exact', () => {
	it('picks the real Keung To profile once the romanized alias is known', () => {
		expect(pickBestArtistId(KEUNG_TO_HITS, '姜濤', ['Keung To', '姜涛', '姜濤'])).toBe('126889862');
	});

	it('without aliases the exact-spelled impostor still wins (documents the bug shape)', () => {
		expect(pickBestArtistId(KEUNG_TO_HITS, '姜濤')).toBe('150054092');
	});

	it('alias matching is case- and punctuation-insensitive like the query match', () => {
		const hits = [
			{ id: 1, name: 'KEUNG-TO', nb_fan: 5 },
			{ id: 2, name: 'Keung To', nb_fan: 50 }
		];
		expect(pickBestArtistId(hits, '姜濤', ['keung to'])).toBe('2');
	});

	it('a non-exact hit still never beats an exact one, even with aliases in play', () => {
		// The Coldplay-tribute guard must survive the alias widening: "Coldplay Metal Tribute"
		// (6166 fans) must not hijack the query just because aliases exist.
		const hits = [
			{ id: 316813311, name: 'Coldplay', nb_fan: 91 },
			{ id: 4581886, name: 'Coldplay Metal Tribute', nb_fan: 6166 }
		];
		expect(pickBestArtistId(hits, 'Coldplay', ['Chris Martin'])).toBe('316813311');
	});

	it('an empty alias list behaves exactly like the two-arg call', () => {
		expect(pickBestArtistId(KEUNG_TO_HITS, '姜濤', [])).toBe(pickBestArtistId(KEUNG_TO_HITS, '姜濤'));
	});
});
