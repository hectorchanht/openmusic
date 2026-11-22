// STANDING RULE guard (Hector 2026-11-21, quick-261122-rules): downloaded/liked songs pin to the
// top of search results. If any assertion here fails, the rule is broken — do not "update" the test.
import { describe, it, expect } from 'vitest';
import { pinOwned } from '$lib/services/search-pin';

describe('pinOwned — downloaded/liked pin to the top of search results', () => {
	const rows = ['a', 'b', 'c', 'd', 'e'];

	it('lifts owned rows to the top', () => {
		const out = pinOwned(rows, (r) => r === 'd');
		expect(out[0]).toBe('d');
	});

	it('is stable in BOTH bands (rank order preserved inside pinned and unpinned)', () => {
		expect(pinOwned(rows, (r) => r === 'e' || r === 'c')).toEqual(['c', 'e', 'a', 'b', 'd']);
	});

	it('never drops or duplicates a row', () => {
		const out = pinOwned(rows, (r) => r !== 'b');
		expect([...out].sort()).toEqual([...rows].sort());
		expect(out).toHaveLength(rows.length);
	});

	it('no owned rows → original order, and a fresh array (caller may not mutate the input)', () => {
		const out = pinOwned(rows, () => false);
		expect(out).toEqual(rows);
		expect(out).not.toBe(rows);
	});

	it('a throwing predicate counts as not-owned, never crashes the result list', () => {
		const out = pinOwned(rows, (r) => {
			if (r === 'b') throw new Error('boom');
			return r === 'c';
		});
		expect(out).toEqual(['c', 'a', 'b', 'd', 'e']);
	});
});
