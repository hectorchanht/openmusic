// POST /api/auth/verify-code { email, code } — passwordless sign-in, step 2b
// (quick-261020-code).
//
// The 6-digit CODE path: the same email that carries the magic link also carries a code,
// and the code is typed into the app (the native-APK path — no browser, no deep link).
// Link and code are TWO CREDENTIALS FOR ONE LOGIN INTENT: the token row holds both
// hashes; burning either (used=1) invalidates the other.
//
// Semantics:
//   - the code is looked up by EMAIL (latest unused unexpired row), never by code hash —
//     a 6-digit space is enumerable, so there is no code→row index to scan;
//   - wrong guesses increment code_attempts; at MAX_CODE_ATTEMPTS (5) the code is dead;
//   - one refusal shape for unknown / expired / wrong ('invalid-code', 401) — never say
//     which (no oracle for guessing), same house rule as /api/auth/verify;
//   - defense in depth: a D1 fixed-window rate limit (10 guesses / email / 10 min) sits
//     on top of the 5-attempts-per-code rule;
//   - success issues the session via the shared issueSessionForEmail() helper — the
//     contract is byte-identical to /api/auth/verify: { user, token, scheme } + the
//     httpOnly session cookie.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS. Helpers live in $lib/auth/auth-core.ts.

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { corsHeaders, jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import {
	CODE_RE,
	MAX_CODE_ATTEMPTS,
	VERIFY_CODE_RATE_MAX,
	VERIFY_CODE_RATE_WINDOW_MS,
	buildSessionCookie,
	clientIp,
	isValidEmail,
	issueSessionForEmail,
	rateLimit,
	sha256hex,
	timingSafeEqual
} from '$lib/auth/auth-core';

const MAX_BODY_BYTES = 1024;

export const POST: RequestHandler = async (event) => {
	const { request, platform } = event;
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;

	// Same drive-by guards as /api/auth/verify (quick-260926-mzn).
	if (origin !== null && !isAllowedOrigin(origin)) {
		return jsonResponse({ ok: false, err: 'forbidden-origin' }, origin, { status: 403 });
	}
	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return jsonResponse({ ok: false, err: 'unsupported-type' }, origin, { status: 415 });
	}
	const db = env?.ACCOUNTS_DB;
	if (!db) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
		return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });
	}
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) {
		return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });
	}
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return jsonResponse({ ok: false, err: 'invalid' }, origin, { status: 400 });
	}
	const email = String((body as { email?: unknown })?.email ?? '')
		.trim()
		.toLowerCase();
	const code = String((body as { code?: unknown })?.code ?? '').trim();
	if (!isValidEmail(email) || !CODE_RE.test(code)) {
		return jsonResponse({ ok: false, err: 'invalid' }, origin, { status: 400 });
	}

	// Guess-rate limit BEFORE touching the token row (defense in depth over the
	// per-code 5-attempt rule). The IP is a second key so one email can't be probed
	// from a botnet; the email key is the primary one.
	let ip: string | null = null;
	try {
		ip = event.getClientAddress();
	} catch {
		ip = null;
	}
	const [okEmail, okIp] = await Promise.all([
		rateLimit(db, `vc:email:${email}`, VERIFY_CODE_RATE_MAX, VERIFY_CODE_RATE_WINDOW_MS),
		rateLimit(db, `vc:ip:${ip ?? clientIp(request)}`, VERIFY_CODE_RATE_MAX * 5, VERIFY_CODE_RATE_WINDOW_MS)
	]);
	if (!okEmail || !okIp) {
		return jsonResponse({ ok: false, err: 'rate-limited' }, origin, { status: 429 });
	}

	// Latest live intent for this email. `used = 1` covers link-burned rows too — either
	// credential consumes the intent.
	const now = Date.now();
	const row = await db
		.prepare(
			'SELECT token_hash, code_hash, code_attempts, scheme FROM magic_tokens WHERE email = ? AND used = 0 AND expires_at > ? ORDER BY rowid DESC LIMIT 1'
		)
		.bind(email, now)
		.first<{ token_hash: string; code_hash: string | null; code_attempts: number; scheme: string | null }>();
	// One refusal for unknown / expired / code-less rows — never say which.
	if (!row || !row.code_hash) {
		return jsonResponse({ ok: false, err: 'invalid-code' }, origin, { status: 401 });
	}
	if (row.code_attempts >= MAX_CODE_ATTEMPTS) {
		return jsonResponse({ ok: false, err: 'too-many-attempts' }, origin, { status: 401 });
	}

	const guessHash = await sha256hex('code:' + code);
	if (!timingSafeEqual(guessHash, row.code_hash)) {
		await db
			.prepare('UPDATE magic_tokens SET code_attempts = code_attempts + 1 WHERE token_hash = ?')
			.bind(row.token_hash)
			.run();
		return jsonResponse({ ok: false, err: 'invalid-code' }, origin, { status: 401 });
	}

	// Correct code — burn the intent (the link dies with it) and issue the session.
	await db.prepare('UPDATE magic_tokens SET used = 1 WHERE token_hash = ?').bind(row.token_hash).run();
	const { user, token: sessionToken } = await issueSessionForEmail(db, email);

	// jsonResponse() has no extra-header passthrough, and this route MUST set Set-Cookie —
	// so the Response is built here with the same corsHeaders() seam (never `*`).
	// `scheme` rides along like verify's (null unless the intent was minted with one).
	return new Response(
		JSON.stringify({ user: { id: user.id, email: user.email }, token: sessionToken, scheme: row.scheme ?? null }),
		{
			status: 200,
			headers: {
				...corsHeaders(origin),
				'content-type': 'application/json',
				'Set-Cookie': buildSessionCookie(sessionToken)
			}
		}
	);
};
