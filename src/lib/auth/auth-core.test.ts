// auth-core unit tests (quick-261020-acct) — the pure primitives: token shape, hashing,
// email screen, cookie builders, token extraction (cookie vs bearer), the D1 fixed-window
// rate limiter, and getUserFromRequest over an in-memory D1 stand-in.
//
// The stand-in implements exactly the statements auth-core issues, with Map semantics —
// it proves the module's logic, not D1's SQL engine (the route tests drive the same fake
// through the real handlers).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleJwk } from './auth-core';
import {
	GOOGLE_WEB_CLIENT_ID,
	SESSION_COOKIE_NAME,
	TOKEN_RE,
	NATIVE_APP_SCHEME,
	__resetGoogleCerts,
	buildAuthCallbackUrl,
	buildSessionCookie,
	diagLine,
	clearSessionCookie,
	getAuthToken,
	getBearerToken,
	getSessionTokenFromCookie,
	getUserFromRequest,
	isAllowedScheme,
	isValidEmail,
	parseAuthCallbackUrl,
	randomToken,
	rateLimit,
	sha256hex,
	verifyGoogleIdToken
} from './auth-core';

// --- in-memory D1 stand-in (rate_limits + sessions + users only) -----------------------

interface RateRow {
	count: number;
	window_start: number;
}
interface SessionRow {
	user_id: string;
	expires_at: number;
}

function fakeDb() {
	const rates = new Map<string, RateRow>();
	const sessions = new Map<string, SessionRow>();
	const users = new Map<string, { id: string; email: string }>();
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
				}
				return { success: true };
			}
		};
		return stmt;
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { db: { prepare } as any, rates, sessions, users };
}

const req = (headers: Record<string, string> = {}) =>
	new Request('https://openmusic.lol/api/auth/session', { headers });

describe('randomToken / sha256hex', () => {
	it('randomToken is 64 lowercase hex and unique per call', () => {
		const a = randomToken();
		const b = randomToken();
		expect(a).toMatch(TOKEN_RE);
		expect(b).toMatch(TOKEN_RE);
		expect(a).not.toBe(b);
	});

	it('sha256hex matches the published SHA-256 vectors', async () => {
		expect(await sha256hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
		expect(await sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	});
});

describe('isValidEmail', () => {
	it('accepts ordinary addresses, rejects the malformed', () => {
		for (const ok of ['a@b.co', 'first.last+tag@example.com', 'u@sub.domain.org']) {
			expect(isValidEmail(ok), ok).toBe(true);
		}
		for (const bad of ['', 'nope', 'a@b', 'a b@c.com', 'a@b .com', '@b.com', 'a@.com', 'a@@b.com']) {
			expect(isValidEmail(bad), bad).toBe(false);
		}
	});
});

describe('cookie builders', () => {
	it('buildSessionCookie carries the 30-day httpOnly posture', () => {
		const tok = 'a'.repeat(64);
		expect(buildSessionCookie(tok)).toBe(
			`${SESSION_COOKIE_NAME}=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`
		);
	});

	it('clearSessionCookie expires the same cookie', () => {
		expect(clearSessionCookie()).toBe(
			`${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
		);
	});
});

describe('token extraction', () => {
	const tok = 'b'.repeat(64);

	it('reads the cookie among others', () => {
		const r = req({ cookie: `other=1; ${SESSION_COOKIE_NAME}=${tok}; x=2` });
		expect(getSessionTokenFromCookie(r)).toBe(tok);
		expect(getAuthToken(r)).toBe(tok);
	});

	it('falls back to the bearer header (native seam)', () => {
		const r = req({ authorization: `Bearer ${tok}` });
		expect(getBearerToken(r)).toBe(tok);
		expect(getAuthToken(r)).toBe(tok);
	});

	it('the cookie wins over a bearer when both are present', () => {
		const other = 'c'.repeat(64);
		const r = req({ cookie: `${SESSION_COOKIE_NAME}=${tok}`, authorization: `Bearer ${other}` });
		expect(getAuthToken(r)).toBe(tok);
	});

	it('malformed tokens on both channels → null', () => {
		expect(getAuthToken(req({ cookie: `${SESSION_COOKIE_NAME}=short` }))).toBeNull();
		expect(getAuthToken(req({ authorization: 'Bearer short' }))).toBeNull();
		expect(getAuthToken(req())).toBeNull();
	});
});

describe('rateLimit — fixed window', () => {
	const T0 = 1_700_000_000_000;
	let now = T0;
	beforeEach(() => {
		now = T0;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
	});
	afterEach(() => vi.restoreAllMocks());

	it('allows up to max, then blocks, then the window resets', async () => {
		const { db } = fakeDb();
		expect(await rateLimit(db, 'k', 3, 60_000)).toBe(true);
		expect(await rateLimit(db, 'k', 3, 60_000)).toBe(true);
		expect(await rateLimit(db, 'k', 3, 60_000)).toBe(true);
		expect(await rateLimit(db, 'k', 3, 60_000)).toBe(false);
		now = T0 + 60_001;
		expect(await rateLimit(db, 'k', 3, 60_000)).toBe(true);
	});

	it('keys are independent windows', async () => {
		const { db } = fakeDb();
		expect(await rateLimit(db, 'a', 1, 60_000)).toBe(true);
		expect(await rateLimit(db, 'a', 1, 60_000)).toBe(false);
		expect(await rateLimit(db, 'b', 1, 60_000)).toBe(true);
	});
});

describe('getUserFromRequest', () => {
	const T0 = 1_700_000_000_000;
	beforeEach(() => vi.spyOn(Date, 'now').mockImplementation(() => T0));
	afterEach(() => vi.restoreAllMocks());

	async function seed() {
		const f = fakeDb();
		const token = 'd'.repeat(64);
		f.users.set('u1', { id: 'u1', email: 'a@b.co' });
		f.sessions.set(await sha256hex('session:' + token), { user_id: 'u1', expires_at: T0 + 1000 });
		return { ...f, token };
	}

	it('resolves a cookie session and a bearer session to the user', async () => {
		const { db, token } = await seed();
		expect(await getUserFromRequest(req({ cookie: `${SESSION_COOKIE_NAME}=${token}` }), db)).toEqual({
			id: 'u1',
			email: 'a@b.co'
		});
		expect(await getUserFromRequest(req({ authorization: `Bearer ${token}` }), db)).toEqual({
			id: 'u1',
			email: 'a@b.co'
		});
	});

	it('unknown token → null; expired session → null; no token → null', async () => {
		const { db, sessions, token } = await seed();
		expect(await getUserFromRequest(req({ cookie: `${SESSION_COOKIE_NAME}=${'e'.repeat(64)}` }), db)).toBeNull();
		sessions.set(await sha256hex('session:' + token), { user_id: 'u1', expires_at: T0 - 1 });
		expect(await getUserFromRequest(req({ cookie: `${SESSION_COOKIE_NAME}=${token}` }), db)).toBeNull();
		expect(await getUserFromRequest(req(), db)).toBeNull();
	});
});

describe('deep-link handoff — quick-261020-deeplink', () => {
	describe('isAllowedScheme', () => {
		it('accepts exactly the app scheme', () => {
			expect(isAllowedScheme('openmusic://')).toBe(true);
			expect(isAllowedScheme(NATIVE_APP_SCHEME)).toBe(true);
		});

		it('rejects everything else — javascript:, https:, lookalikes, non-strings', () => {
			for (const bad of [
				'javascript:alert(1)',
				'https://',
				'https://openmusic.lol',
				'openmusic:',
				'openmusic://evil',
				'OpenMusic://',
				'OPENMUSIC://',
				' openmusic://',
				'openmusic:// ',
				'',
				null,
				undefined,
				42,
				{}
			]) {
				expect(isAllowedScheme(bad)).toBe(false);
			}
		});
	});

	describe('buildAuthCallbackUrl', () => {
		it('builds the exact appUrlOpen URL the manifest filter claims', () => {
			const token = 'a'.repeat(64);
			expect(buildAuthCallbackUrl('openmusic://', token)).toBe(`openmusic://auth/callback?token=${token}`);
		});
	});

	describe('parseAuthCallbackUrl', () => {
		const token = 'b'.repeat(64);
		const good = `openmusic://auth/callback?token=${token}`;

		it('parses a well-formed callback into the bearer token', () => {
			expect(parseAuthCallbackUrl(good)).toBe(token);
		});

		it('rejects wrong scheme, wrong host, wrong path, bad token, junk', () => {
			expect(parseAuthCallbackUrl(`https://openmusic.lol/auth/callback?token=${token}`)).toBeNull(); // web URL, not a deep link
			expect(parseAuthCallbackUrl(`javascript:alert(1)//auth/callback?token=${token}`)).toBeNull();
			expect(parseAuthCallbackUrl(`openmusic://evil/callback?token=${token}`)).toBeNull();
			expect(parseAuthCallbackUrl(`openmusic://auth/other?token=${token}`)).toBeNull();
			expect(parseAuthCallbackUrl(`openmusic://auth/callback`)).toBeNull(); // no token
			expect(parseAuthCallbackUrl(`openmusic://auth/callback?token=short`)).toBeNull(); // fails TOKEN_RE
			expect(parseAuthCallbackUrl(`openmusic://auth/callback?token=${'B'.repeat(64)}`)).toBeNull(); // uppercase hex
			expect(parseAuthCallbackUrl('not a url')).toBeNull();
			expect(parseAuthCallbackUrl('')).toBeNull();
			expect(parseAuthCallbackUrl(null)).toBeNull();
			expect(parseAuthCallbackUrl(undefined)).toBeNull();
		});

		it('round-trips buildAuthCallbackUrl', () => {
			expect(parseAuthCallbackUrl(buildAuthCallbackUrl(NATIVE_APP_SCHEME, token))).toBe(token);
		});

		it('accepts a case-variant scheme — the URL parser lowercases it, same as the OS intent filter', () => {
			expect(parseAuthCallbackUrl(`OPENMUSIC://auth/callback?token=${token}`)).toBe(token);
		});
	});
});

describe('diagLine (quick-261020-realerr)', () => {
	it('formats a real Error as "attempt N: Name: message @Xms"', () => {
		const err = new TypeError('Failed to fetch');
		expect(diagLine(err, 0, 230)).toBe('attempt 1: TypeError: Failed to fetch @230ms');
	});

	it('marks a hung request by its ~15s AbortError elapsed', () => {
		const err = new DOMException('signal timed out', 'AbortError');
		expect(diagLine(err, 1, 15012)).toBe('attempt 2: AbortError: signal timed out @15012ms');
	});

	it('never emits an empty message (falls back to "(no message)")', () => {
		expect(diagLine(new Error(), 0, 5)).toBe('attempt 1: Error: (no message) @5ms');
	});

	it('handles non-Error throws without crashing', () => {
		expect(diagLine('string boom', 0, 12)).toBe('attempt 1: Unknown: string boom @12ms');
		expect(diagLine(undefined, 0, 1)).toBe('attempt 1: Unknown: undefined @1ms');
	});
});

describe('verifyGoogleIdToken (quick-261020-google)', () => {
	// A real 2048-bit RSA pair minted once per file — the JWKS below is genuinely
	// signature-checked by verifyGoogleIdToken, not stubbed around.
	let keyPair: CryptoKeyPair;
	let jwk: GoogleJwk;
	const KID = 'test-kid-1';

	const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
	const b64urlBytes = (b: Uint8Array) => Buffer.from(b).toString('base64url');

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
		__resetGoogleCerts();
	});

	const fetchCerts = async () => ({ keys: [jwk] });

	function claims(over: Record<string, unknown> = {}) {
		const nowSec = Math.floor(Date.now() / 1000);
		return {
			iss: 'accounts.google.com',
			aud: GOOGLE_WEB_CLIENT_ID,
			exp: nowSec + 3600,
			iat: nowSec,
			email: 'Tester@Example.com',
			email_verified: true,
			sub: '12345',
			...over
		};
	}

	async function mint(
		payload: Record<string, unknown>,
		header: Record<string, unknown> = { alg: 'RS256', kid: KID, typ: 'JWT' },
		signer: CryptoKey = keyPair.privateKey
	): Promise<string> {
		const hb = b64url(JSON.stringify(header));
		const pb = b64url(JSON.stringify(payload));
		const data = new TextEncoder().encode(hb + '.' + pb);
		const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, data);
		return `${hb}.${pb}.${b64urlBytes(new Uint8Array(sig))}`;
	}

	it('accepts a well-formed Google token and lowercases the email', async () => {
		const res = await verifyGoogleIdToken(await mint(claims()), { fetchCerts });
		expect(res).toEqual({ ok: true, email: 'tester@example.com' });
	});

	it('accepts the https:// issuer variant too', async () => {
		const res = await verifyGoogleIdToken(await mint(claims({ iss: 'https://accounts.google.com' })), {
			fetchCerts
		});
		expect(res.ok).toBe(true);
	});

	it('rejects a wrong aud', async () => {
		const res = await verifyGoogleIdToken(await mint(claims({ aud: 'evil.apps.googleusercontent.com' })), {
			fetchCerts
		});
		expect(res).toEqual({ ok: false, reason: 'bad-aud' });
	});

	it('rejects an expired token', async () => {
		const past = Math.floor(Date.now() / 1000) - 10;
		const res = await verifyGoogleIdToken(await mint(claims({ exp: past })), { fetchCerts });
		expect(res).toEqual({ ok: false, reason: 'expired' });
	});

	it('rejects a wrong iss', async () => {
		const res = await verifyGoogleIdToken(await mint(claims({ iss: 'evil.example.com' })), { fetchCerts });
		expect(res).toEqual({ ok: false, reason: 'bad-iss' });
	});

	it('rejects email_verified !== true (a string "true" is not enough)', async () => {
		const res = await verifyGoogleIdToken(await mint(claims({ email_verified: 'true' })), { fetchCerts });
		expect(res).toEqual({ ok: false, reason: 'email-unverified' });
	});

	it('rejects a tampered payload (bad signature)', async () => {
		const good = await mint(claims());
		const [h, p, s] = good.split('.');
		const evil = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
		evil.email = 'attacker@example.com';
		const tampered = `${h}.${b64url(JSON.stringify(evil))}.${s}`;
		const res = await verifyGoogleIdToken(tampered, { fetchCerts });
		expect(res).toEqual({ ok: false, reason: 'bad-signature' });
	});

	it('rejects a token signed by an unknown key', async () => {
		const other = await crypto.subtle.generateKey(
			{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
			true,
			['sign', 'verify']
		);
		const res = await verifyGoogleIdToken(await mint(claims(), { alg: 'RS256', kid: KID, typ: 'JWT' }, other.privateKey), {
			fetchCerts
		});
		expect(res).toEqual({ ok: false, reason: 'bad-signature' });
	});

	it('rejects an unknown kid', async () => {
		const res = await verifyGoogleIdToken(await mint(claims(), { alg: 'RS256', kid: 'nope' }), { fetchCerts });
		expect(res).toEqual({ ok: false, reason: 'unknown-kid' });
	});

	it('rejects alg=none', async () => {
		const c = claims();
		const hb = b64url(JSON.stringify({ alg: 'none', kid: KID }));
		const pb = b64url(JSON.stringify(c));
		const res = await verifyGoogleIdToken(`${hb}.${pb}.anysig`, { fetchCerts });
		expect(res).toEqual({ ok: false, reason: 'bad-alg' });
	});

	it('rejects malformed tokens', async () => {
		for (const bad of ['', 'abc', 'a.b', 'a.b.c.d', '....']) {
			expect(await verifyGoogleIdToken(bad, { fetchCerts })).toEqual({ ok: false, reason: 'malformed' });
		}
	});

	it('rejects a non-email email claim', async () => {
		const res = await verifyGoogleIdToken(await mint(claims({ email: 'not-an-email' })), { fetchCerts });
		expect(res).toEqual({ ok: false, reason: 'bad-email' });
	});

	it('reports certs-unavailable when the JWKS fetch fails', async () => {
		const res = await verifyGoogleIdToken(await mint(claims()), {
			fetchCerts: async () => {
				throw new Error('down');
			}
		});
		expect(res).toEqual({ ok: false, reason: 'certs-unavailable' });
	});

	it('never throws on garbage input', async () => {
		await expect(verifyGoogleIdToken('', { fetchCerts })).resolves.toBeDefined();
		await expect(verifyGoogleIdToken('...', { fetchCerts })).resolves.toBeDefined();
	});
});
