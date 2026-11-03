// CCMixter audio stream proxy (quick-261101-ccm) — the reason this source has
// a second route. ccmixter.org media enforces `Referer: https://ccmixter.org/`
// (live-probed 2026-11-01: no Referer → 403, foreign Referer → 403), and an
// HTML <audio> element cannot set request headers. So playback streams
// through THIS route, which re-derives the media URL from the upload id,
// fetches it WITH the ccmixter Referer, and passes Range requests through
// for seeking. Mirrors the /api/bilibili/stream shape with two deliberate
// deltas: failures are 503 (never 502 — the CF edge replaces 502 bodies),
// and the resolve hop is the by-id XSPF lookup (the canonical primary file,
// even when an upload carries several mp3 renditions).
//
// Safety shape (deliberately NOT an open proxy):
//   - The only input is a numeric upload id (/^\d{1,10}$/); the upstream URL
//     is always produced by our own parser, never by the caller.
//   - The resolved URL must pass $lib/proxy/ccmixter.isCcmixterMediaUrl
//     (https + ccmixter.org + /content/…​.mp3) before any fetch happens.
//   - Response carries only media headers + own-origin CORS.
// The per-isolate memo (10 min) keeps seeks from re-running the lookup; a
// media 403 triggers exactly ONE fresh lookup + retry.
import type { RequestHandler } from './$types';
import { corsHeaders, corsPreflight, fetchWithRetry } from '$lib/proxy/http';
import { parseCcmixterLocation, isCcmixterMediaUrl } from '$lib/proxy/ccmixter';

const ID_RE = /^\d{1,10}$/;
const MEMO_TTL_MS = 10 * 60 * 1000;
const CCMIXTER_REFERER = 'https://ccmixter.org/';

const memo = new Map<string, { location: string; at: number }>();

async function lookupFresh(id: string): Promise<string | null> {
	try {
		const res = await fetchWithRetry(
			`https://ccmixter.org/api/query?f=xspf&ids=${encodeURIComponent(id)}`,
			{ signal: AbortSignal.timeout(8000) },
			2
		);
		if (!res.ok) return null;
		const location = parseCcmixterLocation(await res.text());
		if (location) memo.set(id, { location, at: Date.now() });
		return location;
	} catch {
		return null;
	}
}

async function lookupMemoized(id: string): Promise<string | null> {
	const hit = memo.get(id);
	if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.location;
	return lookupFresh(id);
}

/** One media fetch attempt with the ccmixter Referer + the caller's Range, if any. */
function fetchMedia(mediaUrl: string, range: string | null): Promise<Response> {
	const headers: Record<string, string> = { Referer: CCMIXTER_REFERER };
	if (range) headers.Range = range;
	// RAW fetch (not fetchWithRetry): a media body must not be retried/cancelled
	// mid-stream by the JSON-proxy retry helper.
	return fetch(mediaUrl, { headers });
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const cors = corsHeaders(origin);
	const id = (url.searchParams.get('id') ?? '').trim();
	if (!ID_RE.test(id)) return new Response('bad id', { status: 400, headers: cors });

	const range = request.headers.get('range');
	let location = await lookupMemoized(id);
	if (!location || !isCcmixterMediaUrl(location)) {
		return new Response('unresolvable', { status: 503, headers: cors });
	}

	let res = await fetchMedia(location, range).catch(() => null);
	if (res && res.status === 403) {
		// Memoized location went stale (file moved) — one fresh lookup, one retry.
		await res.body?.cancel().catch(() => {});
		location = await lookupFresh(id);
		if (location && isCcmixterMediaUrl(location)) {
			res = await fetchMedia(location, range).catch(() => null);
		}
	}
	if (!res || !(res.status === 200 || res.status === 206)) {
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
