// /api/analytics/event endpoint tests (quick-261122-pseudo). Driven through
// the exported POST over a fake D1 (prepare/bind/run capture). Pins:
//   - promise-first: with PSEUDO_ANALYTICS_LIVE off, NOTHING is written;
//   - the pseudo_id must be a UUID v4 (an email / account id is refused);
//   - the bound params are exactly the ruled fields — a body stuffed with
//     user_id / email / ip / anon_id and a rich User-Agent + X-Forwarded-For
//     + CF-Connecting-IP never leaks into the SQL or the params;
//   - country comes from CF-IPCountry as a 2-letter code; platform is one bit.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ live: true }));
vi.mock('$lib/config/pseudo-analytics', () => ({
	get PSEUDO_ANALYTICS_LIVE() {
		return flag.live;
	}
}));

import { POST } from './+server';

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
		prepare: vi.fn((sql: string) => {
			sqls.push(sql);
			return stmt;
		})
	};
}

const PID = '0b7c9a52-3f1e-4c2a-9d7e-1a2b3c4d5e6f';
const UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function fakeEvent(body: unknown, env?: Record<string, unknown>, origin = 'https://openmusic.lol') {
	return {
		platform: { env: env ?? {} },
		request: new Request('https://openmusic.lol/api/analytics/event', {
			method: 'POST',
			headers: {
				origin,
				'content-type': 'application/json',
				'user-agent': UA,
				'cf-ipcountry': 'hk',
				'cf-connecting-ip': '203.0.113.9',
				'x-forwarded-for': '203.0.113.9',
				cookie: 'om_session=secret-session-token'
			},
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	};
}

async function call(body: unknown, env?: Record<string, unknown>, origin?: string) {
	const res = await POST(fakeEvent(body, env, origin) as unknown as Parameters<typeof POST>[0]);
	return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
	flag.live = true;
});

describe('POST /api/analytics/event', () => {
	it('is a no-op until the promise is live (promise-first ordering)', async () => {
		flag.live = false;
		const db = fakeDb();
		const r = await call({ pseudo_id: PID, action: 'session_start' }, { ANALYTICS_DB: db });
		expect(r.json).toEqual({ ok: false, reason: 'not-live' });
		expect(db.prepare).not.toHaveBeenCalled();
	});

	it('writes exactly the ruled fields for a play — identifiers in body/headers never leak', async () => {
		const db = fakeDb();
		const r = await call(
			{
				pseudo_id: PID,
				action: 'play',
				song_id: 'qq:1',
				title: 'T',
				artist: 'A',
				source: 'qq',
				app_version: 'abc123',
				platform: 'mobile',
				user_id: 'u-42',
				email: 'someone@example.com',
				ip: '198.51.100.1',
				anon_id: 'legacy'
			},
			{ ANALYTICS_DB: db }
		);
		expect(r.json).toEqual({ ok: true });
		expect(db.sqls).toHaveLength(1);
		expect(db.sqls[0]).toMatch(/INSERT INTO pseudo_events/);
		const p = db.rows[0];
		expect(p[0]).toBe(PID);
		expect(p[1]).toBe('play');
		expect(p[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(typeof p[3]).toBe('number');
		expect(p.slice(4)).toEqual(['qq:1', 'T', 'A', 'qq', '', '', 'abc123', 'mobile', 'HK']);
		const blob = JSON.stringify(db.rows) + db.sqls.join(' ');
		for (const leak of ['u-42', 'someone@example.com', '198.51.100.1', '203.0.113.9', 'legacy', 'iPhone', 'secret-session-token', 'user_id', 'anon_id']) {
			expect(blob).not.toContain(leak);
		}
	});

	it('refuses a non-UUID pseudo_id (no email / account id can ride in)', async () => {
		const db = fakeDb();
		for (const bad of ['someone@example.com', 'user:42', PID.toUpperCase(), '', 7]) {
			const r = await call({ pseudo_id: bad, action: 'session_start' }, { ANALYTICS_DB: db });
			expect(r.status).toBe(400);
		}
		expect(db.prepare).not.toHaveBeenCalled();
	});

	it('refuses unknown actions and song events without a song', async () => {
		const db = fakeDb();
		expect((await call({ pseudo_id: PID, action: 'pageview' }, { ANALYTICS_DB: db })).status).toBe(400);
		expect((await call({ pseudo_id: PID, action: 'play' }, { ANALYTICS_DB: db })).status).toBe(400);
		expect((await call({ pseudo_id: PID, action: 'search_miss' }, { ANALYTICS_DB: db })).status).toBe(400);
		expect(db.prepare).not.toHaveBeenCalled();
	});

	it('search_miss keeps the query and drops song fields', async () => {
		const db = fakeDb();
		await call({ pseudo_id: PID, action: 'search_miss', query: ' 包羅萬有 ', song_id: 'x' }, { ANALYTICS_DB: db });
		expect(db.rows[0].slice(4, 10)).toEqual(['', '', '', '', '包羅萬有', '']);
	});

	it('play_failure keeps a known stage only', async () => {
		const db = fakeDb();
		await call({ pseudo_id: PID, action: 'play_failure', song_id: 'kw:1', source: 'kuwo', stage: 'timeout' }, { ANALYTICS_DB: db });
		await call({ pseudo_id: PID, action: 'play_failure', song_id: 'kw:1', source: 'kuwo', stage: 'rm -rf' }, { ANALYTICS_DB: db });
		expect(db.rows[0][9]).toBe('timeout');
		expect(db.rows[1][9]).toBe('');
	});

	it('session_start needs no song; platform is one bit or empty', async () => {
		const db = fakeDb();
		await call({ pseudo_id: PID, action: 'session_start', platform: 'iPhone 15 Pro' }, { ANALYTICS_DB: db });
		expect(db.rows[0][11]).toBe('');
	});

	it('refuses a foreign origin and non-JSON; degrades without a binding', async () => {
		expect((await call({ pseudo_id: PID, action: 'session_start' }, {}, 'https://evil.example')).status).toBe(403);
		const r = await call({ pseudo_id: PID, action: 'session_start' }, {});
		expect(r.json).toEqual({ ok: false, reason: 'no-db' });
	});

	it('soft-fails a D1 error', async () => {
		const db = fakeDb();
		db.prepare.mockImplementationOnce(() => {
			throw new Error('no such table: pseudo_events');
		});
		const r = await call({ pseudo_id: PID, action: 'session_start' }, { ANALYTICS_DB: db });
		expect(r).toEqual({ status: 200, json: { ok: false, reason: 'db-error' } });
	});
});
