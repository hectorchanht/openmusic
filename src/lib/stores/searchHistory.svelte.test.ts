import { describe, it, expect, beforeEach } from 'vitest';
import { searchHistory } from './searchHistory.svelte';

// Headless runes (node project) — mirrors player.svelte.test.ts / history style.
// Under the node project `browser` is false, so load()/save() early-return (no
// localStorage touch — verifies the SSR guard). The in-memory `entries` $state still
// updates via recordQuery, so add/clear round-trip is observable headless.
describe('searchHistory store (D-05)', () => {
	beforeEach(() => {
		searchHistory.clear();
	});

	it('add() prepends and de-dupes case-insensitively (in-memory round-trip)', () => {
		searchHistory.add('jay');
		searchHistory.add('eason');
		searchHistory.add('JAY '); // dupe → moves to top, single entry
		expect(searchHistory.entries.map((e) => e.query)).toEqual(['JAY', 'eason']);
	});

	it('add() ignores empty / whitespace queries', () => {
		searchHistory.add('jay');
		searchHistory.add('');
		searchHistory.add('   ');
		expect(searchHistory.entries.map((e) => e.query)).toEqual(['jay']);
	});

	it('clear() empties the entries', () => {
		searchHistory.add('jay');
		searchHistory.add('eason');
		searchHistory.clear();
		expect(searchHistory.entries).toEqual([]);
	});

	it('remove() drops a single entry case-insensitively (quick-260711-sm7)', () => {
		searchHistory.add('jay');
		searchHistory.add('eason');
		searchHistory.add('leehom');
		searchHistory.remove('EASON'); // case-insensitive match
		expect(searchHistory.entries.map((e) => e.query)).toEqual(['leehom', 'jay']);
	});

	it('SSR guard: under !browser, save() writes nothing to localStorage and does not throw', () => {
		// `globalThis.localStorage` is absent in the node project; if save() were not
		// browser-guarded, add() would throw a ReferenceError. It does not.
		expect(typeof globalThis.localStorage).toBe('undefined');
		expect(() => searchHistory.add('jay')).not.toThrow();
		// entries still updated in memory (the guard only skips persistence)
		expect(searchHistory.entries.map((e) => e.query)).toEqual(['jay']);
	});
});
