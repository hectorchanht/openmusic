// POST /api/analytics/download — anonymous download count ping. Body:
// { song_id: string, title?: string, artist?: string, source?: string }.
//
// The client fires from download-track.ts at the single point where a download
// result becomes 'saved' — the convergence of TrackMenu startDownload / the
// "Download from…" picker, DownloadControl, and the album bulk loop. Silent
// background repairs (save:false without dir) are NOT logged: they are
// re-persists the user never initiated. Only user-initiated saves land here.
//
// DATA DOCTRINE (quick-261118-datadoctrine; Hector, 2026-11-18): analytics are
// anonymous TOTALS ONLY. This endpoint increments a (day, 'download', song_id)
// counter in metric_counters (ANALYTICS_DB, database `openmusic-analytics`)
// via $lib/services/metric-counter — the single analytics write path. It
// REPLACES the retired identity-linked design (quick-261023-like-dl), which
// resolved the session to a user_id and stored per-user download rows (with
// quality + byte counts) in the accounts database: that was per-user tracking
// and it is gone. No session is read here, no anon_id (a body field of that
// name is ignored), no quality/bytes, no IP, no User-Agent-derived device/os,
// no country, no timestamp finer than the UTC day.
//
// Fails soft: any problem (no binding, bad body, D1 error) answers HTTP 200
// with { ok:false } — the client is fire-and-forget, and Cloudflare's edge
// rewrites 5xx Pages bodies into its own bare error page (same posture as
// /api/analytics/play).
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

	// Degrades cleanly when the binding is absent (local dev, unit tests, a deploy
	// from before the binding was wired): the client ignores the answer anyway.
	const db = platform?.env?.ANALYTICS_DB;
	if (!db) return jsonResponse({ ok: false, reason: 'no-db' }, origin);

	try {
		await bumpMetric(db, 'download', {
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
