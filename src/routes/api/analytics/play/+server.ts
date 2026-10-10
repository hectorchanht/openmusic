// POST /api/analytics/play — anonymous play-count ping. Body:
// { anon_id?: string, song_id: string, title?: string, artist?: string, source?: string,
//   platform?: 'web' | 'android', app_version?: string, locale?: string }.
//
// The client fires exactly once per track load, on the audio `playing` event (first
// real audio output); pause/resume and mid-track re-resolves never re-fire.
//
// Columns the SERVER derives (never trusted from the client):
//   device_type — mobile | desktop | tablet, from User-Agent
//   os          — windows | ios | android | macos | linux | other, from User-Agent
//   country     — 2-letter code from Cloudflare's CF-IPCountry header (country-level
//                 only; the raw IP is never read — getClientAddress is deliberately
//                 unused, and no IP is ever stored).
// No PII: anon_id is a random UUID the client keeps in localStorage. played_at is
// stamped server-side so clients cannot backfill.
//
// Writes one row to the ANALYTICS_DB D1 binding (database `openmusic-analytics`,
// table play_events). Fails soft: any problem (no binding, bad body, D1 error)
// answers HTTP 200 with { ok:false } — the client is fire-and-forget, and
// Cloudflare's edge rewrites 5xx Pages bodies into its own bare error page
// (same posture as /api/sponsored/verify).
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — `GET` and `POST`. A top-level
// helper export makes SvelteKit throw "Invalid export" at REQUEST time.

import type { RequestHandler } from './$types';
import { jsonResponse, isAllowedOrigin } from '$lib/proxy/http';

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

	// Same drive-by guards as /api/sponsored/verify: a browser always sends Origin
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

	// Client-declared properties (validated shapes only).
	const pf = body.platform;
	const clientPlatform = pf === 'web' || pf === 'android' ? pf : '';

	// Server-derived properties — never taken from the body.
	const ua = request.headers.get('user-agent') ?? '';
	const cc = (request.headers.get('cf-ipcountry') ?? '').toUpperCase();
	const country = /^[A-Z]{2}$/.test(cc) ? cc : '';

	// Degrades cleanly when the binding is absent (local dev, unit tests, a deploy
	// from before the binding was wired): the client ignores the answer anyway.
	const db = platform?.env?.ANALYTICS_DB;
	if (!db) return jsonResponse({ ok: false, reason: 'no-db' }, origin);

	try {
		await db
			.prepare(
				'INSERT INTO play_events (anon_id, song_id, title, artist, source, played_at, device_type, os, platform, app_version, locale, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
			)
			.bind(
				str(body.anon_id, MAX_ANON_ID),
				songId,
				str(body.title, MAX_FIELD),
				str(body.artist, MAX_FIELD),
				str(body.source, MAX_FIELD),
				new Date().toISOString(),
				deviceType(ua),
				osName(ua),
				clientPlatform,
				str(body.app_version, MAX_APP_VERSION),
				str(body.locale, MAX_LOCALE),
				country
			)
			.run();
	} catch {
		return jsonResponse({ ok: false, reason: 'db-error' }, origin);
	}
	return jsonResponse({ ok: true }, origin);
};
