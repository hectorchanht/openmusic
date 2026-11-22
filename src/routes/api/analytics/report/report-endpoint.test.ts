// /api/analytics/report endpoint tests (quick-261122-pseudo): FAIL-CLOSED
// bearer gate (an unset ANALYTICS_READ_TOKEN rejects everything; the DIAG
// tokens are not accepted), 503 without a binding, aggregates on success.

import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

function fakeDb(rows: Record<string, unknown>[] = []) {
	const stmt = {
		bind: vi.fn(() => stmt),
		all: vi.fn(async () => ({ results: rows, success: true, meta: {} }))
	};
	return { prepare: vi.fn(() => stmt) };
}

async function call(auth: string | null, env: Record<string, unknown>) {
	const headers: Record<string, string> = {};
	if (auth) headers.authorization = auth;
	const res = await GET({
		url: new URL('https://openmusic.lol/api/analytics/report'),
		request: new Request('https://openmusic.lol/api/analytics/report', { headers }),
		platform: { env }
	} as unknown as Parameters<typeof GET>[0]);
	return { status: res.status, json: (await res.json()) as Record<string, unknown>, res };
}

describe('GET /api/analytics/report', () => {
	it('fails closed when the read token is unset', async () => {
		const r = await call('Bearer anything', { ANALYTICS_DB: fakeDb() });
		expect(r.status).toBe(401);
	});

	it('rejects a wrong token and the diag tokens', async () => {
		const env = { ANALYTICS_READ_TOKEN: 'right', DIAG_READ_TOKEN: 'diag', ANALYTICS_DB: fakeDb() };
		expect((await call('Bearer wrong', env)).status).toBe(401);
		expect((await call('Bearer diag', env)).status).toBe(401);
		expect((await call(null, env)).status).toBe(401);
	});

	it('503 without a binding', async () => {
		expect((await call('Bearer right', { ANALYTICS_READ_TOKEN: 'right' })).status).toBe(503);
	});

	it('returns the aggregate report, uncached', async () => {
		const r = await call('Bearer right', { ANALYTICS_READ_TOKEN: 'right', ANALYTICS_DB: fakeDb() });
		expect(r.status).toBe(200);
		expect(r.json.ok).toBe(true);
		expect(r.res.headers.get('cache-control')).toBe('no-store');
	});
});
