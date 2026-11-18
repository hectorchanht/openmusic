// POST /api/analytics/play — anonymous play-count ping. Body:
// { song_id: string, title?: string, artist?: string, source?: string }.
//
// The client fires exactly once per track load, on the audio `playing` event
// (first real audio output); pause/resume and mid-track re-resolves never
// re-fire.
//
// DATA DOCTRINE (quick-261118-datadoctrine; Hector, 2026-11-18): analytics are
// anonymous TOTALS ONLY. This endpoint increments a (day, action, song_id)
// counter in metric_counters (ANALYTICS_DB, database `openmusic-analytics`)
// via $lib/services/metric-counter — the single analytics write path. NOTHING
// per-user is read or stored: no anon_id (retired — a body field of that name
// is ignored like any other unknown field), no user_id, no IP (getClientAddress
// is deliberately unused), no User-Agent-derived device/os, no country, no
// timestamp finer than the UTC day. The counter schema has no column an
// identifier could land in.
//
// Fails soft: any problem (no binding, bad body, D1 error) answers HTTP 200
// with { ok:false } — the client is fire-and-forget, and Cloudflare's edge
// rewrites 5xx Pages bodies into its own bare error page (same posture as
// /api/sponsored/verify).
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — `GET` and `POST`. A top-level
// helper export makes SvelteKit throw "Invalid export" at REQUEST time.

import type { RequestHandler } from './$types';
import { jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import { bumpMetric } from '$lib/services/metric-counter';

const MAX_BODY_BYTES = 2048;
const MAX_FIELD = 300;
const MAX_SONG_ID = 256;

function str(v: unknown, max: number): string {
	if (typeof v !== 'string') return '';
	const s = v.trim();
	return s.length > max ? s.slice(0, max) : s;
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

	// Degrades cleanly when the binding is absent (local dev, unit tests, a deploy
	// from before the binding was wired): the client ignores the answer anyway.
	const db = platform?.env?.ANALYTICS_DB;
	if (!db) return jsonResponse({ ok: false, reason: 'no-db' }, origin);

	try {
		await bumpMetric(db, 'play', {
			songId,
			title: str(body.title, MAX_FIELD),
			artist: str(body.artist, MAX_FIELD),
			source: str(body.source, MAX_FIELD)
		});
	} catch {
		return jsonResponse({ ok: false, reason: 'db-error' }, origin);
	}
	return jsonResponse({ ok: true }, origin);
};
