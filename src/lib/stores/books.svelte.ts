// quick-261122-books — the Books tab's per-series resume store (runes singleton) over the pure
// services/book-progress.ts. LEAF: imports no other store, so player can import it one-way
// beside history (player.play → history.record + books.record) with no cycle. The history seed
// is passed IN by the caller (load(entries)) for the same reason.
import { browser } from '$app/environment';
import type { Track } from '$lib/sources/types';
import type { HistoryEntry } from '$lib/history/history-logic';
import {
	BOOKS_PROGRESS_KEY,
	parseBookProgress,
	recordBookProgress,
	removeBookProgress,
	seedFromHistory,
	type BookProgress
} from '$lib/services/book-progress';

class Books {
	/** Most-recent-first, one row per series. */
	progress = $state<readonly BookProgress[]>([]);
	// plain field — internal guard, never read by the UI (store convention)
	private loaded = false;

	/** Hydrate once. With no stored blob yet, seed from `historySeed` (the play history). */
	load(historySeed: readonly HistoryEntry[] = []) {
		if (this.loaded || !browser) return;
		this.loaded = true;
		let stored: BookProgress[] | null = null;
		try {
			stored = parseBookProgress(localStorage.getItem(BOOKS_PROGRESS_KEY));
		} catch {
			stored = [];
		}
		if (stored === null) {
			this.progress = seedFromHistory(historySeed);
			if (this.progress.length) this.save();
		} else {
			this.progress = stored;
		}
	}

	/** Called from the player's history seam (right after history.record, so `historySeed`
	 *  already holds this play). Non-chapters are a no-op (no persist). */
	record(track: Track, historySeed: readonly HistoryEntry[] = []) {
		if (!browser) return;
		// a play before the tab ever opened: hydrate (or seed) first so nothing is clobbered
		this.load(historySeed);
		const next = recordBookProgress(this.progress, track, Date.now());
		if (next === this.progress) return;
		this.progress = next;
		this.save();
	}

	remove(key: string) {
		this.progress = removeBookProgress(this.progress, key);
		this.save();
	}

	private save() {
		if (!browser) return;
		try {
			localStorage.setItem(BOOKS_PROGRESS_KEY, JSON.stringify(this.progress));
		} catch {
			/* quota — non-fatal */
		}
	}
}

export const books = new Books();
