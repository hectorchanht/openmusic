// pseudo-events — the ONLY write path for pseudonymous analytics
// (quick-261122-pseudo; Hector's ruling 2026-11-20).
//
// WHAT CHANGED: the 2026-11-18 doctrine kept anonymous TOTALS only. Hector
// reversed that by explicit decision: OpenMusic now counts DISTINCT USERS and
// links listening per user — under a random, user-resettable PSEUDONYMOUS ID,
// with real identity never known. metric_counters keeps running untouched
// beside this store (the existing dashboard feed reads it).
//
// GUARDRAILS (test-pinned in pseudo-events.test.ts + analytics-doctrine.test.ts):
//   - The pseudo_id is a client-generated random UUID v4 (localStorage). Anything
//     else is REJECTED (isPseudoId) so an email / account id / fingerprint can
//     never be smuggled in through the id field.
//   - Never bound to account identity, IP, email or a device fingerprint: the
//     table below has NO column for any of them, lives in openmusic-analytics
//     (NOT the accounts DB), and shares no key with any account table.
//   - Collected fields, minimal and exhaustive: pseudo_id, action, song_id /
//     title / artist / source, timestamp (day + epoch seconds), app_version,
//     coarse platform class (mobile|desktop) and country (CF header). Plus the
//     two event-specific payloads the v1 event set names: `query` (search_miss)
//     and `stage` (play_failure). Nothing else without a new ruling.
//   - Purpose: product analysis/improvement only. Never sold, never ad
//     targeting, never per-user profiling for outreach. (Doctrine, not copy.)
//   - Retention is DERIVED from pseudo_id active days — there is no separate
//     tracking mechanism.
//
// The DDL is the single source of truth, applied out-of-band (D1 API /
// wrangler — there is no migrations runner) and exercised verbatim against a
// real SQLite in pseudo-events.test.ts.

/** v1 event set. play/like/unlike/download mirror the counter actions. */
export const PSEUDO_ACTIONS = [
	'play',
	'like',
	'unlike',
	'download',
	'search_miss',
	'play_failure',
	'lyrics_missing',
	'session_start'
] as const;
export type PseudoAction = (typeof PSEUDO_ACTIONS)[number];

export type PlatformClass = 'mobile' | 'desktop';

/** play_failure stages — the player's SkipReason set. */
export const FAILURE_STAGES = ['no-source', 'timeout', 'load-error'] as const;
export type FailureStage = (typeof FAILURE_STAGES)[number];

/** Columns, exhaustively. NO ip / user_id / account / email / user_agent / device column. */
export const PSEUDO_EVENTS_DDL = `CREATE TABLE IF NOT EXISTS pseudo_events (
	pseudo_id TEXT NOT NULL,
	action TEXT NOT NULL,
	day TEXT NOT NULL,
	ts INTEGER NOT NULL,
	song_id TEXT NOT NULL DEFAULT '',
	title TEXT NOT NULL DEFAULT '',
	artist TEXT NOT NULL DEFAULT '',
	source TEXT NOT NULL DEFAULT '',
	query TEXT NOT NULL DEFAULT '',
	stage TEXT NOT NULL DEFAULT '',
	app_version TEXT NOT NULL DEFAULT '',
	platform TEXT NOT NULL DEFAULT '',
	country TEXT NOT NULL DEFAULT ''
)`;

/** Report-path indexes (distinct users per day, per-action scans). */
export const PSEUDO_EVENTS_INDEXES = [
	'CREATE INDEX IF NOT EXISTS pseudo_events_day_pid ON pseudo_events (day, pseudo_id)',
	'CREATE INDEX IF NOT EXISTS pseudo_events_action_day ON pseudo_events (action, day)'
];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A pseudo_id is a lowercase random UUID v4 and NOTHING else. */
export function isPseudoId(v: unknown): v is string {
	return typeof v === 'string' && UUID_V4.test(v);
}

export function isPseudoAction(v: unknown): v is PseudoAction {
	return typeof v === 'string' && (PSEUDO_ACTIONS as readonly string[]).includes(v);
}

export interface PseudoEvent {
	pseudoId: string;
	action: PseudoAction;
	songId: string;
	title: string;
	artist: string;
	source: string;
	query: string;
	stage: string;
	appVersion: string;
	platform: PlatformClass | '';
	/** ISO-3166 alpha-2 from CF-IPCountry, or '' — never an IP. */
	country: string;
}

/** UTC day bucket, YYYY-MM-DD (retention unit). */
export function eventDay(now: Date): string {
	return now.toISOString().slice(0, 10);
}

/** Normalise the CF-IPCountry header to a 2-letter code ('' for XX/T1/absent). */
export function coarseCountry(header: string | null): string {
	const c = (header ?? '').trim().toUpperCase();
	return /^[A-Z]{2}$/.test(c) && c !== 'XX' ? c : '';
}

/** Insert one event row. Throws on D1 error — the route maps it to a soft-fail. */
export async function recordPseudoEvent(
	db: D1Database,
	ev: PseudoEvent,
	now: Date = new Date()
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO pseudo_events (pseudo_id, action, day, ts, song_id, title, artist, source, query, stage, app_version, platform, country)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			ev.pseudoId,
			ev.action,
			eventDay(now),
			Math.floor(now.getTime() / 1000),
			ev.songId,
			ev.title,
			ev.artist,
			ev.source,
			ev.query,
			ev.stage,
			ev.appVersion,
			ev.platform,
			ev.country
		)
		.run();
}
