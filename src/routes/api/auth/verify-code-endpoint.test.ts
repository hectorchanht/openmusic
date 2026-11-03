// POST /api/auth/verify-code endpoint tests (quick-261020-code) — the 6-digit code →
// app-session exchange driven through the exported POST handler over an in-memory D1
// stand-in (harness follows google-endpoint.test.ts). Resend is a stubbed global fetch
// that CAPTURES the email body, so the test reads the real code out of the sent HTML —
// the same HTML the template assertions check.
//
// What these CANNOT prove: that SvelteKit loads the module (a non-verb export 500s at
// request time), or that Resend delivers — those are live checks.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE_NAME, sha256hex } from '$lib/auth/auth-core';
import { POST as magicLinkPOST } from './magic-link/+server';
import { POST as verifyPOST } from './verify/+server';
import { POST as verifyCodePOST } from './verify-code/+server';

// --- in-memory D1 stand-in: exactly the statements the code routes issue ---------------

interface MagicRow {
	token_hash: string;
	email: string;
	expires_at: number;
	used: number;
	scheme: string | null;
	code_hash: string | null;
	code_attempts: number;
}
interface RateRow {
	count: number;
	window_start: number;
}

function fakeDb() {
	const users = new Map<string, { id: string; email: string }>();
	const usersByEmail = new Map<string, { id: string; email: string }>();
	const magic = new Map<string, MagicRow>();
	const magicByEmail: MagicRow[] = [];
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
				if (sql.startsWith('SELECT email, expires_at, used, scheme FROM magic_tokens')) {
					return magic.get(args[0] as string) ?? null;
				}
				if (sql.startsWith('SELECT token_hash, code_hash, code_attempts, scheme FROM magic_tokens')) {
					// latest live intent for the email
					const [email, now] = args as [string, number];
					const live = magicByEmail.filter((r) => r.email === email && r.used === 0 && r.expires_at > now);
					return live.length > 0 ? live[live.length - 1] : null;
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
				} else if (sql.startsWith('INSERT INTO magic_tokens')) {
					const row: MagicRow = {
						token_hash: args[0] as string,
						email: args[1] as string,
						expires_at: args[2] as number,
						used: 0,
						scheme: (args[3] as string | null) ?? null,
						code_hash: (args[4] as string | null) ?? null,
						code_attempts: 0
					};
					magic.set(args[0] as string, row);
					magicByEmail.push(row);
				} else if (sql.startsWith('DELETE FROM magic_tokens')) {
					const row = magic.get(args[0] as string);
					if (row) {
						magic.delete(args[0] as string);
						const i = magicByEmail.indexOf(row);
						if (i >= 0) magicByEmail.splice(i, 1);
					}
				} else if (sql.startsWith('UPDATE magic_tokens SET used = 1')) {
					const m = magic.get(args[0] as string);
					if (m) m.used = 1;
				} else if (sql.startsWith('UPDATE magic_tokens SET code_attempts = code_attempts + 1')) {
					const m = magic.get(args[0] as string);
					if (m) m.code_attempts += 1;
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
	return { db: { prepare } as unknown as D1Database, sessions, magicByEmail };
}

// --- stubbed Resend: captures the email body so tests read the real code --------------

let lastEmail: { subject: string; html: string; text: string } | null = null;

function stubResend() {
	lastEmail = null;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init: { body: string }) => {
			const body = JSON.parse(init.body) as { subject: string; html: string; text: string };
			lastEmail = { subject: body.subject, html: body.html, text: body.text };
			return new Response(JSON.stringify({ id: 'stub-id' }), { status: 200 });
		})
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

/** The 6-digit code out of the captured email HTML. */
function codeFromEmail(): string {
	expect(lastEmail).not.toBeNull();
	const m = lastEmail!.html.match(/>(\d{6})</);
	expect(m).not.toBeNull();
	return m![1];
}

/** The magic-link token out of the captured email HTML. */
function tokenFromEmail(): string {
	const m = lastEmail!.html.match(/\/auth\/magic\?token=([0-9a-f]{64})/);
	expect(m).not.toBeNull();
	return m![1];
}

function fakeEvent(path: string, body: unknown, ip = '9.9.9.9') {
	const url = new URL(`https://openmusic.lol${path}`);
	return {
		url,
		platform: { env: { ACCOUNTS_DB: null as unknown as D1Database, RESEND_API_KEY: 'stub-key' } },
		request: new Request(url, {
			method: 'POST',
			headers: { origin: 'https://openmusic.lol', 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => ip
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callMagicLink = (db: D1Database, body: unknown, ip?: string) => {
	const e = fakeEvent('/api/auth/magic-link', body, ip);
	(e.platform as { env: { ACCOUNTS_DB: D1Database } }).env.ACCOUNTS_DB = db;
	return magicLinkPOST(e as any);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callVerify = (db: D1Database, body: unknown, ip?: string) => {
	const e = fakeEvent('/api/auth/verify', body, ip);
	(e.platform as { env: { ACCOUNTS_DB: D1Database } }).env.ACCOUNTS_DB = db;
	return verifyPOST(e as any);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callVerifyCode = (db: D1Database, body: unknown, ip?: string) => {
	const e = fakeEvent('/api/auth/verify-code', body, ip);
	(e.platform as { env: { ACCOUNTS_DB: D1Database } }).env.ACCOUNTS_DB = db;
	return verifyCodePOST(e as any);
};

describe('POST /api/auth/verify-code (quick-261020-code)', () => {
	it('verifies a correct code and issues the session contract', async () => {
		stubResend();
		const { db, sessions } = fakeDb();
		const email = 'code-ok@example.com';
		const ml = await callMagicLink(db, { email });
		expect(ml.status).toBe(200);
		const code = codeFromEmail();

		const res = await callVerifyCode(db, { email, code });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { user: { email: string }; token: string; scheme: null };
		expect(body.user.email).toBe(email);
		expect(body.token).toMatch(/^[0-9a-f]{64}$/);
		expect(body.scheme).toBeNull();
		// httpOnly session cookie rides along
		expect(res.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE_NAME}=`);
		expect(res.headers.get('Set-Cookie')).toContain('HttpOnly');
		// the session row exists server-side
		const sessionHash = await sha256hex('session:' + body.token);
		expect(sessions.has(sessionHash)).toBe(true);
	});

	it('rejects a wrong code with 401 invalid-code', async () => {
		stubResend();
		const { db } = fakeDb();
		const email = 'code-wrong@example.com';
		await callMagicLink(db, { email });
		const res = await callVerifyCode(db, { email, code: '000000' });
		expect(res.status).toBe(401);
		expect(((await res.json()) as { err: string }).err).toBe('invalid-code');
	});

	it('rejects an expired code with 401 invalid-code (no oracle)', async () => {
		stubResend();
		const { db, magicByEmail } = fakeDb();
		const email = 'code-expired@example.com';
		await callMagicLink(db, { email });
		const code = codeFromEmail();
		// expire the intent
		magicByEmail[0].expires_at = Date.now() - 1000;
		const res = await callVerifyCode(db, { email, code });
		expect(res.status).toBe(401);
		expect(((await res.json()) as { err: string }).err).toBe('invalid-code');
	});

	it('locks the code out after 5 wrong attempts', async () => {
		stubResend();
		const { db } = fakeDb();
		const email = 'code-lockout@example.com';
		await callMagicLink(db, { email });
		const realCode = codeFromEmail();
		for (let i = 0; i < 5; i++) {
			const r = await callVerifyCode(db, { email, code: '000000' }, `10.0.0.${i}`);
			expect(r.status).toBe(401);
			expect(((await r.json()) as { err: string }).err).toBe('invalid-code');
		}
		// 6th guess — even the RIGHT code is refused now
		const locked = await callVerifyCode(db, { email, code: realCode }, '10.0.0.9');
		expect(locked.status).toBe(401);
		expect(((await locked.json()) as { err: string }).err).toBe('too-many-attempts');
	});

	it('verifying the LINK burns the code (two credentials, one intent)', async () => {
		stubResend();
		const { db } = fakeDb();
		const email = 'code-linkburn@example.com';
		await callMagicLink(db, { email });
		const code = codeFromEmail();
		const token = tokenFromEmail();
		const v = await callVerify(db, { token });
		expect(v.status).toBe(200);
		const res = await callVerifyCode(db, { email, code });
		expect(res.status).toBe(401);
	});

	it('verifying the CODE burns the link (two credentials, one intent)', async () => {
		stubResend();
		const { db } = fakeDb();
		const email = 'code-codeburn@example.com';
		await callMagicLink(db, { email });
		const code = codeFromEmail();
		const token = tokenFromEmail();
		const vc = await callVerifyCode(db, { email, code });
		expect(vc.status).toBe(200);
		const v = await callVerify(db, { token });
		expect(v.status).toBe(400);
	});

	it('rate-limits guesses per email (429)', async () => {
		stubResend();
		const { db } = fakeDb();
		const email = 'code-ratelimit@example.com';
		await callMagicLink(db, { email });
		let last: Response | null = null;
		// 10 guesses/email/10min allowed; the 11th trips the limiter. Distinct IPs so
		// only the email bucket binds.
		for (let i = 0; i < 11; i++) {
			last = await callVerifyCode(db, { email, code: '000000' }, `10.1.0.${i}`);
		}
		expect(last!.status).toBe(429);
		expect(((await last!.json()) as { err: string }).err).toBe('rate-limited');
	});

	it('rejects malformed bodies with 400', async () => {
		stubResend();
		const { db } = fakeDb();
		for (const body of [{ email: 'x@example.com', code: '12345' }, { email: 'x@example.com', code: 'abcdef' }, { email: 'nope', code: '123456' }, {}]) {
			const res = await callVerifyCode(db, body);
			expect(res.status).toBe(400);
		}
	});
});
