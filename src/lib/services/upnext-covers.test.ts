// upnext-covers.test.ts (quick-260910-q5a) — node tests for the PURE Up-Next cover decision.
// No localStorage stub is needed: the module is deliberately cache-free (see upnext-covers.ts).
// The tile read-order cases moved to row-cover.test.ts with the helper (quick-260910-qwt).
import { describe, it, expect } from 'vitest';
import { upNextCoverNeeds, UPNEXT_COVER_MAX } from '$lib/services/upnext-covers';

type Row = { artist: string; title: string; cover: string | null };
const row = (artist: string, title: string, cover: string | null = null): Row => ({ artist, title, cover });

describe('upNextCoverNeeds', () => {
	it('skips a row that already carries a non-empty https cover', () => {
		const needs = upNextCoverNeeds([row('Coldplay', 'Yellow', 'https://cdn/a.jpg')]);
		expect(needs).toEqual([]);
	});

	it('includes rows whose cover is null, empty or non-https', () => {
		const needs = upNextCoverNeeds([
			row('A', 'One', null),
			row('B', 'Two', ''),
			row('C', 'Three', 'http://cdn/c.jpg')
		]);
		expect(needs).toEqual([
			{ artist: 'A', title: 'One' },
			{ artist: 'B', title: 'Two' },
			{ artist: 'C', title: 'Three' }
		]);
	});

	it('de-dupes by matchKey, first occurrence wins', () => {
		const needs = upNextCoverNeeds([row('Coldplay', 'Yellow'), row('  coldplay ', 'YELLOW')]);
		expect(needs).toEqual([{ artist: 'Coldplay', title: 'Yellow' }]);
	});

	it('caps at UPNEXT_COVER_MAX by default and honors an explicit max, in list order', () => {
		const rows = Array.from({ length: 25 }, (_, i) => row(`Artist ${i}`, `Title ${i}`));
		const capped = upNextCoverNeeds(rows);
		expect(UPNEXT_COVER_MAX).toBe(20);
		expect(capped).toHaveLength(20);
		expect(capped[0]).toEqual({ artist: 'Artist 0', title: 'Title 0' });
		expect(capped[19]).toEqual({ artist: 'Artist 19', title: 'Title 19' });
		expect(upNextCoverNeeds(rows, 5)).toHaveLength(5);
	});

	it('drops a row with a blank artist AND title; max: 0 returns []', () => {
		expect(upNextCoverNeeds([row('', ''), row('A', 'One')])).toEqual([{ artist: 'A', title: 'One' }]);
		expect(upNextCoverNeeds([row('A', 'One')], 0)).toEqual([]);
	});
});
