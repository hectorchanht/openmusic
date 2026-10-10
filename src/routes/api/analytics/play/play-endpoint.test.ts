// /api/analytics/play endpoint tests — the POST status matrix driven through the
// exported verb handler, over a fake D1Database stand-in (prepare/bind/run chain).
// Covers the 12-column insert: client fields validated, device_type/os/country
// derived server-side from headers. Every reject path asserts the DB was not touched.
//
// What these CANNOT prove: that SvelteKit loads the module (a non-verb export 500s
// at request time), or that the real D1 binding is wired on the deploy — those are
// live checks.

import { describe, expect, it, vi } from 'vitest';
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
const ANDROID_UA =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

function fakeEvent(
	body: unknown,
	env?: Record<string, unknown>,
	opts: { origin?: string; ua?: string; country?: string } = {}
) {
	const url = new URL('https://openmusic.lol/api/analytics/play');
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

describe('POST /api/analytics/play', () => {
	it('inserts one 12-column row and answers ok:true on a valid ping', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent(
				{
					anon_id: 'a1',
					song_id: 'qq:123',
					title: 'T',
					artist: 'A',
					source: 'qq',
					platform: 'web',
					app_version: '1.4.0',
					locale: 'zh-Hant-HK'
				},
				{ ANALYTICS_DB: db },
				{ country: 'HK' }
			)
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(db.prepare).toHaveBeenCalledTimes(1);
		expect(db.rows).toHaveLength(1);
		const r = db.rows[0];
		expect(r.slice(0, 5)).toEqual(['a1', 'qq:123', 'T', 'A', 'qq']);
		expect(typeof r[5]).toBe('string'); // played_at, server-stamped ISO
		expect(Number.isNaN(Date.parse(r[5] as string))).toBe(false);
		expect(r[6]).toBe('desktop'); // derived from UA, not the body
		expect(r[7]).toBe('windows');
		expect(r[8]).toBe('web');
		expect(r[9]).toBe('1.4.0');
		expect(r[10]).toBe('zh-Hant-HK');
		expect(r[11]).toBe('HK'); // derived from CF-IPCountry, not the body
	});

	it('derives mobile/android from an Android UA even when the body disagrees', async () => {
		const db = fakeDb();
		const res = await post(
			fakeEvent(
				{ song_id: 'qq:1', platform: 'web', device_type: 'desktop', os: 'windows', country: 'US' },
				{ ANALYTICS_DB: db },
				{ ua: ANDROID_UA, country: 'CA' }
			)
		);
		expect(res.status).toBe(200);
		const r = db.rows[0];
		// Body-supplied device_type/os/country are IGNORED — server derivation wins.
		expect(r[6]).toBe('mobile');
		expect(r[7]).toBe('android');
		expect(r[8]).toBe('web'); // client-declared platform is trusted as sent
		expect(r[11]).toBe('CA');
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

	it('answers ok:false (still 200) when the insert throws', async () => {
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
		expect((db.rows[0][1] as string).length).toBe(256);
		expect((db.rows[0][2] as string).length).toBe(300);
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
