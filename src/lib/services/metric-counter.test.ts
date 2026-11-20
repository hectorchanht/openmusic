// metric-counter tests — the aggregation contract exercised against a REAL
// SQLite (node:sqlite) running the module's verbatim DDL and upsert SQL, via
// a thin D1Database-shaped adapter. This is the layer that proves "totals
// only" arithmetic: repeated bumps fold into one counter row per
// (day, action, song); different days/actions stay separate; metadata
// refreshes on conflict but an empty incoming title never erases a known one.

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { METRIC_COUNTERS_DDL, bumpMetric, metricDay } from './metric-counter';

/** Minimal D1Database stand-in backed by a real in-memory SQLite. */
function realDb() {
	const sqlite = new DatabaseSync(':memory:');
	sqlite.exec(METRIC_COUNTERS_DDL);
	const db = {
		prepare(sql: string) {
			let params: unknown[] = [];
			const stmt = {
				bind(...p: unknown[]) {
					params = p;
					return stmt;
				},
				async run() {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					sqlite.prepare(sql).run(...(params as any[]));
					return { success: true, meta: {} };
				}
			};
			return stmt;
		}
	};
	const all = () =>
		sqlite
			.prepare('SELECT day, action, song_id, title, artist, source, count FROM metric_counters ORDER BY day, action, song_id')
			.all();
	return { db: db as unknown as D1Database, all };
}

const DAY1 = new Date('2026-11-18T10:00:00.000Z');
const DAY1_LATE = new Date('2026-11-18T23:59:59.000Z');
const DAY2 = new Date('2026-11-19T00:00:01.000Z');
const SONG = { songId: 'qq:123', title: 'T', artist: 'A', source: 'qq' };

describe('metricDay', () => {
	it('buckets to the UTC calendar day and nothing finer', () => {
		expect(metricDay(DAY1)).toBe('2026-11-18');
		expect(metricDay(DAY1_LATE)).toBe('2026-11-18');
		expect(metricDay(DAY2)).toBe('2026-11-19');
	});
});

describe('bumpMetric (real SQLite)', () => {
	it('folds repeated bumps of the same song+action+day into ONE row whose count increments', async () => {
		const { db, all } = realDb();
		await bumpMetric(db, 'play', SONG, DAY1);
		await bumpMetric(db, 'play', SONG, DAY1_LATE);
		await bumpMetric(db, 'play', SONG, DAY1);
		expect(all()).toEqual([
			{ day: '2026-11-18', action: 'play', song_id: 'qq:123', title: 'T', artist: 'A', source: 'qq', count: 3 }
		]);
	});

	it('keeps days and actions in separate counters', async () => {
		const { db, all } = realDb();
		await bumpMetric(db, 'play', SONG, DAY1);
		await bumpMetric(db, 'play', SONG, DAY2);
		await bumpMetric(db, 'like', SONG, DAY1);
		await bumpMetric(db, 'download', SONG, DAY1);
		const rows = all() as { day: string; action: string; count: number }[];
		expect(rows).toHaveLength(4);
		expect(rows.every((r) => r.count === 1)).toBe(true);
		expect(rows.map((r) => `${r.day}/${r.action}`).sort()).toEqual([
			'2026-11-18/download',
			'2026-11-18/like',
			'2026-11-18/play',
			'2026-11-19/play'
		]);
	});

	it('refreshes metadata on conflict, but an empty incoming title never erases a known one', async () => {
		const { db, all } = realDb();
		await bumpMetric(db, 'play', SONG, DAY1);
		await bumpMetric(db, 'play', { ...SONG, title: '', artist: '', source: '' }, DAY1);
		await bumpMetric(db, 'play', { ...SONG, title: 'T2' }, DAY1);
		expect(all()).toEqual([
			{ day: '2026-11-18', action: 'play', song_id: 'qq:123', title: 'T2', artist: 'A', source: 'qq', count: 3 }
		]);
	});

	it('the schema itself has no column an identifier could land in', () => {
		for (const banned of ['anon', 'user', 'ip', 'agent', 'device', 'os', 'email', 'session', 'locale', 'country']) {
			expect(METRIC_COUNTERS_DDL.toLowerCase()).not.toContain(banned);
		}
	});
});
