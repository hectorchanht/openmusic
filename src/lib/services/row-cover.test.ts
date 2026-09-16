// row-cover.test.ts (quick-260910-qwt) — node tests for the ONE shared row-cover read order.
// Moved here from upnext-covers.test.ts when upNextTileCover was generalised to pickRowCover: the
// helper is now the read-order authority for search, library, artist, CompactRow, Up Next and
// Related, so its tests live beside it. No localStorage stub needed — the module is cache-free
// (the caller passes the cache read IN; see row-cover.ts).
import { describe, it, expect } from 'vitest';
import { pickRowCover } from '$lib/services/row-cover';

describe('pickRowCover', () => {
	it('reads resolved -> seeded -> cached -> null', () => {
		expect(pickRowCover(null, 'https://resolved', 'https://seeded', 'https://cached')).toBe('https://resolved');
		expect(pickRowCover(null, undefined, 'https://seeded', 'https://cached')).toBe('https://seeded');
		expect(pickRowCover(null, undefined, null, 'https://cached')).toBe('https://cached');
		expect(pickRowCover(null, undefined, null, null)).toBeNull();
	});

	it('treats an empty string as a miss at every rung', () => {
		expect(pickRowCover('', '', 'https://a', null)).toBe('https://a');
		expect(pickRowCover('', '', '', 'https://c')).toBe('https://c');
		expect(pickRowCover('', '', '', '')).toBeNull();
	});

	it('keeps the seeded album cover ahead of the cache (quick-260910-piz)', () => {
		expect(pickRowCover(null, undefined, 'https://album', 'https://deezer')).toBe('https://album');
	});

	// quick-260915-w4f: rung 0. The pin must beat `seeded` (track.cover) specifically — that is the
	// rung the first-solid-wins chain's wrong answer usually sits in, and the reason a pin folded only
	// into the cache read would look broken on every list surface.
	it('puts the user pin ahead of resolved AND seeded (quick-260915-w4f)', () => {
		expect(pickRowCover('https://pin', 'https://resolved', 'https://seeded', 'https://cached')).toBe('https://pin');
		expect(pickRowCover('https://pin', undefined, 'https://album', null)).toBe('https://pin');
		// An unpinned uid (null / '' / undefined) leaves the existing order untouched.
		expect(pickRowCover(undefined, 'https://resolved', 'https://seeded', null)).toBe('https://resolved');
		expect(pickRowCover('', undefined, 'https://seeded', null)).toBe('https://seeded');
	});
});
