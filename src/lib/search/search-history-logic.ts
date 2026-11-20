// PURE recently-SEARCHED query logic (D-05) — NO runes, NO `$state`, NO
// `$app/environment`. Node-Vitest-testable core; the runes singleton
// (src/lib/stores/searchHistory.svelte.ts) merely WRAPS these helpers, exactly as
// the play-history feature splits history/history-logic.ts from
// stores/history.svelte.ts.
//
// NAMING-COLLISION WARNING: a `history` store ALREADY exists meaning recently-PLAYED
// tracks (HISTORY_KEY = 'openmusic:history:v1'). THIS is recently-SEARCHED queries — a
// DIFFERENT concern, with a DISTINCT symbol (searchHistory) AND a DISTINCT localStorage
// key (below). Do NOT reuse/extend the play-history store or key.

/** Most-recent-first cap. A mobile suggestion list wants a short cap (shorter than the
 *  play-history cap of 50). The persisted list never grows beyond this. */
export const SEARCH_HISTORY_CAP = 12;

/** Versioned localStorage key — DISTINCT from the play-history `openmusic:history:v1`. */
export const SEARCH_HISTORY_KEY = 'openmusic:search-history:v1';

/** A persisted past-search entry. `ts` enables future "clear older than" / display. */
export interface SearchHistoryEntry {
	query: string;
	ts: number;
}

/**
 * Return a NEW most-recent-first list: trim `query`; an empty/whitespace query returns
 * `list` unchanged (never record empty). Otherwise drop any existing entry whose query
 * matches case-insensitively (re-search moves to the top with a single entry), prepend
 * the new entry, then truncate to `cap`. Never mutates `list`.
 */
export function recordQuery(
	list: SearchHistoryEntry[],
	query: string,
	cap = SEARCH_HISTORY_CAP
): SearchHistoryEntry[] {
	const q = query.trim();
	if (!q) return list; // never record empty/whitespace
	const norm = q.toLowerCase();
	const without = list.filter((e) => e.query.toLowerCase() !== norm); // case-insensitive de-dupe
	return [{ query: q, ts: Date.now() }, ...without].slice(0, cap);
}

/**
 * Return a NEW list with any entry whose query matches `query` case-insensitively
 * removed (per-entry delete for the recent-searches bin). A whitespace-only `query`
 * returns `list` unchanged. Never mutates `list` — mirrors recordQuery's contract.
 */
export function removeQuery(list: SearchHistoryEntry[], query: string): SearchHistoryEntry[] {
	const norm = query.trim().toLowerCase();
	if (!norm) return list; // nothing to match
	return list.filter((e) => e.query.toLowerCase() !== norm);
}

/**
 * Parse a persisted search-history blob. Returns [] on null / parse error / non-array
 * (T-14-03 tampering: a corrupt store must never crash the app — mirrors parseHistory).
 */
export function parseSearchHistory(raw: string | null): SearchHistoryEntry[] {
	if (raw == null) return [];
	try {
		const v = JSON.parse(raw);
		if (!Array.isArray(v)) return [];
		// CR-01: validate per-ENTRY shape, not just that the blob is an array. A corrupt
		// store containing null / a number / an object without a string `query` would make
		// recordQuery's `.filter(e => e.query.toLowerCase()...)` throw — and add() runs
		// BEFORE run()'s try block, so an uncaught throw breaks the whole search form.
		return (v as unknown[]).filter(
			(e): e is SearchHistoryEntry =>
				e != null &&
				typeof (e as Partial<SearchHistoryEntry>).query === 'string' &&
				typeof (e as Partial<SearchHistoryEntry>).ts === 'number'
		);
	} catch {
		return [];
	}
}
