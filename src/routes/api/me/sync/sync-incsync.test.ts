// /api/me/sync per-key incremental tests (quick-261020-incsync) — partial PUTs upsert
// only their keys (no read-modify-write, so concurrent devices can't clobber each other),
// null deletes a key, legacy full-envelope PUTs still work, and GET assembles from rows
// (falling back to the legacy user_sync table).

import { describe, expect, it } from 'vitest';
import { sha256hex } from '$lib/auth/auth-core';
import { GET, PUT } from './+server';

const UID = 'u1';
const TOKEN = 'a'.repeat(64);

function fakeDb() {
	const keyRows = new Map<string, { data: string; updated_at: number }>();
	let legacy: { data: string; updated_at: number } | null = null;
	const tokenHash = new Map<string, string>();
	const prepare = (sql: string) => {
		let args: unknown[] = [];
		const stmt = {
			bind(...a: unknown[]) {
				args = a;
				return stmt;
			},
			async first() {
				if (sql.startsWith('SELECT s.user_id AS id')) {
					const uid = tokenHash.get(args[0] as string);
					return uid ? { id: uid, email: 't@x.invalid' } : null;
				}
				if (sql.startsWith('SELECT data, updated_at FROM user_sync WHERE')) {
					return legacy;
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
				}
				return { success: true };
			}
		};
		return stmt;
	};
	return {
		prepare,
		async batch(stmts: { run(): Promise<unknown> }[]) {
			for (const s of stmts) await s.run();
			return [];
		},
		_keyRows: keyRows,
		_setLegacy(v: typeof legacy) {
			legacy = v;
		},
		async _addSession() {
			tokenHash.set(await sha256hex('session:' + TOKEN), UID);
		}
	};
}

function req(method: string, body?: unknown, bearer = true) {
	return new Request('https://openmusic.lol/api/me/sync', {
		method,
		headers: {
			'content-type': 'application/json',
			...(bearer ? { authorization: `Bearer ${TOKEN}` } : {})
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

const platform = (db: ReturnType<typeof fakeDb>) => ({ env: { ACCOUNTS_DB: db } }) as never;

describe('PUT { keys } (incremental)', () => {
	it('upserts only the pushed keys and GET assembles them', async () => {
		const db = fakeDb();
		await db._addSession();
		const put = await PUT({ request: req('PUT', { keys: { 'openmusic:history:v1': [1] } }), platform: platform(db) } as never);
		expect(put.status).toBe(200);
		const get = await GET({ request: req('GET'), platform: platform(db) } as never);
		const body = (await get.json()) as { envelope: { keys: Record<string, unknown> } };
		expect(body.envelope.keys).toEqual({ 'openmusic:history:v1': [1] });
	});

	it('a second partial push merges without clobbering the first', async () => {
		const db = fakeDb();
		await db._addSession();
		const p = platform(db);
		await PUT({ request: req('PUT', { keys: { 'openmusic:history:v1': [1] } }), platform: p } as never);
		await PUT({ request: req('PUT', { keys: { 'openmusic:settings:v1': { a: 1 } } }), platform: p } as never);
		const get = await GET({ request: req('GET'), platform: p } as never);
		const body = (await get.json()) as { envelope: { keys: Record<string, unknown> } };
		expect(body.envelope.keys).toEqual({ 'openmusic:history:v1': [1], 'openmusic:settings:v1': { a: 1 } });
	});

	it('null deletes the key', async () => {
		const db = fakeDb();
		await db._addSession();
		const p = platform(db);
		await PUT({ request: req('PUT', { keys: { 'openmusic:history:v1': [1] } }), platform: p } as never);
		await PUT({ request: req('PUT', { keys: { 'openmusic:history:v1': null } }), platform: p } as never);
		const get = await GET({ request: req('GET'), platform: p } as never);
		const body = (await get.json()) as { envelope: unknown };
		expect(body.envelope).toBeNull();
	});

	it('rejects a disallowed key and a bad shape', async () => {
		const db = fakeDb();
		await db._addSession();
		const p = platform(db);
		const bad1 = await PUT({ request: req('PUT', { keys: { 'openmusic:player:v1': {} } }), platform: p } as never);
		expect(bad1.status).toBe(400);
		const bad2 = await PUT({ request: req('PUT', { keys: { 'openmusic:history:v1': 'nope' } }), platform: p } as never);
		expect(bad2.status).toBe(400);
	});

	it('legacy { envelope } PUT still works (split into rows)', async () => {
		const db = fakeDb();
		await db._addSession();
		const p = platform(db);
		const env = { app: 'openmusic-backup', format: 1, exportedAt: new Date().toISOString(), keys: { 'openmusic:history:v1': [9] } };
		const put = await PUT({ request: req('PUT', { envelope: env }), platform: p } as never);
		expect(put.status).toBe(200);
		const get = await GET({ request: req('GET'), platform: p } as never);
		const body = (await get.json()) as { envelope: { keys: Record<string, unknown> } };
		expect(body.envelope.keys).toEqual({ 'openmusic:history:v1': [9] });
	});

	it('GET falls back to the legacy user_sync table', async () => {
		const db = fakeDb();
		await db._addSession();
		db._setLegacy({ data: JSON.stringify({ keys: { 'openmusic:history:v1': [7] } }), updated_at: 5 });
		const get = await GET({ request: req('GET'), platform: platform(db) } as never);
		const body = (await get.json()) as { envelope: { keys: Record<string, unknown> }; updatedAt: number };
		expect(body.envelope.keys).toEqual({ 'openmusic:history:v1': [7] });
		expect(body.updatedAt).toBe(5);
	});

	it('401 without a session', async () => {
		const db = fakeDb();
		const put = await PUT({ request: req('PUT', { keys: {} }, false), platform: platform(db) } as never);
		expect(put.status).toBe(401);
	});
});
