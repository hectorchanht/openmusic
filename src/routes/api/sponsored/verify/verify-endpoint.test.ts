// /api/sponsored/verify endpoint tests — the POST status matrix driven through
// the exported verb handler, with the Gumroad upstream stubbed at global fetch
// and a fake D1 stand-in (prepare/bind/run chain) capturing wall writes.
// Covers the 2026-10-24 supporters-wall contract: opt-in upsert (sanitized,
// keyed by the key's SHA-256 — never the raw key), explicit opt-out delete,
// absent fields = wall untouched, and an invalid key touching nothing.
//
// What these CANNOT prove: that SvelteKit loads the module (a non-verb export
// 500s at request time), or that the real SUPPORTERS_DB binding is wired on
// the deploy — those are live checks.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

/** D1 stand-in: prepare(sql) → { bind(...).run() }, capturing sql + params. */
function fakeDb() {
	const calls: { sql: string; params: unknown[] }[] = [];
	const prepare = vi.fn((sql: string) => {
		const stmt = {
			bind: vi.fn((...params: unknown[]) => {
				calls.push({ sql, params });
				return stmt;
			}),
			run: vi.fn(async () => ({ success: true, meta: {} }))
		};
		return stmt;
	});
	return { calls, prepare };
}

function stubGumroad(payload: unknown) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: true, json: async () => payload }))
	);
}

function fakeEvent(body: unknown, env?: Record<string, unknown>) {
	return {
		platform: { env: env ?? {} },
		request: new Request('https://openmusic.lol/api/sponsored/verify', {
			method: 'POST',
			headers: { origin: 'https://openmusic.lol', 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = (e: unknown) => (POST as any)(e);

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/sponsored/verify — supporters wall', () => {
	it('rejects an invalid key and never touches the wall DB', async () => {
		stubGumroad({ success: false });
		const db = fakeDb();
		const res = await post(
			fakeEvent(
				{ license_key: 'FAKE-KEY', public_wall: true, display_name: 'Ada' },
				{ SUPPORTERS_DB: db }
			)
		);
		const data = await res.json();
		expect(data.ok).toBe(false);
		expect(data.reason).toBe('invalid');
		expect(db.prepare).not.toHaveBeenCalled();
	});

	it('upserts a sanitized wall row on opt-in, keyed by key hash', async () => {
		stubGumroad({ success: true, purchase: {} });
		const db = fakeDb();
		const res = await post(
			fakeEvent(
				{
					license_key: 'REAL-KEY-1234',
					public_wall: true,
					display_name: 'Ada <b>Lovelace</b>',
					message: '  Love   this app!  '
				},
				{ SUPPORTERS_DB: db }
			)
		);
		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(data.wall).toBe(true);
		expect(db.calls).toHaveLength(1);
		expect(db.calls[0].sql).toContain('INSERT INTO supporters');
		const [hash, name, message] = db.calls[0].params as string[];
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(hash).not.toBe('REAL-KEY-1234');
		expect(name).toBe('Ada b Lovelace /b');
		expect(message).toBe('Love this app!');
	});

	it('deletes the wall row on an explicit opt-out re-verify', async () => {
		stubGumroad({ success: true, purchase: {} });
		const db = fakeDb();
		const res = await post(
			fakeEvent({ license_key: 'REAL-KEY-1234', public_wall: false }, { SUPPORTERS_DB: db })
		);
		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(data.wall).toBeUndefined();
		expect(db.calls).toHaveLength(1);
		expect(db.calls[0].sql).toContain('DELETE FROM supporters');
	});

	it('leaves the wall untouched when the fields are absent (old client)', async () => {
		stubGumroad({ success: true, purchase: {} });
		const db = fakeDb();
		const res = await post(
			fakeEvent({ license_key: 'REAL-KEY-1234' }, { SUPPORTERS_DB: db })
		);
		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(data.wall).toBeUndefined();
		expect(db.prepare).not.toHaveBeenCalled();
	});

	it('verifies fine with no SUPPORTERS_DB binding at all', async () => {
		stubGumroad({ success: true, purchase: {} });
		const res = await post(
			fakeEvent(
				{ license_key: 'REAL-KEY-1234', public_wall: true, display_name: 'Ada' },
				{}
			)
		);
		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(data.wall).toBeUndefined();
	});
});
