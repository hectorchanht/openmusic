// GET /api/analytics/report — the OpenMusic data dashboard feed for the
// pseudonymous store (quick-261122-pseudo, step 3 of Hector's 2026-11-20 ruling).
// Returns ONLY aggregates (distinct users day/week/total, D1/D7 retention, top
// songs, search-miss list, play-failure by source, lyrics-missing demand) — no
// pseudo_id ever leaves the database through this route (pseudo-report.ts).
//
// AUTH: bearer ANALYTICS_READ_TOKEN (`wrangler pages secret put`, never a var).
// FAILS CLOSED via bearerMatches — an unset secret rejects every request. The
// token never ships on a device; it lives with the maintainer (the /analytics
// dashboard page asks for it and keeps it in that browser only).
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — `GET`.

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse } from '$lib/proxy/http';
import { bearerMatches } from '$lib/proxy/diag-auth';
import { buildPseudoReport } from '$lib/services/pseudo-report';

export const GET: RequestHandler = async ({ url, request, platform }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;

	if (!(await bearerMatches(request.headers.get('authorization'), env?.ANALYTICS_READ_TOKEN))) {
		return jsonResponse({ ok: false, err: 'unauthorized' }, origin, { status: 401 });
	}
	const db = env?.ANALYTICS_DB;
	if (!db) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	const daysParam = Number(url.searchParams.get('days') ?? '30');
	const days = Number.isInteger(daysParam) && daysParam >= 1 && daysParam <= 365 ? daysParam : 30;
	try {
		const report = await buildPseudoReport(db, new Date(), days);
		return jsonResponse({ ok: true, report }, origin, { cacheControl: 'no-store' });
	} catch {
		// Most likely cause before the DDL is applied: "no such table: pseudo_events".
		return jsonResponse({ ok: false, err: 'db-error' }, origin);
	}
};
