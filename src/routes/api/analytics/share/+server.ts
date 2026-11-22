// POST /api/analytics/share — anonymous share-sheet count ping (quick-261122-sharefeed).
// Body: { action: 'open' | 'copy' | 'wa', lang: <promo lang id>, variant?: 'full' | 'short' | 'link' }.
//
// K-factor instrumentation for the ready-written share sheet (GOLD RULE "feed it to their
// mouth"): how often the sheet opens, how often a message is copied, how often the WhatsApp
// handoff is tapped — per message language and variant, so the canon copy can be judged.
//
// DATA DOCTRINE (quick-261118-datadoctrine; Hector, 2026-11-18): anonymous TOTALS ONLY. Every
// accepted field is an ALLOWLISTED enum — no free text reaches storage, so a sender name, a track
// or any identifier cannot be smuggled into the counters even by a hostile client. The ping folds
// into a (day, 'share_<action>', 'promo:<lang>:<variant>') counter in metric_counters via the
// single write path ($lib/services/metric-counter). No session, no IP, no User-Agent, nothing
// finer than the UTC day.
//
// Fails soft like /api/analytics/play: problems answer HTTP 200 { ok:false } where possible — the
// client is fire-and-forget.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — a top-level helper export makes SvelteKit throw
// "Invalid export" at REQUEST time.

import type { RequestHandler } from './$types';
import { jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import { bumpMetric, type MetricAction } from '$lib/services/metric-counter';

const MAX_BODY_BYTES = 512;
const ACTIONS: Record<string, MetricAction> = { open: 'share_open', copy: 'share_copy', wa: 'share_wa' };
const LANGS = new Set(['yue', 'zh-TW', 'zh-CN', 'en', 'ja', 'ko']);
const VARIANTS = new Set(['full', 'short', 'link']);

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
	const action = typeof body.action === 'string' ? ACTIONS[body.action] : undefined;
	const lang = typeof body.lang === 'string' && LANGS.has(body.lang) ? body.lang : null;
	const variant = body.variant === undefined ? 'full' : typeof body.variant === 'string' && VARIANTS.has(body.variant) ? body.variant : null;
	if (!action || !lang || !variant) {
		return jsonResponse({ ok: false, reason: 'invalid' }, origin, { status: 400 });
	}

	const db = platform?.env?.ANALYTICS_DB;
	if (!db) return jsonResponse({ ok: false, reason: 'no-db' }, origin);

	try {
		await bumpMetric(db, action, { songId: `promo:${lang}:${variant}`, title: '', artist: '', source: 'share' });
	} catch {
		return jsonResponse({ ok: false, reason: 'db-error' }, origin);
	}
	return jsonResponse({ ok: true }, origin);
};
