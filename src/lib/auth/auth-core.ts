// PURE auth primitives for magic-link sign-in + cross-device sync (quick-261020-acct) —
// NO runes, no $app import, no i18n import, NEVER throws for an expected failure.
//
// This is the node-Vitest-testable core the /api/auth/* and /api/me/sync routes thinly wrap
// (the backup-logic.ts precedent: the route owns the HTTP shape, this module owns the
// semantics). It is a faithful port of the Clipbin house pattern
// (~/workspace/clipbin/functions/_lib.js + api/auth/*):
//   - tokens are 64 lowercase hex chars (32 random bytes); the raw token NEVER touches D1 —
//     only SHA-256('magic:' + token) / SHA-256('session:' + token) are stored, so a database
//     leak hands out no usable credential;
//   - a magic token is single-use and expires 15 minutes after issue;
//   - a session lasts 30 days and rides in an httpOnly `openmusic_session` cookie on web;
//   - rate limits are a D1 fixed window (`rate_limits` table, key / count / window_start).
//
// quick-261020-acct (native seam): the Capacitor WebView (origin https://localhost) cannot
// rely on a cookie set on the deployed origin, so getUserFromRequest ALSO accepts an
// `Authorization: Bearer <token>` header — the SAME 64-hex session token the verify route
// returns in its JSON body for the native client only. hooks.server.ts + corsHeaders already
// advertise `Authorization` for allow-listed origins (T-33-06), and getUserFromRequest never
// trusts a token that fails the 64-hex screen, whichever channel carried it.

/** The account row every auth route works with. Never carries a token or a hash. */
export interface AccountUser {
	id: string;
	email: string;
}

/** Cookie name — `openmusic_session`, NOT Clipbin's `clipbin_session`. */
export const SESSION_COOKIE_NAME = 'openmusic_session';

/** 30 days, in seconds (cookie Max-Age) — the session lifetime. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 3600;

/** 15 minutes — the magic-link lifetime. Matches the copy in the email body. */
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

/** 30 days, in ms — the `sessions.expires_at` horizon (epoch ms, matching the D1 schema). */
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

/** The one shape every token (magic + session) must have before it is hashed or looked up. */
export const TOKEN_RE = /^[0-9a-f]{64}$/;

/** Default `From:` when env.MAGIC_LINK_FROM is unset (sender domain openmusic.lol). */
export const DEFAULT_MAGIC_LINK_FROM = 'OpenMusic <login@openmusic.lol>';

/** 64 lowercase hex chars from `bytes` random bytes (32 ⇒ the 64-hex token shape). */
export function randomToken(bytes = 32): string {
	const b = crypto.getRandomValues(new Uint8Array(bytes));
	return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Lowercase hex SHA-256 of a string. Async because crypto.subtle is async everywhere. */
export async function sha256hex(s: string): Promise<string> {
	const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Deliberately the Clipbin regex — broad on purpose; deliverability is Resend's problem,
 *  and a stricter screen here would lock out real addresses (plus-tags, IDN domains…). */
export function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Raw session token from the `openmusic_session` cookie, or null. NOT format-checked here —
 *  TOKEN_RE is applied by getAuthToken / getUserFromRequest, the single gate. */
export function getSessionTokenFromCookie(request: Request): string | null {
	const cookie = request.headers.get('cookie') || '';
	const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
	if (!m) return null;
	try {
		return decodeURIComponent(m[1]);
	} catch {
		return null; // a malformed %-escape in a cookie value is not a token
	}
}

/** Raw session token from `Authorization: Bearer <token>`, or null (native seam — see header). */
export function getBearerToken(request: Request): string | null {
	const h = request.headers.get('authorization') || '';
	const m = h.match(/^Bearer\s+(.+)$/i);
	return m ? m[1].trim() : null;
}

/**
 * The request's session token, whichever channel carried it — cookie FIRST (the web client's
 * httpOnly cookie is the canonical credential), bearer second (native only). Returns null
 * when neither channel carries a well-formed token.
 */
export function getAuthToken(request: Request): string | null {
	const cookie = getSessionTokenFromCookie(request);
	if (cookie && TOKEN_RE.test(cookie)) return cookie;
	const bearer = getBearerToken(request);
	if (bearer && TOKEN_RE.test(bearer)) return bearer;
	return null;
}

/** `Set-Cookie` value establishing the session (30-day, httpOnly, Secure, SameSite=Lax). */
export function buildSessionCookie(token: string): string {
	return [
		`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
		'Path=/',
		'HttpOnly',
		'Secure',
		'SameSite=Lax',
		`Max-Age=${SESSION_MAX_AGE_SECONDS}`
	].join('; ');
}

/** `Set-Cookie` value clearing the session (logout). */
export function clearSessionCookie(): string {
	return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Best-effort client IP for rate-limit keys. Cloudflare sets CF-Connecting-IP on every
 *  edge request; 'unknown' buckets the rest (local dev) under one shared key. */
export function clientIp(request: Request): string {
	return request.headers.get('cf-connecting-ip') || 'unknown';
}

/**
 * Fixed-window rate limiter backed by the `rate_limits` table (Clipbin _lib.js port).
 * Returns true when the call is ALLOWED. The window is anchored at the first hit; once
 * `windowMs` has passed since `window_start`, the counter restarts at 1.
 */
export async function rateLimit(db: D1Database, key: string, max: number, windowMs: number): Promise<boolean> {
	const now = Date.now();
	const row = await db
		.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?')
		.bind(key)
		.first<{ count: number; window_start: number }>();
	if (!row || now - row.window_start > windowMs) {
		await db
			.prepare('INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)')
			.bind(key, now)
			.run();
		return true;
	}
	if (row.count >= max) return false;
	await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
	return true;
}

/**
 * Resolve the request's session (cookie OR bearer — see getAuthToken) to its user, or null
 * when there is no token, the token is malformed, the session is unknown, or it has expired.
 * The sessions ⨝ users join means a deleted user invalidates their sessions for free.
 */
export async function getUserFromRequest(request: Request, db: D1Database): Promise<AccountUser | null> {
	const token = getAuthToken(request);
	if (!token) return null;
	const hash = await sha256hex('session:' + token);
	const row = await db
		.prepare(
			'SELECT s.user_id AS id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'
		)
		.bind(hash, Date.now())
		.first<{ id: string; email: string }>();
	return row ? { id: row.id, email: row.email } : null;
}

/** Typed result so the route can map each failure to its own status + delete the minted
 *  token row on a send failure — a never-throw service (house rule), not Clipbin's throw. */
export type SendMagicLinkResult = { ok: true } | { ok: false; reason: 'send-failed' };

/**
 * Send the magic-link email via Resend. `apiKey` is env.RESEND_API_KEY — the ROUTE checks it
 * first and fails closed with 500 before a token row exists, so this helper only ever runs
 * with a key. Any non-2xx (or a network rejection) maps to { ok:false, reason:'send-failed' }.
 *
 * The explicit browser User-Agent is load-bearing: Resend's Cloudflare front door rejects
 * the Python-urllib / bare default UAs with 403 error 1010 (recorded 2026-10-20 on the
 * management API); a browser UA passes. The header costs nothing on the happy path.
 */
export async function sendMagicLinkEmail(
	apiKey: string,
	from: string,
	to: string,
	link: string
): Promise<SendMagicLinkResult> {
	try {
		// RAW fetch (not apiFetch — fetch→apiFetch audit): SERVER-SIDE (Cloudflare edge) call
		// to the Resend API. apiFetch is the CLIENT seam and must not run edge-side.
		const res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'User-Agent':
					'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
			},
			body: JSON.stringify({
				from,
				to,
				subject: 'Your OpenMusic sign-in link',
				html: `<p>Click the link below to sign in to OpenMusic. It expires in 15 minutes and can only be used once.</p><p><a href="${link}">Sign in to OpenMusic</a></p><p>If you didn't request this, just ignore this email.</p>`,
				text: `Sign in to OpenMusic (expires in 15 minutes, single use): ${link}`
			})
		});
		if (!res.ok) {
			// Drain so the connection can be reused; the body is never logged (it may echo the
			// recipient address back).
			await res.body?.cancel().catch(() => {});
			return { ok: false, reason: 'send-failed' };
		}
		return { ok: true };
	} catch {
		return { ok: false, reason: 'send-failed' };
	}
}
