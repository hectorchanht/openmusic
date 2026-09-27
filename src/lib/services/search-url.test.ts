import { describe, it, expect } from 'vitest';
// PURE module — no runes, no $app/environment — so the node Vitest project compiles it.
import { initialSearch, MAX_URL_QUERY } from './search-url';

// quick-260927-dh5: the search page's mount-time decision — run the ?q= URL query, restore the
// in-memory session, or do nothing. `prior` mirrors the searchSession singleton's shape.
const NO_PRIOR = { hasPrior: false, q: '' };

describe('initialSearch — a ?q= URL query', () => {
	it('runs the URL query on a fresh session', () => {
		expect(initialSearch('?q=hello', NO_PRIOR)).toEqual({ action: 'run', q: 'hello' });
	});

	it('runs the URL query when it differs from the prior session', () => {
		expect(initialSearch('?q=hello', { hasPrior: true, q: 'other' })).toEqual({
			action: 'run',
			q: 'hello'
		});
	});

	it('restores (no refetch) when the URL query matches the prior session', () => {
		expect(initialSearch('?q=hello', { hasPrior: true, q: 'hello' })).toEqual({
			action: 'restore'
		});
	});

	it('runs when the session q matches but hasPrior is false — nothing to restore', () => {
		expect(initialSearch('?q=hello', { hasPrior: false, q: 'hello' })).toEqual({
			action: 'run',
			q: 'hello'
		});
	});

	it('trims the URL query', () => {
		expect(initialSearch('?q=%20hello%20', NO_PRIOR)).toEqual({ action: 'run', q: 'hello' });
	});

	it('caps the URL query at MAX_URL_QUERY code points', () => {
		const init = initialSearch('?q=' + 'a'.repeat(300), NO_PRIOR);
		expect(init.action).toBe('run');
		expect(init.action === 'run' && init.q.length).toBe(MAX_URL_QUERY);
		expect(MAX_URL_QUERY).toBe(200);
	});

	it('decodes %20 and percent-encoded UTF-8', () => {
		expect(initialSearch('?q=G.E.M.%20%E5%85%89%E5%B9%B4%E4%B9%8B%E5%A4%96', NO_PRIOR)).toEqual({
			action: 'run',
			q: 'G.E.M. 光年之外'
		});
	});
});

describe('initialSearch — no usable ?q=', () => {
	it('restores the prior session when there is no URL query', () => {
		expect(initialSearch('', { hasPrior: true, q: 'x' })).toEqual({ action: 'restore' });
	});

	it('does nothing with no URL query and no prior session', () => {
		expect(initialSearch('', NO_PRIOR)).toEqual({ action: 'none' });
	});

	it('treats a blank ?q=%20 as no URL query', () => {
		expect(initialSearch('?q=%20', NO_PRIOR)).toEqual({ action: 'none' });
		expect(initialSearch('?q=%20', { hasPrior: true, q: 'x' })).toEqual({ action: 'restore' });
	});
});
