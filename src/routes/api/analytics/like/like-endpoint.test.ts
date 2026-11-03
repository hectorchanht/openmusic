// /api/analytics/like endpoint tests — the POST status matrix driven through the
// exported verb handler, over a fake D1Database stand-in (prepare/bind/run chain).
// getUserFromRequest is mocked so the identity path (logged-in → user_id, logged-out
// → NULL) is exercised without a real sessions table.
//
// What these CANNOT prove: that SvelteKit loads the module (a non-verb export 500s
// at request time), or that the real D1 binding is wired on the deploy — those are
// live checks.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const authState: { user: { id: string; email: string } | null } = { user: null };
vi.mock('$lib/auth/auth-core', () => ({
	getUserFromRequest: vi.fn(async () => authState.user)
}));

import { POST } from './+server';

/** D1 stand-in: prepare() → { bind(...).run() }, capturing bound params per row. */
function fakeDb() {
	const rows: unknown[][] = [];
	const stmt = {
		bind: vi.fn((...params: unknown[]) => {
			rows.push(params);
			return stmt;
		}),
		run: vi.fn(async () => ({ success: true, meta: {} }))
	};
	return { rows, stmt, prepare: vi.fn(() => stmt) };
}

const DESKTOP_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function fakeEvent(
	body: unknown,
	env?: Record<string, unknown>,
	opts: { origin?: string; ua?: string; country?: string } = {}
) {
	const url = new URL('https://openmusic.lol/api/analytics/like');
	const headers: Record<string, string> = {
		origin: opts.origin ?? 'https://openmusic.lol',
		'content-type': 'application/json',
		'user-agent': opts.ua ?? DESKTOP_UA
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

describe('POST /api/analytics/like', () => {
	beforeEach(() => {
		authState.user = null;
	});

	it('inserts one 14-column row with the server-resolved user_id on a valid like', async () => {
		authState.user = { id: 'u-123', email: 'fan@example.com' };
		const db = fakeDb();
		const res = await post(
			fakeEvent(
				{
					anon_id: 'a1',
					action: 'like',
					song_id: 'qq:123',
					title: 'T',
					artist: 'A',
					source: 'qq',
					platform: 'web',
					app_version: '1.4.0',
					locale: 'zh-Hant-HK'
				},
				{ ACCOUNTS_DB: db },
				{ country: 'HK' }
			)
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(db.prepare).toHaveBeenCalledTimes(1);
		expect(db.rows).toHaveLength(1);
		const r = db.rows[0];
		expect(r[0]).toBe('u-123'); // server-resolved, never from the body
		expect(r[1]).toBe('a1');
		expect(r[2]).toBe('like');
		expect(r.slice(3, 7)).toEqual(['qq:123', 'T', 'A', 'qq']);
		expect(r[7]).toBe('web');
		expect(r[8]).toBe('1.4.0');
		expect(r[9]).toBe('zh-Hant-HK');
		expect(r[10]).toBe('desktop'); // derived from UA, not the body
		expect(r[11]).toBe('windows');
		expect(r[12]).toBe('HK'); // derived from CF-IPCountry, not the body
		expect(typeof r[13]).toBe('string'); // liked_at, server-stamped ISO
		expect(Number.isNaN(Date.parse(r[13] as string))).toBe(false);
	});

	it('stores user_id NULL (still logging the event) when there is no session', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent({ anon_id: 'a9', action: 'like', song_id: 'qq:1' }, { ACCOUNTS_DB: db })
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(db.rows[0][0]).toBeNull();
		expect(db.rows[0][1]).toBe('a9');
	});

	it('logs unlikes with action=unlike', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent({ action: 'unlike', song_id: 'qq:1' }, { ACCOUNTS_DB: db })
		);
		expect(res.status).toBe(200);
		expect(db.rows[0][2]).toBe('unlike');
	});

	it('ignores a body-supplied user_id — identity comes from the session only', async () => {
		authState.user = { id: 'u-real', email: 'real@example.com' };
		const db = fakeDb();
		const res = await post(
			fakeEvent(
				{ action: 'like', song_id: 'qq:1', user_id: 'u-spoofed', email: 'spoof@evil.com' },
				{ ACCOUNTS_DB: db }
			)
		);
		expect(res.status).toBe(200);
		expect(db.rows[0][0]).toBe('u-real');
	});

	it('400s without touching the DB when action is not like/unlike', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent({ action: 'love', song_id: 'qq:123' }, { ACCOUNTS_DB: db })
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ ok: false, reason: 'invalid' });
		expect(db.prepare).not.toHaveBeenCalled();
	});

	it('400s without touching the DB when song_id is missing', async () => {
		const db = fakeDb();
		const res = await post(fakeEvent({ action: 'like' }, { ACCOUNTS_DB: db }));
		expect(res.status).toBe(400);
		expect(db.prepare).not.toHaveBeenCalled();
	});

	it('answers ok:false (still 200) when the D1 binding is absent', async () => {
		const res = await post(fakeEvent({ action: 'like', song_id: 'qq:123' }, {}));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: false, reason: 'no-db' });
	});

	it('answers ok:false (still 200) when the insert throws', async () => {
		const db = fakeDb();
		db.prepare.mockImplementation(() => {
			throw new Error('boom');
		});
		const res = await post(fakeEvent({ action: 'like', song_id: 'qq:123' }, { ACCOUNTS_DB: db }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: false, reason: 'db-error' });
	});

	it('truncates overlong fields instead of rejecting', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent({ action: 'like', song_id: 'x'.repeat(300), title: 't'.repeat(500) }, { ACCOUNTS_DB: db })
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect((db.rows[0][3] as string).length).toBe(256);
		expect((db.rows[0][4] as string).length).toBe(300);
	});

	it('403s a non-allow-listed origin without touching the DB', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent({ action: 'like', song_id: 'qq:123' }, { ACCOUNTS_DB: db }, { origin: 'https://evil.example' })
		);
		expect(res.status).toBe(403);
		expect(db.prepare).not.toHaveBeenCalled();
	});
});
