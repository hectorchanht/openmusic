// /api/analytics/like endpoint tests — the POST status matrix driven through
// the exported verb handler, over a fake D1Database stand-in (prepare/bind/run
// chain), under the totals-only data doctrine (quick-261118-datadoctrine).
//
// The retired design (quick-261023-like-dl) resolved the session to a user_id
// and stored per-user rows in the ACCOUNTS database. These tests pin its
// absence: no auth module is consulted, the counter lands in ANALYTICS_DB with
// params [day, action, song_id, title, artist, source], and identity fields in
// the body (anon_id, user_id, email) never reach the SQL or the params — even
// a request WITH a session cookie is counted anonymously.
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
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function fakeEvent(
	body: unknown,
	env?: Record<string, unknown>,
	opts: { origin?: string; cookie?: string } = {}
) {
	const url = new URL('https://openmusic.lol/api/analytics/like');
	const headers: Record<string, string> = {
		origin: opts.origin ?? 'https://openmusic.lol',
		'content-type': 'application/json',
		'user-agent': RICH_UA,
		'cf-ipcountry': 'HK'
	};
	if (opts.cookie) headers['cookie'] = opts.cookie;
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

describe('POST /api/analytics/like', () => {
	it('upserts one (day, like, song) counter in ANALYTICS_DB on a valid like', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent(
				{ action: 'like', song_id: 'qq:123', title: 'T', artist: 'A', source: 'qq' },
				{ ANALYTICS_DB: db }
			)
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(db.prepare).toHaveBeenCalledTimes(1);
		expect(db.sqls[0]).toContain('INSERT INTO metric_counters');
		expect(db.rows).toHaveLength(1);
		const r = db.rows[0];
		expect(r).toHaveLength(6);
		expect(r[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(r.slice(1)).toEqual(['like', 'qq:123', 'T', 'A', 'qq']);
	});

	it('counts unlikes under their own action so net likes stay derivable', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent({ action: 'unlike', song_id: 'qq:1' }, { ANALYTICS_DB: db })
		);
		expect(res.status).toBe(200);
		expect(db.rows[0][1]).toBe('unlike');
	});

	it('never writes identity: session cookie and body identity fields are ignored', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent(
				{
					action: 'like',
					song_id: 'qq:1',
					anon_id: 'persistent-uuid-1234',
					user_id: 'u-spoofed',
					email: 'spoof@evil.com'
				},
				{ ANALYTICS_DB: db },
				{ cookie: 'om_session=secret-session-token' }
			)
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		const flat = JSON.stringify(db.rows) + db.sqls.join(' ');
		expect(flat).not.toContain('persistent-uuid-1234');
		expect(flat).not.toContain('u-spoofed');
		expect(flat).not.toContain('spoof@evil.com');
		expect(flat).not.toContain('user_id');
		expect(flat).not.toContain('anon_id');
	});

	it('does not treat the ACCOUNTS_DB binding as an analytics target', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent({ action: 'like', song_id: 'qq:123' }, { ACCOUNTS_DB: db })
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: false, reason: 'no-db' });
		expect(db.prepare).not.toHaveBeenCalled();
	});

	it('400s without touching the DB when action is not like/unlike', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent({ action: 'love', song_id: 'qq:123' }, { ANALYTICS_DB: db })
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ ok: false, reason: 'invalid' });
		expect(db.prepare).not.toHaveBeenCalled();
	});

	it('400s without touching the DB when song_id is missing', async () => {
		const db = fakeDb();
		const res = await post(fakeEvent({ action: 'like' }, { ANALYTICS_DB: db }));
		expect(res.status).toBe(400);
		expect(db.prepare).not.toHaveBeenCalled();
	});

	it('answers ok:false (still 200) when the D1 binding is absent', async () => {
		const res = await post(fakeEvent({ action: 'like', song_id: 'qq:123' }, {}));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: false, reason: 'no-db' });
	});

	it('answers ok:false (still 200) when the upsert throws', async () => {
		const db = fakeDb();
		db.prepare.mockImplementation(() => {
			throw new Error('boom');
		});
		const res = await post(fakeEvent({ action: 'like', song_id: 'qq:123' }, { ANALYTICS_DB: db }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: false, reason: 'db-error' });
	});

	it('truncates overlong fields instead of rejecting', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent(
				{ action: 'like', song_id: 'x'.repeat(300), title: 't'.repeat(500) },
				{ ANALYTICS_DB: db }
			)
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect((db.rows[0][2] as string).length).toBe(256);
		expect((db.rows[0][3] as string).length).toBe(300);
	});

	it('403s a non-allow-listed origin without touching the DB', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent(
				{ action: 'like', song_id: 'qq:123' },
				{ ANALYTICS_DB: db },
				{ origin: 'https://evil.example' }
			)
		);
		expect(res.status).toBe(403);
		expect(db.prepare).not.toHaveBeenCalled();
	});
});
