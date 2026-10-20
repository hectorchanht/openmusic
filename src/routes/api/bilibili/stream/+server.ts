// Bilibili audio stream proxy (quick-261020-bili) — the reason this source has a
// third route. bilivideo.com CDN urls enforce `Referer: https://www.bilibili.com/`
// (live-probed 2026-10-20: no Referer → 403, Referer https://openmusic.lol/ → 403,
// bilibili Referer → 206), and an HTML <audio> element cannot set request headers
// (the app even sends referrerpolicy="no-referrer"). So playback streams through
// THIS route, which re-resolves the bvid, fetches the CDN url WITH the bilibili
// Referer, and passes Range requests through for seeking.
//
// Safety shape (this is deliberately NOT an open proxy):
//   - The only input is a bvid (`/^BV[0-9A-Za-z]{10}$/`); the upstream URL is
//     always produced by our own resolver, never by the caller.
//   - The resolved host is allow-listed (bilivideo.com / akamaized.net) in
//     $lib/proxy/bilibili.isBiliCdnUrl before any fetch happens.
//   - Response carries only media headers + own-origin CORS (jsonResponse idiom
//     doesn't fit byte streams, so headers are assembled here from corsHeaders).
// The per-isolate memo (10 min) keeps seeks from re-running the resolve chain;
// a CDN 403 (stale signed url) triggers exactly ONE fresh resolve + retry.
import type { RequestHandler } from './$types';
import { corsHeaders } from '$lib/proxy/http';
import { biliResolveDashAudio, isBiliCdnUrl, BILI_UA, type BiliDashAudio } from '$lib/proxy/bilibili';

const BVID_RE = /^BV[0-9A-Za-z]{10}$/;
const MEMO_TTL_MS = 10 * 60 * 1000;

const memo = new Map<string, { dash: BiliDashAudio; at: number }>();

async function resolveFresh(bvid: string): Promise<BiliDashAudio | null> {
	const dash = await biliResolveDashAudio(bvid).catch(() => null);
	if (dash) memo.set(bvid, { dash, at: Date.now() });
	return dash;
}

async function resolveMemoized(bvid: string): Promise<BiliDashAudio | null> {
	const hit = memo.get(bvid);
	if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.dash;
	return resolveFresh(bvid);
}

/** One CDN fetch attempt with the bilibili Referer + the caller's Range, if any. */
function fetchCdn(cdnUrl: string, range: string | null): Promise<Response> {
	const headers: Record<string, string> = {
		'User-Agent': BILI_UA,
		Referer: 'https://www.bilibili.com/'
	};
	if (range) headers.Range = range;
	// RAW fetch (not fetchWithRetry): a media body must not be retried/cancelled
	// mid-stream by the JSON-proxy retry helper.
	return fetch(cdnUrl, { headers });
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const cors = corsHeaders(origin);
	const bvid = (url.searchParams.get('bvid') ?? '').trim();
	if (!BVID_RE.test(bvid)) return new Response('bad bvid', { status: 400, headers: cors });

	const range = request.headers.get('range');
	let dash = await resolveMemoized(bvid);
	if (!dash || !isBiliCdnUrl(dash.url)) {
		return new Response('unresolvable', { status: 502, headers: cors });
	}

	let res = await fetchCdn(dash.url, range).catch(() => null);
	if (res && res.status === 403) {
		// Signed URL may have expired early — one fresh resolve, one retry.
		await res.body?.cancel().catch(() => {});
		dash = await resolveFresh(bvid);
		if (dash && isBiliCdnUrl(dash.url)) {
			res = await fetchCdn(dash.url, range).catch(() => null);
		}
	}
	if (!res || !(res.status === 200 || res.status === 206)) {
		return new Response('upstream unavailable', { status: 502, headers: cors });
	}

	const headers: Record<string, string> = { ...cors };
	for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
		const v = res.headers.get(h);
		if (v) headers[h] = v;
	}
	if (!headers['accept-ranges']) headers['accept-ranges'] = 'bytes';
	return new Response(res.body, { status: res.status, headers });
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
