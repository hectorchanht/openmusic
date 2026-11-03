// quick-261006-mnu — the TrackMenu action catalog + order normalization.
//
// The menu grid is user-customizable (drag to reorder, tap to show/hide), so the visible
// order lives in settings.trackMenuOrder. This module is PURE (no store/browser imports —
// settings.svelte.ts stays a LEAF) and exports everything the component and the settings
// load/save path need. MENU_ACTIONS doubles as the DEFAULT order: it preserves the user's
// own 2026-10-06 arrangement, with the merged download slot in place and go-to-album
// grouped after go-to-artist.
//
// normalizeMenuOrder is the load-time guard (the rowActions T-l9e-01 posture):
// localStorage is user/extension-writable, so unknown ids are dropped, duplicates are
// collapsed, and any catalog ids missing from the saved array are appended in catalog
// order — that last rule is what makes a FUTURE new action appear instead of vanishing
// silently for existing users.
export type MenuActionId =
	| 'remix'
	| 'playNext'
	| 'download'
	| 'like'
	| 'addQueue'
	| 'startRadio'
	| 'versions'
	| 'changeCover'
	| 'changeLyrics'
	| 'viewComments'
	| 'viewRelated'
	| 'editTags'
	| 'addToPlaylist'
	| 'customize'
	| 'repeat'
	| 'shuffleQueue'
	| 'clearQueue'
	| 'sleepTimer'
	| 'goToArtist'
	| 'goToAlbum'
	| 'share'
	| 'detail'
	| 'downloadSource';

/** The full action catalog, in default (shipping) order. Also the settings default. */
export const MENU_ACTIONS: readonly MenuActionId[] = [
	// quick-261021-menu2 (user 2026-10-21):
	// Group 1: remix (autoplay), share, download, like.
	// Group 2: versions (play from source), changeCover, changeLyrics, goToArtist, goToAlbum.
	// Group 3: customize, downloadSource, repeat, addToPlaylist.
	// Group 4: detail, sleepTimer, editTags, playNext.
	// quick-261021-menu3: lyricsTiming REMOVED from catalog — it's now a toggle inside
	// the Fix lyrics picker, not a standalone menu item. Existing saved orders drop it
	// as unknown via normalizeMenuOrder.
	'remix',
	'share',
	'download',
	'like',
	'versions',
	'changeCover',
	'changeLyrics',
	'goToArtist',
	'goToAlbum',
	'customize',
	'downloadSource',
	'repeat',
	'addToPlaylist',
	'detail',
	'sleepTimer',
	'editTags',
	'playNext',
	// The remainder of the catalog, in a stable order.
	'addQueue',
	'startRadio',
	'viewComments',
	'viewRelated',
	'shuffleQueue',
	'clearQueue'
] as const;

// quick-261006-44g — the menu is ALWAYS an icon grid (user 2026-10-06). The live grid
// renders at most this many cells: the user's enabled-and-visible actions in their order,
// extras silently stay in the edit pool. User 2026-11-02: widened from 4 rows to 5 —
// 20 = 4 columns x 5 rows (was 16 = 4x4).
export const MENU_GRID_SLOTS = 20;

const KNOWN = new Set<string>(MENU_ACTIONS);

/**
 * Normalize a persisted trackMenuOrder: keep known ids in saved order, drop unknowns
 * and duplicates, append any missing catalog ids at the end in catalog order.
 * A non-array (or anything else unexpected) yields a full catalog copy.
 *
 * quick-261006-44r: 'customize' is new in the catalog — a saved order from before this
 * change lacks it. Mirror the new default arrangement for those users: the edit
 * affordance takes repeat's old slot and repeat moves to the back, so an existing
 * user gets exactly the arrangement the user asked for instead of finding the pencil
 * appended invisibly beyond the 20-slot cap.
 */
export function normalizeMenuOrder(saved: unknown): MenuActionId[] {
	// quick-261021-menu3 (user): one-time migration — any saved order containing the
	// removed 'lyricsTiming' is from the old layout. Reset the whole order to the new
	// default instead of trying to preserve a stale arrangement.
	if (Array.isArray(saved) && saved.includes('lyricsTiming')) {
		return [...MENU_ACTIONS];
	}
	const kept: MenuActionId[] = [];
	if (Array.isArray(saved)) {
		for (const x of saved) {
			if (typeof x === 'string' && KNOWN.has(x) && !kept.includes(x as MenuActionId)) {
				kept.push(x as MenuActionId);
			}
		}
	}
	if (!kept.includes('customize')) {
		const ri = kept.indexOf('repeat');
		if (ri >= 0) {
			kept.splice(ri, 1);
			kept.splice(ri, 0, 'customize');
			kept.push('repeat');
		}
	}
	// quick-261006-44u: any other missing catalog ids (new actions for pre-existing
	// users) insert at their catalog positions — not appended at the end — so they
	// land inside the visible grid instead of piling up invisibly beyond the 20 slots.
	for (const id of MENU_ACTIONS) {
		if (!kept.includes(id)) {
			kept.splice(Math.min(MENU_ACTIONS.indexOf(id), kept.length), 0, id);
		}
	}
	// quick-261021-menu2 (user): Group 1 is ALWAYS remix, share, download, like in that
	// order — enforce on the normalized order so the arrangement is identical everywhere
	// the menu is triggered, regardless of saved customization.
	for (const [id, pos] of [['remix', 0], ['share', 1], ['download', 2], ['like', 3]] as const) {
		const i = kept.indexOf(id);
		if (i >= 0) kept.splice(i, 1);
		kept.splice(pos, 0, id);
	}
	return kept;
}

// quick-261102-menudrag — the edit grid's drag-to-reorder geometry, extracted PURE so
// it is node-testable (the track-menu-gate precedent: pure decisions live here, the
// component owns the DOM). The component measures every enabled cell's rect ONCE at
// drag start — before any transform is written, so the rects are layout truth — and
// the whole gesture is then these two functions over that frozen table: no live data
// reorder mid-drag, no re-measurement against a half-shifted, mid-animation DOM (the
// quick-261006-mnu original did both, which is why the dragged cell led the pointer
// by whole cells and the target hunted around it).
export interface MenuCellRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * Insertion index into the enabled order AFTER removing the dragged item (0..n-1)
 * for a pointer at (x, y) — the drop rule the edit grid has always documented,
 * evaluated once over the frozen slot table: the pointer's nearest cell center wins,
 * converted from a pre-removal index to the post-removal insertion index, with a
 * past-the-end rule so the last slot stays reachable (nearest-center alone always
 * resolves to the last cell itself).
 *
 * The dragged cell's HOME center competes like any other — deliberately UNLIKE the
 * old live-DOM version, which excluded the dragged cell because its rect was
 * transformed and re-laid-out mid-gesture. Over a frozen table the home center is
 * the anchor that makes `from` itself reachable: with it excluded, NO pointer
 * position maps back to the identity insertion except the sliver where the next
 * sibling is nearest, so even a press that never leaves home would reorder.
 * `cells` are the enabled cells' rects in order; `from` is the dragged cell's
 * index among them.
 */
export function menuDropIndex(x: number, y: number, cells: readonly MenuCellRect[], from: number): number {
	const n = cells.length;
	if (n === 0) return 0;
	// Past-the-end: the pointer is clearly beyond the final enabled slot in reading
	// order → append. (If the dragged cell IS the final one, judge against the slot
	// before it — appending from there is the identity anyway.)
	let lastIdx = n - 1;
	if (lastIdx === from) lastIdx--;
	if (lastIdx >= 0) {
		const r = cells[lastIdx];
		if ((x > r.left + r.width / 2 && y > r.top) || y > r.top + r.height) return n - 1;
	}
	let best = from;
	let bestD = Infinity;
	for (let i = 0; i < n; i++) {
		const r = cells[i];
		const dx = x - (r.left + r.width / 2);
		const dy = y - (r.top + r.height / 2);
		const d = dx * dx + dy * dy;
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	// `best` is a pre-removal index; convert to the post-removal insertion index.
	return best > from ? best - 1 : best;
}

/**
 * The slot a cell ENDS UP in when the item at `from` is splice-moved to final index
 * `to` (remove at `from`, insert at `to` — the component's drop commit): the moved
 * item takes slot `to`, every item between the two slots shifts one slot toward the
 * vacated one, all others stay. Drives the edit grid's live sibling-glide transforms
 * while a drag is in flight (the transforms only — the data order does not change
 * until the drop settles, so a re-render can never race the gesture).
 */
export function menuSlotForIndex(index: number, from: number, to: number): number {
	if (index === from) return to;
	if (from < index && index <= to) return index - 1;
	if (to <= index && index < from) return index + 1;
	return index;
}
