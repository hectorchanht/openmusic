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
	it('is the 23-id catalog in the documented default order', () => {
		expect([...MENU_ACTIONS]).toEqual([
			// quick-261006-44v: the default IS the user's own arrangement (screenshot 2026-10-06)
			'remix',
			'goToArtist',
			'download',
			'like',
			'versions',
			'changeCover',
			'changeLyrics',
			'lyricsTiming',
			'editTags',
			'addToPlaylist',
			'sleepTimer',
			'clearQueue',
			// quick-261006-44r: the edit affordance is a grid cell; the header pencil is retired
			'customize',
			'detail',
			'goToAlbum',
			'share',
			// quick-261006-44u: the three new actions, enabled and one drag from the visible grid
			'startRadio',
			'viewComments',
			'viewRelated',
			// the remainder of the catalog, in a stable order
			'playNext',
			'addQueue',
			'shuffleQueue',
			// quick-261006-44r: repeat moved to the back (user 2026-10-06)
			'repeat'
		]);
	});

	it('has no duplicates', () => {
		expect(new Set(MENU_ACTIONS).size).toBe(MENU_ACTIONS.length);
	});
});

describe('normalizeMenuOrder', () => {
	it('keeps a complete saved order as-is (user reordered)', () => {
		const saved = [...MENU_ACTIONS].reverse() as MenuActionId[];
		expect(normalizeMenuOrder(saved)).toEqual(saved);
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
		// the kept ids hold their relative saved order under the catalog-position fill
		expect(out.indexOf('like')).toBeLessThan(out.indexOf('share'));
	});

	// quick-261006-44u: missing ids insert at their CATALOG positions (not appended),
	// so new actions land inside the visible 16 instead of piling up beyond the grid.
	it('inserts missing catalog ids at their catalog positions', () => {
		const out = normalizeMenuOrder(['share']);
		expect(out).toEqual([...MENU_ACTIONS]);
		expect(out.indexOf('share')).toBe(MENU_ACTIONS.indexOf('share'));
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
	// quick-261006-44u/v: new actions insert at their catalog positions.
	it('migrates a pre-customize order: customize takes repeat\'s old slot, repeat to the back, new actions at catalog positions', () => {
		const oldOrder: MenuActionId[] = [
			'remix', 'playNext', 'download', 'like', 'addQueue', 'versions',
			'changeCover', 'changeLyrics', 'lyricsTiming', 'editTags', 'addToPlaylist',
			'repeat', 'shuffleQueue', 'clearQueue', 'sleepTimer', 'goToArtist',
			'goToAlbum', 'share', 'detail'
		];
		const out = normalizeMenuOrder(oldOrder);
		expect(out).toHaveLength(23);
		expect(out[11]).toBe('customize'); // repeat's old slot
		expect(out[out.length - 1]).toBe('repeat'); // repeat to the back
		expect(out[16]).toBe('startRadio');
		expect(out[17]).toBe('viewComments');
		expect(out[18]).toBe('viewRelated');
		// everything else keeps its saved relative order
		expect(out.indexOf('shuffleQueue')).toBe(12);
		expect(new Set(out).size).toBe(23);
	});

	it('does not re-migrate an order that already has customize', () => {
		const current = [...MENU_ACTIONS];
		expect(normalizeMenuOrder(current)).toEqual(current);
	});

	it('a pre-customize order missing repeat still gains customize via the catalog insert', () => {
		const out = normalizeMenuOrder(['like', 'share']);
		expect(out).toContain('customize');
		expect(out).toContain('repeat');
		expect(out.indexOf('customize')).toBeLessThan(out.indexOf('repeat'));
	});

	it('inserts new actions at catalog positions for a user-reordered full order', () => {
		// A user on the 20-action catalog who moved 'share' to the front.
		const twenty = [...MENU_ACTIONS].filter(
			(id) => id !== 'startRadio' && id !== 'viewComments' && id !== 'viewRelated'
		) as MenuActionId[];
		const saved = ['share', ...twenty.filter((id) => id !== 'share')] as MenuActionId[];
		const out = normalizeMenuOrder(saved);
		expect(out).toHaveLength(23);
		expect(out[0]).toBe('share'); // the user's own arrangement is respected
		expect(out).toContain('startRadio');
		expect(out).toContain('viewComments');
		expect(out).toContain('viewRelated');
		expect(new Set(out).size).toBe(23);
	});
});
