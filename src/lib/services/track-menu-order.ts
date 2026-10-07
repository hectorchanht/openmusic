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
	| 'versions'
	| 'changeCover'
	| 'changeLyrics'
	| 'lyricsTiming'
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
	| 'detail';

/** The full action catalog, in default (shipping) order. Also the settings default. */
export const MENU_ACTIONS: readonly MenuActionId[] = [
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
	// quick-261006-44r (user 2026-10-06): the edit affordance is a grid cell now, sitting
	// in repeat's old slot; repeat moves to the back. The header pencil is retired.
	'customize',
	'shuffleQueue',
	'clearQueue',
	'sleepTimer',
	'goToArtist',
	'goToAlbum',
	'share',
	'detail',
	'repeat'
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
	for (const id of MENU_ACTIONS) {
		if (!kept.includes(id)) kept.push(id);
	}
	return kept;
}
