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

// quick-261006-44g — the menu is ALWAYS a 4x4 icon grid (user 2026-10-06). The live grid
// renders at most this many cells: the user's enabled-and-visible actions in their order,
// extras silently stay in the edit pool. 16 = 4 columns x 4 rows, no dangling 5th row.
export const MENU_GRID_SLOTS = 16;

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
 * appended invisibly beyond the 16-slot cap.
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
	// land inside the visible grid instead of piling up invisibly beyond the 16 slots.
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
