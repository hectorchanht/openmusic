import { describe, it, expect } from 'vitest';
import { MENU_ACTIONS, MENU_GRID_SLOTS, normalizeMenuOrder, type MenuActionId } from './track-menu-order';

describe('MENU_GRID_SLOTS', () => {
	it('is 16 — the menu is always a 4x4 icon grid (user 2026-10-06)', () => {
		expect(MENU_GRID_SLOTS).toBe(16);
	});

	it('is smaller than the catalog — the live grid caps, extras stay in the edit pool', () => {
		expect(MENU_GRID_SLOTS).toBeLessThan(MENU_ACTIONS.length);
	});
});

describe('MENU_ACTIONS', () => {
	it('is the 20-id catalog in the documented default order', () => {
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
			// quick-261006-44r: the edit affordance is a grid cell in repeat's old slot
			'customize',
			'shuffleQueue',
			'clearQueue',
			'sleepTimer',
			'goToArtist',
			'goToAlbum',
			'share',
			'detail',
			// quick-261006-44r: repeat moved to the back (user 2026-10-06)
			'repeat'
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

	// quick-261006-44r: the customize/repeat rearrangement migrates existing saved orders.
	it('migrates a pre-customize order: customize takes repeat\'s old slot, repeat goes to the back', () => {
		const oldOrder: MenuActionId[] = [
			'remix', 'playNext', 'download', 'like', 'addQueue', 'versions',
			'changeCover', 'changeLyrics', 'lyricsTiming', 'editTags', 'addToPlaylist',
			'repeat', 'shuffleQueue', 'clearQueue', 'sleepTimer', 'goToArtist',
			'goToAlbum', 'share', 'detail'
		];
		const out = normalizeMenuOrder(oldOrder);
		expect(out).toHaveLength(20);
		expect(out[11]).toBe('customize');
		expect(out[out.length - 1]).toBe('repeat');
		expect(out.indexOf('shuffleQueue')).toBe(12); // everything else keeps its place
		expect(new Set(out).size).toBe(20);
	});

	it('does not re-migrate an order that already has customize', () => {
		const current = [...MENU_ACTIONS];
		expect(normalizeMenuOrder(current)).toEqual(current);
	});

	it('a pre-customize order missing repeat still gains customize via the catalog append', () => {
		const out = normalizeMenuOrder(['like', 'share']);
		expect(out).toContain('customize');
		expect(out).toContain('repeat');
		expect(out.indexOf('customize')).toBeLessThan(out.indexOf('repeat'));
	});
});
