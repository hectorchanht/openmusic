// Migu lyric edge proxy (quick-261020-migu; k3y: caches.default at 24h).
//
// musicdl's lyric leg: the PC strategy listen call returns `data.lrcUrl` (a direct
// LRC file on d.musicapp.migu.cn) alongside the audio fields. This route runs that
// call, follows lrcUrl server-side and returns the lyric TEXT as { lrc } — the shape
// every adapter's resolve() produces. (The search rows also carry a lyricUrl; the
// PC-listen leg is used because it needs only the composite identity the adapter
// already holds — contentId + copyrightId — and survives serializeTrack's whitelist.)
// Any failure → { lrc: null }: lyrics are best-effort everywhere in this app.
import type { RequestHandler } from './$types';
import { fetchWithRetry, jsonResponse, corsPreflight } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';

const MG_PC = 'https://app.c.nf.migu.cn/MIGUM3.0/strategy/pc/listen/v1.0';
const TTL = 86400; // 24h — lyrics are immutable per song (kugou lyric route idiom)
const PC_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const ID_RE = /^\d{6,24}$/;

// Shared JSON responder (src/lib/proxy/http.ts).
const jsonPassthrough = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

interface PcBody {
	code?: string;
	data?: { lrcUrl?: string; lyricUrl?: string };
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const cid = (url.searchParams.get('contentId') ?? '').trim();
	const cpid = (url.searchParams.get('copyrightId') ?? '').trim();
	if (!ID_RE.test(cid) || !ID_RE.test(cpid)) return jsonPassthrough({ lrc: null }, origin);

	const cache = edgeCache();
	const cacheReq = new Request(url.toString());
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			const cached = await hit.json();
			return jsonPassthrough(cached, origin, TTL);
		}
	}

	try {
		const upstream =
			`${MG_PC}?scene=&netType=01&resourceType=2&toneFlag=PQ` +
			`&contentId=${encodeURIComponent(cid)}&copyrightId=${encodeURIComponent(cpid)}`;
		const res = await fetchWithRetry(
			upstream,
			{
				signal: AbortSignal.timeout(8000),
				headers: { 'User-Agent': PC_UA, Channel: '014X031', Referer: 'https://music.migu.cn/' }
			},
			1
		);
		const body = (await res.json()) as PcBody | null;
		const lrcUrl = body?.data?.lrcUrl || body?.data?.lyricUrl;
		// The lyric file must live on Migu's own content host — never fetch arbitrary URLs.
		if (!lrcUrl || !/^https:\/\/d\.musicapp\.migu\.cn\//.test(lrcUrl)) {
			return jsonPassthrough({ lrc: null }, origin);
		}
		const lres = await fetchWithRetry(
			lrcUrl,
			{ signal: AbortSignal.timeout(8000), headers: { 'User-Agent': PC_UA } },
			1
		);
		if (!lres.ok) return jsonPassthrough({ lrc: null }, origin);
		const text = await lres.text();
		if (!text || !text.includes('[')) return jsonPassthrough({ lrc: null }, origin);

		const out = { lrc: text };
		if (cache) {
			const cached = new Response(JSON.stringify(out), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			});
			await cache.put(cacheReq, cached);
		}
		return jsonPassthrough(out, origin, TTL);
	} catch {
		return jsonPassthrough({ lrc: null }, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => corsPreflight(request);
