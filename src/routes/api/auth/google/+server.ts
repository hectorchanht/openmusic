// POST /api/auth/google { idToken } — Google sign-in (quick-261020-google).
//
// NO Firebase, NO new infra: Google only proves identity via a signed ID token (from the
// web's Google Identity Services button or the APK's Play-Services sign-in — both mint
// JWTs with aud = GOOGLE_WEB_CLIENT_ID). The token is verified here (RS256 against
// Google's JWKS, then aud / iss / exp / email_verified), the user is upserted BY EMAIL —
// so a same-email Google + magic-link sign-in resolves to ONE user row — and the app's
// own 30-day session takes over, exactly like the magic-link verify route.
//
// The success contract is byte-identical to /api/auth/verify's: { user, token, scheme }
// + the httpOnly session cookie. `scheme` is always null here (no email link involved),
// and `token` is the NATIVE seam only — web JS must use the cookie, never the token.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS. Helpers live in $lib/auth/auth-core.ts.

import type { RequestHandler } from './$types';
import { corsHeaders, jsonResponse, guardJsonPost } from '$lib/proxy/http';
import {
	buildSessionCookie,
	clientIp,
	issueSessionForEmail,
	rateLimit,
	verifyGoogleIdToken
} from '$lib/auth/auth-core';

// An ID token is ~1–2KB; 8KB leaves headroom without inviting junk.
const MAX_BODY_BYTES = 8 * 1024;

// A Google sign-in attempt is cheap for an attacker to mint (no email round-trip), so it
// is rate-limited tighter than a passive probe but looser than magic-link sends:
// 10 attempts per IP per 10 minutes, plus 10 per verified email per 10 minutes.
const RATE_MAX = 10;
const RATE_WINDOW_MS = 10 * 60 * 1000;

export const POST: RequestHandler = async (event) => {
	// quick-261020-batch4: shared drive-by guard prelude (guardJsonPost in $lib/proxy/http).
	// Same drive-by guards as /api/auth/verify (quick-260926-mzn).
	const g = await guardJsonPost(event);
	if (g instanceof Response) return g;
	const { request, origin, db } = g;

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
	const idToken = String((body as { idToken?: unknown })?.idToken ?? '');
	if (idToken.length === 0 || idToken.length > 8192) {
		return jsonResponse({ ok: false, err: 'invalid-token' }, origin, { status: 400 });
	}

	// Pre-verification rate limit by IP (the email is only known after verification).
	if (!(await rateLimit(db, `google:ip:${clientIp(request)}`, RATE_MAX, RATE_WINDOW_MS))) {
		return jsonResponse({ ok: false, err: 'rate-limited' }, origin, { status: 429 });
	}

	const verified = await verifyGoogleIdToken(idToken);
	if (!verified.ok) {
		// One refusal for every verification failure — never say which (no oracle).
		return jsonResponse({ ok: false, err: 'invalid-token' }, origin, { status: 401 });
	}

	// Post-verification rate limit by email — a verified identity is the stable key.
	if (!(await rateLimit(db, `google:email:${verified.email}`, RATE_MAX, RATE_WINDOW_MS))) {
		return jsonResponse({ ok: false, err: 'rate-limited' }, origin, { status: 429 });
	}

	// Upsert by email + session via the shared helper — byte-identical to the verify
	// route, so Google + magic-link + code share the user row (and the sync envelope).
	const { user, token: sessionToken } = await issueSessionForEmail(db, verified.email);

	// jsonResponse() has no extra-header passthrough, and this route MUST set Set-Cookie —
	// so the Response is built here with the same corsHeaders() seam (never `*`).
	return new Response(
		JSON.stringify({ user: { id: user.id, email: user.email }, token: sessionToken, scheme: null }),
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
