// TEST-ONLY SPIKE — NOT A PLAYBACK PATH. Phase-2 media-cache experiment (Hector 2026-11-19:
// test first, decision after). This route exists to MEASURE whether a stable edge byte-proxy +
// Cloudflare Cache API would beat direct kuwo CDN playback. No client code references it.
//
// GATE: every request must carry header `x-spike-key` whose SHA-256 equals SPIKE_KEY_SHA256
// below (only the HASH is in the repo — the key itself never is). Anything else gets a plain
// 404, indistinguishable from a nonexistent route. The spike is removed in a follow-up commit
// immediately after measurement; see ~/workspace/openmusic-mediacache/audit.md Phase-2.
//
// Behaviour: resolve the kuwo signed url SERVER-SIDE (the client never sees it), fetch the
// full object, store it in caches.default under a STABLE uid key (kuwo:<songid>@<level>,
// TTL 3600s), and serve it back with Range support (206 sliced from the cached full object).
// Response header `x-spike-cache: HIT|MISS` marks which path served the bytes.
import type { RequestHandler } from './$types';
import { fetchKuwoDetail } from '$lib/proxy/kuwo';
import { edgeCache } from '$lib/proxy/edge-cache';

const SPIKE_KEY_SHA256 = 'fed9423f5cc7c5670d9f5ed82b5016a01ae2e590cc433894930ed169295ec309';
const SPIKE_TTL_S = 3600;

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function notFound(): Response {
	return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

/** Parse a single-range `bytes=a-b` header against a known length. Null = no/invalid range. */
function parseRange(header: string | null, length: number): { start: number; end: number } | null {
	if (!header) return null;
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m) return null;
	let start = m[1] === '' ? NaN : Number(m[1]);
	let end = m[2] === '' ? NaN : Number(m[2]);
	if (m[1] === '' && Number.isFinite(end)) {
		start = Math.max(0, length - end);
		end = length - 1;
	} else {
		if (!Number.isFinite(start)) return null;
		if (!Number.isFinite(end) || end >= length) end = length - 1;
	}
	if (start < 0 || end < start || start >= length) return null;
	return { start, end };
}

function serveBytes(
	buf: ArrayBuffer,
	rangeHeader: string | null,
	cacheState: 'HIT' | 'MISS',
	contentType: string
): Response {
	const range = parseRange(rangeHeader, buf.byteLength);
	const headers = new Headers({
		'content-type': contentType,
		'accept-ranges': 'bytes',
		'x-spike-cache': cacheState,
		'cache-control': 'no-store'
	});
	if (range) {
		const slice = buf.slice(range.start, range.end + 1);
		headers.set('content-range', `bytes ${range.start}-${range.end}/${buf.byteLength}`);
		headers.set('content-length', String(slice.byteLength));
		return new Response(slice, { status: 206, headers });
	}
	headers.set('content-length', String(buf.byteLength));
	return new Response(buf, { status: 200, headers });
}

export const GET: RequestHandler = async ({ params, url, request, platform }) => {
	const key = request.headers.get('x-spike-key') ?? '';
	if ((await sha256Hex(key)) !== SPIKE_KEY_SHA256) return notFound();

	const songid = (params.songid ?? '').trim();
	if (!/^\d{1,12}$/.test(songid)) return notFound();
	const level = url.searchParams.get('level') ?? '320k';

	const cache = edgeCache();
	const cacheKey = new Request(
		`https://openmusic.lol/__spike_cache__/kuwo:${songid}@${encodeURIComponent(level)}`
	);

	if (cache) {
		const hit = await cache.match(cacheKey);
		if (hit) {
			const buf = await hit.arrayBuffer();
			return serveBytes(buf, request.headers.get('range'), 'HIT', hit.headers.get('content-type') ?? 'audio/mpeg');
		}
	}

	// MISS — resolve the signed url server-side and pull the FULL object through the edge.
	const { status, body } = await fetchKuwoDetail(songid, level);
	const signedUrl =
		status === 200 && body && typeof body === 'object'
			? ((body as { data?: { url?: unknown } }).data?.url as string | undefined)
			: undefined;
	if (!signedUrl) return new Response('spike: resolve failed', { status: 502 });

	const upstream = await fetch(signedUrl);
	if (!upstream.ok) return new Response('spike: upstream failed', { status: 502 });
	const contentType = upstream.headers.get('content-type') ?? 'audio/mpeg';
	const buf = await upstream.arrayBuffer();

	if (cache) {
		const toStore = new Response(buf.slice(0), {
			status: 200,
			headers: {
				'content-type': contentType,
				'content-length': String(buf.byteLength),
				'accept-ranges': 'bytes',
				'cache-control': `public, max-age=${SPIKE_TTL_S}, s-maxage=${SPIKE_TTL_S}`
			}
		});
		platform?.ctx?.waitUntil(cache.put(cacheKey, toStore));
	}

	return serveBytes(buf, request.headers.get('range'), 'MISS', contentType);
};
