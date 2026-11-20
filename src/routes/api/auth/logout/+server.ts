// POST /api/auth/logout — destroy the session (quick-261020-acct).
//
// Deletes the session row for whichever credential the request carried (cookie OR
// bearer — getAuthToken) and ALWAYS answers 200 { ok:true } with a clearing Set-Cookie:
// signing out must succeed from the client's point of view even when the session was
// already gone or the binding is missing (the client still has local state to drop).
// Clipbin functions/api/auth/logout.js, ported.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS.

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { corsHeaders, jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import { clearSessionCookie, getAuthToken, sha256hex } from '$lib/auth/auth-core';

export const POST: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;

	if (origin !== null && !isAllowedOrigin(origin)) {
		return jsonResponse({ ok: false, err: 'forbidden-origin' }, origin, { status: 403 });
	}

	const db = env?.ACCOUNTS_DB;
	const token = getAuthToken(request);
	if (db && token) {
		await db
			.prepare('DELETE FROM sessions WHERE token_hash = ?')
			.bind(await sha256hex('session:' + token))
			.run();
	}

	// Built by hand (like verify) because the response MUST carry the clearing Set-Cookie.
	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			...corsHeaders(origin),
			'content-type': 'application/json',
			'Set-Cookie': clearSessionCookie()
		}
	});
};
