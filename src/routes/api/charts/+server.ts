// Edge chart shelves — /api/charts (39-D-13 / 39-D-14 / 39-D-15).
//
// GET /api/charts?src=apple|kkbox|yt&kind=…&cc=…  → { items: ChartItem[] }
//
// 39-D-15: ONE route for Apple Music RSS, KKBOX kma and YouTube Charts, so serve-stale, the 5 s
// upstream budget and CORS live once. `/api/charts` is a static segment and wins over the
// `/api/[source]/[...path]` catch-all by SvelteKit route specificity.
//
// THIS FILE EXPORTS ONLY HTTP VERBS. A top-level non-verb `export function` in a `+server.ts`
// 500s at REQUEST time ("Invalid export") and unit tests do NOT catch it, because they import
// the module directly (`svelte-server-endpoint-only-verb-exports`). Every helper therefore lives
// in $lib/proxy/charts.ts. `jsonResult` below is private (non-exported), matching deezer/chart.
import type { RequestHandler } from './$types';
import { corsHeaders, jsonResponse } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import {
	validateChartQuery,
	chartCacheKey,
	serveChart,
	loadChartUpstream,
	CHART_CLIENT_TTL_S
} from '$lib/proxy/charts';

const jsonResult = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

export const GET: RequestHandler = async ({ url, request, platform }) => {
	const origin = request.headers.get('origin');
	const q = validateChartQuery(url.searchParams);
	// T-39-10: anything off the allowlist answers empty with zero cache touches and zero subrequests.
	if (!q) return jsonResult({ items: [] }, origin);

	const items = await serveChart(
		edgeCache(),
		chartCacheKey(url.origin, q),
		() => loadChartUpstream(q),
		platform?.ctx
	);
	// An empty answer carries no browser ttl, so the client's next try is not pinned to a blank shelf
	// for 30 minutes — the same "empty is never cached" rule the edge entry follows.
	return jsonResult({ items }, origin, items.length ? CHART_CLIENT_TTL_S : undefined);
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
