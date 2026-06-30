// PURE action-log ring-buffer logic (quick-260630-sgw) — NO runes, NO `$state`, NO
// `$app/environment`. Node-Vitest-testable core; the runes singleton
// (src/lib/stores/actionLog.svelte.ts) merely WRAPS these helpers, exactly as
// searchHistory.svelte.ts wraps search-history-logic.ts.
//
// PURPOSE: a verbose, localStorage-backed log of player ACTIONS so playback behaviour is
// observable after the fact (no more guessing about background auto-advance stalls). The
// player imports the bare `logAction` from the store wrapper; the wrapper persists a capped
// ring buffer under the key below. This module owns the pure data shape + transforms only.

/** Versioned localStorage key — DISTINCT from every other `openmusic:*:v1` store. */
export const ACTION_LOG_KEY = 'openmusic:action-log:v1';

/** Ring-buffer cap. The persisted list never grows beyond this; the oldest entries drop. */
export const ACTION_LOG_CAP = 2000;

/** A single recorded action. `t` = epoch ms (first occurrence); `ev` = short event name; `d` = small
 *  payload. `n` = repeat count when consecutive identical events were COALESCED (absent / 1 = single);
 *  `tl` = epoch ms of the most recent occurrence in a coalesced run. */
export interface ActionLogEntry {
	t: number;
	ev: string;
	d?: Record<string, unknown>;
	n?: number;
	tl?: number;
}

/**
 * Parse a persisted action-log blob. Returns [] on null / parse error / non-array, and
 * filters out any entry that is not a well-shaped {t:number, ev:string}. A corrupt store
 * must NEVER crash the app (mirrors parseSearchHistory's per-entry validation).
 */
export function parseActionLog(raw: string | null): ActionLogEntry[] {
	if (raw == null) return [];
	try {
		const v = JSON.parse(raw);
		if (!Array.isArray(v)) return [];
		return (v as unknown[]).filter(
			(e): e is ActionLogEntry =>
				e != null &&
				typeof (e as Partial<ActionLogEntry>).t === 'number' &&
				typeof (e as Partial<ActionLogEntry>).ev === 'string'
		);
	} catch {
		return [];
	}
}

/** True when two entries are the SAME event (same name + same payload) — used to coalesce a
 *  consecutive run. `d` is a small flat payload, so a JSON compare is sufficient + stable for the
 *  same call site (which always emits keys in the same order). */
function sameEvent(a: ActionLogEntry, b: ActionLogEntry): boolean {
	if (a.ev !== b.ev) return false;
	if (a.d === b.d) return true; // both undefined
	if (!a.d || !b.d) return false;
	return JSON.stringify(a.d) === JSON.stringify(b.d);
}

/**
 * Return a NEW array with `entry` recorded, truncated to the last `cap` entries (oldest dropped,
 * newest kept). Pure — never mutates `entries`.
 *
 * FREQUENCY REDUCTION (quick-260630-sgw follow-up): if `entry` is identical to the LAST entry (same
 * ev + payload), COALESCE it — bump that entry's repeat count `n` and last-seen `tl` instead of
 * appending a new row. A tight loop (e.g. the capped reresolve / a rapid burst) then shows as a single
 * `ev ×N` row rather than flooding the buffer (it once logged 1495 identical audio.error rows). The
 * array length is unchanged on a coalesce, so the cap is unaffected.
 */
export function appendEntry(
	entries: ActionLogEntry[],
	entry: ActionLogEntry,
	cap = ACTION_LOG_CAP
): ActionLogEntry[] {
	const last = entries[entries.length - 1];
	if (last && sameEvent(last, entry)) {
		const merged: ActionLogEntry = { ...last, n: (last.n ?? 1) + 1, tl: entry.t };
		return [...entries.slice(0, -1), merged];
	}
	const next = [...entries, entry];
	return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Serialize the buffer for persistence. */
export function serializeActionLog(entries: ActionLogEntry[]): string {
	return JSON.stringify(entries);
}
