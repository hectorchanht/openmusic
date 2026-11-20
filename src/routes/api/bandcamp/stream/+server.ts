// Bandcamp stream byte-pipe (43) — the DOWNLOAD leg only. <audio> plays the
// direct bcbits URL (Track.audioUrl); the adapter stamps this route as
// Track.proxyUrl because bcbits sends no ACAO header, so a browser fetch() →
// Blob of the direct URL is CORS-blocked (ccmixter stream route precedent).
//
// Safety shape (deliberately NOT an open proxy):
//   - The only input is a `band-track` numeric id; the media URL is re-derived
//     server-side via resolveBandcampStream (fixed templates, 302 host-checked).
//   - isBcbitsMediaUrl is re-checked HERE before the media fetch — the pipe is
//     the SSRF-sensitive seam, so it does not rely on the helper alone.
//   - Response carries only media headers + own-origin CORS. No Referer needed
//     (bcbits accepts none). Failures are 503 (never 502 — CF replaces those).
// Per-isolate memo (1 h; bcbits URLs are valid 24 h) keeps seeks/Range calls
// cheap; a media 403/410 drops the memo and re-resolves exactly ONCE.
import type { RequestHandler } from './$types';
import { corsHeaders, corsPreflight } from '$lib/proxy/http';
import { isBandcampId, isBcbitsMediaUrl, resolveBandcampStream } from '$lib/proxy/bandcamp';

const MEMO_TTL_MS = 60 * 60 * 1000;
const memo = new Map<string, { url: string; at: number }>();

async function lookup(id: string, fresh: boolean): Promise<string | null> {
	const hit = memo.get(id);
	if (!fresh && hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.url;
	memo.delete(id);
	try {
		const r = await resolveBandcampStream(id, AbortSignal.timeout(10000));
		if (r) memo.set(id, { url: r.url, at: Date.now() });
		return r?.url ?? null;
	} catch {
		return null;
	}
}

/** RAW fetch: a media body must not be retried/cancelled mid-stream by fetchWithRetry. */
function fetchMedia(mediaUrl: string, range: string | null): Promise<Response | null> {
	if (!isBcbitsMediaUrl(mediaUrl)) return Promise.resolve(null);
	return fetch(mediaUrl, { headers: range ? { Range: range } : {} }).catch(() => null);
}

export const GET: RequestHandler = async ({ url, request }) => {
	const cors = corsHeaders(request.headers.get('origin'));
	const id = (url.searchParams.get('id') ?? '').trim();
	if (!isBandcampId(id)) return new Response('bad id', { status: 400, headers: cors });

	const range = request.headers.get('range');
	let media = await lookup(id, false);
	let res = media ? await fetchMedia(media, range) : null;
	if (res && (res.status === 403 || res.status === 410)) {
		await res.body?.cancel().catch(() => {});
		media = await lookup(id, true);
		res = media ? await fetchMedia(media, range) : null;
	}
	if (!res || !(res.status === 200 || res.status === 206)) {
		await res?.body?.cancel().catch(() => {});
		return new Response('upstream unavailable', { status: 503, headers: cors });
	}

	const headers: Record<string, string> = { ...cors };
	for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
		const v = res.headers.get(h);
		if (v) headers[h] = v;
	}
	if (!headers['accept-ranges']) headers['accept-ranges'] = 'bytes';
	return new Response(res.body, { status: res.status, headers });
};

export const OPTIONS: RequestHandler = ({ request }) => corsPreflight(request);
