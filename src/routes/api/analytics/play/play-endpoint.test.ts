// /api/analytics/play endpoint tests — the POST status matrix driven through
// the exported verb handler, over a fake D1Database stand-in (prepare/bind/run
// chain), under the totals-only data doctrine (quick-261118-datadoctrine):
// every accepted ping becomes ONE counter upsert against metric_counters with
// params [day, 'play', song_id, title, artist, source] — and NOTHING else.
// Bodies and headers stuffed with identifiers (anon_id, user_id, platform,
// locale, a rich User-Agent, CF-IPCountry) must not leak into the SQL or the
// bound params. Every reject path asserts the DB was not touched.
//
// What these CANNOT prove: that SvelteKit loads the module (a non-verb export
// 500s at request time), or that the real D1 binding is wired on the deploy —
// those are live checks.

import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

/** D1 stand-in: prepare(sql) → { bind(...).run() }, capturing SQL + params. */
function fakeDb() {
	const rows: unknown[][] = [];
	const sqls: string[] = [];
	const stmt = {
		bind: vi.fn((...params: unknown[]) => {
			rows.push(params);
			return stmt;
		}),
		run: vi.fn(async () => ({ success: true, meta: {} }))
	};
	return {
		rows,
		sqls,
		stmt,
		prepare: vi.fn((sql: string) => {
			sqls.push(sql);
			return stmt;
		})
	};
}

const RICH_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function fakeEvent(
	body: unknown,
	env?: Record<string, unknown>,
	opts: { origin?: string; ua?: string; country?: string } = {}
) {
	const url = new URL('https://openmusic.lol/api/analytics/play');
	const headers: Record<string, string> = {
		origin: opts.origin ?? 'https://openmusic.lol',
		'content-type': 'application/json',
		'user-agent': opts.ua ?? RICH_UA
	};
	if (opts.country) headers['cf-ipcountry'] = opts.country;
	return {
		platform: { env: env ?? {} },
		request: new Request(url, {
			method: 'POST',
			headers,
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = (e: unknown) => (POST as any)(e);

describe('POST /api/analytics/play', () => {
	it('upserts one (day, play, song) counter and answers ok:true on a valid ping', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent(
				{ song_id: 'qq:123', title: 'T', artist: 'A', source: 'qq' },
				{ ANALYTICS_DB: db },
				{ country: 'HK' }
			)
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(db.prepare).toHaveBeenCalledTimes(1);
		expect(db.sqls[0]).toContain('INSERT INTO metric_counters');
		expect(db.sqls[0]).toContain('ON CONFLICT (day, action, song_id)');
		expect(db.sqls[0]).toContain('count = count + 1');
		expect(db.rows).toHaveLength(1);
		const r = db.rows[0];
		expect(r).toHaveLength(6);
		expect(r[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/); // UTC day bucket, nothing finer
		expect(r.slice(1)).toEqual(['play', 'qq:123', 'T', 'A', 'qq']);
	});

	it('ignores identifier fields in the body and every header-derived signal', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent(
				{
					anon_id: 'persistent-uuid-1234',
					user_id: 'u-spoofed',
					song_id: 'qq:123',
					title: 'T',
					artist: 'A',
					source: 'qq',
					platform: 'android',
					app_version: '9.9.9',
					locale: 'zh-Hant-HK',
					device_type: 'mobile',
					os: 'ios',
					country: 'HK'
				},
				{ ANALYTICS_DB: db },
				{ country: 'HK' }
			)
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		const flat = JSON.stringify(db.rows) + db.sqls.join(' ');
		expect(flat).not.toContain('persistent-uuid-1234');
		expect(flat).not.toContain('u-spoofed');
		expect(flat).not.toContain('anon_id');
		expect(flat).not.toContain('user_id');
		expect(flat).not.toContain('zh-Hant-HK');
		expect(flat).not.toContain('9.9.9');
		expect(db.rows[0].slice(1)).toEqual(['play', 'qq:123', 'T', 'A', 'qq']);
	});

	it('400s without touching the DB when song_id is missing', async () => {
		const db = fakeDb();
		const res = await post(fakeEvent({ title: 'T' }, { ANALYTICS_DB: db }));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ ok: false, reason: 'invalid' });
		expect(db.prepare).not.toHaveBeenCalled();
	});

	it('answers ok:false (still 200) when the D1 binding is absent', async () => {
		const res = await post(fakeEvent({ song_id: 'qq:123' }, {}));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: false, reason: 'no-db' });
	});

	it('answers ok:false (still 200) when the ACCOUNTS_DB binding alone is present', async () => {
		// Counters live ONLY in the analytics database now — the accounts DB is
		// never an analytics target (the retired like/download design wrote there).
		const db = fakeDb();
		const res = await post(fakeEvent({ song_id: 'qq:123' }, { ACCOUNTS_DB: db }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: false, reason: 'no-db' });
		expect(db.prepare).not.toHaveBeenCalled();
	});

	it('answers ok:false (still 200) when the upsert throws', async () => {
		const db = fakeDb();
		db.prepare.mockImplementation(() => {
			throw new Error('boom');
		});
		const res = await post(fakeEvent({ song_id: 'qq:123' }, { ANALYTICS_DB: db }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: false, reason: 'db-error' });
	});

	it('truncates overlong fields instead of rejecting', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent({ song_id: 'x'.repeat(300), title: 't'.repeat(500) }, { ANALYTICS_DB: db })
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect((db.rows[0][2] as string).length).toBe(256);
		expect((db.rows[0][3] as string).length).toBe(300);
	});

	it('403s a non-allow-listed origin without touching the DB', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent({ song_id: 'qq:123' }, { ANALYTICS_DB: db }, { origin: 'https://evil.example' })
		);
		expect(res.status).toBe(403);
		expect(db.prepare).not.toHaveBeenCalled();
	});
});
