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
			// quick-261021-menu2: regrouped by user 2026-10-21
			// Group 1: remix (autoplay), share, download, like
			'remix',
			'share',
			'download',
			'like',
			// Group 2: versions, changeCover, changeLyrics, goToArtist, goToAlbum
			'versions',
			'changeCover',
			'changeLyrics',
			'goToArtist',
			'goToAlbum',
			// Group 3: customize, downloadSource, repeat, addToPlaylist
			'customize',
			'downloadSource',
			'repeat',
			'addToPlaylist',
			// Group 4: detail, sleepTimer, editTags, playNext
			'detail',
			'sleepTimer',
			'editTags',
			'playNext',
			// the remainder of the catalog, in a stable order
			// quick-261021-menu3: lyricsTiming removed — now a toggle in the Fix lyrics picker
			'addQueue',
			'startRadio',
			'viewComments',
			'viewRelated',
			'shuffleQueue',
			'clearQueue'
		]);
	});

	it('has no duplicates', () => {
		expect(new Set(MENU_ACTIONS).size).toBe(MENU_ACTIONS.length);
	});
});

describe('normalizeMenuOrder', () => {
	it('keeps a complete saved order as-is except Group 1 pinned (user reordered)', () => {
		// quick-261021-menu2: Group 1 (remix, share, download, like) is ALWAYS first
		// in that order — the saved order is preserved except those four are moved
		// to their pinned slots.
		const saved = [...MENU_ACTIONS].reverse() as MenuActionId[];
		const out = normalizeMenuOrder(saved);
		expect(out[0]).toBe('remix');
		expect(out[1]).toBe('share');
		expect(out[2]).toBe('download');
		expect(out[3]).toBe('like');
		// All other ids preserved in their saved relative order.
		const pinned = new Set(['remix', 'share', 'download', 'like']);
		const restSaved = saved.filter((id) => !pinned.has(id));
		const restOut = out.filter((id) => !pinned.has(id));
		expect(restOut).toEqual(restSaved);
	});

	it('drops unknown ids', () => {
		const out = normalizeMenuOrder(['like', 'nuke-the-app', 'share', 42]);
		expect(out).not.toContain('nuke-the-app');
		expect(out).not.toContain(42);
		// Group 1 pinned: share (1) < like (3)
		expect(out.indexOf('share')).toBeLessThan(out.indexOf('like'));
	});

	it('dedupes, keeping the first occurrence', () => {
		const out = normalizeMenuOrder(['like', 'share', 'like']);
		expect(out.filter((x) => x === 'like')).toHaveLength(1);
		// the kept ids hold their relative saved order under the catalog-position fill
		// (Group 1 pinned: share < like)
		expect(out.indexOf('share')).toBeLessThan(out.indexOf('like'));
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

	// quick-261021-menu3: any saved order containing the removed 'lyricsTiming' triggers
	// a full reset to the new default (one-time migration).
	it('migrates a pre-customize order: full reset to new default when lyricsTiming present', () => {
		const oldOrder = [
			'remix', 'playNext', 'download', 'like', 'addQueue', 'versions',
			'changeCover', 'changeLyrics', 'lyricsTiming', 'editTags', 'addToPlaylist',
			'repeat', 'shuffleQueue', 'clearQueue', 'sleepTimer', 'goToArtist',
			'goToAlbum', 'share', 'detail'
		];
		const out = normalizeMenuOrder(oldOrder);
		// Full reset to the new MENU_ACTIONS default
		expect(out).toEqual([...MENU_ACTIONS]);
		expect(out).toHaveLength(23);
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
			(id) => id !== 'startRadio' && id !== 'viewComments' && id !== 'viewRelated' && id !== 'downloadSource'
		) as MenuActionId[];
		const saved = ['share', ...twenty.filter((id) => id !== 'share')] as MenuActionId[];
		const out = normalizeMenuOrder(saved);
		expect(out).toHaveLength(23);
		// quick-261021-menu2: Group 1 (remix, share, download, like) is pinned — user's
		// arrangement is respected for the rest, but Group 1 always leads.
		expect(out[0]).toBe('remix');
		expect(out[1]).toBe('share');
		expect(out[2]).toBe('download');
		expect(out[3]).toBe('like');
		expect(out).toContain('startRadio');
		expect(out).toContain('viewComments');
		expect(out).toContain('viewRelated');
		expect(out).toContain('downloadSource');
		expect(new Set(out).size).toBe(23);
	});
});
