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
	'repeat',
	'shuffleQueue',
	'clearQueue',
	'sleepTimer',
	'goToArtist',
	'goToAlbum',
	'share',
	'detail'
] as const;

const KNOWN = new Set<string>(MENU_ACTIONS);

/**
 * Normalize a persisted trackMenuOrder: keep known ids in saved order, drop unknowns
 * and duplicates, append any missing catalog ids at the end in catalog order.
 * A non-array (or anything else unexpected) yields a full catalog copy.
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
	for (const id of MENU_ACTIONS) {
		if (!kept.includes(id)) kept.push(id);
	}
	return kept;
}
