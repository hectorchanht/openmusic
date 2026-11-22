// POST /api/analytics/event — pseudonymous analytics event (quick-261122-pseudo;
// Hector's ruling 2026-11-20). Body:
// { pseudo_id: uuid-v4, action: PseudoAction, song_id?, title?, artist?, source?,
//   query? (search_miss), stage? (play_failure), app_version?, platform?: 'mobile'|'desktop' }
//
// Writes ONE row into pseudo_events (ANALYTICS_DB, database `openmusic-analytics`)
// via $lib/services/pseudo-events — the single pseudonymous write path. The
// metric_counters endpoints (play/like/download) are untouched and keep running.
//
// GUARDRAILS (pinned in analytics-doctrine.test.ts):
//   - pseudo_id must be a random UUID v4 — anything else is refused, so no
//     email / account id / fingerprint can ride in through it.
//   - NO IP is read or stored (getClientAddress deliberately unused; the
//     CF-Connecting-IP / X-Forwarded-For headers are never read).
//   - NO User-Agent read, NO session/cookie read, NO accounts DB: an analytics
//     row cannot be joined to a signed-in account — no shared key exists.
//   - Country comes from the CF-IPCountry header as a 2-letter code ("as
//     before"); that is the ONLY request header used beyond Origin/type/length.
//   - Gated by PSEUDO_ANALYTICS_LIVE: until the promise copy is live, every
//     write is refused ({ ok:false, reason:'not-live' }).
//
// Fails soft like the counter endpoints: binding/D1 problems answer 200
// { ok:false } (the client is fire-and-forget; Cloudflare rewrites 5xx bodies).
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — `POST`. A top-level helper
// export makes SvelteKit throw "Invalid export" at REQUEST time.

import type { RequestHandler } from './$types';
import { jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import { PSEUDO_ANALYTICS_LIVE } from '$lib/config/pseudo-analytics';
import {
	FAILURE_STAGES,
	coarseCountry,
	isPseudoAction,
	isPseudoId,
	recordPseudoEvent
} from '$lib/services/pseudo-events';

const MAX_BODY_BYTES = 2048;
const MAX_FIELD = 300;
const MAX_SONG_ID = 256;
const MAX_QUERY = 200;
const MAX_VERSION = 40;

function str(v: unknown, max: number): string {
	if (typeof v !== 'string') return '';
	const s = v.trim();
	return s.length > max ? s.slice(0, max) : s;
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');

	if (origin !== null && !isAllowedOrigin(origin)) {
		return jsonResponse({ ok: false, reason: 'forbidden-origin' }, origin, { status: 403 });
	}
	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return jsonResponse({ ok: false, reason: 'unsupported-type' }, origin, { status: 415 });
	}
	if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
		return jsonResponse({ ok: false, reason: 'too-large' }, origin, { status: 413 });
	}

	// Promise-first ordering: no pseudonymous write before the copy is live.
	if (!PSEUDO_ANALYTICS_LIVE) return jsonResponse({ ok: false, reason: 'not-live' }, origin);

	let body: Record<string, unknown>;
	try {
		const text = await request.text();
		if (text.length > MAX_BODY_BYTES) {
			return jsonResponse({ ok: false, reason: 'too-large' }, origin, { status: 413 });
		}
		body = JSON.parse(text) as Record<string, unknown>;
		if (!body || typeof body !== 'object') throw new Error('not an object');
	} catch {
		return jsonResponse({ ok: false, reason: 'invalid' }, origin, { status: 400 });
	}

	const pseudoId = body.pseudo_id;
	const action = body.action;
	if (!isPseudoId(pseudoId) || !isPseudoAction(action)) {
		return jsonResponse({ ok: false, reason: 'invalid' }, origin, { status: 400 });
	}

	const songId = str(body.song_id, MAX_SONG_ID);
	const query = action === 'search_miss' ? str(body.query, MAX_QUERY) : '';
	const stageRaw = str(body.stage, 20);
	const stage =
		action === 'play_failure' && (FAILURE_STAGES as readonly string[]).includes(stageRaw)
			? stageRaw
			: '';
	// Per-action shape: song events need a song; search_miss needs a query.
	const needsSong = action !== 'search_miss' && action !== 'session_start';
	if ((needsSong && !songId) || (action === 'search_miss' && !query)) {
		return jsonResponse({ ok: false, reason: 'invalid' }, origin, { status: 400 });
	}
	const platformClass =
		body.platform === 'mobile' || body.platform === 'desktop' ? body.platform : '';

	const db = platform?.env?.ANALYTICS_DB;
	if (!db) return jsonResponse({ ok: false, reason: 'no-db' }, origin);

	try {
		await recordPseudoEvent(db, {
			pseudoId,
			action,
			songId: needsSong ? songId : '',
			title: needsSong ? str(body.title, MAX_FIELD) : '',
			artist: needsSong ? str(body.artist, MAX_FIELD) : '',
			source: needsSong ? str(body.source, MAX_FIELD) : '',
			query,
			stage,
			appVersion: str(body.app_version, MAX_VERSION),
			platform: platformClass,
			country: coarseCountry(request.headers.get('cf-ipcountry'))
		});
	} catch {
		return jsonResponse({ ok: false, reason: 'db-error' }, origin);
	}
	return jsonResponse({ ok: true }, origin);
};
