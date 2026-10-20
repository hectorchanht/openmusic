// auth-core unit tests (quick-261020-acct) — the pure primitives: token shape, hashing,
// email screen, cookie builders, token extraction (cookie vs bearer), the D1 fixed-window
// rate limiter, and getUserFromRequest over an in-memory D1 stand-in.
//
// The stand-in implements exactly the statements auth-core issues, with Map semantics —
// it proves the module's logic, not D1's SQL engine (the route tests drive the same fake
// through the real handlers).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	SESSION_COOKIE_NAME,
	TOKEN_RE,
	buildSessionCookie,
	clearSessionCookie,
	getAuthToken,
	getBearerToken,
	getSessionTokenFromCookie,
	getUserFromRequest,
	isValidEmail,
	randomToken,
	rateLimit,
	sha256hex
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
