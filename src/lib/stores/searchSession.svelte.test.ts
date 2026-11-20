import { describe, it, expect, beforeEach } from 'vitest';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';
import { searchSession } from './searchSession.svelte';

// Headless runes (node project) — mirrors player.svelte.test.ts / searchHistory style.
// Under the node project `window` is undefined, so the store must still CONSTRUCT and
// hasPrior must default false (SSR-guard sanity), and setScroll() must no-op without
// throwing. The in-memory `$state` fields round-trip headless via save()/reset().

function mk(source: SourceId, songid: string): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title: `t-${songid}`,
		artist: `a-${songid}`,
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1
	};
}

describe('searchSession store (D-02)', () => {
	beforeEach(() => {
		searchSession.reset();
	});

	it('defaults to an empty, un-searched session', () => {
		expect(searchSession.q).toBe('');
		expect(searchSession.results).toEqual([]);
		expect(searchSession.page).toBe(1);
		expect(searchSession.hasMore).toBe(false);
		expect(searchSession.scrollY).toBe(0);
		expect(searchSession.searched).toBe(false);
	});

	it('save() round-trips q/results/page/hasMore/searched', () => {
		const results = [mk('netease', 'n1'), mk('qq', 'q1')];
		searchSession.save({ q: 'jay', results, page: 2, hasMore: true, searched: true });
		expect(searchSession.q).toBe('jay');
		expect(searchSession.results).toBe(results);
		expect(searchSession.page).toBe(2);
		expect(searchSession.hasMore).toBe(true);
		expect(searchSession.searched).toBe(true);
	});

	it('hasPrior is false when q empty or searched false, true otherwise', () => {
		// default → false
		expect(searchSession.hasPrior).toBe(false);
		// searched but empty query → false
		searchSession.save({ q: '   ', results: [], page: 1, hasMore: false, searched: true });
		expect(searchSession.hasPrior).toBe(false);
		// non-empty query but not searched → false
		searchSession.save({ q: 'jay', results: [], page: 1, hasMore: false, searched: false });
		expect(searchSession.hasPrior).toBe(false);
		// non-empty query AND searched → true
		searchSession.save({ q: 'jay', results: [mk('netease', 'n1')], page: 1, hasMore: true, searched: true });
		expect(searchSession.hasPrior).toBe(true);
	});

	it('a second save() overwrites the prior session (reset-on-new-query)', () => {
		searchSession.save({ q: 'jay', results: [mk('netease', 'n1')], page: 3, hasMore: true, searched: true });
		const fresh = [mk('kuwo', 'k1')];
		searchSession.save({ q: 'eason', results: fresh, page: 1, hasMore: true, searched: true });
		expect(searchSession.q).toBe('eason');
		expect(searchSession.results).toBe(fresh);
		expect(searchSession.page).toBe(1);
		expect(searchSession.hasPrior).toBe(true);
	});

	it('reset() returns every field to defaults', () => {
		searchSession.save({ q: 'jay', results: [mk('netease', 'n1')], page: 4, hasMore: true, searched: true });
		searchSession.setScroll(0); // no-op under SSR but must not throw
		searchSession.reset();
		expect(searchSession.q).toBe('');
		expect(searchSession.results).toEqual([]);
		expect(searchSession.page).toBe(1);
		expect(searchSession.hasMore).toBe(false);
		expect(searchSession.scrollY).toBe(0);
		expect(searchSession.searched).toBe(false);
	});

	it('SSR guard: under !window, setScroll() writes nothing and does not throw', () => {
		// `window` is absent in the node project; setScroll early-returns (no-op),
		// proving the HAS_WINDOW backstop. The store still constructs and hasPrior
		// defaults false (asserted above) — no SSR module-state leak.
		expect(typeof window).toBe('undefined');
		expect(() => searchSession.setScroll(500)).not.toThrow();
		expect(searchSession.scrollY).toBe(0);
	});
});
