// Direct-first playback URL helper.
//
// Asks our edge (/api/stream-url) for the FINAL upstream stream URL as JSON. The edge
// follows redirects server-side but NEVER pipes audio bytes; the caller attaches the
// returned URL straight to <audio>.src (media elements don't need CORS — only fetch()
// does), so the primary playback path stops relaying audio through our server.
//
// Never-throw: null means "direct unavailable — keep the proxy path". A null is not an
// error the UI should surface; the adapter falls back to its proxy URL and the player
// treats it as proxy-first for this resolve.
import { apiFetch } from './api-base';
import { getCachedDirectUrl, setCachedDirectUrl } from './direct-url-cache';

/** Sources with a direct-playable final-URL hop behind /api/stream-url. */
export type DirectSource = 'netease' | 'audius';

export async function fetchDirectStreamUrl(
	source: DirectSource,
	id: string,
	signal: AbortSignal
): Promise<string | null> {
	// quick-261006-r2: client-side memo — replaying or seeking back within the 10-min TTL skips
	// the /api/stream-url round-trip. Miss/expiry falls through to the resolve below as before;
	// failures are never cached, so a transient failure cannot pin the track.
	const cached = getCachedDirectUrl(source, id);
	if (cached) return cached;
	try {
		// GOVERNED (fetch→apiFetch audit): our own-origin JSON path goes through apiFetch
		// (dedup + concurrency cap + circuit breaker) like every other /api/* call.
		const res = await apiFetch(`/api/stream-url?source=${source}&id=${encodeURIComponent(id)}`, {
			signal
		});
		if (!res.ok) return null;
		const json = (await res.json()) as { url?: unknown };
		const url = typeof json.url === 'string' ? json.url : '';
		// Belt-and-braces: the edge already forces https; never hand <audio> an http:// URL
		// (mixed content) or a non-URL string.
		if (!url.startsWith('https://')) return null;
		setCachedDirectUrl(source, id, url); // successes only
		return url;
	} catch {
		return null;
	}
}
