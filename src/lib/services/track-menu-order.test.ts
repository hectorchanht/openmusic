import { describe, it, expect } from 'vitest';
import { MENU_ACTIONS, normalizeMenuOrder, type MenuActionId } from './track-menu-order';

describe('MENU_ACTIONS', () => {
	it('is the 19-id catalog in the documented default order', () => {
		expect([...MENU_ACTIONS]).toEqual([
			'remix',
			'playNext',
			'download',
			'like',
			'addQueue',
			'versions',
			'changeCover',
			'changeLyrics',
			'lyricsTiming',
			'editTags',
			'addToPlaylist',
			'repeat',
			'shuffleQueue',
			'clearQueue',
			'sleepTimer',
			'goToArtist',
			'goToAlbum',
			'share',
			'detail'
		]);
	});

	it('has no duplicates', () => {
		expect(new Set(MENU_ACTIONS).size).toBe(MENU_ACTIONS.length);
	});
});

describe('normalizeMenuOrder', () => {
	it('keeps a valid saved order as-is', () => {
		const saved: MenuActionId[] = ['share', 'like', 'detail'];
		const out = normalizeMenuOrder(saved);
		expect(out.slice(0, 3)).toEqual(['share', 'like', 'detail']);
		// …and still appends the rest of the catalog after it
		expect(out).toHaveLength(MENU_ACTIONS.length);
		expect(new Set(out).size).toBe(MENU_ACTIONS.length);
	});

	it('drops unknown ids', () => {
		const out = normalizeMenuOrder(['like', 'nuke-the-app', 'share', 42]);
		expect(out).not.toContain('nuke-the-app');
		expect(out).not.toContain(42);
		expect(out.indexOf('like')).toBeLessThan(out.indexOf('share'));
	});

	it('dedupes, keeping the first occurrence', () => {
		const out = normalizeMenuOrder(['like', 'share', 'like']);
		expect(out.filter((x) => x === 'like')).toHaveLength(1);
		expect(out.indexOf('like')).toBe(0);
	});

	it('appends missing catalog ids in catalog order', () => {
		const out = normalizeMenuOrder(['share']);
		expect(out[0]).toBe('share');
		const rest = out.slice(1);
		expect(rest).toEqual(MENU_ACTIONS.filter((id) => id !== 'share'));
	});

	it('returns a full catalog copy for non-array / undefined input', () => {
		for (const bad of [undefined, null, 'share', 42, { 0: 'share' }]) {
			const out = normalizeMenuOrder(bad);
			expect([...out]).toEqual([...MENU_ACTIONS]);
			expect(out).not.toBe(MENU_ACTIONS); // a copy, not the frozen source
		}
	});

	it('a saved empty array regrows to the full catalog', () => {
		expect(normalizeMenuOrder([])).toEqual([...MENU_ACTIONS]);
	});
});
