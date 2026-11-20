// GET /api/sponsored/supporters — the public Supporters wall list.
//
// Reads the SUPPORTERS_DB D1 binding (database `openmusic-supporters`, table
// `supporters`) and returns ONLY what a listed supporter explicitly opted to
// publish: { name, message?, month }. The row key is a SHA-256 of the license
// key and is never selected; no emails exist in this database at all. Rows are
// written by POST /api/sponsored/verify (see that route for the opt-in /
// opt-out contract).
//
// Fails soft like the other sponsored routes: a missing binding or a D1 error
// answers HTTP 200 with { ok:false, supporters: [] } so the /supporters page
// degrades to its empty state instead of an edge error page (Cloudflare
// rewrites 5xx Pages bodies — same posture as /api/analytics/play).
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — `GET` and `POST`. A top-level
// helper export makes SvelteKit throw "Invalid export" at REQUEST time
// (same rule as /api/lyric-offset); helpers would live in $lib/proxy.

import type { RequestHandler } from './$types';
import { jsonResponse } from '$lib/proxy/http';

const MAX_ROWS = 200;
const MONTHS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
];

type WallRow = { display_name: string; message: string; created_at: string };

/** "2026-10-05T…" → "October 2026" (UTC, matching how created_at was stamped). */
function monthLabel(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const GET: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');
	const db = platform?.env?.SUPPORTERS_DB;
	if (!db) return jsonResponse({ ok: false, reason: 'no-db', supporters: [] }, origin);
	try {
		const { results } = await db
			.prepare(
				'SELECT display_name, message, created_at FROM supporters ORDER BY created_at DESC LIMIT ?'
			)
			.bind(MAX_ROWS)
			.all<WallRow>();
		const supporters = (results ?? []).map((r) => ({
			name: r.display_name,
			...(r.message ? { message: r.message } : {}),
			month: monthLabel(r.created_at)
		}));
		// The wall changes rarely (a verify at a time) — let the edge hold it
		// for a few minutes so the public page is not a D1 read per visit.
		return jsonResponse({ ok: true, supporters }, origin, {
			cacheControl: 'public, max-age=300'
		});
	} catch {
		return jsonResponse({ ok: false, reason: 'db-error', supporters: [] }, origin);
	}
};
