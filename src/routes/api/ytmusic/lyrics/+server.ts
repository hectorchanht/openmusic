// YouTube Music lyrics edge route (Plan 27-02, YT-LYRICS-01).
//
// Does the InnerTube next -> browse two-hop EDGE-side and returns plain { text, attribution } for a
// track's lyrics tab. Metadata endpoints are NOT bot-gated (spike 007), so no visitorData/auth —
// only the public WEB_REMIX key + client context, all edge-side. Own-origin, CORS via corsHeaders +
// the hooks.server.ts seam, OPTIONS 204, edge-cacheable.
//
// Degrades to {} (never a 500 to the client): a genuine no-lyrics track (cacheable) and an upstream
// error (NOT cached) both return {}. Timed/synced LRC is NOT available from YT — the app's existing
// crossSourceLyric(name, artist) fallback covers that, wired in Plan 27-04.
//
// SECURITY (threats T-27-02-01/02/04): `videoId` is placed ONLY into the FIXED NEXT_URL/BROWSE_URL
// request bodies (POST-to-fixed-URL, no open relay). The WEB_REMIX key lives only in those URLs
// (server -> upstream) and is never echoed to a response body. CORS allowlisted (never '*').
import type { RequestHandler } from './$types';
import { corsHeaders, jsonResponse, corsPreflight } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import {
	innerTubePost,
	NEXT_URL,
	BROWSE_URL,
	WEB_REMIX_CONTEXT,
	findLyricsTab,
	extractLyrics,
	callPlayerGated,
	fetchMedia,
	isPlayable,
	extractCaptionTracks,
	pickCaptionTrack,
	captionsToLrc,
	extractDescription
} from '$lib/proxy/ytmusic';

const TTL = 86400; // 1 day — lyrics are stable (also caches a genuine no-lyrics {}).

// Shared JSON responder (src/lib/proxy/http.ts).
const jsonPassthrough = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

function cacheEntry(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
	});
}

/**
 * quick-261024-lyr — the fallback for the (now usual) empty YTM lyrics tab: CAPTIONS first
 * (a human caption track on an MV is very often the song's actual lyrics, and timedtext
 * gives them TIMED, so the lyrics tab syncs), then the video DESCRIPTION (labels paste
 * full lyrics there). Runs the shared gated player resolve; any failure degrades to null
 * and the route answers its usual {}. Never throws.
 */
async function captionOrDescription(
	videoId: string
): Promise<{ result: { text: string; attribution: string } | null; stage: string }> {
	try {
		const json = await callPlayerGated(videoId);
		// 'gated' is TRANSIENT (the bot gate), not a verdict — the caller must not cache it.
		if (!isPlayable(json)) return { result: null, stage: 'gated' };
		const track = pickCaptionTrack(extractCaptionTracks(json));
		if (track) {
			try {
				const res = await fetchMedia(track.baseUrl + '&fmt=json3', {});
				if (res.ok) {
					const lrc = captionsToLrc(await res.json());
					if (lrc) return { result: { text: lrc, attribution: 'YouTube captions' }, stage: 'ok-captions' };
					return { result: null, stage: 'tt-sparse' };
				}
				await res.body?.cancel().catch(() => {});
				return { result: null, stage: `tt-http-${res.status}` };
			} catch {
				return { result: null, stage: 'tt-throw' };
			}
		}
		const description = extractDescription(json);
		if (description.length >= 40) return { result: { text: description, attribution: 'YouTube' }, stage: 'ok-desc' };
		return { result: null, stage: 'no-tracks-desc-short' };
	} catch {
		return { result: null, stage: 'throw' };
	}
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const videoId = (url.searchParams.get('videoId') ?? '').trim();
	// Empty videoId → {}, NO upstream call.
	if (!videoId) return jsonPassthrough({}, origin);

	// Edge cache key = own-origin Request per videoId (NEVER the key-bearing upstream URL).
	const cache = edgeCache();
	const cacheReq = ownOriginCacheKey(url);
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) return jsonPassthrough(await hit.json(), origin, TTL);
	}

	try {
		// Hop 1: next(videoId) -> find the Lyrics tab's browseId. videoId in the fixed-URL body only.
		const nextJson = await innerTubePost(NEXT_URL, {
			context: WEB_REMIX_CONTEXT,
			videoId,
			isAudioOnly: true
		});
		const { browseId } = findLyricsTab(nextJson);
		if (!browseId) {
			// No lyrics tab. quick-261024-lyr: before declaring a miss, run the
			// caption/description fallback. Its result caches like any answer; a GATED
			// fallback (transient) answers {} WITHOUT caching so the next play retries.
			const fb = await captionOrDescription(videoId);
			const result = fb.result ?? {};
			if (cache && fb.stage !== 'gated') await cache.put(cacheReq, cacheEntry(result));
			const res = jsonPassthrough(result, origin, TTL);
			res.headers.set('x-lyr-stage', fb.stage);
			return res;
		}

		// Hop 2: browse(browseId) -> plain text + licensor attribution.
		const browseJson = await innerTubePost(BROWSE_URL, {
			context: WEB_REMIX_CONTEXT,
			browseId
		});
		let result = extractLyrics(browseJson); // { text, attribution }
		let stage = 'browse';
		// quick-261024-lyr: an EMPTY browse text is the fallback's cue too (YouTube's
		// lyrics source has been returning shells); only a real text short-circuits it.
		if (!result.text?.trim()) {
			const fb = await captionOrDescription(videoId);
			stage = fb.stage;
			if (fb.result) result = fb.result;
			if (cache && stage !== 'gated') await cache.put(cacheReq, cacheEntry(result));
			const res = jsonPassthrough(result, origin, TTL);
			res.headers.set('x-lyr-stage', stage);
			return res;
		}
		if (cache) await cache.put(cacheReq, cacheEntry(result));
		return jsonPassthrough(result, origin, TTL);
	} catch {
		// Upstream error → {} with NO cache write (never a 500 to the client; a retry can succeed).
		return jsonPassthrough({}, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => corsPreflight(request);
