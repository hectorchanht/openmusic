// Edge networking helpers for the /api/* metadata proxy.
//
// - fetchWithRetry: bounded retry on 429/5xx using the NATIVE AbortSignal.timeout
//   (RESEARCH "Don't Hand-Roll" — do NOT hand-roll setTimeout + AbortController).
//   ONE exception: fetchWithHeadDeadline below. AbortSignal.timeout cannot be disarmed once the
//   headers arrive, so it also cut every streamed media body at the deadline — netease /url audio
//   truncated at exactly 8.00 s (quick-260930-vjp deferred item #1, fixed quick-260930-x3q).
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

// quick-260926-mzn: exported so /api/lyric-offset POST can refuse a foreign-origin browser write
// outright (CORS headers alone only hide the RESPONSE; a no-preflight POST still executes).
export function isAllowedOrigin(origin: string | null): origin is string {
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
		'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
		// `Authorization` is NOT a CORS-safelisted request header, so the Capacitor WebView
		// (https://localhost → https://openmusic.lol, cross-origin) preflights any bearer POST and
		// fails it unless the header is advertised here (T-33-06). Allow-Headers only says which
		// headers an ALREADY allow-listed origin may send — it grants nothing to a foreign origin,
		// so this does not widen Allow-Origin (T-33-10).
		'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization'
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
			// RAW fetch (not apiFetch — fetch→apiFetch audit): SERVER-SIDE (Cloudflare edge) fetch of the
			// UPSTREAM source. apiFetch is the CLIENT seam; it does not (and must not) run edge-side.
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

const MEDIA_CONTENT_TYPE = /^(audio|video)\/|^application\/octet-stream/i;

/**
 * fetchWithRetry under a deadline that covers the HEADERS only for a media body (quick-260930-x3q).
 * A media response (audio/video/octet-stream) is returned with the timer cleared, so its body
 * streams with no wall-clock cap — Workers bill CPU, not wall time, and a client abort closes the
 * stream. Any other body (detail/lrc/search JSON) keeps the timer armed, so the whole response
 * stays bounded by `ms` exactly as before. Media is decided by response content-type, not by path.
 */
export async function fetchWithHeadDeadline(
	url: string,
	ms: number,
	retries = 2
): Promise<Response> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), ms);
	try {
		const res = await fetchWithRetry(url, { signal: ctrl.signal }, retries);
		if (MEDIA_CONTENT_TYPE.test(res.headers.get('content-type') ?? '')) clearTimeout(timer);
		return res;
	} catch (err) {
		clearTimeout(timer);
		throw err;
	}
}

function sizeOf(raw: string | null | undefined): number | null {
	const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
	return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Bodiless size/type probe of an upstream media URL — what the catch-all answers a client HEAD with
 * (quick-261001-0hr). Ladder: upstream HEAD → `Range: bytes=0-0` with the body CANCELLED unread.
 * The invariant: no audio body is ever pulled, so a HEAD can never turn into a second full stream.
 *
 * Deliberately plain `AbortSignal.timeout(ms)` via fetchWithRetry, NOT fetchWithHeadDeadline: that
 * helper exists to DISARM its timer so a media body can stream; a HEAD never streams, so the whole
 * exchange stays bounded by `ms`. `retries = 1` keeps a flaky upstream at ≤2 attempts per step.
 *
 * Returns an ALLOW-LIST of headers only (content-length / content-type / accept-ranges) — upstream
 * headers are never spread, since a `location`/`set-cookie` could echo the JOOX-token URL (T-01-04).
 * content-length is emitted only for a finite positive integer (never '0' / 'NaN' — T-0hr-04).
 * Status is 200 whenever either step answered (a HEAD describes the full resource, so 206 → 200).
 */
export async function upstreamHead(
	url: string,
	ms: number
): Promise<{ status: number; headers: Record<string, string> }> {
	const head = await fetchWithRetry(url, { method: 'HEAD', signal: AbortSignal.timeout(ms) }, 1);
	void head.body?.cancel().catch(() => {}); // a HEAD has none — unless the upstream misbehaves
	let size = head.ok ? sizeOf(head.headers.get('content-length')) : null;
	let range: Response | null = null;
	if (size == null) {
		range = await fetchWithRetry(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(ms) }, 1);
		// THE invariant: never read the body. One byte was asked for, but an upstream that ignores
		// Range would otherwise stream the whole file.
		void range.body?.cancel().catch(() => {});
		size = sizeOf(range.headers.get('content-range')?.match(/\/(\d+)$/)?.[1]);
	}
	const headers: Record<string, string> = {};
	if (size != null) headers['content-length'] = String(size);
	const ct = (head.ok ? head.headers.get('content-type') : null) ?? range?.headers.get('content-type');
	if (ct) headers['content-type'] = ct;
	const ar =
		head.headers.get('accept-ranges') ??
		range?.headers.get('accept-ranges') ??
		(range?.status === 206 ? 'bytes' : null);
	if (ar) headers['accept-ranges'] = ar;
	const ok = head.ok || !!range?.ok;
	return { status: ok ? 200 : (range ?? head).status, headers };
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

/**
 * A JSON `Response` with this route's CORS headers applied.
 *
 * Replaces EIGHTEEN local copies — `jsonResult` in 12 route files and the byte-identical
 * `jsonPassthrough` in 6 more. They were not all the same, which is exactly why they needed reading
 * rather than a blind collapse: most were the standard shape below, `/api/resolve` needed a status
 * code and `no-store`, and `/api/deezer/radio` spelled its content-type and cache-control
 * differently. Those become OPTIONS here instead of three private forks.
 *
 * `Cache-Control` precedence: an explicit `cacheControl` wins; otherwise a non-null `ttl` becomes
 * `public, max-age=<ttl>`; otherwise the header is omitted entirely (no implicit caching policy).
 *
 * Callers keep their own `satisfies` assertions at the call site — that is a compile-time check of
 * the route's payload type and has no business being a runtime parameter.
 */
export function jsonResponse(
	body: unknown,
	origin: string | null,
	opts: { ttl?: number; status?: number; cacheControl?: string } = {}
): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl;
	else if (opts.ttl != null) headers['Cache-Control'] = `public, max-age=${opts.ttl}`;
	return new Response(JSON.stringify(body), { status: opts.status ?? 200, headers });
}
