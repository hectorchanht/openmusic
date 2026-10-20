// Kugou lyric edge proxy (quick-261020-kugo; k3y: caches.default at 24h).
//
// Two-step KRC lyric flow (guohuiyuan/music-lib kugou lyric + Meting `kugou_lyric`):
//   1. `krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=<artist - title>
//      &duration=<ms>&hash=<hash>` → candidates[0] { id, accesskey }
//   2. `lyrics.kugou.com/download?ver=1&client=pc&id=…&accesskey=…&fmt=lrc&charset=utf8`
//      → { content: <base64 LRC> } — decoded HERE so the client adapter receives plain
//      LRC text, the same shape every other adapter's resolve() produces.
// Lyrics are immutable per song, hence the 24h edge cache (search metadata gets 1h).
// Any failure → { lrc: null }: lyrics are best-effort everywhere in this app.
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders, jsonResponse } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';

const KRC_SEARCH = 'https://krcs.kugou.com/search';
const KRC_DOWNLOAD = 'https://lyrics.kugou.com/download';
const TTL = 86400; // 24h
const PC_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const HASH_RE = /^[0-9a-fA-F]{32}$/;

// Shared JSON responder (src/lib/proxy/http.ts).
const jsonPassthrough = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

interface KrcSearchBody {
	candidates?: Array<{ id?: string; accesskey?: string }>;
}
interface KrcDownloadBody {
	content?: string;
}

/** base64 → utf8 text (edge-safe: atob + TextDecoder, no Buffer dependency). */
function base64ToUtf8(b64: string): string {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new TextDecoder('utf-8').decode(bytes);
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const keyword = (url.searchParams.get('keyword') ?? '').trim();
	const hash = (url.searchParams.get('hash') ?? '').trim();
	const durationMs = Math.max(0, Number(url.searchParams.get('duration')) || 0);
	if (!keyword || !HASH_RE.test(hash)) return jsonPassthrough({ lrc: null }, origin);

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
		const searchUrl =
			`${KRC_SEARCH}?ver=1&man=yes&client=mobi&keyword=${encodeURIComponent(keyword)}` +
			`&duration=${durationMs}&hash=${encodeURIComponent(hash)}`;
		const sRes = await fetchWithRetry(
			searchUrl,
			{ signal: AbortSignal.timeout(8000), headers: { 'User-Agent': PC_UA } },
			1
		);
		const sBody = (await sRes.json()) as KrcSearchBody | null;
		const cand = sBody?.candidates?.[0];
		if (!cand?.id || !cand?.accesskey) return jsonPassthrough({ lrc: null }, origin);

		const dlUrl =
			`${KRC_DOWNLOAD}?ver=1&client=pc&fmt=lrc&charset=utf8` +
			`&id=${encodeURIComponent(cand.id)}&accesskey=${encodeURIComponent(cand.accesskey)}`;
		const dRes = await fetchWithRetry(
			dlUrl,
			{ signal: AbortSignal.timeout(8000), headers: { 'User-Agent': PC_UA } },
			1
		);
		const dBody = (await dRes.json()) as KrcDownloadBody | null;
		if (!dBody?.content) return jsonPassthrough({ lrc: null }, origin);

		const body = { lrc: base64ToUtf8(dBody.content) };
		if (cache) {
			const cached = new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			});
			await cache.put(cacheReq, cached);
		}
		return jsonPassthrough(body, origin, TTL);
	} catch {
		return jsonPassthrough({ lrc: null }, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
