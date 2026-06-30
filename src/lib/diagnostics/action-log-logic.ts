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

/** A single recorded action. `t` = epoch ms; `ev` = short event name; `d` = small payload. */
export interface ActionLogEntry {
	t: number;
	ev: string;
	d?: Record<string, unknown>;
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

/**
 * Return a NEW array with `entry` appended, truncated to the last `cap` entries (oldest
 * dropped, newest kept). Pure — never mutates `entries`.
 */
export function appendEntry(
	entries: ActionLogEntry[],
	entry: ActionLogEntry,
	cap = ACTION_LOG_CAP
): ActionLogEntry[] {
	const next = [...entries, entry];
	return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Serialize the buffer for persistence. */
export function serializeActionLog(entries: ActionLogEntry[]): string {
	return JSON.stringify(entries);
}
