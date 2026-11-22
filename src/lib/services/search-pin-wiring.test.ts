import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// STANDING RULE structural pins (Hector 2026-11-21, quick-261122-rules), in the
// lyrics-settings-sheet source technique (no jsdom in this project). The pure partition is
// pinned in search-pin.test.ts; these pin that the search page actually ROUTES every result
// commit and the typeahead's song rows through it, with the downloaded AND liked signals.
const page = readFileSync('src/routes/(app)/search/+page.svelte', 'utf-8');

describe('search page — downloaded/liked songs pin to the top', () => {
	it('the one ranking funnel (rankList) wraps rankPool in pinOwned', () => {
		const fn = page.slice(page.indexOf('function rankList('));
		const body = fn.slice(0, fn.indexOf('\n\t}'));
		expect(body).toMatch(/pinOwned\(\s*rankPool\(/);
		expect(body).toContain('isOwnedSong');
	});

	it('every result commit goes through rankList (no raw dedupeBest assignment)', () => {
		expect(page).not.toMatch(/results\s*=\s*dedupeBest\(/);
		expect(page).not.toMatch(/results\s*=\s*rankPool\(/);
		expect((page.match(/rankList\(dedupeBest\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
	});

	it('owned = liked OR downloaded, both at song level', () => {
		const fn = page.slice(page.indexOf('function isOwnedSong('));
		const body = fn.slice(0, fn.indexOf('\n\t}'));
		expect(body).toContain('library.isLikedTrack(t)');
		expect(body).toContain('library.downloadUidFor(t)');
	});

	it('the tab-return restore re-pins the session results', () => {
		expect(page).toContain('results = pinOwned(searchSession.results, isOwnedSong)');
	});

	it('typeahead song suggestions are pinned too', () => {
		expect(page).toMatch(/suggestions = pinOwned\(deriveSuggestions\(/);
	});
});
