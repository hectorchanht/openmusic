import type { Track } from '$lib/sources/types';
import { library } from '$lib/stores/library.svelte';
import { toast } from '$lib/stores/toast.svelte';
import { t } from '$lib/i18n';

// quick-261104-swipe — swipe-RIGHT on a song row = 收藏 (like / save to Library), with Undo.
//
// Hector 2026-11-04: the old right-swipe (append to the END of Up Next) was never useful; the
// left-swipe (play next) stays. One helper for every row surface — SongRow's default, NpRelated,
// and the four charts pages that swipe over DiscoveryTrack stubs — so the toast + undo contract
// cannot drift. Uses the existing toast action slot (quick-260910-omt) and the existing
// toast.liked / toast.unliked / toast.undo keys: no new i18n.
//
// An already-liked song (by uid, or by the quick-261031-dedup same-song rule inside toggleLike)
// just confirms "Liked" — a right-swipe is a SAVE gesture, never a toggle, so it can never
// un-like by accident. Undo only ever removes what THIS swipe added.
export function likeWithUndo(track: Track): void {
	if (!track.uid) {
		// like-state-wrong-track-menu: nothing to key on — tell the truth, never claim a like.
		toast.show(t('home.unplayable'));
		return;
	}
	if (!library.isLiked(track.uid)) library.toggleLike(track);
	if (!library.isLiked(track.uid)) {
		// toggleLike refused (no uid) or folded it into an existing same-song like — nothing to undo.
		toast.show(t('toast.liked'));
		return;
	}
	toast.show(t('toast.liked'), {
		action: {
			label: t('toast.undo'),
			run: () => {
				if (library.isLiked(track.uid)) library.toggleLike(track);
				toast.show(t('toast.unliked'));
			}
		}
	});
}
