// /api/auth/* endpoint tests (quick-261020-acct) — the magic-link → verify → session →
// logout flow driven through the exported verb handlers over an in-memory D1 stand-in
// (harness follows comments-endpoint.test.ts). Resend is a stubbed global fetch.
//
// What these CANNOT prove: that SvelteKit loads the modules (a non-verb export 500s at
// request time) or that Resend accepts the key — those are live checks.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256hex } from '$lib/auth/auth-core';
import { POST as magicLinkPOST } from './magic-link/+server';
import { POST as verifyPOST } from './verify/+server';
import { GET as sessionGET } from './session/+server';
import { POST as logoutPOST } from './logout/+server';

// --- in-memory D1 stand-in: exactly the statements the auth routes issue -----------------

interface MagicRow {
	email: string;
	expires_at: number;
	used: number;
}
interface RateRow {
	count: number;
	window_start: number;
}

function fakeDb() {
	const users = new Map<string, { id: string; email: string }>();
	const usersByEmail = new Map<string, { id: string; email: string }>();
	const magic = new Map<string, MagicRow>();
	const sessions = new Map<string, { user_id: string; expires_at: number }>();
	const rates = new Map<string, RateRow>();
	const prepare = (sql: string) => {
		let args: unknown[] = [];
		const stmt = {
			bind(...a: unknown[]) {
				args = a;
				return stmt;
			},
			async first() {
				if (sql.startsWith('SELECT count, window_start FROM rate_limits')) {
					return rates.get(args[0] as string) ?? null;
				}
				if (sql.startsWith('SELECT email, expires_at, used FROM magic_tokens')) {
					return magic.get(args[0] as string) ?? null;
				}
				if (sql.startsWith('SELECT id, email FROM users WHERE email')) {
					return usersByEmail.get(args[0] as string) ?? null;
				}
				if (sql.startsWith('SELECT s.user_id AS id')) {
					const s = sessions.get(args[0] as string);
					if (!s || s.expires_at <= (args[1] as number)) return null;
					const u = users.get(s.user_id);
					return u ? { id: u.id, email: u.email } : null;
				}
				return null;
			},
			async run() {
				if (sql.startsWith('INSERT OR REPLACE INTO rate_limits')) {
					rates.set(args[0] as string, { count: 1, window_start: args[1] as number });
				} else if (sql.startsWith('UPDATE rate_limits SET count = count + 1')) {
					const r = rates.get(args[0] as string);
					if (r) r.count += 1;
				} else if (sql.startsWith('INSERT INTO magic_tokens')) {
					magic.set(args[0] as string, { email: args[1] as string, expires_at: args[2] as number, used: 0 });
				} else if (sql.startsWith('DELETE FROM magic_tokens')) {
					magic.delete(args[0] as string);
				} else if (sql.startsWith('UPDATE magic_tokens SET used = 1')) {
					const m = magic.get(args[0] as string);
					if (m) m.used = 1;
				} else if (sql.startsWith('INSERT INTO users')) {
					const u = { id: args[0] as string, email: args[1] as string };
					users.set(u.id, u);
					usersByEmail.set(u.email, u);
				} else if (sql.startsWith('INSERT INTO sessions')) {
					sessions.set(args[0] as string, { user_id: args[1] as string, expires_at: args[2] as number });
				} else if (sql.startsWith('DELETE FROM sessions')) {
					sessions.delete(args[0] as string);
				}
				return { success: true };
			}
		};
		return stmt;
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { db: { prepare } as any, users, usersByEmail, magic, sessions, rates };
}

type Db = ReturnType<typeof fakeDb>;

interface EventOpts {
	body?: string;
	headers?: Record<string, string>;
	env?: Record<string, unknown>;
	path?: string;
}

function fakeEvent(opts: EventOpts = {}) {
	const url = new URL(`https://openmusic.lol${opts.path ?? '/api/auth/magic-link'}`);
	const headers: Record<string, string> = {
		origin: 'https://openmusic.lol',
		'content-type': 'application/json',
		...(opts.headers ?? {})
	};
	for (const [h, v] of Object.entries(headers)) if (v === '') delete headers[h];
	return {
		url,
		platform: opts.env ? { env: opts.env } : undefined,
		request: new Request(url, { method: 'POST', headers, body: opts.body }),
		getClientAddress: () => '1.2.3.4'
	};
}

function fakeGetEvent(opts: { headers?: Record<string, string>; env?: Record<string, unknown> } = {}) {
	const url = new URL('https://openmusic.lol/api/auth/session');
	return {
		url,
		platform: opts.env ? { env: opts.env } : undefined,
		request: new Request(url, { method: 'GET', headers: { origin: 'https://openmusic.lol', ...(opts.headers ?? {}) } }),
		getClientAddress: () => '1.2.3.4'
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callMagic = (e: ReturnType<typeof fakeEvent>) => magicLinkPOST(e as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callVerify = (e: ReturnType<typeof fakeEvent>) => verifyPOST(e as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callSession = (e: ReturnType<typeof fakeGetEvent>) => sessionGET(e as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callLogout = (e: ReturnType<typeof fakeEvent>) => logoutPOST(e as any);

const env = (f: Db, extra: Record<string, unknown> = {}) => ({
	ACCOUNTS_DB: f.db,
	RESEND_API_KEY: 'rk-test',
	...extra
});

/** Resend stand-in: captures calls, answers `status`. */
function stubResend(status = 200) {
	const f = vi.fn(async (..._a: unknown[]) => new Response('{}', { status }));
	vi.stubGlobal('fetch', f);
	return f;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('POST /api/auth/magic-link', () => {
	it('a malformed email → 400 invalid-email, nothing stored, no send', async () => {
		const send = stubResend();
		const f = fakeDb();
		const res = await callMagic(fakeEvent({ body: JSON.stringify({ email: 'nope' }), env: env(f) }));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ ok: false, err: 'invalid-email' });
		expect(f.magic.size).toBe(0);
		expect(send).not.toHaveBeenCalled();
	});

	it('a foreign Origin → 403 before anything else', async () => {
		const f = fakeDb();
		const res = await callMagic(
			fakeEvent({ body: JSON.stringify({ email: 'a@b.co' }), headers: { origin: 'https://evil.example' }, env: env(f) })
		);
		expect(res.status).toBe(403);
		expect(f.magic.size).toBe(0);
	});

	it('no binding → 503; no RESEND_API_KEY → 500 not-configured and NO token row (fail closed)', async () => {
		const a = await callMagic(fakeEvent({ body: JSON.stringify({ email: 'a@b.co' }), env: {} }));
		expect(a.status).toBe(503);

		const f = fakeDb();
		const b = await callMagic(fakeEvent({ body: JSON.stringify({ email: 'a@b.co' }), env: env(f, { RESEND_API_KEY: undefined }) }));
		expect(b.status).toBe(500);
		expect(await b.json()).toEqual({ ok: false, err: 'not-configured' });
		expect(f.magic.size).toBe(0);
	});

	it('happy path: token row stored HASHED, email sent with the /auth/magic link', async () => {
		const send = stubResend();
		const f = fakeDb();
		const res = await callMagic(fakeEvent({ body: JSON.stringify({ email: 'User@Example.com ' }), env: env(f) }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(f.magic.size).toBe(1);
		const [[hash, row]] = [...f.magic.entries()];
		expect(row.email).toBe('user@example.com'); // trimmed + lowercased
		expect(row.used).toBe(0);
		expect(row.expires_at).toBeGreaterThan(Date.now());
		expect(send).toHaveBeenCalledTimes(1);
		const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://api.resend.com/emails');
		const payload = JSON.parse(init.body as string) as { from: string; to: string; text: string };
		expect(payload.from).toBe('OpenMusic <login@openmusic.lol>');
		expect(payload.to).toBe('user@example.com');
		const m = payload.text.match(/token=([0-9a-f]{64})/);
		expect(m).not.toBeNull();
		// The emailed token hashes to the stored row key — and the raw token is never stored.
		expect(await sha256hex('magic:' + m![1])).toBe(hash);
		expect([...f.magic.keys()]).not.toContain(m![1]);
	});

	it('a failed send deletes the minted token and answers 500 send-failed', async () => {
		stubResend(500);
		const f = fakeDb();
		const res = await callMagic(fakeEvent({ body: JSON.stringify({ email: 'a@b.co' }), env: env(f) }));
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ ok: false, err: 'send-failed' });
		expect(f.magic.size).toBe(0);
	});

	it('the 4th request for one email inside the window → 429 rate-limited', async () => {
		stubResend();
		const f = fakeDb();
		for (let i = 0; i < 3; i++) {
			const ok = await callMagic(fakeEvent({ body: JSON.stringify({ email: 'a@b.co' }), env: env(f) }));
			expect(ok.status).toBe(200);
		}
		const fourth = await callMagic(fakeEvent({ body: JSON.stringify({ email: 'a@b.co' }), env: env(f) }));
		expect(fourth.status).toBe(429);
		expect(await fourth.json()).toEqual({ ok: false, err: 'rate-limited' });
	});
});

/** Drive a full sign-in: request a link, extract the emailed token, verify it. */
async function signIn(f: Db, email = 'a@b.co') {
	const send = stubResend();
	await callMagic(fakeEvent({ body: JSON.stringify({ email }), env: env(f) }));
	const payload = JSON.parse((send.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as { text: string };
	const token = payload.text.match(/token=([0-9a-f]{64})/)![1];
	const res = await callVerify(fakeEvent({ body: JSON.stringify({ token }), env: env(f), path: '/api/auth/verify' }));
	return { res, token };
}

describe('POST /api/auth/verify', () => {
	it('a garbage token → 400; an unknown well-formed token → 400', async () => {
		const f = fakeDb();
		const a = await callVerify(fakeEvent({ body: JSON.stringify({ token: 'xyz' }), env: env(f), path: '/api/auth/verify' }));
		expect(a.status).toBe(400);
		const b = await callVerify(
			fakeEvent({ body: JSON.stringify({ token: 'f'.repeat(64) }), env: env(f), path: '/api/auth/verify' })
		);
		expect(b.status).toBe(400);
		expect(await b.json()).toEqual({ ok: false, err: 'invalid-token' });
		expect(f.users.size).toBe(0);
	});

	it('an expired token → 400', async () => {
		const f = fakeDb();
		const token = 'a'.repeat(64);
		f.magic.set(await sha256hex('magic:' + token), { email: 'a@b.co', expires_at: Date.now() - 1, used: 0 });
		const res = await callVerify(fakeEvent({ body: JSON.stringify({ token }), env: env(f), path: '/api/auth/verify' }));
		expect(res.status).toBe(400);
	});

	it('happy path: user created, session minted, cookie + native token returned; single-use enforced', async () => {
		const f = fakeDb();
		const { res, token: magicToken } = await signIn(f);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { user: { id: string; email: string }; token: string };
		expect(body.user.email).toBe('a@b.co');
		expect(body.token).toMatch(/^[0-9a-f]{64}$/);
		const cookie = res.headers.get('Set-Cookie') ?? '';
		expect(cookie).toContain(`openmusic_session=${body.token}`);
		expect(cookie).toContain('HttpOnly');
		expect(f.users.size).toBe(1);
		expect(f.sessions.size).toBe(1);
		// The session row is keyed by the HASH — the raw token is never at rest.
		expect(f.sessions.has(body.token)).toBe(false);
		expect(f.sessions.has(await sha256hex('session:' + body.token))).toBe(true);

		// Second redemption of the same magic token → 400 (single use).
		const again = await callVerify(
			fakeEvent({ body: JSON.stringify({ token: magicToken }), env: env(f), path: '/api/auth/verify' })
		);
		expect(again.status).toBe(400);
		expect(f.sessions.size).toBe(1);
	});

	it('a second sign-in for the same email reuses the user row', async () => {
		const f = fakeDb();
		const first = await signIn(f);
		const firstBody = (await first.res.json()) as { user: { id: string } };
		const second = await signIn(f);
		const secondBody = (await second.res.json()) as { user: { id: string } };
		expect(secondBody.user.id).toBe(firstBody.user.id);
		expect(f.users.size).toBe(1);
		expect(f.sessions.size).toBe(2);
	});
});

describe('GET /api/auth/session + POST /api/auth/logout', () => {
	it('no credential → 200 {user:null}; no binding → 200 {user:null}', async () => {
		const f = fakeDb();
		const a = await callSession(fakeGetEvent({ env: env(f) }));
		expect(a.status).toBe(200);
		expect(await a.json()).toEqual({ user: null });
		const b = await callSession(fakeGetEvent({ env: {} }));
		expect(b.status).toBe(200);
		expect(await b.json()).toEqual({ user: null });
	});

	it('cookie session resolves; bearer session resolves; logout kills it', async () => {
		const f = fakeDb();
		const { res } = await signIn(f);
		const body = (await res.json()) as { user: { id: string; email: string }; token: string };

		const viaCookie = await callSession(
			fakeGetEvent({ env: env(f), headers: { cookie: `openmusic_session=${body.token}` } })
		);
		expect(await viaCookie.json()).toEqual({ user: { id: body.user.id, email: 'a@b.co' } });
		const viaBearer = await callSession(
			fakeGetEvent({ env: env(f), headers: { authorization: `Bearer ${body.token}` } })
		);
		expect(await viaBearer.json()).toEqual({ user: { id: body.user.id, email: 'a@b.co' } });

		const out = await callLogout(
			fakeEvent({
				body: undefined,
				env: env(f),
				path: '/api/auth/logout',
				headers: { cookie: `openmusic_session=${body.token}`, 'content-type': '' }
			})
		);
		expect(out.status).toBe(200);
		expect(out.headers.get('Set-Cookie')).toContain('Max-Age=0');
		expect(f.sessions.size).toBe(0);
		const after = await callSession(fakeGetEvent({ env: env(f), headers: { cookie: `openmusic_session=${body.token}` } }));
		expect(await after.json()).toEqual({ user: null });
	});
});
