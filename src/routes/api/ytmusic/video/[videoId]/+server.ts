// YouTube Music VIDEO byte-proxy (quick-261024-vid1) — the Now Playing video layer's feed.
//
// GET /api/ytmusic/video/:videoId?q=720 — resolves the SAME gated VISIONOS player call as
// the audio route (shared callPlayerGated in $lib/proxy/ytmusic), selects the best avc/mp4
// video-only format at or below the `q` height cap (selectVideoFormat), and range-proxies
// the googlevideo bytes in the same invocation (the URL is IP-locked — see the audio
// route's header for the full reasoning). The client feeds the bytes into an MSE
// SourceBuffer; the audio itself keeps playing from itag 140 via the audio route — this
// route carries PICTURE ONLY.
//
// Caches (per PoP, like the audio route):
//  - the resolved video URL + its pick metadata (mimeType/height for the SourceBuffer and
//    the UI) under `__ytmusic__/video-url/<id>@<cap>`, 3 h — repeat plays skip the gate.
//  - NO byte cache in phase 1: an MV is 20-60 MB; PoP storage is better spent on audio.
//    Any non-OK media answer invalidates the URL entry and falls through to a fresh resolve.
//
// SECURITY: same posture as the audio route — we only ever fetch the adaptiveFormats URL
// the player returned (never a client-supplied URL), and the signed URL never leaves the
// edge (only bytes + the pick's mime/height metadata headers do).
import type { RequestHandler } from './$types';
import { corsHeaders, corsPreflight } from '$lib/proxy/http';
import { edgeCache, type EdgeCache } from '$lib/proxy/edge-cache';
import {
	callPlayerGated,
	fetchMedia,
	isPlayable,
	playabilityInfo,
	selectVideoFormat,
	type YtVideoPick
} from '$lib/proxy/ytmusic';

const URL_ATTEMPTS = 3; // player→bytes rounds on a media 403 (audio route posture)
const URL_CACHE_TTL_S = 3 * 60 * 60;
const HEIGHT_CAPS = [240, 360, 480, 720] as const;
const SINGLE_RANGE_SHAPE = /^bytes=\d*-\d*$/;

type VideoPickMeta = Omit<YtVideoPick, 'url'> & { url: string };
const urlCacheKey = (videoId: string, cap: number) =>
	new Request('https://openmusic.lol/__ytmusic__/video-url/' + encodeURIComponent(videoId) + '@' + cap);

function parseCap(raw: string | null): number {
	const n = Number(raw);
	return (HEIGHT_CAPS as readonly number[]).includes(n) ? n : 720;
}

/** The cached pick (url + SourceBuffer metadata) for this video+cap, or null. Implausible
 *  stored shapes are deleted rather than trusted (the cache is a hint, not a trust root). */
async function readCachedPick(cache: EdgeCache, videoId: string, cap: number): Promise<VideoPickMeta | null> {
	try {
		const hit = await cache.match(urlCacheKey(videoId, cap));
		if (!hit) return null;
		const meta = (await hit.json()) as VideoPickMeta;
		if (
			typeof meta?.url !== 'string' ||
			!meta.url.startsWith('https://') ||
			!meta.url.includes('googlevideo.com') ||
			typeof meta?.mimeType !== 'string' ||
			typeof meta?.height !== 'number'
		) {
			await cache.delete(urlCacheKey(videoId, cap)).catch(() => false);
			return null;
		}
		return meta;
	} catch {
		return null;
	}
}

async function writeCachedPick(cache: EdgeCache, videoId: string, cap: number, pick: YtVideoPick): Promise<void> {
	try {
		await cache.put(
			urlCacheKey(videoId, cap),
			new Response(JSON.stringify(pick), {
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${URL_CACHE_TTL_S}` }
			})
		);
	} catch {
		// a cache write failure must never break playback
	}
}

/** Pick metadata as response headers so the client can build its SourceBuffer + quality UI
 *  without a second round-trip. Values are our own pick fields (mime is codec text — header
 *  sanitised to printable ASCII, quotes kept). */
function pickHeaders(pick: VideoPickMeta, extra: Record<string, string> = {}): Record<string, string> {
	const mime = pick.mimeType.replace(/[^\x20-\x7E]/g, '').slice(0, 120);
	return { 'x-ytmusic-video-height': String(pick.height), 'x-ytmusic-video-mime': mime, ...extra };
}

export const GET: RequestHandler = async ({ params, request, url }) => {
	const origin = request.headers.get('origin');
	const videoId = (params.videoId ?? '').trim();
	if (!videoId) return new Response('missing videoId', { status: 400, headers: corsHeaders(origin) });
	const cap = parseCap(url.searchParams.get('q'));
	const range = request.headers.get('range');
	const upstreamHeaders: Record<string, string> = { Range: range ?? 'bytes=0-' };
	const cache = edgeCache();

	let res: Response | null = null;
	let pick: VideoPickMeta | null = null;
	let urlCacheHit = false;

	// Fast path: a cached pick skips the gated player call entirely.
	if (cache && (range === null || SINGLE_RANGE_SHAPE.test(range.trim()))) {
		const cached = await readCachedPick(cache, videoId, cap);
		if (cached) {
			try {
				const mediaRes = await fetchMedia(cached.url, upstreamHeaders);
				if (mediaRes.ok) {
					res = mediaRes;
					pick = cached;
					urlCacheHit = true;
				} else {
					await mediaRes.body?.cancel().catch(() => {});
					await cache.delete(urlCacheKey(videoId, cap)).catch(() => false);
				}
			} catch {
				// network throw — keep the entry, run the live flow
			}
		}
	}

	for (let attempt = 0; !res && attempt < URL_ATTEMPTS; attempt++) {
		const json = await callPlayerGated(videoId);
		if (!isPlayable(json)) {
			const info = playabilityInfo(json);
			const headers: Record<string, string> = { ...corsHeaders(origin) };
			if (info.status) headers['x-ytmusic-playability'] = info.status;
			if (info.reason) headers['x-ytmusic-reason'] = info.reason;
			return new Response('ytmusic video: player not OK', { status: 503, headers });
		}
		const found = selectVideoFormat(json, cap);
		if (!found) {
			// Playable, but no avc/mp4 video rung — a genuine "this track has no watchable
			// picture for us" (audio-only upload / vp9-only). 404, distinctly from a gate 503.
			return new Response('ytmusic video: no avc video format', {
				status: 404,
				headers: { ...corsHeaders(origin), 'x-ytmusic-video': 'none' }
			});
		}
		pick = found;
		if (cache) await writeCachedPick(cache, videoId, cap, found);
		try {
			res = await fetchMedia(found.url, upstreamHeaders);
		} catch {
			return new Response('ytmusic video: upstream error', { status: 503, headers: corsHeaders(origin) });
		}
		if (res.status !== 403) break;
		await res.body?.cancel().catch(() => {});
		res = null;
	}
	if (!res || !pick) return new Response('ytmusic video: upstream error', { status: 503, headers: corsHeaders(origin) });

	const outHeaders: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'video/mp4',
		...pickHeaders(pick, urlCacheHit ? { 'x-ytmusic-urlcache': 'hit' } : {})
	};
	if (!res.ok) {
		// Same posture as the audio route: upstream error bodies are dropped (length/body
		// mismatch → edge 502 page), 502/504 map to 503 so our headers survive.
		await res.body?.cancel().catch(() => {});
		const status = res.status === 502 || res.status === 504 ? 503 : res.status;
		return new Response(null, { status, headers: outHeaders });
	}
	const acceptRanges = res.headers.get('accept-ranges');
	if (acceptRanges != null) outHeaders['Accept-Ranges'] = acceptRanges;
	const contentLength = res.headers.get('content-length');
	if (contentLength != null) outHeaders['Content-Length'] = contentLength;
	if (!range) return new Response(res.body, { status: 200, headers: outHeaders });
	const contentRange = res.headers.get('content-range');
	if (contentRange != null) outHeaders['Content-Range'] = contentRange;
	return new Response(res.body, { status: res.status, headers: outHeaders });
};

export const OPTIONS: RequestHandler = ({ request }) => corsPreflight(request);
