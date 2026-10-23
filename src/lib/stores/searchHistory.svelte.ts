// Recently-SEARCHED queries (Svelte 5 runes singleton, D-05). WRAPS the pure
// node-testable logic module (src/lib/search/search-history-logic.ts) — same
// separation as the play-history store over history-logic.ts. Persisted to
// localStorage `openmusic:search-history:v1`, SSR-guarded.
//
// DISTINCT from the existing `history` store (recently-PLAYED tracks) and the D-02
// in-memory `searchSession` (live result set). This one persists past QUERY STRINGS to
// drive tappable suggestions.
import { browser } from '$app/environment';
import { library } from '$lib/stores/library.svelte';
import { tombQuery } from '$lib/sync/merge-logic';
import {
	SEARCH_HISTORY_KEY,
	parseSearchHistory,
	recordQuery,
	removeQuery,
	type SearchHistoryEntry
} from '$lib/search/search-history-logic';

class SearchHistory {
	/** Most-recent-first, capped, case-insensitively-deduped past queries. */
	entries = $state<SearchHistoryEntry[]>([]);
	private loaded = false;

	/** Hydrate from localStorage once, in the browser. Call from the search page onMount. */
	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			this.entries = parseSearchHistory(localStorage.getItem(SEARCH_HISTORY_KEY));
		} catch {
			/* corrupt/unavailable — start empty */
		}
	}

	/** Record a submitted query: prepend (case-insensitive de-dupe → top), cap, persist. */
	add(query: string) {
		this.entries = recordQuery(this.entries, query);
		this.save();
	}

	/** Remove a single past query (case-insensitive) — the per-keyword bin action. */
	remove(query: string) {
		// quick-261023-syncmerge: tombstone it, or the next merge resurrects it.
		const folded = query.trim().toLowerCase();
		if (folded) library.tombstone([tombQuery(folded)]);
		this.entries = removeQuery(this.entries, query);
		this.save();
	}

	/** Wipe search history — and tombstone every query so the wipe survives the merge. */
	clear() {
		const keys = this.entries
			.map((e) => e.query.trim().toLowerCase())
			.filter((q) => !!q)
			.map(tombQuery);
		if (keys.length > 0) library.tombstone(keys);
		this.entries = [];
		this.save();
	}

	private save() {
		if (!browser) return;
		try {
			localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(this.entries));
		} catch {
			/* quota — non-fatal */
		}
	}
}

export const searchHistory = new SearchHistory();
