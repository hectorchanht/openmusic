// In-memory live SEARCH RESULT SET for the current session (D-02). Svelte 5 runes
// singleton — mirrors overlays.svelte.ts / player.svelte.ts. Holds the query +
// already-loaded results + pagination + scroll + artist tiles so the Search tab
// restores INSTANTLY (no refetch) when the user navigates away and back within a
// session.
//
// DISTINCT from the persisted `searchHistory` store (past QUERY STRINGS, D-05) and the
// `history` store (recently-PLAYED tracks). This one is in-memory ONLY: cross-route
// within a session, NOT persisted, NOT cross-reload (D-02 floor is in-memory).
//
// SSR module-state leak (T-14-05): on Cloudflare SSR this module-level `$state` is
// shared across concurrent requests for the worker's lifetime. The DISCIPLINE that
// prevents one user's search bleeding into another's render: the PAGE only ever WRITES
// the session inside browser-side handlers (onMount/onDestroy/run/loadMore) — SSR never
// writes search state. Reads during SSR see harmless empty defaults. The HAS_WINDOW
// guard below backstops any imperative window-touching path (setScroll). This mirrors
// the settings/overlays/names browser-guard convention.
import type { Track } from '$lib/sources/types';

const HAS_WINDOW = typeof window !== 'undefined';

// Artist tile shape used by the search page (mirrors its local ArtistTile).
export type ArtistTile = { name: string; image: string | null; trackCount: number };

class SearchSession {
	/** The active query string (trimmed on save). */
	q = $state('');
	/** The currently-loaded deduped result set (cumulative superset). */
	results = $state<Track[]>([]);
	/** Last page successfully loaded (pagination, cumulative-superset contract). */
	page = $state(1);
	/** Whether another batch might yield net-new tracks (infinite-scroll). */
	hasMore = $state(false);
	/** Window scroll offset to restore after results repaint. */
	scrollY = $state(0);
	/** True once a search has actually run — drives "restore vs fresh" on mount. */
	searched = $state(false);

	/** Cached artist tiles row for the active query. */
	artistTiles = $state<ArtistTile[]>([]);
	/** Normalized query tag the artistTiles are cached for. */
	artistTilesFor = $state('');

	/**
	 * True only when we hold a prior search to restore: a non-empty query AND a search
	 * has run. The page restores from the store on mount only when this is true;
	 * otherwise it starts fresh (and a NEW/changed query overwrites via save()).
	 */
	get hasPrior(): boolean {
		return this.q.trim().length > 0 && this.searched;
	}

	/**
	 * Overwrite the session with the latest settled set (used by the page's run() and
	 * loadMore()). A NEW query simply calls this with the fresh values — the prior
	 * session is replaced wholesale, preserving the reset-on-new-query semantics. Does
	 * NOT touch scrollY (scroll is captured separately on navigate-away).
	 */
	save(s: {
		q: string;
		results: Track[];
		page: number;
		hasMore: boolean;
		searched: boolean;
		artistTiles?: ArtistTile[];
		artistTilesFor?: string;
	}) {
		this.q = s.q;
		this.results = s.results;
		this.page = s.page;
		this.hasMore = s.hasMore;
		this.searched = s.searched;

		// If artistTiles are provided (from run() after refreshArtistTiles), save them.
		if (Array.isArray(s.artistTiles)) {
			this.artistTiles = s.artistTiles;
			this.artistTilesFor = s.artistTilesFor ?? '';
		}
	}

	/** Record the current scroll offset (browser-guarded; no-op under SSR). */
	setScroll(y: number) {
		if (!HAS_WINDOW) return;
		this.scrollY = y;
	}

	/** Return every field to its default (full session clear). */
	reset() {
		this.q = '';
		this.results = [];
		this.page = 1;
		this.hasMore = false;
		this.scrollY = 0;
		this.searched = false;
		this.artistTiles = [];
		this.artistTilesFor = '';
	}
}

export const searchSession = new SearchSession();
