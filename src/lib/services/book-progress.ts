// quick-261122-books — per-SERIES resume points for the Books tab (`openmusic:books:progress`).
//
// NOT a parallel history system: it is fed from the same player seam that records history
// (player.play → history.record + books.record), and it keeps ONE row per series — the last
// chapter played — where history keeps 50 rows of anything. A first load with no stored blob
// seeds itself from the existing history so a listener who was already mid-book sees Continue
// listening on day one.
//
// PURE .ts — the runes store (stores/books.svelte.ts) wraps it, same split as history-logic.
import type { Track } from '$lib/sources/types';
import { toEntry, type HistoryEntry } from '$lib/history/history-logic';
import { isBookChapter, parseChapter, seriesKey, seriesName } from './book-chapters';

export const BOOKS_PROGRESS_KEY = 'openmusic:books:progress';
/** Bounded growth (same reasoning as HISTORY_CAP — T-ggv-03). */
export const BOOKS_PROGRESS_CAP = 30;

export interface BookProgress {
	key: string;
	name: string;
	narrator: string;
	/** Chapter number of the last chapter played. */
	n: number;
	/** The replay slice of that chapter (re-resolves on play, like a history row). */
	entry: HistoryEntry;
	updatedAt: number;
}

/**
 * Upsert `track` as its series' resume point, most-recent-first, capped. A track that is not a
 * book chapter (no strong marker) returns `list` UNCHANGED (same reference — callers can skip
 * the persist). Never mutates `list`.
 */
export function recordBookProgress(
	list: readonly BookProgress[],
	track: Track | HistoryEntry,
	now: number,
	cap = BOOKS_PROGRESS_CAP
): readonly BookProgress[] {
	if (!isBookChapter(track)) return list;
	const p = parseChapter(track.title);
	if (!p) return list;
	const key = seriesKey(track);
	const row: BookProgress = {
		key,
		name: seriesName(track),
		narrator: (track.artist ?? '').trim(),
		n: p.n,
		entry: 'detailsLoaded' in track ? toEntry(track) : { ...track },
		updatedAt: now
	};
	return [row, ...list.filter((r) => r.key !== key)].slice(0, cap);
}

export function removeBookProgress(list: readonly BookProgress[], key: string): BookProgress[] {
	return list.filter((r) => r.key !== key);
}

/** Seed from history (most-recent-first): the newest chapter per series wins, recency kept. */
export function seedFromHistory(entries: readonly HistoryEntry[]): readonly BookProgress[] {
	let out: readonly BookProgress[] = [];
	// Oldest first, so each newer chapter replaces its series' row and lands on top.
	for (let i = entries.length - 1; i >= 0; i--) out = recordBookProgress(out, entries[i], entries.length - i);
	return out;
}

function isRow(v: unknown): v is BookProgress {
	if (!v || typeof v !== 'object') return false;
	const r = v as Record<string, unknown>;
	const e = r.entry as Record<string, unknown> | undefined;
	return (
		typeof r.key === 'string' &&
		typeof r.name === 'string' &&
		typeof r.n === 'number' &&
		!!e &&
		typeof e.uid === 'string' &&
		typeof e.title === 'string'
	);
}

/** Parse the persisted blob. null = nothing stored yet (→ seed); a corrupt blob is [] (T-ggv-01). */
export function parseBookProgress(raw: string | null): BookProgress[] | null {
	if (raw == null) return null;
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v.filter(isRow) : [];
	} catch {
		return [];
	}
}
