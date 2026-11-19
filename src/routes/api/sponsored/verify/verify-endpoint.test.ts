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
import { sha256hex } from '$lib/auth/auth-core';
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

function fakeEvent(body: unknown, env?: Record<string, unknown>, headers?: Record<string, string>) {
	return {
		platform: { env: env ?? {} },
		request: new Request('https://openmusic.lol/api/sponsored/verify', {
			method: 'POST',
			headers: { origin: 'https://openmusic.lol', 'content-type': 'application/json', ...(headers ?? {}) },
			body: JSON.stringify(body)
		})
	};
}

// --- quick-261119-tipbind: in-memory ACCOUNTS_DB stand-in ----------------------
// Exactly the statements the account binding issues: the session join
// (auth-core getUserFromRequest) + the account_supporters claim statements
// (supporter-core). INSERT enforces the PK/UNIQUE constraints like real D1.

interface SupporterRow {
	user_id: string;
	key_hash: string;
	tier: string;
	verified_at: string;
}

function fakeAccountsDb() {
	const users = new Map<string, { id: string; email: string }>();
	const sessions = new Map<string, { user_id: string; expires_at: number }>();
	const supporters = new Map<string, SupporterRow>();
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
				if (sql.startsWith('SELECT user_id, key_hash, tier FROM account_supporters')) {
					return supporters.get(args[0] as string) ?? null;
				}
				if (sql.startsWith('SELECT user_id FROM account_supporters')) {
					return [...supporters.values()].find((r) => r.key_hash === args[0]) ?? null;
				}
				if (sql.startsWith('SELECT tier, verified_at FROM account_supporters')) {
					const r = supporters.get(args[0] as string);
					return r ? { tier: r.tier, verified_at: r.verified_at } : null;
				}
				return null;
			},
			async run() {
				if (sql.startsWith('INSERT INTO account_supporters')) {
					const [user_id, key_hash, tier, verified_at] = args as string[];
					if (supporters.has(user_id) || [...supporters.values()].some((r) => r.key_hash === key_hash)) {
						throw new Error('UNIQUE constraint failed');
					}
					supporters.set(user_id, { user_id, key_hash, tier, verified_at });
				} else if (sql.startsWith('UPDATE account_supporters SET tier')) {
					const r = supporters.get(args[1] as string);
					if (r) r.tier = args[0] as string;
				} else if (sql.startsWith('DELETE FROM account_supporters')) {
					const r = supporters.get(args[0] as string);
					if (r && r.key_hash === args[1]) supporters.delete(args[0] as string);
				}
				return { success: true };
			}
		};
		return stmt;
	};
	/** Seed a signed-in user: user row + a live session for the raw token. */
	async function seedSession(id: string, email: string, rawToken: string) {
		users.set(id, { id, email });
		sessions.set(await sha256hex('session:' + rawToken), { user_id: id, expires_at: Date.now() + 60_000 });
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { db: { prepare } as any, supporters, seedSession };
}

const TOKEN_1 = '1'.repeat(64);
const TOKEN_2 = '2'.repeat(64);
const cookie1 = { cookie: `openmusic_session=${TOKEN_1}` };
const cookie2 = { cookie: `openmusic_session=${TOKEN_2}` };

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

// quick-261119-tipbind: the claim is recorded against the signed-in account so
// the user never re-enters the key on another device. Best-effort throughout:
// the verify answer never depends on the claim outcome.
describe('POST /api/sponsored/verify — supporter account binding (quick-261119-tipbind)', () => {
	it('a signed-in verify records the claim (key stored ONLY as its SHA-256) and answers account:true', async () => {
		stubGumroad({ success: true, purchase: {} });
		const acc = fakeAccountsDb();
		await acc.seedSession('user-1', 'a@b.co', TOKEN_1);
		const res = await post(fakeEvent({ license_key: 'REAL-KEY-1234' }, { ACCOUNTS_DB: acc.db }, cookie1));
		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(data.account).toBe(true);
		expect(acc.supporters.size).toBe(1);
		const row = acc.supporters.get('user-1');
		expect(row?.key_hash).toBe(await sha256hex('REAL-KEY-1234'));
		expect(row?.key_hash).not.toBe('REAL-KEY-1234');
		expect(row?.tier).toBe('bronze');
		expect(row?.verified_at).toBeTruthy();
	});

	it('a second verify by the SAME user (second device) stays account:true with ONE claim row', async () => {
		stubGumroad({ success: true, purchase: {} });
		const acc = fakeAccountsDb();
		await acc.seedSession('user-1', 'a@b.co', TOKEN_1);
		await post(fakeEvent({ license_key: 'REAL-KEY-1234' }, { ACCOUNTS_DB: acc.db }, cookie1));
		const res = await post(fakeEvent({ license_key: 'REAL-KEY-1234' }, { ACCOUNTS_DB: acc.db }, cookie1));
		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(data.account).toBe(true);
		expect(acc.supporters.size).toBe(1);
	});

	it('the SAME key under a DIFFERENT account verifies but claims nothing (key-in-use, never stolen)', async () => {
		stubGumroad({ success: true, purchase: {} });
		const acc = fakeAccountsDb();
		await acc.seedSession('user-1', 'a@b.co', TOKEN_1);
		await acc.seedSession('user-2', 'c@d.co', TOKEN_2);
		await post(fakeEvent({ license_key: 'REAL-KEY-1234' }, { ACCOUNTS_DB: acc.db }, cookie1));
		const res = await post(fakeEvent({ license_key: 'REAL-KEY-1234' }, { ACCOUNTS_DB: acc.db }, cookie2));
		const data = await res.json();
		// The key IS valid, so the verify itself still passes — only the claim is refused.
		expect(data.ok).toBe(true);
		expect(data.account).toBeUndefined();
		expect(acc.supporters.size).toBe(1);
		expect(acc.supporters.get('user-1')?.key_hash).toBe(await sha256hex('REAL-KEY-1234'));
		expect(acc.supporters.has('user-2')).toBe(false);
	});

	it('a refunded verify revokes the session user’s claim for that key', async () => {
		const acc = fakeAccountsDb();
		await acc.seedSession('user-1', 'a@b.co', TOKEN_1);
		stubGumroad({ success: true, purchase: {} });
		await post(fakeEvent({ license_key: 'REAL-KEY-1234' }, { ACCOUNTS_DB: acc.db }, cookie1));
		expect(acc.supporters.size).toBe(1);
		stubGumroad({ success: true, purchase: { refunded: true } });
		const res = await post(fakeEvent({ license_key: 'REAL-KEY-1234' }, { ACCOUNTS_DB: acc.db }, cookie1));
		const data = await res.json();
		expect(data.ok).toBe(false);
		expect(data.reason).toBe('refunded');
		expect(acc.supporters.size).toBe(0);
	});

	it('an anonymous verify is unchanged: ok, no account field, no claim (even with ACCOUNTS_DB bound)', async () => {
		stubGumroad({ success: true, purchase: {} });
		const acc = fakeAccountsDb();
		await acc.seedSession('user-1', 'a@b.co', TOKEN_1);
		const res = await post(fakeEvent({ license_key: 'REAL-KEY-1234' }, { ACCOUNTS_DB: acc.db }));
		const data = await res.json();
		expect(data).toEqual({ ok: true });
		expect(acc.supporters.size).toBe(0);
	});

	it('a signed-in verify with NO ACCOUNTS_DB binding is unchanged (no account field)', async () => {
		stubGumroad({ success: true, purchase: {} });
		const res = await post(fakeEvent({ license_key: 'REAL-KEY-1234' }, {}, cookie1));
		const data = await res.json();
		expect(data).toEqual({ ok: true });
	});
});
