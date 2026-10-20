// POST /api/auth/magic-link { email } — passwordless sign-in, step 1 (quick-261020-acct).
//
// Mints a single-use 15-minute token, stores ONLY SHA-256('magic:'+token) in the
// ACCOUNTS_DB `magic_tokens` table, and emails the raw token to the user via Resend as
// `${origin}/auth/magic?token=<token>` — the /auth/magic PAGE then POSTs it to
// /api/auth/verify from JS, so a mail scanner following the link cannot burn the
// single-use token (Clipbin house pattern, ported from functions/api/auth/magic-link.js;
// the semantics live in $lib/auth/auth-core.ts).
//
// Gates, cheapest first:
//   1. foreign Origin → 403 (quick-260926-mzn drive-by guard, same as /api/comments — CORS
//      alone only hides the RESPONSE; a foreign page could still fire no-preflight POSTs);
//   2. non-JSON content type → 415 (a cross-origin page cannot send JSON without preflight);
//   3. no ACCOUNTS_DB binding → 503 (fail closed);
//   4. malformed body / email → 400;
//   5. D1 fixed-window rate limits: 3 per email / 10 min, 10 per IP / 10 min → 429;
//   6. no RESEND_API_KEY → 500 'not-configured' — checked BEFORE the token insert so a
//      misconfigured deploy never leaves orphan token rows (fail CLOSED).
// A failed SEND deletes the just-minted token row and answers 500 'send-failed'.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS. Helpers live in $lib/auth/auth-core.ts.

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import {
	MAGIC_LINK_TTL_MS,
	DEFAULT_MAGIC_LINK_FROM,
	clientIp,
	isValidEmail,
	randomToken,
	rateLimit,
	sendMagicLinkEmail,
	sha256hex
} from '$lib/auth/auth-core';

const MAX_BODY_BYTES = 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;

export const POST: RequestHandler = async (event) => {
	const { request, platform } = event;
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;

	if (origin !== null && !isAllowedOrigin(origin)) {
		return jsonResponse({ ok: false, err: 'forbidden-origin' }, origin, { status: 403 });
	}
	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return jsonResponse({ ok: false, err: 'unsupported-type' }, origin, { status: 415 });
	}
	const db = env?.ACCOUNTS_DB;
	if (!db) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	// Size screen (comments-route idiom): the declared length costs no read; the real length
	// is re-checked because the header can lie or be absent.
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
	if (!isValidEmail(email)) {
		return jsonResponse({ ok: false, err: 'invalid-email' }, origin, { status: 400 });
	}

	// Rate limits BEFORE any token row or email exists. The IP comes from getClientAddress
	// (adapter-cloudflare) with the CF-Connecting-IP header as fallback — a write with no
	// attributable address still lands in the shared 'unknown' bucket, never unrated.
	let ip: string | null = null;
	try {
		ip = event.getClientAddress();
	} catch {
		ip = null;
	}
	const [okEmail, okIp] = await Promise.all([
		rateLimit(db, `ml:email:${email}`, 3, RATE_WINDOW_MS),
		rateLimit(db, `ml:ip:${ip ?? clientIp(request)}`, 10, RATE_WINDOW_MS)
	]);
	if (!okEmail || !okIp) {
		return jsonResponse({ ok: false, err: 'rate-limited' }, origin, { status: 429 });
	}

	// Fail CLOSED on a missing key, BEFORE minting anything (see header gate 6).
	const apiKey = env?.RESEND_API_KEY;
	if (!apiKey) {
		return jsonResponse({ ok: false, err: 'not-configured' }, origin, { status: 500 });
	}

	const token = randomToken(32);
	const tokenHash = await sha256hex('magic:' + token);
	await db
		.prepare('INSERT INTO magic_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)')
		.bind(tokenHash, email, Date.now() + MAGIC_LINK_TTL_MS)
		.run();

	const link = `${new URL(request.url).origin}/auth/magic?token=${token}`;
	const sent = await sendMagicLinkEmail(apiKey, env?.MAGIC_LINK_FROM || DEFAULT_MAGIC_LINK_FROM, email, link);
	if (!sent.ok) {
		// The email never left — the token must not stay redeemable.
		await db.prepare('DELETE FROM magic_tokens WHERE token_hash = ?').bind(tokenHash).run();
		return jsonResponse({ ok: false, err: 'send-failed' }, origin, { status: 500 });
	}
	return jsonResponse({ ok: true }, origin);
};
