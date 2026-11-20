// Recently-played history (Svelte 5 runes singleton). WRAPS the pure node-testable
// logic module (src/lib/history/history-logic.ts) — same separation as t() over the
// pure i18n helpers.
//
// quick-261023-syncmerge: imports the library singleton ONE-WAY (library never imports
// history — no cycle) to record h: tombstones on clear, so a wiped history is not
// resurrected by another device's copy on the next merge. Persisted to localStorage
// `openmusic:history:v1`, SSR-guarded.
import { browser } from '$app/environment';
import type { Track } from '$lib/sources/types';
import { library } from '$lib/stores/library.svelte';
import { tombHistory } from '$lib/sync/merge-logic';
import { dedupeShelfList, isSameShelfSong } from '$lib/services/dedupe';
import {
	HISTORY_KEY,
	parseHistory,
	recordEntry,
	toEntry,
	type HistoryEntry
} from '$lib/history/history-logic';

class History {
	/** Most-recent-first, capped, uid-deduped. */
	entries = $state<HistoryEntry[]>([]);
	private loaded = false;

	/** Hydrate from localStorage once, in the browser. Call from each sub-route onMount. */
	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			this.entries = parseHistory(localStorage.getItem(HISTORY_KEY));
		} catch {
			/* corrupt/unavailable — start empty */
		}
		// quick-261031-dedup: history is a shelf too — collapse same-song rows persisted by
		// uid-only dedupe (the same song played from two sources sat twice).
		const deduped = dedupeShelfList(this.entries);
		if (deduped.length !== this.entries.length) {
			this.entries = deduped;
			this.save();
		}
	}

	/** Record a played track: prepend (dedupe-by-uid → replay moves to top), cap, persist. */
	record(track: Track) {
		const entry = toEntry(track);
		// quick-261031-dedup: a replay of the same song+rendition from ANOTHER source replaces
		// the old row (it moves to the top as the new entry) instead of duplicating it.
		const rest = this.entries.filter((x) => !isSameShelfSong(x, entry));
		this.entries = recordEntry(rest, entry);
		this.save();
	}

	/** Wipe history — and tombstone every entry so the wipe survives the next merge
	 *  (quick-261023-syncmerge: a bare [] would be resurrected by another device's copy). */
	clear() {
		if (this.entries.length > 0) {
			library.tombstone(this.entries.map((e) => e.uid).filter((u) => !!u).map(tombHistory));
		}
		this.entries = [];
		this.save();
	}

	private save() {
		if (!browser) return;
		try {
			localStorage.setItem(HISTORY_KEY, JSON.stringify(this.entries));
		} catch {
			/* quota — non-fatal */
		}
	}
}

export const history = new History();
