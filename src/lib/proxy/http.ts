// Edge networking helpers for the /api/* metadata proxy.
//
// - fetchWithRetry: bounded retry on 429/5xx using the NATIVE AbortSignal.timeout
//   (RESEARCH "Don't Hand-Roll" — do NOT hand-roll setTimeout + AbortController).
// - corsHeaders: CORS scoped to the OWN origin. NEVER emits Access-Control-Allow-Origin: *
//   — combined with the JOOX token that would make us an open music/CORS relay
//   (Anti-Patterns line 341, Security V4, threat T-01-02).

/** Origins this proxy will echo back in Access-Control-Allow-Origin. */
const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
	/^https:\/\/openmusic\.lol$/, // deployed app — primary custom domain
	/^https:\/\/[a-z0-9-]+\.openmusic\.lol$/, // CF preview deploys on the custom domain
	/^https:\/\/openmusic\.pages\.dev$/, // legacy CF Pages domain — kept during cutover (D-06)
	/^https:\/\/[a-z0-9-]+\.openmusic\.pages\.dev$/, // legacy CF preview deploys — kept during cutover
	/^http:\/\/localhost(:\d+)?$/, // local dev (also covers Capacitor http androidScheme)
	/^http:\/\/127\.0\.0\.1(:\d+)?$/,
	/^https:\/\/localhost$/, // Capacitor Android default (server.androidScheme 'https' → WebView origin https://localhost) (D-02)
	/^capacitor:\/\/localhost$/ // future iOS Capacitor WebView origin — harmless to allow now (D-02)
];

function isAllowedOrigin(origin: string | null): origin is string {
	return !!origin && ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

/**
 * CORS headers scoped to the OWN origin. If the request origin is not in the
 * allow-list (or absent), no Access-Control-Allow-Origin is emitted at all —
 * we never fall back to `*`.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
	const headers: Record<string, string> = {
		Vary: 'Origin',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Range'
	};
	if (isAllowedOrigin(origin)) {
		headers['Access-Control-Allow-Origin'] = origin;
	}
	return headers;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Fetch with bounded retry on 429/5xx. `retries` is the number of EXTRA attempts
 * after the first (so retries=2 → up to 3 total). Network errors are retried too;
 * the final error/response is returned/thrown after the budget is exhausted.
 *
 * The caller passes its own `init.signal` (typically AbortSignal.timeout(ms)) so the
 * timeout is native and not hand-rolled.
 */
export async function fetchWithRetry(
	url: string,
	init: RequestInit = {},
	retries = 2
): Promise<Response> {
	let lastErr: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const res = await fetch(url, init);
			if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
				// Drain the body so the connection can be reused, then back off.
				await res.body?.cancel().catch(() => {});
				await backoff(attempt);
				continue;
			}
			return res;
		} catch (err) {
			lastErr = err;
			// Abort (timeout) is not worth retrying past the budget; honor the budget anyway.
			if (attempt < retries) {
				await backoff(attempt);
				continue;
			}
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error('fetchWithRetry: request failed');
}

/**
 * Native-Promise delay (RESEARCH "Don't Hand-Roll" — same setTimeout pattern as the private
 * `backoff` below; deliberately NO AbortController). Callers that need cancellation check their
 * own `signal.aborted` AFTER the await rather than racing an abort here.
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number): Promise<void> {
	// 150ms, 300ms, ... (capped). Cheap; the edge waits on I/O, not CPU.
	const ms = Math.min(150 * 2 ** attempt, 1000);
	return sleep(ms);
}
