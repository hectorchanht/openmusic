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
	}

	/** Record a played track: prepend (dedupe-by-uid → replay moves to top), cap, persist. */
	record(track: Track) {
		this.entries = recordEntry(this.entries, toEntry(track));
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
