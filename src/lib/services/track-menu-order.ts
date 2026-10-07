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
	// quick-261006-44v (user 2026-10-06): the default IS his own arrangement (screenshot
	// 2026-10-06 — Remix / Go to artist / Downloaded / Liked / Play from source /
	// Change cover / Change lyrics / Adjust lyrics / Edit metadata / Add to playlist /
	// Sleep timer / Clear queue / Customize menu / Detail / Go to album / Share).
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
	// quick-261006-44r (user 2026-10-06): the edit affordance is a grid cell now; the
	// header pencil is retired.
	'customize',
	'detail',
	'goToAlbum',
	'share',
	// quick-261006-44u (user 2026-10-06): the three new actions sit right after the
	// default 16 — enabled and one drag away from the visible grid.
	'startRadio',
	'viewComments',
	'viewRelated',
	// The remainder of the catalog, in a stable order.
	'playNext',
	'addQueue',
	'shuffleQueue',
	// quick-261006-44r: repeat moved to the back (user 2026-10-06)
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
	// quick-261006-44u: any other missing catalog ids (new actions for pre-existing
	// users) insert at their catalog positions — not appended at the end — so they
	// land inside the visible grid instead of piling up invisibly beyond the 16 slots.
	for (const id of MENU_ACTIONS) {
		if (!kept.includes(id)) {
			kept.splice(Math.min(MENU_ACTIONS.indexOf(id), kept.length), 0, id);
		}
	}
	return kept;
}
