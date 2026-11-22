// pseudo-report — read-side aggregates over pseudo_events for the OpenMusic
// data dashboard (quick-261122-pseudo, step 3 of Hector's 2026-11-20 ruling).
//
// Every figure here is an AGGREGATE: distinct-user counts, retention ratios,
// per-song / per-query / per-source totals. No query returns a pseudo_id, and
// nothing here reads any account table — the report cannot be used to look at
// one person's listening (doctrine: never per-user profiling).
//
// Retention is DERIVED from pseudo_id active days (first-seen cohort day d0;
// "D1 return" = active on d0+1, "D7 return" = active on d0+7), never a separate
// tracking mechanism. Only cohorts old enough to have had the chance to return
// are counted (d0+N <= today), so a launch-day cohort doesn't read as 0%.

export interface PseudoReport {
	today: string;
	users: { today: number; week: number; total: number };
	dailyUsers: { day: string; users: number }[];
	retention: { d1: { cohort: number; returned: number }; d7: { cohort: number; returned: number } };
	topSongs: { song_id: string; title: string; artist: string; plays: number; listeners: number }[];
	searchMisses: { query: string; misses: number; users: number; last_day: string }[];
	playFailures: { source: string; stage: string; failures: number }[];
	lyricsMissing: { song_id: string; title: string; artist: string; plays: number }[];
}

type Row = Record<string, unknown>;

async function all<T = Row>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
	const res = await db
		.prepare(sql)
		.bind(...params)
		.all<T>();
	return (res.results ?? []) as T[];
}

function num(v: unknown): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

function dayOffset(today: string, delta: number): string {
	const d = new Date(`${today}T00:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() + delta);
	return d.toISOString().slice(0, 10);
}

async function retention(db: D1Database, today: string, n: number) {
	const [r] = await all(
		db,
		`WITH firsts AS (SELECT pseudo_id, MIN(day) AS d0 FROM pseudo_events GROUP BY pseudo_id)
		 SELECT COUNT(*) AS cohort,
		        COALESCE(SUM(EXISTS (SELECT 1 FROM pseudo_events e
		                             WHERE e.pseudo_id = f.pseudo_id AND e.day = date(f.d0, ?))), 0) AS returned
		 FROM firsts f WHERE date(f.d0, ?) <= ?`,
		`+${n} day`,
		`+${n} day`,
		today
	);
	return { cohort: num(r?.cohort), returned: num(r?.returned) };
}

/** Build the whole dashboard payload. `days` bounds the list windows (default 30). */
export async function buildPseudoReport(
	db: D1Database,
	now: Date = new Date(),
	days = 30
): Promise<PseudoReport> {
	const today = now.toISOString().slice(0, 10);
	const weekStart = dayOffset(today, -6);
	const since = dayOffset(today, -(days - 1));
	const seriesStart = dayOffset(today, -13);

	const [u] = await all(
		db,
		`SELECT
		   COUNT(DISTINCT CASE WHEN day = ? THEN pseudo_id END) AS today,
		   COUNT(DISTINCT CASE WHEN day >= ? THEN pseudo_id END) AS week,
		   COUNT(DISTINCT pseudo_id) AS total
		 FROM pseudo_events`,
		today,
		weekStart
	);

	const dailyUsers = (
		await all(
			db,
			`SELECT day, COUNT(DISTINCT pseudo_id) AS users FROM pseudo_events
			 WHERE day >= ? GROUP BY day ORDER BY day`,
			seriesStart
		)
	).map((r) => ({ day: String(r.day), users: num(r.users) }));

	const topSongs = (
		await all(
			db,
			`SELECT song_id, MAX(title) AS title, MAX(artist) AS artist,
			        COUNT(*) AS plays, COUNT(DISTINCT pseudo_id) AS listeners
			 FROM pseudo_events WHERE action = 'play' AND day >= ? AND song_id <> ''
			 GROUP BY song_id ORDER BY listeners DESC, plays DESC LIMIT 50`,
			since
		)
	).map((r) => ({
		song_id: String(r.song_id),
		title: String(r.title ?? ''),
		artist: String(r.artist ?? ''),
		plays: num(r.plays),
		listeners: num(r.listeners)
	}));

	const searchMisses = (
		await all(
			db,
			`SELECT lower(query) AS query, COUNT(*) AS misses, COUNT(DISTINCT pseudo_id) AS users, MAX(day) AS last_day
			 FROM pseudo_events WHERE action = 'search_miss' AND day >= ? AND query <> ''
			 GROUP BY lower(query) ORDER BY users DESC, misses DESC LIMIT 100`,
			since
		)
	).map((r) => ({
		query: String(r.query),
		misses: num(r.misses),
		users: num(r.users),
		last_day: String(r.last_day)
	}));

	const playFailures = (
		await all(
			db,
			`SELECT source, stage, COUNT(*) AS failures FROM pseudo_events
			 WHERE action = 'play_failure' AND day >= ?
			 GROUP BY source, stage ORDER BY failures DESC`,
			since
		)
	).map((r) => ({ source: String(r.source), stage: String(r.stage), failures: num(r.failures) }));

	const lyricsMissing = (
		await all(
			db,
			`SELECT song_id, MAX(title) AS title, MAX(artist) AS artist, COUNT(*) AS plays
			 FROM pseudo_events WHERE action = 'lyrics_missing' AND day >= ? AND song_id <> ''
			 GROUP BY song_id ORDER BY plays DESC LIMIT 100`,
			since
		)
	).map((r) => ({
		song_id: String(r.song_id),
		title: String(r.title ?? ''),
		artist: String(r.artist ?? ''),
		plays: num(r.plays)
	}));

	return {
		today,
		users: { today: num(u?.today), week: num(u?.week), total: num(u?.total) },
		dailyUsers,
		retention: { d1: await retention(db, today, 1), d7: await retention(db, today, 7) },
		topSongs,
		searchMisses,
		playFailures,
		lyricsMissing
	};
}
