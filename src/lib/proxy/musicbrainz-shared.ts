// Shared MusicBrainz edge-proxy helpers (quick-260831-re9, acting on spike 010).
//
// WHY MUSICBRAINZ: Deezer fragments CJK artists across profiles and romanizes their catalogue.
// Measured 2026-09-01 — 陳奕迅 has 5 albums on the profile we picked (72 on MusicBrainz), and
// 周杰倫's only populated Deezer profile titles everything in English ("Greatest Works Of Art"
// for 最偉大的作品). MusicBrainz stores original-script titles AND resolves every script variant
// plus the romanized name to ONE artist id, which is also what collapses the three separate
// 周傑倫 / Jay Chou / 周杰倫 pages.
//
// THREE OPERATIONAL RULES, all learned the hard way in spike 010:
//
// 1. A REAL User-Agent is REQUIRED. MusicBrainz blocks generic/absent agents outright. It must
//    identify the application and carry a contact URL.
// 2. The rate limit is ~1 req/s and it answers a violation with a genuine **503** plus
//    {"error":"The MusicBrainz web server is currently busy..."} — measured 503/200/503 on three
//    rapid calls. That is a DETECTABLE failure (unlike the /api/translate soft-fail documented in
//    CLAUDE.md, which returns 200 with echoed originals), so it is retryable and must never be
//    cached as a genuine empty answer.
// 3. Cover art lives at Cover Art Archive, not MusicBrainz. It is keyless and was 8/8 on a Jay
//    Chou sample, but a miss is still possible — callers render it as a LAYERED background so a
//    404 reveals the gradient beneath instead of a blank tile.

/** MusicBrainz requires an identifying UA with contact info; a generic one is blocked. */
export const MB_USER_AGENT = 'openmusic/1.0 ( https://openmusic.lol )';

export const MB_WS = 'https://musicbrainz.org/ws/2';
const CAA = 'https://coverartarchive.org';

/** MusicBrainz ids are UUIDs. Validate BEFORE interpolating into any upstream path or URL. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `id` is a well-formed MusicBrainz UUID. */
export function isMbid(id: string | null | undefined): id is string {
	return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * The Cover Art Archive front-cover URL for a release-group. Pure string building — NO network
 * call, so listing an artist's albums stays one upstream request regardless of album count. CAA
 * 307-redirects to archive.org, which an `<img>`/`background-image` follows natively.
 *
 * Returns null for a malformed id so a bad value can never reach the DOM as a URL.
 */
export function coverArtUrl(releaseGroupId: string, size: 250 | 500 = 500): string | null {
	return isMbid(releaseGroupId) ? `${CAA}/release-group/${releaseGroupId}/front-${size}` : null;
}

/**
 * GET a MusicBrainz ws/2 URL with the required UA and 503-aware retry.
 *
 * MusicBrainz throttles at ~1 req/s with a real 503, so a burst (an artist page firing several
 * lookups) WILL hit it. Retries with linear backoff — deliberately not exponential, because the
 * limiter is a fixed 1/s window, so waiting ~1.1s is exactly the right amount and doubling past
 * that just adds latency for no benefit.
 *
 * Returns the parsed JSON, or null on a non-ok response / malformed body / timeout. NEVER throws,
 * so a caller degrades to its own fallback rather than 500ing.
 */
export async function mbFetch<T>(url: string, attempts = 3): Promise<T | null> {
	for (let i = 0; i < attempts; i++) {
		try {
			const res = await fetch(url, {
				headers: { 'User-Agent': MB_USER_AGENT, accept: 'application/json' },
				signal: AbortSignal.timeout(8000)
			});
			// 503 = the documented rate-limit answer. Wait out the 1s window and retry.
			if (res.status === 503 && i < attempts - 1) {
				await new Promise((r) => setTimeout(r, 1100 * (i + 1)));
				continue;
			}
			if (!res.ok) return null;
			const data = (await res.json()) as T & { error?: unknown };
			// MusicBrainz can also answer 200 with an {error} envelope — treat it as a miss.
			if (data && typeof data === 'object' && 'error' in data && data.error) return null;
			return data;
		} catch {
			// Timeout / network / malformed JSON. Retry the transient cases, then give up.
			if (i === attempts - 1) return null;
			await new Promise((r) => setTimeout(r, 1100 * (i + 1)));
		}
	}
	return null;
}

/**
 * Normalize a MusicBrainz alias locale to the app's language tag.
 * MB uses underscored, sometimes region-qualified tags (`zh_Hant`, `zh_Hans_CN`); the app uses
 * `zh-Hant` / `zh-Hans` / `en`. Returns the hyphenated form, region suffix dropped beyond the
 * script subtag so `zh_Hans_CN` and `zh_Hans` both land on `zh-Hans`.
 */
export function normalizeLocale(locale: string | null | undefined): string | null {
	if (typeof locale !== 'string' || !locale) return null;
	const parts = locale.replace(/-/g, '_').split('_').filter(Boolean);
	if (!parts.length) return null;
	const lang = parts[0].toLowerCase();
	// A 4-letter subtag is a script (Hant/Hans/Latn); anything else (CN/TW/HK) is a region we drop.
	const script = parts[1] && parts[1].length === 4 ? parts[1] : null;
	if (!script) return lang;
	return `${lang}-${script.charAt(0).toUpperCase()}${script.slice(1).toLowerCase()}`;
}
