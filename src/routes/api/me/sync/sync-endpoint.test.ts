// /api/me/sync endpoint tests (quick-261020-acct) — auth gating, the empty-baseline read,
// a PUT → GET round trip through the real validateEnvelope gate, and the reject matrix,
// driven through the exported verb handlers over an in-memory D1 stand-in.

import { describe, expect, it } from 'vitest';
import { sha256hex } from '$lib/auth/auth-core';
import { BACKUP_MAGIC, BACKUP_FORMAT } from '$lib/backup/backup-logic';
import { GET, PUT } from './+server';

// --- in-memory D1 stand-in: sessions + users (for auth) + user_sync ---------------------

function fakeDb() {
	const users = new Map<string, { id: string; email: string }>();
	const sessions = new Map<string, { user_id: string; expires_at: number }>();
	const sync = new Map<string, { data: string; updated_at: number }>();
	const keyRows = new Map<string, { data: string; updated_at: number }>();
	const prepare = (sql: string) => {
		let args: unknown[] = [];
		const stmt = {
			bind(...a: unknown[]) {
				args = a;
				return stmt;
			},
			async first() {
				if (sql.startsWith('SELECT s.user_id AS id')) {
					const s = sessions.get(args[0] as string);
					if (!s || s.expires_at <= (args[1] as number)) return null;
					const u = users.get(s.user_id);
					return u ? { id: u.id, email: u.email } : null;
				}
				if (sql.startsWith('SELECT data, updated_at FROM user_sync')) {
					return sync.get(args[0] as string) ?? null;
				}
				return null;
			},
			async all() {
				if (sql.startsWith('SELECT key AS k, data, updated_at FROM user_sync_keys')) {
					const out: { k: string; data: string; updated_at: number }[] = [];
					for (const [k, v] of keyRows) {
						const [uid, key] = k.split('|');
						if (uid === (args[0] as string)) out.push({ k: key, data: v.data, updated_at: v.updated_at });
					}
					return { results: out };
				}
				return { results: [] };
			},
			async run() {
				if (sql.startsWith('INSERT INTO user_sync_keys')) {
					const [uid, key, data, updated_at] = args as [string, string, string, number];
					keyRows.set(uid + '|' + key, { data, updated_at });
				} else if (sql.startsWith('DELETE FROM user_sync_keys')) {
					keyRows.delete((args[0] as string) + '|' + (args[1] as string));
				} else if (sql.startsWith('INSERT INTO user_sync')) {
					sync.set(args[0] as string, { data: args[1] as string, updated_at: args[2] as number });
				}
				return { success: true };
			}
		};
		return stmt;
	};
	const batch = async (stmts: { run(): Promise<unknown> }[]) => {
		for (const s of stmts) await s.run();
		return [];
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { db: { prepare, batch } as any, users, sessions, sync, keyRows };
}

type Db = ReturnType<typeof fakeDb>;

const TOKEN = 'e'.repeat(64);

async function seededDb(): Promise<Db> {
	const f = fakeDb();
	f.users.set('u1', { id: 'u1', email: 'a@b.co' });
	f.sessions.set(await sha256hex('session:' + TOKEN), { user_id: 'u1', expires_at: Date.now() + 60_000 });
	return f;
}

function fakeEvent(method: 'GET' | 'PUT', opts: { body?: string; headers?: Record<string, string>; env?: Record<string, unknown> } = {}) {
	const url = new URL('https://openmusic.lol/api/me/sync');
	const headers: Record<string, string> = {
		origin: 'https://openmusic.lol',
		cookie: `openmusic_session=${TOKEN}`,
		...(method === 'PUT' ? { 'content-type': 'application/json' } : {}),
		...(opts.headers ?? {})
	};
	for (const [h, v] of Object.entries(headers)) if (v === '') delete headers[h];
	return {
		url,
		platform: opts.env ? { env: opts.env } : undefined,
		request: new Request(url, { method, headers, body: opts.body }),
		getClientAddress: () => '1.2.3.4'
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callGET = (e: ReturnType<typeof fakeEvent>) => GET(e as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callPUT = (e: ReturnType<typeof fakeEvent>) => PUT(e as any);

const validEnvelope = () => ({
	app: BACKUP_MAGIC,
	format: BACKUP_FORMAT,
	exportedAt: '2026-10-20T00:00:00.000Z',
	keys: { 'openmusic:settings:v1': { theme: 'light' } }
});

describe('GET /api/me/sync', () => {
	it('no session → 401; bearer works too', async () => {
		const f = await seededDb();
		const anon = await callGET(fakeEvent('GET', { headers: { cookie: '' }, env: { ACCOUNTS_DB: f.db } }));
		expect(anon.status).toBe(401);
		expect(await anon.json()).toEqual({ ok: false, err: 'unauthorized' });

		const bearer = await callGET(
			fakeEvent('GET', { headers: { cookie: '', authorization: `Bearer ${TOKEN}` }, env: { ACCOUNTS_DB: f.db } })
		);
		expect(bearer.status).toBe(200);
	});

	it('no binding → 503', async () => {
		const res = await callGET(fakeEvent('GET', { env: {} }));
		expect(res.status).toBe(503);
	});

	it('never synced → { envelope:null, updatedAt:null }', async () => {
		const f = await seededDb();
		const res = await callGET(fakeEvent('GET', { env: { ACCOUNTS_DB: f.db } }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, envelope: null, updatedAt: null });
	});
});

describe('PUT /api/me/sync', () => {
	it('no session → 401, nothing stored', async () => {
		const f = await seededDb();
		const res = await callPUT(
			fakeEvent('PUT', { body: JSON.stringify({ envelope: validEnvelope() }), headers: { cookie: '' }, env: { ACCOUNTS_DB: f.db } })
		);
		expect(res.status).toBe(401);
		expect(f.sync.size).toBe(0);
	});

	it('round trip: PUT stores the VALIDATED envelope, GET returns it with updatedAt', async () => {
		const f = await seededDb();
		const env = { ACCOUNTS_DB: f.db };
		const put = await callPUT(fakeEvent('PUT', { body: JSON.stringify({ envelope: validEnvelope() }), env }));
		expect(put.status).toBe(200);
		const putBody = (await put.json()) as { ok: boolean; updatedAt: number };
		expect(putBody.ok).toBe(true);
		expect(typeof putBody.updatedAt).toBe('number');

		const get = await callGET(fakeEvent('GET', { env }));
		const getBody = (await get.json()) as { ok: boolean; envelope: ReturnType<typeof validEnvelope>; updatedAt: number };
		expect(getBody.envelope.keys['openmusic:settings:v1']).toEqual({ theme: 'light' });
		expect(getBody.updatedAt).toBe(putBody.updatedAt);

		// A second PUT overwrites (last-write-wins) and bumps updatedAt.
		const env2 = validEnvelope();
		env2.keys['openmusic:settings:v1'] = { theme: 'dark' };
		const put2 = await callPUT(fakeEvent('PUT', { body: JSON.stringify({ envelope: env2 }), env }));
		expect(put2.status).toBe(200);
		// quick-261020-incsync: storage is per-key rows now, not one envelope blob.
		const stored = JSON.parse(f.keyRows.get('u1|openmusic:settings:v1')!.data);
		expect(stored).toEqual({ theme: 'dark' });
	});

	it('a foreign Origin → 403; a non-JSON type → 415', async () => {
		const f = await seededDb();
		const a = await callPUT(
			fakeEvent('PUT', { body: '{}', headers: { origin: 'https://evil.example' }, env: { ACCOUNTS_DB: f.db } })
		);
		expect(a.status).toBe(403);
		const b = await callPUT(
			fakeEvent('PUT', { body: '{}', headers: { 'content-type': 'text/plain' }, env: { ACCOUNTS_DB: f.db } })
		);
		expect(b.status).toBe(415);
		expect(f.sync.size).toBe(0);
	});

	it('an envelope the validator refuses → 400 invalid-envelope, nothing stored', async () => {
		const f = await seededDb();
		for (const envelope of [
			{ app: 'something-else', format: 1, keys: {} }, // not ours
			{ app: BACKUP_MAGIC, format: 99, keys: {} }, // newer format
			{ app: BACKUP_MAGIC, format: 1, keys: { 'openmusic:library:v1': { liked: 5 } } }, // hostile shape
			'just a string',
			42
		]) {
			const res = await callPUT(
				fakeEvent('PUT', { body: JSON.stringify({ envelope }), env: { ACCOUNTS_DB: f.db } })
			);
			expect(res.status, JSON.stringify(envelope)).toBe(400);
			expect(await res.json()).toEqual({ ok: false, err: 'invalid-envelope' });
		}
		expect(f.sync.size).toBe(0);
	});

	it('a missing envelope field → 400 invalid; malformed JSON → 400 invalid', async () => {
		const f = await seededDb();
		const a = await callPUT(fakeEvent('PUT', { body: '{}', env: { ACCOUNTS_DB: f.db } }));
		expect(a.status).toBe(400);
		expect(await a.json()).toEqual({ ok: false, err: 'invalid' });
		const b = await callPUT(fakeEvent('PUT', { body: 'not json', env: { ACCOUNTS_DB: f.db } }));
		expect(b.status).toBe(400);
	});

	it('an oversize declared length → 413 before any read of the store', async () => {
		const f = await seededDb();
		const res = await callPUT(
			fakeEvent('PUT', {
				body: JSON.stringify({ envelope: validEnvelope() }),
				headers: { 'content-length': String(3 * 1024 * 1024) },
				env: { ACCOUNTS_DB: f.db }
			})
		);
		expect(res.status).toBe(413);
		expect(f.sync.size).toBe(0);
	});
});
