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
// quick-261119-tipbind: the response also carries `supporter` — the account's
// recorded tip claim ({ tier, since } from $lib/auth/supporter-core, since =
// the claim's verified_at) or null (signed out, no claim, or the claim store
// unavailable). The client heals its local supporter flag from it, so a user
// who verified ONCE is a supporter on every device they sign in on. Never
// 500s: getAccountSupporter is never-throw by contract, and the whole lookup
// is skipped when there is no user.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS.

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse } from '$lib/proxy/http';
import { getUserFromRequest } from '$lib/auth/auth-core';
import { getAccountSupporter } from '$lib/auth/supporter-core';

export const GET: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;
	const db = env?.ACCOUNTS_DB;
	if (!db) return jsonResponse({ user: null, supporter: null }, origin);
	const user = await getUserFromRequest(request, db);
	if (!user) return jsonResponse({ user: null, supporter: null }, origin);
	const claim = await getAccountSupporter(db, user.id);
	const supporter = claim ? { tier: claim.tier, since: claim.verified_at } : null;
	return jsonResponse({ user, supporter }, origin);
};
