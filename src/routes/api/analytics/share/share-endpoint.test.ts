// /api/analytics/share endpoint tests (quick-261122-sharefeed) — the share sheet's K-factor
// counters, under the totals-only data doctrine: every accepted field is an allowlisted enum, so no
// free text (a sender name, a track, an id) can reach metric_counters.
import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

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

function fakeEvent(body: unknown, env?: Record<string, unknown>, origin = 'https://openmusic.lol') {
	return {
		platform: { env: env ?? {} },
		request: new Request('https://openmusic.lol/api/analytics/share', {
			method: 'POST',
			headers: { origin, 'content-type': 'application/json' },
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = (e: unknown) => (POST as any)(e);

describe('POST /api/analytics/share', () => {
	it('folds a copy ping into (day, share_copy, promo:<lang>:<variant>)', async () => {
		const db = fakeDb();
		const res = await post(fakeEvent({ action: 'copy', lang: 'ja', variant: 'full' }, { ANALYTICS_DB: db }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(db.rows).toHaveLength(1);
		const [day, action, songId, title, artist, source] = db.rows[0];
		expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect([action, songId, title, artist, source]).toEqual(['share_copy', 'promo:ja:full', '', '', 'share']);
	});

	it('maps open / wa and defaults the variant to full', async () => {
		const db = fakeDb();
		await post(fakeEvent({ action: 'open', lang: 'yue' }, { ANALYTICS_DB: db }));
		await post(fakeEvent({ action: 'wa', lang: 'en', variant: 'full' }, { ANALYTICS_DB: db }));
		expect(db.rows.map((r) => [r[1], r[2]])).toEqual([
			['share_open', 'promo:yue:full'],
			['share_wa', 'promo:en:full']
		]);
	});

	it('refuses anything off the allowlists — free text never reaches the counter', async () => {
		const db = fakeDb();
		for (const body of [
			{ action: 'copy', lang: 'Hector Chan' },
			{ action: 'steal', lang: 'en' },
			{ action: 'copy', lang: 'en', variant: '阿明' },
			{ action: 'copy' }
		]) {
			const res = await post(fakeEvent(body, { ANALYTICS_DB: db }));
			expect(res.status).toBe(400);
		}
		expect(db.rows).toHaveLength(0);
	});

	it('extra fields (a name, an id) are ignored, never stored', async () => {
		const db = fakeDb();
		await post(fakeEvent({ action: 'copy', lang: 'en', sender: 'Secret', anon: 'x1' }, { ANALYTICS_DB: db }));
		expect(JSON.stringify(db.rows)).not.toContain('Secret');
		expect(JSON.stringify(db.rows)).not.toContain('x1');
	});

	it('refuses a foreign origin and degrades softly without the binding', async () => {
		const db = fakeDb();
		const res = await post(fakeEvent({ action: 'copy', lang: 'en' }, { ANALYTICS_DB: db }, 'https://evil.example'));
		expect(res.status).toBe(403);
		const noDb = await post(fakeEvent({ action: 'copy', lang: 'en' }));
		expect(await noDb.json()).toEqual({ ok: false, reason: 'no-db' });
	});
});
