// POST /api/analytics/like — identity-linked like/unlike ping. Body:
// { anon_id?: string, action: 'like' | 'unlike', song_id: string, title?: string,
//   artist?: string, source?: string, platform?: 'web' | 'android',
//   app_version?: string, locale?: string }.
//
// The client fires from library.toggleLike — the single convergence point for every
// like UI — AFTER the toggle, with the action that just happened. Both directions
// are logged so net like counts stay derivable.
//
// Identity is resolved SERVER-side only, via getUserFromRequest against the
// ACCOUNTS_DB binding (cookie OR bearer session → users row). The client NEVER
// sends user_id/email — a body-supplied identity field would be spoofable. When
// there is no session, user_id is NULL and the row is keyed by anon_id only, the
// same approximation as /api/analytics/play (resets if the user clears site data).
//
// Columns the SERVER derives (never trusted from the client):
//   device_type — mobile | desktop | tablet, from User-Agent
//   os          — windows | ios | android | macos | linux | other, from User-Agent
//   country     — 2-letter code from Cloudflare's CF-IPCountry header (country-level
//                 only; the raw IP is never read — getClientAddress is deliberately
//                 unused, and no IP is ever stored).
// liked_at is stamped server-side so clients cannot backfill.
//
// Writes one row to the ACCOUNTS_DB D1 binding (database `openmusic-accounts`,
// table like_events) — the PII-side database, deliberately NOT the no-PII
// openmusic-analytics. Fails soft: any problem (no binding, bad body, D1 error)
// answers HTTP 200 with { ok:false } — the client is fire-and-forget, and
// Cloudflare's edge rewrites 5xx Pages bodies into its own bare error page
// (same posture as /api/analytics/play).
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — `GET` and `POST`. A top-level
// helper export makes SvelteKit throw "Invalid export" at REQUEST time.

import type { RequestHandler } from './$types';
import { jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import { getUserFromRequest } from '$lib/auth/auth-core';

const MAX_BODY_BYTES = 2048;
const MAX_FIELD = 300;
const MAX_SONG_ID = 256;
const MAX_ANON_ID = 64;
const MAX_APP_VERSION = 32;
const MAX_LOCALE = 16;

function str(v: unknown, max: number): string {
	if (typeof v !== 'string') return '';
	const s = v.trim();
	return s.length > max ? s.slice(0, max) : s;
}

/** mobile | desktop | tablet — coarse bucketing from the User-Agent, best effort. */
function deviceType(ua: string): string {
	if (/tablet|ipad|playbook/i.test(ua)) return 'tablet';
	if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/i.test(ua)) return 'mobile';
	return 'desktop';
}

/** OS bucket from the User-Agent. Order matters: Android UAs contain "Linux",
 *  iPhone UAs contain "like Mac OS X" — check the specific before the generic. */
function osName(ua: string): string {
	const u = ua.toLowerCase();
	if (u.includes('windows nt')) return 'windows';
	if (/iphone|ipad|ipod/.test(u)) return 'ios';
	if (u.includes('android')) return 'android';
	if (u.includes('mac os x')) return 'macos';
	if (u.includes('linux')) return 'linux';
	return 'other';
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');

	// Same drive-by guards as /api/analytics/play: a browser always sends Origin
	// on a POST (refuse non-allow-listed), and require application/json, which a
	// cross-origin page cannot send without a preflight.
	if (origin !== null && !isAllowedOrigin(origin)) {
		return jsonResponse({ ok: false, reason: 'forbidden-origin' }, origin, { status: 403 });
	}
	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return jsonResponse({ ok: false, reason: 'unsupported-type' }, origin, { status: 415 });
	}

	// Size screen before the read (the declared length costs no read).
	if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
		return jsonResponse({ ok: false, reason: 'too-large' }, origin, { status: 413 });
	}
	let body: Record<string, unknown>;
	try {
		const text = await request.text();
		if (text.length > MAX_BODY_BYTES) {
			return jsonResponse({ ok: false, reason: 'too-large' }, origin, { status: 413 });
		}
		body = JSON.parse(text) as Record<string, unknown>;
	} catch {
		return jsonResponse({ ok: false, reason: 'invalid' }, origin, { status: 400 });
	}
	const songId = str(body.song_id, MAX_SONG_ID);
	if (!songId) return jsonResponse({ ok: false, reason: 'invalid' }, origin, { status: 400 });
	const action = body.action === 'like' || body.action === 'unlike' ? body.action : '';
	if (!action) return jsonResponse({ ok: false, reason: 'invalid' }, origin, { status: 400 });

	// Client-declared properties (validated shapes only).
	const pf = body.platform;
	const clientPlatform = pf === 'web' || pf === 'android' ? pf : '';

	// Server-derived properties — never taken from the body.
	const ua = request.headers.get('user-agent') ?? '';
	const cc = (request.headers.get('cf-ipcountry') ?? '').toUpperCase();
	const country = /^[A-Z]{2}$/.test(cc) ? cc : '';

	// Degrades cleanly when the binding is absent (local dev, unit tests, a deploy
	// from before the binding was wired): the client ignores the answer anyway.
	const db = platform?.env?.ACCOUNTS_DB;
	if (!db) return jsonResponse({ ok: false, reason: 'no-db' }, origin);

	// Identity: server-resolved from the session, never from the body. A missing
	// or expired session is not an error — the row is simply anonymous (user_id NULL).
	let userId: string | null = null;
	try {
		userId = (await getUserFromRequest(request, db))?.id ?? null;
	} catch {
		return jsonResponse({ ok: false, reason: 'db-error' }, origin);
	}

	try {
		await db
			.prepare(
				'INSERT INTO like_events (user_id, anon_id, action, song_id, title, artist, source, platform, app_version, locale, device_type, os, country, liked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
			)
			.bind(
				userId,
				str(body.anon_id, MAX_ANON_ID),
				action,
				songId,
				str(body.title, MAX_FIELD),
				str(body.artist, MAX_FIELD),
				str(body.source, MAX_FIELD),
				clientPlatform,
				str(body.app_version, MAX_APP_VERSION),
				str(body.locale, MAX_LOCALE),
				deviceType(ua),
				osName(ua),
				country,
				new Date().toISOString()
			)
			.run();
	} catch {
		return jsonResponse({ ok: false, reason: 'db-error' }, origin);
	}
	return jsonResponse({ ok: true }, origin);
};
