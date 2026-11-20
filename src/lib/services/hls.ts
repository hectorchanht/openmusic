// hls.ts — HLS helpers, pure and store-free (43-D-09).
//
// PROJECT RULE: no HLS in JS — no hls.js, no MediaSource. PLAYBACK hands an `.m3u8` straight to the
// native <audio> element, gated on `canPlayNativeHls()`. The only JS-side HLS work is for DOWNLOADS:
// a playlist URL saved as-is would be a text file, so `stitchHls` fetches the fMP4 init segment plus
// every media segment (all parts are CORS-open) and concatenates them, in playlist order, into one
// `audio/mp4` Blob — init.mp4 + .m4s segments concatenated is a valid m4a.
//
// Detection is by URL SHAPE (`.m3u8` path), never by source name.

/** True when `url`'s path ends in `.m3u8` (query string ignored). */
export function isHlsUrl(url: string | null): boolean {
	if (!url) return false;
	try {
		return new URL(url).pathname.toLowerCase().endsWith('.m3u8');
	} catch {
		return false;
	}
}

let nativeHls: boolean | null = null;

/**
 * Can the native <audio> element play HLS (iOS/macOS Safari, recent Android Chrome)? Memoized per
 * page; false under node/SSR. Tests reset the memo with `_resetHlsSupportForTests()`.
 */
export function canPlayNativeHls(): boolean {
	if (nativeHls === null) {
		nativeHls =
			typeof document !== 'undefined' &&
			document.createElement('audio').canPlayType('application/vnd.apple.mpegurl') !== '';
	}
	return nativeHls;
}

/** Test-only: clear the `canPlayNativeHls` memo. */
export function _resetHlsSupportForTests(): void {
	nativeHls = null;
}

/** Resolve a playlist URI against the playlist URL; only https parts are accepted (T-43-14). */
function resolvePart(uri: string, baseUrl: string): string {
	const href = new URL(uri, baseUrl).href;
	if (!href.startsWith('https://')) throw new Error(`hls: non-https part ${href}`);
	return href;
}

/**
 * Parse an HLS MEDIA playlist into absolute part URLs. A master playlist (`#EXT-X-STREAM-INF`)
 * throws — callers are expected to hold a media playlist URL.
 */
export function parseHlsMedia(text: string, baseUrl: string): { init: string | null; segments: string[] } {
	let init: string | null = null;
	const segments: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith('#EXT-X-STREAM-INF')) throw new Error('hls: master playlist, not media');
		if (line.startsWith('#EXT-X-MAP:')) {
			const m = /URI="([^"]+)"/.exec(line);
			if (m) init = resolvePart(m[1], baseUrl);
			continue;
		}
		if (line.startsWith('#')) continue;
		segments.push(resolvePart(line, baseUrl));
	}
	return { init, segments };
}

const STITCH_CONCURRENCY = 4;

/**
 * Download an HLS media playlist and stitch it into ONE `audio/mp4` Blob (init + segments, in
 * playlist order). Throws on any non-ok part or an aborted signal — the caller owns the never-throws
 * boundary. RAW fetch, not apiFetch: these are absolute CDN media bytes, not JSON API calls.
 *
 * ponytail: the whole file is held in memory; fine for ≤ ~10 min AAC (~10 MB), revisit (stream to
 * disk) if lossless HLS ever appears.
 */
export async function stitchHls(
	url: string,
	opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}
): Promise<Blob> {
	const { signal, onProgress } = opts;
	const get = async (u: string): Promise<Response> => {
		signal?.throwIfAborted();
		const resp = await fetch(u, { signal });
		if (!resp.ok) throw new Error(`hls: ${resp.status} for ${u}`);
		return resp;
	};
	const { init, segments } = parseHlsMedia(await (await get(url)).text(), url);
	const urls = init ? [init, ...segments] : segments;
	if (!urls.length) throw new Error('hls: empty playlist');

	// Fetched up to STITCH_CONCURRENCY at a time, but each lands in its playlist slot.
	const parts: ArrayBuffer[] = new Array(urls.length);
	let next = 0;
	let done = 0;
	const worker = async () => {
		while (next < urls.length) {
			const i = next++;
			parts[i] = await (await get(urls[i])).arrayBuffer();
			onProgress?.(++done / urls.length);
		}
	};
	await Promise.all(Array.from({ length: Math.min(STITCH_CONCURRENCY, urls.length) }, worker));
	return new Blob(parts, { type: 'audio/mp4' });
}
