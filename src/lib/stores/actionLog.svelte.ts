// Action-log runes singleton (quick-260630-sgw). WRAPS the pure node-testable logic module
// (src/lib/diagnostics/action-log-logic.ts) — same separation as searchHistory.svelte.ts over
// search-history-logic.ts. Persisted to localStorage `openmusic:action-log:v1`, SSR-guarded.
//
// CONTRACT (the player calls `logAction` on hot paths):
//  - MUST be cheap and MUST NEVER throw — a logging failure can NEVER alter playback.
//  - Persistence is THROTTLED (~1s) so a burst of log calls does a single localStorage write;
//    clear() flushes immediately. A quota error halves the buffer and retries ONCE, then gives
//    up silently (the in-memory `entries` stay intact for the live viewer).
//  - This store MUST NOT import the player (no cycle). The player imports `logAction` from here.
import { browser } from '$app/environment';
import {
	ACTION_LOG_KEY,
	appendEntry,
	parseActionLog,
	serializeActionLog,
	type ActionLogEntry
} from '$lib/diagnostics/action-log-logic';

class ActionLog {
	/** Oldest-first capped ring buffer of recorded actions. Reactive for the Settings viewer. */
	entries = $state<ActionLogEntry[]>([]);
	private loaded = false;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;

	/** Throttle window (ms): a burst of log() calls coalesces into one localStorage write. */
	private static FLUSH_MS = 1000;

	/** Hydrate from localStorage once, in the browser. Call from the viewer's onMount. */
	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			this.entries = parseActionLog(localStorage.getItem(ACTION_LOG_KEY));
		} catch {
			/* corrupt/unavailable — start empty */
		}
	}

	/**
	 * Record one action. Builds `{ t: Date.now(), ev, d }`, appends via the pure capped helper,
	 * reassigns `entries` (reactive), then schedules a throttled persist. SSR-guarded and wrapped
	 * so it NEVER throws into the caller (the player) — playback is never affected by logging.
	 */
	log(ev: string, d?: Record<string, unknown>) {
		try {
			const entry: ActionLogEntry = d === undefined ? { t: Date.now(), ev } : { t: Date.now(), ev, d };
			this.entries = appendEntry(this.entries, entry);
			this.scheduleFlush();
		} catch {
			/* never throw on a hot path */
		}
	}

	/** Wipe the buffer and remove the persisted key immediately (cancels any pending flush). */
	clear() {
		this.entries = [];
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		if (!browser) return;
		try {
			localStorage.removeItem(ACTION_LOG_KEY);
		} catch {
			/* non-fatal */
		}
	}

	/** Arm a single throttled flush; coalesces a burst into one write. */
	private scheduleFlush() {
		if (!browser || this.flushTimer) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			this.flush();
		}, ActionLog.FLUSH_MS);
	}

	/** Persist the buffer. A quota error halves the buffer (drop oldest) and retries ONCE, then
	 *  gives up silently. NEVER throws. */
	private flush() {
		if (!browser) return;
		try {
			localStorage.setItem(ACTION_LOG_KEY, serializeActionLog(this.entries));
		} catch {
			// Quota / unavailable — trim harder (keep the newest half) and retry once.
			try {
				const half = this.entries.slice(Math.floor(this.entries.length / 2));
				this.entries = half;
				localStorage.setItem(ACTION_LOG_KEY, serializeActionLog(half));
			} catch {
				/* still failing — keep the in-memory buffer for the live viewer, persist nothing */
			}
		}
	}
}

export const actionLog = new ActionLog();

/** Bare hot-path entry point. The player imports THIS tiny function, not the class. Never throws. */
export function logAction(ev: string, d?: Record<string, unknown>): void {
	actionLog.log(ev, d);
}
