// kuwo detail edge route (quick-261004-n1i) — full-length audio through the resolver chain ∥ lyrics,
// answered in the legacy `{ code: 200, data: { name, artist, album, pic, url, lyric } }` shape.
// A 502 when no resolver yields a valid *.kuwo.cn url, ON PURPOSE: the client's kuwoJson seam counts
// a non-200 against the kuwo health gate. NEVER cached — resolver urls are signed and expiring.
// `type` / `format` are accepted and ignored (the legacy client still sends them). Verb exports only.
import type { RequestHandler } from './$types';
import { corsHeaders, jsonResponse } from '$lib/proxy/http';
import { fetchKuwoDetail } from '$lib/proxy/kuwo';

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const id = (url.searchParams.get('id') ?? '').trim();
	// Validated BEFORE any upstream fetch (T-n1i-06).
	if (!/^\d{1,12}$/.test(id)) return jsonResponse({ code: 400, msg: 'kuwo: bad id' }, origin, { status: 400 });
	const { status, body } = await fetchKuwoDetail(id, url.searchParams.get('level'));
	return jsonResponse(body, origin, { status, cacheControl: 'no-store' });
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
