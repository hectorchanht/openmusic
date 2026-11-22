// metric-counter — the ONLY analytics write path (quick-261118-datadoctrine).
//
// Dawn free-apps data doctrine (Hector, 2026-11-18): analytics are anonymous
// TOTALS ONLY. This module is the structural enforcement: the single table it
// writes (metric_counters, in the openmusic-analytics D1) has columns
//   day · action · song_id · title · artist · source · count
// and NOTHING else — no anon_id, no user_id, no IP, no User-Agent-derived
// device/os, no timestamps finer than a day. There is no column in which an
// identifier COULD be stored, so no future edit to a route handler can quietly
// re-introduce per-user tracking without changing this schema first (and the
// analytics-doctrine test pins both the schema and the route sources).
//
// This replaces the retired per-event tables (play_events in
// openmusic-analytics; like_events / download_events in openmusic-accounts),
// which stored a persistent anon_id — and, for likes/downloads, the signed-in
// user_id — per event. Those tables are no longer read or written by any code;
// their historical rows are left untouched pending Hector's decision.
//
// The DDL lives here as the single source of truth (METRIC_COUNTERS_DDL
// below): applied out-of-band via the D1 API / wrangler, like every other D1
// table in this project (there is no migrations runner), and exercised
// verbatim against a real SQLite in metric-counter.test.ts.

/** The only actions the counters know. like/unlike stay separate actions so
 *  net likes remain derivable from totals (likes − unlikes), as before. */
export type MetricAction =
	| 'play'
	| 'like'
	| 'unlike'
	| 'download'
	// quick-261122-sharefeed: the ready-written share sheet's K-factor counters. Their song_id
	// is a fixed `promo:<lang>:<variant>` bucket — never a person, never a track.
	| 'share_open'
	| 'share_copy'
	| 'share_wa';

/** The counter table's DDL — note what is NOT here: no identifier columns. */
export const METRIC_COUNTERS_DDL = `CREATE TABLE IF NOT EXISTS metric_counters (
	day TEXT NOT NULL,
	action TEXT NOT NULL,
	song_id TEXT NOT NULL,
	title TEXT NOT NULL DEFAULT '',
	artist TEXT NOT NULL DEFAULT '',
	source TEXT NOT NULL DEFAULT '',
	count INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (day, action, song_id)
)`;

export interface MetricFields {
	songId: string;
	title: string;
	artist: string;
	source: string;
}

/** UTC day bucket, YYYY-MM-DD. The finest time granularity analytics may keep. */
export function metricDay(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/**
 * Increment today's counter for (action, song_id) by one, refreshing the
 * content metadata (title/artist/source) when the caller supplies non-empty
 * values. Throws on D1 error — route handlers map that to their soft-fail
 * { ok:false, reason:'db-error' } answer, as the retired endpoints did.
 */
export async function bumpMetric(
	db: D1Database,
	action: MetricAction,
	fields: MetricFields,
	now: Date = new Date()
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO metric_counters (day, action, song_id, title, artist, source, count)
			 VALUES (?, ?, ?, ?, ?, ?, 1)
			 ON CONFLICT (day, action, song_id) DO UPDATE SET
			   count = count + 1,
			   title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE metric_counters.title END,
			   artist = CASE WHEN excluded.artist <> '' THEN excluded.artist ELSE metric_counters.artist END,
			   source = CASE WHEN excluded.source <> '' THEN excluded.source ELSE metric_counters.source END`
		)
		.bind(metricDay(now), action, fields.songId, fields.title, fields.artist, fields.source)
		.run();
}
