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

/**
 * quick-261020-deeplink — the app's own deep-link scheme. The /api/auth/magic-link route
 * accepts it as an optional `scheme` body field (STRICT allowlist: exact match only — never
 * `javascript:`, never `https:`, never a lookalike), stores it on the magic-token row, and
 * the /auth/magic page offers an "Open in OpenMusic" handoff when the redeemed token
 * carried one. The value keeps the `://` suffix because the server and the client both
 * build absolute callback URLs from it; the Android manifest claims it as
 * `android:scheme="openmusic"` (manifest form drops the suffix).
 */
export const NATIVE_APP_SCHEME = 'openmusic://';

/** Exact-match allowlist for the magic-link `scheme` field — see NATIVE_APP_SCHEME. */
export function isAllowedScheme(scheme: unknown): scheme is string {
	return scheme === NATIVE_APP_SCHEME;
}

/**
 * quick-261020-google — Google sign-in WITHOUT Firebase and WITHOUT new infra. Google
 * only proves identity (a signed ID token); the app's own session infra takes over from
 * there, exactly like the magic-link verify route. Same-email Google + magic-link sign-ins
 * resolve to ONE user row (upsert by email).
 *
 * The Web OAuth client ID is the `aud` every ID token must carry — it is a PUBLIC
 * identifier (baked into the web bundle + the APK), never a secret. Created 2026-10-20
 * in GCP project "OpenMusic" (openmusic-512208) as f147259@gmail.com, alongside the
 * Android client (package com.openmusic.app, release SHA-1).
 */
export const GOOGLE_WEB_CLIENT_ID =
	'241980960784-f3hp8l2nnctq6stdj8lmclfclr5pit8r.apps.googleusercontent.com';

/** Google's JWKS endpoint for ID-token verification. */
export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** The only two issuers Google ever puts on an ID token. */
export const GOOGLE_ALLOWED_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** A Google ID token is only ever RS256. Anything else is junk, never a credential. */
const GOOGLE_ID_TOKEN_ALG = 'RS256';

/** How long fetched Google certs are trusted (module scope; the edge isolate reuses it). */
const GOOGLE_CERTS_TTL_MS = 60 * 60 * 1000;

/**
 * A Google JWKS key. TS 5.9's lib.dom JsonWebKey omits `kid` (RFC 7517 §4.5), but
 * Google's certs always carry it and kid-matching is how the verifying key is
 * selected — so the Google key type re-adds it instead of casting at every use.
 * quick-261020-google
 */
export interface GoogleJwk extends JsonWebKey {
	kid?: string;
}

interface GoogleJwks {
	keys: GoogleJwk[];
}

let cachedCerts: { keys: GoogleJwk[]; fetchedAt: number } | null = null;

/** TEST-ONLY: drop the cached Google certs so tests control the JWKS deterministically. */
export function __resetGoogleCerts(): void {
	cachedCerts = null;
}

function base64UrlDecode(s: string): Uint8Array<ArrayBuffer> {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
	const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
	const bin = atob(padded);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function getGoogleCerts(fetchImpl: typeof fetch): Promise<GoogleJwk[]> {
	const now = Date.now();
	if (cachedCerts && now - cachedCerts.fetchedAt < GOOGLE_CERTS_TTL_MS) return cachedCerts.keys;
	const res = await fetchImpl(GOOGLE_CERTS_URL);
	if (!res.ok) throw new Error(`certs fetch failed: ${res.status}`);
	const jwks = (await res.json()) as GoogleJwks;
	if (!jwks || !Array.isArray(jwks.keys)) throw new Error('certs malformed');
	cachedCerts = { keys: jwks.keys, fetchedAt: now };
	return jwks.keys;
}

/** Never-throw outcome: the verified email, or the precise reason verification failed. */
export type GoogleIdTokenResult = { ok: true; email: string } | { ok: false; reason: string };

/**
 * Verify a Google ID token (web GIS button or native Play-Services sign-in — both mint
 * JWTs with aud = GOOGLE_WEB_CLIENT_ID). Checks, in order: three-part shape, JSON
 * header/payload, alg == RS256, signature against Google's current JWKS (kid-matched),
 * aud, iss, exp, email_verified === true, and a deliverable-looking email.
 *
 * `fetchCerts` injects the JWKS for tests; `now` pins the clock for expiry tests.
 * Never throws — every failure is a typed reason the route maps to a status.
 */
export async function verifyGoogleIdToken(
	idToken: string,
	opts?: { fetchCerts?: () => Promise<GoogleJwks>; now?: number }
): Promise<GoogleIdTokenResult> {
	const parts = typeof idToken === 'string' ? idToken.split('.') : [];
	if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
		return { ok: false, reason: 'malformed' };
	}
	let header: { alg?: unknown; kid?: unknown };
	let payload: Record<string, unknown>;
	try {
		header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
		payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
	} catch {
		return { ok: false, reason: 'malformed' };
	}
	if (typeof header !== 'object' || header === null) return { ok: false, reason: 'malformed' };
	if (header.alg !== GOOGLE_ID_TOKEN_ALG) return { ok: false, reason: 'bad-alg' };
	if (typeof header.kid !== 'string' || header.kid.length === 0) return { ok: false, reason: 'unknown-kid' };

	let keys: GoogleJwk[];
	try {
		keys = opts?.fetchCerts ? (await opts.fetchCerts()).keys : await getGoogleCerts(fetch);
	} catch {
		return { ok: false, reason: 'certs-unavailable' };
	}
	const jwk = keys.find((k) => k.kty === 'RSA' && k.kid === header.kid);
	if (!jwk) return { ok: false, reason: 'unknown-kid' };

	let valid: boolean;
	try {
		const key = await crypto.subtle.importKey(
			'jwk',
			jwk,
			{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
			false,
			['verify']
		);
		const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
		valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlDecode(parts[2]), data);
	} catch {
		return { ok: false, reason: 'bad-signature' };
	}
	if (!valid) return { ok: false, reason: 'bad-signature' };

	const nowSec = Math.floor((opts?.now ?? Date.now()) / 1000);
	if (payload.aud !== GOOGLE_WEB_CLIENT_ID) return { ok: false, reason: 'bad-aud' };
	if (typeof payload.iss !== 'string' || !GOOGLE_ALLOWED_ISSUERS.includes(payload.iss)) {
		return { ok: false, reason: 'bad-iss' };
	}
	if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return { ok: false, reason: 'expired' };
	// Google emits a real boolean here; a string "true" is not accepted — strict is safer
	// than lenient when the claim gates account creation.
	if (payload.email_verified !== true) return { ok: false, reason: 'email-unverified' };
	const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
	if (!isValidEmail(email)) return { ok: false, reason: 'bad-email' };
	return { ok: true, email };
}

/**
 * quick-261020-realerr — one raw diagnostic line for a failed request attempt
 * (Hector: "why don't you show the real error message?"). Pure so the store and the
 * tests share it: `attempt 1: TypeError: Failed to fetch @230ms`. A 15s AbortError
 * means the request hung; an instant TypeError means the phone never reached the
 * server (DNS/TCP/TLS/CORS-preflight).
 */
export function diagLine(thrown: unknown, attempt: number, elapsedMs: number): string {
	const name = thrown instanceof Error ? thrown.name : 'Unknown';
	const msg = thrown instanceof Error ? thrown.message : String(thrown);
	return `attempt ${attempt + 1}: ${name}: ${msg || '(no message)'} @${elapsedMs}ms`;
}

/**
 * The deep-link URL the /auth/magic page offers after a scheme-tagged redeem:
 * `openmusic://auth/callback?token=<64-hex bearer>`. The bearer is the 30-day SESSION
 * token (the same value the verify response carries); the magic token is single-use and
 * already burned by the time this URL is built, so re-tapping the button is harmless.
 */
export function buildAuthCallbackUrl(scheme: string, bearerToken: string): string {
	return `${scheme}auth/callback?token=${encodeURIComponent(bearerToken)}`;
}

/**
 * Parse an incoming deep link into the auth-callback bearer token, or null.
 *
 * T-38-02 twin of deepLinkPath(): the OS's manifest filter is not our gate — a hostile
 * app can hand the activity any VIEW intent, so the payload is re-checked here before it
 * can become a credential: exact `openmusic:` scheme, exact `auth` host, exact `/callback`
 * path, and a token that passes TOKEN_RE. Anything else is junk, never a credential.
 */
export function parseAuthCallbackUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	try {
		const u = new URL(raw);
		if (u.protocol !== 'openmusic:') return null;
		if (u.hostname.toLowerCase() !== 'auth') return null;
		if (u.pathname !== '/callback') return null;
		const token = u.searchParams.get('token') ?? '';
		return TOKEN_RE.test(token) ? token : null;
	} catch {
		// Not a URL — junk or an attack, never a credential.
		return null;
	}
}

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
 * quick-261020-code — the 6-digit sign-in code (the native-APK path: typed into the app,
 * no browser needed). Link and code are TWO CREDENTIALS FOR ONE LOGIN INTENT: either
 * consumes it — both single-use, 15-minute expiry, and burning one invalidates the other.
 */
export const CODE_RE = /^[0-9]{6}$/;

/** A code dies after this many wrong guesses (per code_hash row, in D1). */
export const MAX_CODE_ATTEMPTS = 5;

/** quick-261020-code — verify-code rate limit: guesses per email per 10 minutes. */
export const VERIFY_CODE_RATE_MAX = 10;
export const VERIFY_CODE_RATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Crypto-random 6-digit code (100000–999999), rejection-sampled off a full uint32 —
 * no modulo bias (900000 divides 2^32 with a remainder, so the tail is re-drawn).
 */
export function randomCode(): string {
	const b = new Uint32Array(1);
	const range = 900000;
	const limit = 4294967296 - (4294967296 % range);
	do {
		crypto.getRandomValues(b);
	} while (b[0] >= limit);
	return String(100000 + (b[0] % range));
}

/**
 * Constant-time string equality for credential-hash comparison — a naive `===` leaks
 * the matching prefix length through timing (an oracle for guessing the code hash).
 */
export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/**
 * quick-261020-code — issue the app's own session for an email: upsert the user row by
 * email (so Google + magic-link + code sign-ins for one address are ONE user), mint a
 * 30-day session token, store SHA-256('session:'+token). Shared by /api/auth/verify,
 * /api/auth/verify-code and /api/auth/google — the success contract is byte-identical
 * everywhere: { user, token, scheme } + the httpOnly cookie the route sets itself.
 */
export async function issueSessionForEmail(
	db: D1Database,
	email: string
): Promise<{ user: AccountUser; token: string }> {
	let user = await db
		.prepare('SELECT id, email FROM users WHERE email = ?')
		.bind(email)
		.first<{ id: string; email: string }>();
	if (!user) {
		const id = crypto.randomUUID();
		await db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(id, email).run();
		user = { id, email };
	}
	const token = randomToken(32);
	const hash = await sha256hex('session:' + token);
	await db
		.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
		.bind(hash, user.id, Date.now() + SESSION_TTL_MS)
		.run();
	return { user, token };
}

/** Minimal HTML-escape — the footer interpolates the recipient address (user input). */
function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * quick-261020-code — the formal branded sign-in email (Hector's design): branded header,
 * "Hi there,", a TEAL CTA BUTTON (a real table button, not a colored text link — bulletproof
 * for mail clients), a divider, "Or enter this code in the app:" with the code BIG in a
 * box (monospace + letter-spacing + user-select:all, prominent enough that Gmail offers
 * its own "Copy code" chip), and a formal footer. HTML + plain-text fallback.
 */
export function buildSignInEmail(
	link: string,
	code: string,
	toEmail: string
): { subject: string; html: string; text: string } {
	const safeEmail = escapeHtml(toEmail);
	// quick-261020-metafmt: mirror Meta's OTP email shape so Gmail's "Copy code" detector
	// fires — the CODE IS IN THE SUBJECT ("Use code 316001 to log in"), the body leads
	// with the code ("entering the following code" + a "Sign-in code" label), and the
	// magic link rides below as the secondary path. (Whether Gmail shows its pill is
	// still its own detector's call — this is the closest sender-side mirror.)
	const html = `<!doctype html><html><body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:32px 24px;">
<div style="text-align:center;margin-bottom:24px;">
<span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">OpenMusic</span>
</div>
<div style="background-color:#141414;border:1px solid #2a2a2a;border-radius:16px;padding:32px 28px;">
<p style="color:#ffffff;font-size:16px;margin:0 0 16px;">Hi there,</p>
<p style="color:#b3b3b3;font-size:14px;line-height:1.6;margin:0 0 12px;">You can sign in to OpenMusic by entering the following code.</p>
<p style="color:#b3b3b3;font-size:14px;margin:0 0 8px;">Sign-in code</p>
<div style="background-color:#0a0a0a;border:1px dashed #00c2b8;border-radius:12px;padding:20px 12px;text-align:center;margin:0 0 8px;">
<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;font-weight:700;letter-spacing:6px;text-indent:6px;color:#ffffff;user-select:all;-webkit-user-select:all;white-space:nowrap;">${code}</span>
</div>
<p style="color:#737373;font-size:12px;margin:0 0 24px;">The code expires in 15 minutes and stops working after 5 wrong tries. Long-press the code to copy it.</p>
<div style="border-top:1px solid #2a2a2a;margin:0 0 24px;"></div>
<p style="color:#b3b3b3;font-size:14px;line-height:1.6;margin:0 0 16px;">Or tap the button below to sign in instantly.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 8px;"><tr><td style="border-radius:999px;background-color:#00c2b8;">
<a href="${link}" style="display:inline-block;padding:14px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">Sign in to OpenMusic</a>
</td></tr></table>
<p style="color:#737373;font-size:12px;margin:16px 0 0;">The link expires in 15 minutes and can only be used once.</p>
</div>
<p style="color:#737373;font-size:12px;line-height:1.6;text-align:center;margin:24px 0 8px;">This message was sent to ${safeEmail} at your request.</p>
<p style="color:#525252;font-size:12px;text-align:center;margin:0;">OpenMusic &middot; Dawn Studio &middot; openmusic.lol</p>
</div>
</body></html>`;
	const text = `Hi there,

You can sign in to OpenMusic by entering the following code.

Sign-in code: ${code}

The code expires in 15 minutes and stops working after 5 wrong tries.

Or sign in instantly with this link (expires in 15 minutes, one-time use):
${link}

This message was sent to ${toEmail} at your request.
OpenMusic · Dawn Studio · openmusic.lol`;
	// The email carries BOTH credentials — the code leads (subject + body, Gmail "Copy
	// code" detector mirror) while the link rides below as the instant path.
	return { subject: `Use code ${code} to sign in to OpenMusic`, html, text };
}

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
	link: string,
	code: string
): Promise<SendMagicLinkResult> {
	try {
		const { subject, html, text } = buildSignInEmail(link, code, to);
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
			body: JSON.stringify({ from, to, subject, html, text })
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
