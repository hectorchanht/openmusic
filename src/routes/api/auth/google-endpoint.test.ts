// POST /api/auth/google endpoint tests (quick-261020-google) — the Google ID token →
// app-session exchange driven through the exported POST handler over an in-memory D1
// stand-in (harness follows auth-endpoint.test.ts). Google's JWKS is a stubbed global
// fetch serving a REAL RSA keypair, so signature verification is genuinely exercised.
//
// What these CANNOT prove: that SvelteKit loads the module (a non-verb export 500s at
// request time), or that a real Google-minted token verifies — that is the on-device
// check (Hector taps the Google button in the APK / web).

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GoogleJwk } from '$lib/auth/auth-core';
import {
	GOOGLE_CERTS_URL,
	GOOGLE_WEB_CLIENT_ID,
	SESSION_COOKIE_NAME,
	__resetGoogleCerts,
	sha256hex
} from '$lib/auth/auth-core';
import { POST as googlePOST } from './google/+server';

// --- in-memory D1 stand-in: exactly the statements the google route issues ------------

interface RateRow {
	count: number;
	window_start: number;
}

function fakeDb() {
	const users = new Map<string, { id: string; email: string }>();
	const usersByEmail = new Map<string, { id: string; email: string }>();
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
				if (sql.startsWith('SELECT id, email FROM users WHERE email')) {
					return usersByEmail.get(args[0] as string) ?? null;
				}
				return null;
			},
			async run() {
				if (sql.startsWith('INSERT OR REPLACE INTO rate_limits')) {
					rates.set(args[0] as string, { count: 1, window_start: args[1] as number });
				} else if (sql.startsWith('UPDATE rate_limits SET count = count + 1')) {
					const r = rates.get(args[0] as string);
					if (r) r.count += 1;
				} else if (sql.startsWith('INSERT INTO users')) {
					const row = { id: args[0] as string, email: args[1] as string };
					users.set(row.id, row);
					usersByEmail.set(row.email, row);
				} else if (sql.startsWith('INSERT INTO sessions')) {
					sessions.set(args[0] as string, { user_id: args[1] as string, expires_at: args[2] as number });
				}
			}
		};
		return stmt;
	};
	return { db: { prepare } as unknown as D1Database, sessions };
}

interface EventOpts {
	body?: string;
	headers?: Record<string, string>;
	env?: Record<string, unknown>;
}

function fakeEvent(opts: EventOpts = {}) {
	const url = new URL('https://openmusic.lol/api/auth/google');
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callGoogle = (e: ReturnType<typeof fakeEvent>) => googlePOST(e as any);

// --- real RSA keypair + JWT minter (mirrors auth-core.test.ts) --------------------------

let keyPair: CryptoKeyPair;
let jwk: GoogleJwk;
const KID = 'route-test-kid';

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

async function mint(payload: Record<string, unknown>): Promise<string> {
	const hb = b64url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
	const pb = b64url(JSON.stringify(payload));
	const data = new TextEncoder().encode(hb + '.' + pb);
	const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, data);
	return `${hb}.${pb}.${Buffer.from(new Uint8Array(sig)).toString('base64url')}`;
}

function claims(over: Record<string, unknown> = {}) {
	const nowSec = Math.floor(Date.now() / 1000);
	return {
		iss: 'accounts.google.com',
		aud: GOOGLE_WEB_CLIENT_ID,
		exp: nowSec + 3600,
		iat: nowSec,
		email: 'googler@example.com',
		email_verified: true,
		sub: '999',
		...over
	};
}

/** Google JWKS stand-in: serves the test keypair's public JWK, 404s anything else. */
function stubGoogleCerts() {
	const f = vi.fn(async (input: unknown) => {
		if (String(input) === GOOGLE_CERTS_URL) {
			return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
		}
		return new Response('{}', { status: 404 });
	});
	vi.stubGlobal('fetch', f as unknown as typeof fetch);
	return f;
}

describe('POST /api/auth/google', () => {
	beforeAll(async () => {
		keyPair = await crypto.subtle.generateKey(
			{
				name: 'RSASSA-PKCS1-v1_5',
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: 'SHA-256'
			},
			true,
			['sign', 'verify']
		);
		jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: KID };
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		__resetGoogleCerts();
	});

	it('verifies a valid Google token and returns the verify-shaped session', async () => {
		stubGoogleCerts();
		const { db, sessions } = fakeDb();
		const res = await callGoogle(
			fakeEvent({ body: JSON.stringify({ idToken: await mint(claims()) }), env: { ACCOUNTS_DB: db } })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { user: { id: string; email: string }; token: string; scheme: null };
		expect(body.user.email).toBe('googler@example.com');
		expect(body.token).toMatch(/^[0-9a-f]{64}$/);
		expect(body.scheme).toBeNull();
		// The session row exists under SHA-256('session:' + token), like the verify route.
		const hash = await sha256hex('session:' + body.token);
		expect(sessions.get(hash)?.user_id).toBe(body.user.id);
		// The httpOnly cookie is set for the web client.
		expect(res.headers.get('set-cookie') ?? '').toContain(`${SESSION_COOKIE_NAME}=`);
	});

	it('upserts by email: the same Google account twice is ONE user', async () => {
		stubGoogleCerts();
		const { db } = fakeDb();
		const env = { ACCOUNTS_DB: db };
		const a = (await (
			await callGoogle(fakeEvent({ body: JSON.stringify({ idToken: await mint(claims()) }), env }))
		).json()) as { user: { id: string } };
		const b = (await (
			await callGoogle(fakeEvent({ body: JSON.stringify({ idToken: await mint(claims()) }), env }))
		).json()) as { user: { id: string } };
		expect(a.user.id).toBe(b.user.id);
	});

	it('rejects garbage with 401 and never says why (empty is 400: missing)', async () => {
		stubGoogleCerts();
		const { db } = fakeDb();
		for (const bad of ['nope', 'a.b.c']) {
			const res = await callGoogle(
				fakeEvent({ body: JSON.stringify({ idToken: bad }), env: { ACCOUNTS_DB: db } })
			);
			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({ ok: false, err: 'invalid-token' });
		}
		const empty = await callGoogle(
			fakeEvent({ body: JSON.stringify({ idToken: '' }), env: { ACCOUNTS_DB: db } })
		);
		expect(empty.status).toBe(400);
	});

	it('rejects a wrong-aud token with 401', async () => {
		stubGoogleCerts();
		const { db } = fakeDb();
		const res = await callGoogle(
			fakeEvent({
				body: JSON.stringify({ idToken: await mint(claims({ aud: 'evil.apps.googleusercontent.com' })) }),
				env: { ACCOUNTS_DB: db }
			})
		);
		expect(res.status).toBe(401);
	});

	it('rejects an expired token with 401', async () => {
		stubGoogleCerts();
		const { db } = fakeDb();
		const res = await callGoogle(
			fakeEvent({
				body: JSON.stringify({
					idToken: await mint(claims({ exp: Math.floor(Date.now() / 1000) - 5 }))
				}),
				env: { ACCOUNTS_DB: db }
			})
		);
		expect(res.status).toBe(401);
	});

	it('rate-limits: the 11th attempt in 10 minutes gets 429', async () => {
		stubGoogleCerts();
		const { db } = fakeDb();
		const env = { ACCOUNTS_DB: db };
		const token = await mint(claims());
		let last = 0;
		for (let i = 0; i < 11; i++) {
			const res = await callGoogle(fakeEvent({ body: JSON.stringify({ idToken: token }), env }));
			last = res.status;
		}
		expect(last).toBe(429);
	});

	it('fails closed without ACCOUNTS_DB', async () => {
		stubGoogleCerts();
		const res = await callGoogle(fakeEvent({ body: JSON.stringify({ idToken: 'x.y.z' }), env: {} }));
		expect(res.status).toBe(503);
	});

	it('rejects a non-JSON content-type', async () => {
		const { db } = fakeDb();
		const res = await callGoogle(
			fakeEvent({ body: 'x', headers: { 'content-type': 'text/plain' }, env: { ACCOUNTS_DB: db } })
		);
		expect(res.status).toBe(415);
	});

	it('rejects a forbidden origin', async () => {
		const { db } = fakeDb();
		const res = await callGoogle(
			fakeEvent({
				body: JSON.stringify({ idToken: 'x.y.z' }),
				headers: { origin: 'https://evil.example' },
				env: { ACCOUNTS_DB: db }
			})
		);
		expect(res.status).toBe(403);
	});
});
