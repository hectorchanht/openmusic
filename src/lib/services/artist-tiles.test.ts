import { describe, it, expect } from 'vitest';
import { mergeArtistTiles, pickTileName, type ArtistTile } from './artist-tiles';

// quick-260831-s0c. Reported: a search for "jay chow" showed THREE artist tiles — 周傑倫, Jay Chou,
// 周杰倫 — for one person, because tiles are derived from raw per-source `track.artist` strings.
// Last.fm resolves all of them to one entity (122,572 listeners for each spelling, measured
// 2026-09-01), and the avatar call already fetches that canonical name, so the merge is free.
function t(name: string, trackCount: number, canonical: string | null = null, image: string | null = null): ArtistTile {
	return { name, image, trackCount, canonical };
}

const JAY_TILES = [
	t('周傑倫', 5, 'Jay Chou'),
	t('Jay Chou', 2, 'Jay Chou'),
	t('周杰倫', 3, 'Jay Chou')
];

describe('mergeArtistTiles — the reported three-tiles-one-artist bug', () => {
	it('collapses all three spellings into ONE tile', () => {
		const out = mergeArtistTiles(JAY_TILES, 'zh-Hant');
		expect(out).toHaveLength(1);
	});

	it('sums the track counts across the merged spellings', () => {
		expect(mergeArtistTiles(JAY_TILES, 'zh-Hant')[0].trackCount).toBe(10);
	});

	it('keeps the first resolved avatar and never lets a null shadow it', () => {
		const withArt = [
			t('周傑倫', 5, 'Jay Chou', null),
			t('Jay Chou', 2, 'Jay Chou', 'https://img/jay.jpg'),
			t('周杰倫', 3, 'Jay Chou', null)
		];
		expect(mergeArtistTiles(withArt, 'zh-Hant')[0].image).toBe('https://img/jay.jpg');
	});

	it('does NOT merge artists Last.fm resolved differently', () => {
		const out = mergeArtistTiles(
			[t('周傑倫', 5, 'Jay Chou'), t('陳奕迅', 4, 'Eason Chan')],
			'zh-Hant'
		);
		expect(out).toHaveLength(2);
	});

	it('leaves tiles with NO canonical exactly as they are (no over-merging)', () => {
		// An artist Last.fm does not know must keep one tile per distinct spelling rather than
		// collapsing into some other group.
		const out = mergeArtistTiles([t('Unknown A', 2), t('Unknown B', 1)], 'en');
		expect(out.map((x) => x.name)).toEqual(['Unknown A', 'Unknown B']);
	});

	it('re-sorts by the SUMMED count so a merged artist can overtake a single-spelling one', () => {
		// Solo Act has more tracks than any individual Jay spelling, but fewer than their sum.
		const out = mergeArtistTiles([t('Solo Act', 6, 'Solo Act'), ...JAY_TILES], 'en');
		expect(out.map((x) => x.trackCount)).toEqual([10, 6]);
		expect(out[0].name).toBe('Jay Chou');
	});

	it('is order-independent for grouping and stable for ties', () => {
		const a = mergeArtistTiles(JAY_TILES, 'en');
		const b = mergeArtistTiles([...JAY_TILES].reverse(), 'en');
		expect(a[0].trackCount).toBe(b[0].trackCount);
	});

	it('handles an empty list', () => {
		expect(mergeArtistTiles([], 'en')).toEqual([]);
	});
});

describe('pickTileName — display name follows the artist-language setting', () => {
	it("shows the romanized name for 'en'", () => {
		expect(pickTileName(JAY_TILES, 'Jay Chou', 'en')).toBe('Jay Chou');
	});

	it("shows a Han spelling for a Chinese setting rather than the romanized one", () => {
		const out = pickTileName(JAY_TILES, 'Jay Chou', 'zh-Hant');
		expect(['周傑倫', '周杰倫']).toContain(out);
		expect(out).not.toBe('Jay Chou');
	});

	it("treats 'auto' and 'off' as sentinels — falls through to the most-represented spelling", () => {
		expect(pickTileName(JAY_TILES, 'Jay Chou', 'auto')).toBe('周傑倫'); // 5 tracks, the highest
		expect(pickTileName(JAY_TILES, 'Jay Chou', 'off')).toBe('周傑倫');
	});

	it('breaks ties on track count, so the dominant spelling in the results wins', () => {
		const out = pickTileName(
			[t('周杰倫', 9, 'Jay Chou'), t('周傑倫', 1, 'Jay Chou')],
			'Jay Chou',
			'zh-Hant'
		);
		expect(out).toBe('周杰倫');
	});

	it('falls back to the canonical when the setting matches no spelling', () => {
		// Only Han spellings present, but the user asked for English.
		expect(pickTileName([t('周傑倫', 5), t('周杰倫', 3)], 'Jay Chou', 'en')).toBe('Jay Chou');
	});

	it('falls back to the most-represented spelling when there is no canonical either', () => {
		expect(pickTileName([t('周傑倫', 5), t('周杰倫', 3)], null, 'ko')).toBe('周傑倫');
	});

	it('returns the canonical for an empty candidate list', () => {
		expect(pickTileName([], 'Jay Chou', 'en')).toBe('Jay Chou');
	});
});
