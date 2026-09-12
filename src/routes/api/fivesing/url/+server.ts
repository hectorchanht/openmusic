// 5sing audio-URL resolve proxy (quick-260607-hvu).
//
// Calls `mobileapi.5sing.kugou.com/song/getSongUrl?songid=…&songtype=fc|bz|yc` and returns
// `{ code, data: { squrl, hqurl, lqurl, …_backup } }` verbatim. The adapter picks the best
// available tier client-side and falls through to backups. Audio URL has a 1-2h timestamp
// segment; the player re-calls resolve() on detailsLoaded=false (e.g. after an <audio>
// error event), and the cross-source fallback (gte SRC-FB-01) handles full exhaustion.
//
// Songtype is identity-critical: musicdl's source code treats fc/bz/yc as distinct
// namespaces for the same numeric songid, and our compound uid encodes this. We pin the
// allowed values here so a malformed query never reaches upstream.
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders, jsonResponse } from '$lib/proxy/http';

// Upstream is http-only (TLS cert mismatch on https, mirrors the search proxy). The CLIENT
// still talks to this route over its own-origin https; the worker→upstream hop is http.
const FS_URL = 'http://mobileapi.5sing.kugou.com/song/getSongUrl';
const ALLOWED_TYPES = new Set(['fc', 'bz', 'yc']);

// Shared JSON responder (src/lib/proxy/http.ts).
const jsonPassthrough = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const songid = (url.searchParams.get('songid') ?? '').trim();
	const songtype = (url.searchParams.get('songtype') ?? '').trim();

	// Validate inputs at the edge — never blindly forward an unknown songtype.
	if (!songid || !ALLOWED_TYPES.has(songtype)) {
		return jsonPassthrough({ code: 0, data: {} }, origin);
	}

	const upstream =
		`${FS_URL}?songid=${encodeURIComponent(songid)}&songtype=${encodeURIComponent(songtype)}`;

	try {
		const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
		const body = await res.json();
		return jsonPassthrough(body, origin);
	} catch {
		return jsonPassthrough({ code: 0, data: {} }, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
