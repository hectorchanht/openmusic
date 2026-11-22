// pseudo-events + pseudo-report tests (quick-261122-pseudo) — the pseudonymous
// store exercised against a REAL SQLite (node:sqlite) running the module's
// verbatim DDL, insert SQL and report SQL through a thin D1Database-shaped
// adapter. Proves the acceptance arithmetic: a fresh profile is exactly ONE
// distinct user across many plays; a reset ID counts as a NEW user; retention
// is derived from pseudo_id active days. Also pins the schema guardrails: no
// column exists in which an IP, account key, email or UA fingerprint could land.

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
	PSEUDO_EVENTS_DDL,
	PSEUDO_EVENTS_INDEXES,
	coarseCountry,
	isPseudoId,
	recordPseudoEvent,
	type PseudoEvent
} from './pseudo-events';
import { buildPseudoReport } from './pseudo-report';

function realDb() {
	const sqlite = new DatabaseSync(':memory:');
	sqlite.exec(PSEUDO_EVENTS_DDL);
	for (const ix of PSEUDO_EVENTS_INDEXES) sqlite.exec(ix);
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
				},
				async all() {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					return { results: sqlite.prepare(sql).all(...(params as any[])), success: true, meta: {} };
				}
			};
			return stmt;
		}
	};
	return { db: db as unknown as D1Database, sqlite };
}

const A = '0b7c9a52-3f1e-4c2a-9d7e-1a2b3c4d5e6f';
const B = '6f5e4d3c-2b1a-4e7d-a2c4-f1e3a5b7c9d0';

function ev(p: Partial<PseudoEvent> & Pick<PseudoEvent, 'pseudoId' | 'action'>): PseudoEvent {
	return {
		songId: '',
		title: '',
		artist: '',
		source: '',
		query: '',
		stage: '',
		appVersion: 'abc123',
		platform: 'mobile',
		country: 'HK',
		...p
	};
}
const play = (pid: string, song = 'qq:1', title = 'Song 1') =>
	ev({ pseudoId: pid, action: 'play', songId: song, title, artist: 'Art', source: 'qq' });
const at = (iso: string) => new Date(iso);

describe('pseudo_events schema — guardrails pinned', () => {
	it('has exactly the ruled columns and nothing else', () => {
		const { sqlite } = realDb();
		const cols = (sqlite.prepare('PRAGMA table_info(pseudo_events)').all() as { name: string }[]).map((c) => c.name);
		expect(cols).toEqual([
			'pseudo_id',
			'action',
			'day',
			'ts',
			'song_id',
			'title',
			'artist',
			'source',
			'query',
			'stage',
			'app_version',
			'platform',
			'country'
		]);
	});

	it('the DDL has no IP, account-join, email or User-Agent column', () => {
		for (const banned of [/\bip\b/i, /ip_?addr/i, /user_id/i, /account/i, /email/i, /session/i, /user_agent|\bua\b/i, /device/i, /\bos\b/i, /fingerprint/i]) {
			expect(PSEUDO_EVENTS_DDL).not.toMatch(banned);
		}
	});

	it('isPseudoId accepts only a lowercase random UUID v4', () => {
		expect(isPseudoId(A)).toBe(true);
		expect(isPseudoId(A.toUpperCase())).toBe(false);
		expect(isPseudoId('someone@example.com')).toBe(false);
		expect(isPseudoId('42')).toBe(false);
		expect(isPseudoId('0b7c9a52-3f1e-1c2a-9d7e-1a2b3c4d5e6f')).toBe(false); // v1, not v4
		expect(isPseudoId(undefined)).toBe(false);
	});

	it('coarseCountry keeps a 2-letter code and drops XX / Tor / junk', () => {
		expect(coarseCountry('hk')).toBe('HK');
		expect(coarseCountry('XX')).toBe('');
		expect(coarseCountry('T1')).toBe('');
		expect(coarseCountry('203.0.113.9')).toBe('');
		expect(coarseCountry(null)).toBe('');
	});
});

describe('recordPseudoEvent + buildPseudoReport — acceptance arithmetic', () => {
	it('a fresh profile counts as exactly 1 distinct user across many plays', async () => {
		const { db } = realDb();
		const now = at('2026-11-22T10:00:00Z');
		for (let i = 0; i < 5; i++) await recordPseudoEvent(db, play(A, `qq:${i}`, `S${i}`), now);
		await recordPseudoEvent(db, ev({ pseudoId: A, action: 'session_start' }), now);
		const r = await buildPseudoReport(db, now);
		expect(r.users).toEqual({ today: 1, week: 1, total: 1 });
	});

	it('resetting the ID counts as a new user', async () => {
		const { db } = realDb();
		const now = at('2026-11-22T10:00:00Z');
		await recordPseudoEvent(db, play(A), now);
		await recordPseudoEvent(db, play(B), now); // same device after "Reset my anonymous ID"
		const r = await buildPseudoReport(db, now);
		expect(r.users.total).toBe(2);
	});

	it('stores day + epoch seconds, never anything finer than the request time', async () => {
		const { db, sqlite } = realDb();
		await recordPseudoEvent(db, play(A), at('2026-11-22T10:00:00.789Z'));
		const row = sqlite.prepare('SELECT day, ts FROM pseudo_events').get() as { day: string; ts: number };
		expect(row).toEqual({ day: '2026-11-22', ts: Date.parse('2026-11-22T10:00:00Z') / 1000 });
	});

	it('derives D1/D7 retention from active days, counting only eligible cohorts', async () => {
		const { db } = realDb();
		// A: first seen 11-10, back 11-11 (D1) and 11-17 (D7). B: first seen 11-10, never back.
		await recordPseudoEvent(db, play(A), at('2026-11-10T08:00:00Z'));
		await recordPseudoEvent(db, play(A), at('2026-11-11T08:00:00Z'));
		await recordPseudoEvent(db, play(A), at('2026-11-17T08:00:00Z'));
		await recordPseudoEvent(db, play(B), at('2026-11-10T09:00:00Z'));
		const r = await buildPseudoReport(db, at('2026-11-22T00:00:00Z'));
		expect(r.retention.d1).toEqual({ cohort: 2, returned: 1 });
		expect(r.retention.d7).toEqual({ cohort: 2, returned: 1 });
		// a cohort from today is not yet eligible for either
		const r2 = await buildPseudoReport(db, at('2026-11-10T23:00:00Z'));
		expect(r2.retention.d1.cohort).toBe(0);
	});

	it('weekly window and daily series', async () => {
		const { db } = realDb();
		await recordPseudoEvent(db, play(A), at('2026-11-01T08:00:00Z')); // outside the 7-day window
		await recordPseudoEvent(db, play(B), at('2026-11-20T08:00:00Z'));
		const r = await buildPseudoReport(db, at('2026-11-22T08:00:00Z'));
		expect(r.users).toEqual({ today: 0, week: 1, total: 2 });
		expect(r.dailyUsers).toEqual([{ day: '2026-11-20', users: 1 }]);
	});

	it('top songs, search misses, play failures by source, lyrics missing', async () => {
		const { db } = realDb();
		const now = at('2026-11-22T10:00:00Z');
		await recordPseudoEvent(db, play(A, 'qq:1', 'Hit'), now);
		await recordPseudoEvent(db, play(A, 'qq:1', 'Hit'), now);
		await recordPseudoEvent(db, play(B, 'qq:1', 'Hit'), now);
		await recordPseudoEvent(db, play(B, 'kw:9', 'Other'), now);
		await recordPseudoEvent(db, ev({ pseudoId: A, action: 'search_miss', query: '包羅萬有' }), now);
		await recordPseudoEvent(db, ev({ pseudoId: B, action: 'search_miss', query: '包羅萬有' }), now);
		await recordPseudoEvent(db, ev({ pseudoId: A, action: 'play_failure', songId: 'kw:9', source: 'kuwo', stage: 'timeout' }), now);
		await recordPseudoEvent(db, ev({ pseudoId: B, action: 'play_failure', songId: 'kw:8', source: 'kuwo', stage: 'timeout' }), now);
		await recordPseudoEvent(db, ev({ pseudoId: A, action: 'lyrics_missing', songId: 'kw:9', title: 'Other' }), now);
		const r = await buildPseudoReport(db, now);
		expect(r.topSongs[0]).toEqual({ song_id: 'qq:1', title: 'Hit', artist: 'Art', plays: 3, listeners: 2 });
		expect(r.searchMisses).toEqual([{ query: '包羅萬有', misses: 2, users: 2, last_day: '2026-11-22' }]);
		expect(r.playFailures).toEqual([{ source: 'kuwo', stage: 'timeout', failures: 2 }]);
		expect(r.lyricsMissing).toEqual([{ song_id: 'kw:9', title: 'Other', artist: '', plays: 1 }]);
	});

	it('the report never returns a pseudo_id', async () => {
		const { db } = realDb();
		const now = at('2026-11-22T10:00:00Z');
		await recordPseudoEvent(db, play(A), now);
		await recordPseudoEvent(db, ev({ pseudoId: A, action: 'search_miss', query: 'x' }), now);
		await recordPseudoEvent(db, ev({ pseudoId: A, action: 'play_failure', songId: 'qq:1', source: 'qq', stage: 'no-source' }), now);
		await recordPseudoEvent(db, ev({ pseudoId: A, action: 'lyrics_missing', songId: 'qq:1' }), now);
		const json = JSON.stringify(await buildPseudoReport(db, now));
		expect(json).not.toContain(A);
		expect(json).not.toContain('pseudo_id');
	});
});
