import { describe, it, expect } from 'vitest';
import { blockedGenres, filterCandidates, normalizeTag, pickOne } from './random-discovery';
import { normField, matchKey } from '$lib/services/dedupe';
import type { DiscoveryTrack } from '$lib/services/lastfm';

// quick-261116-dtap: the pure half of the double-tap discovery dive — the genre blocklist
// (Last.fm tags → chart genres) and the candidate filter (recent artists / heard songs).
// The orchestration (chart fetch + tapStub) is store wiring and is covered by the player
// suite's pool test; everything that DECIDES lives here.
describe('normalizeTag', () => {
	it('lowercases, trims and collapses whitespace', () => {
		expect(normalizeTag('  Hip   Hop ')).toBe('hip hop');
		expect(normalizeTag('K-Pop')).toBe('k-pop');
	});
});

describe('blockedGenres', () => {
	it('a cantopop tag blocks cantopop AND the overlapping asian pool', () => {
		const b = blockedGenres(['cantopop']);
		expect(b.has('cantopop')).toBe(true);
		expect(b.has('asian')).toBe(true);
		expect(b.has('mandopop')).toBe(false);
	});
	it('hip-hop spellings all block hiphop', () => {
		for (const tag of ['hip-hop', 'Hip Hop', 'rap']) {
			expect(blockedGenres([tag]).has('hiphop')).toBe(true);
		}
	});
	it('r&b spellings block rnb; rock and alternative stay distinct', () => {
		expect(blockedGenres(['R&B']).has('rnb')).toBe(true);
		expect(blockedGenres(['rhythm and blues']).has('rnb')).toBe(true);
		const rock = blockedGenres(['rock']);
		expect(rock.has('rock')).toBe(true);
		expect(rock.has('alternative')).toBe(false);
		expect(blockedGenres(['alternative rock']).has('alternative')).toBe(true);
		expect(blockedGenres(['alternative rock']).has('rock')).toBe(true);
	});
	it('generic tags block nothing (pop / chinese are not chart genres)', () => {
		expect(blockedGenres(['pop', 'chinese', 'favorites', 'seen live']).size).toBe(0);
	});
	it('empty / dry tag lists block nothing — the dive degrades to artist exclusion', () => {
		expect(blockedGenres([]).size).toBe(0);
	});
	it('unions across the current track and recent artists', () => {
		const b = blockedGenres(['k-pop', 'dance']);
		expect([...b].sort()).toEqual(['asian', 'dance', 'kpop']);
	});
});

describe('filterCandidates', () => {
	const item = (artist: string, title: string): DiscoveryTrack => ({
		artist,
		title,
		image: null,
		mbid: null
	});
	it('drops recent artists (folded spelling) and already-heard songs, keeps the rest', () => {
		// The fold here is normField's synchronous layer (case/punct). The 繁/简 script fold
		// rides the async zh-convert dict that the play/search paths warm before any dive
		// can happen — the same posture as every other normField comparison in the app.
		const excludeArtists = new Set([normField('Jay Chou')]);
		const excludeKeys = new Set([matchKey('Adele', 'Hello')]);
		const items = [
			item('jay chou', 'Simple Love'), // same artist, folded spelling → dropped
			item('Adele', 'Hello'), // heard song → dropped
			item('Adele', 'Easy On Me'), // same artist as a heard song but NOT excluded by artist → kept
			item('Coldplay', 'Yellow') // untouched → kept
		];
		const out = filterCandidates(items, excludeArtists, excludeKeys);
		expect(out.map((t) => t.title)).toEqual(['Easy On Me', 'Yellow']);
	});
	it('drops blank artist/title rows a chart pool should never carry', () => {
		const out = filterCandidates([item('', 'X'), item('A', '  ')], new Set(), new Set());
		expect(out).toEqual([]);
	});
	it('no exclusions → everything survives', () => {
		const items = [item('A', 'One'), item('B', 'Two')];
		expect(filterCandidates(items, new Set(), new Set())).toEqual(items);
	});
});

describe('pickOne', () => {
	it('empty list → null', () => {
		expect(pickOne([], Math.random)).toBeNull();
	});
	it('rng 0 picks the head, rng ~1 picks the tail, never out of range', () => {
		const items = ['a', 'b', 'c'];
		expect(pickOne(items, () => 0)).toBe('a');
		expect(pickOne(items, () => 0.999)).toBe('c');
		expect(pickOne(items, () => 1)).toBe('c'); // clamped
	});
});
