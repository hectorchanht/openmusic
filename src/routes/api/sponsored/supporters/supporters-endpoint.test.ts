// /api/sponsored/supporters endpoint tests — the GET mapping driven through
// the exported verb handler over a fake D1 stand-in (prepare/bind/all chain).
// Covers the public shape: ONLY { name, message?, month } leaves the server —
// the key_hash is never selected — plus the no-binding fail-soft.
//
// What these CANNOT prove: that SvelteKit loads the module, or that the real
// SUPPORTERS_DB binding is wired on the deploy — those are live checks.

import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

/** D1 stand-in returning fixed rows from all(). */
function fakeDb(rows: unknown[]) {
	const stmt = {
		bind: vi.fn(() => stmt),
		all: vi.fn(async () => ({ results: rows }))
	};
	return { stmt, prepare: vi.fn((_sql: string) => stmt) };
}

function fakeEvent(env?: Record<string, unknown>) {
	return {
		platform: { env: env ?? {} },
		request: new Request('https://openmusic.lol/api/sponsored/supporters')
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = (e: unknown) => (GET as any)(e);

describe('GET /api/sponsored/supporters', () => {
	it('maps rows to { name, message, month } and omits an empty message', async () => {
		const db = fakeDb([
			{ display_name: 'Ada', message: 'Love it', created_at: '2026-10-05T12:00:00.000Z' },
			{ display_name: 'Ben', message: '', created_at: '2026-09-01T00:30:00.000Z' }
		]);
		const res = await get(fakeEvent({ SUPPORTERS_DB: db }));
		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(data.supporters).toEqual([
			{ name: 'Ada', message: 'Love it', month: 'October 2026' },
			{ name: 'Ben', month: 'September 2026' }
		]);
		// The row key must never be part of the query's output contract.
		expect(db.prepare.mock.calls[0][0]).not.toContain('key_hash');
	});

	it('answers an empty list before the binding exists', async () => {
		const res = await get(fakeEvent({}));
		const data = await res.json();
		expect(data.ok).toBe(false);
		expect(data.reason).toBe('no-db');
		expect(data.supporters).toEqual([]);
	});

	it('answers an empty list on a D1 error instead of throwing', async () => {
		const stmt = {
			bind: vi.fn(() => stmt),
			all: vi.fn(async () => {
				throw new Error('d1 down');
			})
		};
		const db = { prepare: vi.fn(() => stmt) };
		const res = await get(fakeEvent({ SUPPORTERS_DB: db }));
		const data = await res.json();
		expect(data.ok).toBe(false);
		expect(data.supporters).toEqual([]);
	});
});
