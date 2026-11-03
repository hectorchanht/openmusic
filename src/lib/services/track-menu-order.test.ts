import { describe, it, expect } from 'vitest';
import {
	MENU_ACTIONS,
	MENU_GRID_SLOTS,
	menuDropIndex,
	menuSlotForIndex,
	normalizeMenuOrder,
	type MenuActionId,
	type MenuCellRect
} from './track-menu-order';

describe('MENU_GRID_SLOTS', () => {
	it('is 20 — the menu grid is 4 columns x 5 rows (user 2026-11-02, superseding the 2026-10-06 4x4)', () => {
		expect(MENU_GRID_SLOTS).toBe(20);
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
	// so new actions land inside the visible 20 instead of piling up beyond the grid.
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

// quick-261102-menudrag — the edit grid's drop geometry. Layout fixture: the real
// grid is 4 columns (`.acts`), cells ~90px wide / 80px tall with a 2px gap, laid out
// row-major — the same shape the component measures with getBoundingClientRect.
function grid(n: number): MenuCellRect[] {
	return Array.from({ length: n }, (_, i) => ({
		left: (i % 4) * 92,
		top: Math.floor(i / 4) * 82,
		width: 90,
		height: 80
	}));
}
const center = (cells: MenuCellRect[], i: number) => ({
	x: cells[i].left + cells[i].width / 2,
	y: cells[i].top + cells[i].height / 2
});
/** The component's drop commit: splice-move `order[from]` to final index `to`. */
function spliceMove<T>(order: readonly T[], from: number, to: number): T[] {
	const next = [...order];
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}

describe('menuDropIndex', () => {
	it('returns 0 for an empty grid (the old no-cells fallback)', () => {
		expect(menuDropIndex(10, 10, [], 0)).toBe(0);
	});

	it('a pointer over the dragged cell’s own center is the identity — a press that never leaves home cannot reorder', () => {
		const cells = grid(12);
		for (let from = 0; from < 12; from++) {
			const c = center(cells, from);
			expect(menuDropIndex(c.x, c.y, cells, from)).toBe(from);
		}
	});

	it('insertion semantics: hovering the NEXT cell’s center still lands back home (the gap before it)', () => {
		const cells = grid(12);
		// Dragging cell 0 onto cell 1's center: the nearest gap is the one before
		// cell 1, which for from=0 is the identity — the item only advances once the
		// pointer crosses toward the cell after next.
		expect(menuDropIndex(center(cells, 1).x, center(cells, 1).y, cells, 0)).toBe(0);
		expect(menuDropIndex(center(cells, 2).x, center(cells, 2).y, cells, 0)).toBe(1);
		expect(menuDropIndex(center(cells, 3).x, center(cells, 3).y, cells, 0)).toBe(2);
	});

	it('cell-boundary math: the target flips exactly at the midpoint between two centers', () => {
		const cells = grid(12);
		const midX = (center(cells, 2).x + center(cells, 3).x) / 2;
		const y = center(cells, 2).y;
		// Equidistant → the earlier center keeps the win (strict <), target stays 1.
		expect(menuDropIndex(midX, y, cells, 0)).toBe(1);
		// One pixel past the midpoint → cell 3 wins, insertion advances to 2.
		expect(menuDropIndex(midX + 1, y, cells, 0)).toBe(2);
	});

	it('2D: a drag from row 2 up across row 1 lands at the row-1 insertion index', () => {
		const cells = grid(12);
		// from = 5 (row 2, col 2); pointer over cell 1's center (row 1, col 2).
		expect(menuDropIndex(center(cells, 1).x, center(cells, 1).y, cells, 5)).toBe(1);
		// And back down: from = 1 over cell 6's center (row 2, col 3) → insertion 5
		// (cell 6's slot is the identity-adjacent gap: remove at 1, insert at 5 puts
		// the item just before the old cell 6's successor).
		expect(menuDropIndex(center(cells, 6).x, center(cells, 6).y, cells, 1)).toBe(5);
	});

	it('dragging DOWN within reach: next-but-one center advances exactly one slot', () => {
		const cells = grid(12);
		// from = 5: own center → 5; cell 6's center → 5 (gap before 6 == identity);
		// cell 7's center → 6 (advanced one); cell 4's center → 4 (back one).
		expect(menuDropIndex(center(cells, 6).x, center(cells, 6).y, cells, 5)).toBe(5);
		expect(menuDropIndex(center(cells, 7).x, center(cells, 7).y, cells, 5)).toBe(6);
		expect(menuDropIndex(center(cells, 4).x, center(cells, 4).y, cells, 5)).toBe(4);
	});

	it('past-the-end: below the grid appends (n-1), from any row', () => {
		const cells = grid(8);
		const below = cells[7].top + cells[7].height + 30;
		expect(menuDropIndex(center(cells, 0).x, below, cells, 0)).toBe(7);
		expect(menuDropIndex(center(cells, 3).x, below, cells, 2)).toBe(7);
	});

	it('past-the-end: beyond the last cell’s center on its own row appends', () => {
		const cells = grid(8);
		const x = cells[7].left + cells[7].width + 40;
		const y = cells[7].top + 10;
		expect(menuDropIndex(x, y, cells, 0)).toBe(7);
	});

	it('no false append from the row above: beyond the last COLUMN but still on row 1 resolves by nearest center', () => {
		const cells = grid(8);
		// x is past the last column's center, y is on row 1 — the past-end rule needs
		// y beyond the last cell's top or bottom, so this falls through to nearest
		// center: cell 3 wins, insertion 2.
		const x = center(cells, 3).x + 80;
		expect(menuDropIndex(x, center(cells, 3).y, cells, 0)).toBe(2);
	});

	it('the dragged cell IS last: appending is the identity, and its neighbour’s center swaps it up one', () => {
		const cells = grid(8);
		// Judged against cell 6 (the dragged 7 is excluded from the past-end rule):
		// beyond cell 6's center on row 2 → n-1 = 7, the identity for from=7.
		const x = center(cells, 6).x + 60;
		expect(menuDropIndex(x, center(cells, 6).y, cells, 7)).toBe(7);
		// Over cell 6's center → insertion 6: remove 7, insert at 6 — a clean swap.
		expect(menuDropIndex(center(cells, 6).x, center(cells, 6).y, cells, 7)).toBe(6);
	});

	it('never mutates its inputs (the cancel path relies on the pure layer being side-effect free)', () => {
		const cells = grid(8);
		const snapshot = JSON.stringify(cells);
		menuDropIndex(500, 500, cells, 3);
		menuSlotForIndex(2, 3, 6);
		expect(JSON.stringify(cells)).toBe(snapshot);
	});
});

describe('menuSlotForIndex', () => {
	it('the moved item takes slot `to`; items outside the span stay', () => {
		expect(menuSlotForIndex(2, 2, 5)).toBe(5);
		expect(menuSlotForIndex(0, 2, 5)).toBe(0);
		expect(menuSlotForIndex(7, 2, 5)).toBe(7);
	});

	it('moving forward (from < to): items in (from, to] shift one slot toward the vacancy', () => {
		expect(menuSlotForIndex(3, 2, 5)).toBe(2);
		expect(menuSlotForIndex(5, 2, 5)).toBe(4);
	});

	it('moving backward (to < from): items in [to, from) shift one slot toward the vacancy', () => {
		expect(menuSlotForIndex(2, 5, 2)).toBe(3);
		expect(menuSlotForIndex(4, 5, 2)).toBe(5);
	});

	it('identity move (from == to) leaves every slot unchanged', () => {
		for (let i = 0; i < 8; i++) expect(menuSlotForIndex(i, 3, 3)).toBe(i);
	});

	it('the slot map is a permutation — every destination is taken exactly once', () => {
		for (const [from, to] of [[0, 7], [7, 0], [2, 5], [5, 2], [3, 3]] as const) {
			const dests = Array.from({ length: 8 }, (_, i) => menuSlotForIndex(i, from, to)).sort((a, b) => a - b);
			expect(dests).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		}
	});
});

describe('menu drag composition — drop commit + Group-1 pinning (quick-261102-menudrag)', () => {
	it('a drag crossing row 1 commits the documented splice result', () => {
		// Default normalized order: Group 1 (remix, share, download, like) at 0–3,
		// 'versions' first in row 2 at index 4. Drag versions up over share's center
		// (index 1): menuDropIndex gives insertion 1 (asserted above), so the commit
		// is exactly this order — versions lands at 1, share/download/like shift right.
		const order = [...MENU_ACTIONS];
		const cells = grid(order.length);
		const to = menuDropIndex(center(cells, 1).x, center(cells, 1).y, cells, 4);
		expect(to).toBe(1);
		expect(spliceMove(order, 4, to)).toEqual([
			'remix', 'versions', 'share', 'download', 'like',
			...order.slice(5)
		]);
	});

	it('pinning is respected end-to-end: whatever a drag does to row 1, normalizeMenuOrder re-pins Group 1 on load', () => {
		// A drag that pulls 'versions' INTO row 1 displaces Group 1 within the
		// session (the edit grid's committed order is the user's, verbatim) — but the
		// pinning rule lives in normalizeMenuOrder, and the drag math composes with
		// it: the next load restores remix/share/download/like to 0–3 with every
		// other id keeping its dragged relative order.
		const dragged = spliceMove([...MENU_ACTIONS], 4, 1);
		const out = normalizeMenuOrder(dragged);
		expect(out.slice(0, 4)).toEqual(['remix', 'share', 'download', 'like']);
		const pinned = new Set(['remix', 'share', 'download', 'like']);
		expect(out.filter((id) => !pinned.has(id))).toEqual(dragged.filter((id) => !pinned.has(id)));
	});

	it('pinning holds even when a Group-1 cell itself is the dragged one', () => {
		// Drag 'share' (index 1) down to insertion 6: the session order carries it
		// there, and normalizeMenuOrder still restores it to slot 1 on load.
		const dragged = spliceMove([...MENU_ACTIONS], 1, 6);
		expect(dragged[6]).toBe('share');
		const out = normalizeMenuOrder(dragged);
		expect(out.slice(0, 4)).toEqual(['remix', 'share', 'download', 'like']);
	});

	it('cancel contract at the pure layer: no commit call, no change — the origin order stands', () => {
		// The component's cancel path never computes a committed order (it springs
		// home with a null pending order), so the strongest pure-layer statement is:
		// the geometry functions are read-only and the identity drop (target ==
		// from) is reachable from the dragged cell's own center for every slot —
		// a cancelled or unmoved drag therefore has nothing to undo.
		const order = [...MENU_ACTIONS];
		const cells = grid(order.length);
		for (let from = 0; from < order.length; from++) {
			const c = center(cells, from);
			const to = menuDropIndex(c.x, c.y, cells, from);
			expect(spliceMove(order, from, to)).toEqual(order);
		}
	});
});
