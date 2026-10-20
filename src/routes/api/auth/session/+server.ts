// GET /api/auth/session — who is signed in on this request (quick-261020-acct).
//
// Accepts EITHER the httpOnly `openmusic_session` cookie (web) OR an
// `Authorization: Bearer <token>` header (native WebView) — getUserFromRequest in
// $lib/auth/auth-core.ts owns that seam. Always 200: { user } when signed in,
// { user: null } otherwise (including a missing ACCOUNTS_DB binding — nobody can be
// signed in without the store, and the client treats null as signed-out either way).
// Clipbin's session route answered 401 for the same state; this app's client polls the
// endpoint at boot, where 200-null keeps the console clean and the branch trivial.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS.

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse } from '$lib/proxy/http';
import { getUserFromRequest } from '$lib/auth/auth-core';

export const GET: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;
	const db = env?.ACCOUNTS_DB;
	if (!db) return jsonResponse({ user: null }, origin);
	const user = await getUserFromRequest(request, db);
	return jsonResponse({ user }, origin);
};
