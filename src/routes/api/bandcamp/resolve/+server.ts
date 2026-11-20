// Bandcamp resolve edge route (43): id → signed bcbits mp3-128 URL + duration.
//
// The only input is a `band-track` numeric id; the upstream URLs are fixed
// templates and the 302 Location is host-checked in resolveBandcampStream.
// The URL is signed for 24 h but per request → no-store keeps the edge cache
// out of it. Failures are 400 (bad id) or 503 — never a 5xx the CF edge
// replaces with its own error page.
import type { RequestHandler } from './$types';
import { jsonResponse, corsPreflight } from '$lib/proxy/http';
import { isBandcampId, resolveBandcampStream } from '$lib/proxy/bandcamp';

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const id = (url.searchParams.get('id') ?? '').trim();
	if (!isBandcampId(id)) {
		return jsonResponse({ error: 'bad id' }, origin, { status: 400, cacheControl: 'no-store' });
	}
	try {
		const r = await resolveBandcampStream(id, AbortSignal.timeout(10000));
		if (!r) return jsonResponse({ error: 'unstreamable' }, origin, { status: 503, cacheControl: 'no-store' });
		return jsonResponse({ url: r.url, duration: r.duration }, origin, { cacheControl: 'no-store' });
	} catch {
		return jsonResponse({ error: 'unstreamable' }, origin, { status: 503, cacheControl: 'no-store' });
	}
};

export const OPTIONS: RequestHandler = ({ request }) => corsPreflight(request);
