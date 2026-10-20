// POST /api/auth/verify { token } — passwordless sign-in, step 2 (quick-261020-acct).
//
// Redeems a magic-link token (Clipbin functions/api/auth/verify.js, ported): the token must
// be well-formed (64 hex), exist, be unused and unexpired. It is then marked used
// (single-use), the user is created on first sign-in, and a 30-day session is established.
//
// The response carries BOTH credential channels:
//   - `Set-Cookie: openmusic_session=…` (httpOnly) — the WEB client's credential. Web JS
//     must NEVER read or store the token: the cookie is invisible to it by design.
//   - `token` in the JSON body — the NATIVE seam only. The Capacitor WebView cannot rely on
//     a cookie for the deployed origin, so the native client persists this value and sends
//     it back as `Authorization: Bearer <token>` (see $lib/auth/auth-core.ts header).
//   - `scheme` in the JSON body when the redeemed magic token carried one (quick-261020-deeplink):
//     the /auth/magic page renders the "Open in OpenMusic" deep-link button with it, since
//     the system browser that burned the token cannot hand the session to the app itself.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS. Helpers live in $lib/auth/auth-core.ts.

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { corsHeaders, jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import { TOKEN_RE, buildSessionCookie, issueSessionForEmail, sha256hex } from '$lib/auth/auth-core';

const MAX_BODY_BYTES = 1024;

export const POST: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;

	// Same drive-by guards as /api/auth/magic-link (quick-260926-mzn).
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
	const token = String((body as { token?: unknown })?.token ?? '');
	if (!TOKEN_RE.test(token)) {
		return jsonResponse({ ok: false, err: 'invalid-token' }, origin, { status: 400 });
	}

	const hash = await sha256hex('magic:' + token);
	const row = await db
		.prepare('SELECT email, expires_at, used, scheme FROM magic_tokens WHERE token_hash = ?')
		.bind(hash)
		.first<{ email: string; expires_at: number; used: number; scheme: string | null }>();
	// One refusal for unknown / used / expired — never say which (no oracle for guessing).
	if (!row || row.used || row.expires_at < Date.now()) {
		return jsonResponse({ ok: false, err: 'invalid-token' }, origin, { status: 400 });
	}
	// Burning the link burns the code too (same row, used=1) — two credentials, one intent.
	await db.prepare('UPDATE magic_tokens SET used = 1 WHERE token_hash = ?').bind(hash).run();

	// Session issuance is the shared helper — byte-identical to verify-code and google.
	const { user, token: sessionToken } = await issueSessionForEmail(db, row.email);

	// jsonResponse() has no extra-header passthrough, and this route MUST set Set-Cookie —
	// so the Response is built here with the same corsHeaders() seam (never `*`).
	// `scheme` rides along only when the token was minted with one (null otherwise).
	return new Response(
		JSON.stringify({ user: { id: user.id, email: user.email }, token: sessionToken, scheme: row.scheme ?? null }),
		{
		status: 200,
		headers: {
			...corsHeaders(origin),
			'content-type': 'application/json',
			'Set-Cookie': buildSessionCookie(sessionToken)
		}
	});
};
