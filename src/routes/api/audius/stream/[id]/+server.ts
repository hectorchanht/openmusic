// Audius stream edge proxy (quick-260616-0zn; redirect-following audio relay).
//
// THIS IS THE LOAD-BEARING ROUTE. Audius does NOT return the file URL in search JSON.
// `GET https://api.audius.co/v1/tracks/{id}/stream` responds with an HTTP 302 to a signed,
// EXPIRING storage.googleapis.com mp3. So this route MUST follow the redirect and pipe the
// body through — it must NEVER JSON-return the redirect target (that GCS URL is signed and
// expires, and returning it would also leak an off-origin URL into <audio>.src).
//
// Range is forwarded upstream and Accept-Ranges/Content-Range/Content-Length are propagated
// back so a 206 partial-content response and <audio> seeking work end-to-end. The eventual
// <audio>.src stays own-origin (Capacitor/CORS-safe). corsHeaders already lists `Range` in
// Access-Control-Allow-Headers, so the browser preflight passes.
//
// DoS posture: AbortSignal.timeout(15000) (audio is heavier than JSON) + retries=1 (a
// multi-MB stream shouldn't be retried aggressively). The route only proxies
// api.audius.co/.../{id}/stream — id is path-encoded into a fixed template, so it cannot be
// coerced into an arbitrary-host relay (same posture as the existing dedicated routes).
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';

const APP_NAME = 'musicsquare';

export const GET: RequestHandler = async ({ params, request }) => {
	const origin = request.headers.get('origin');
	const id = (params.id ?? '').trim();
	if (!id) return new Response('missing id', { status: 400, headers: corsHeaders(origin) });

	const upstream = `https://api.audius.co/v1/tracks/${encodeURIComponent(id)}/stream?app_name=${APP_NAME}`;

	// Forward the client Range header to upstream when present so the GCS object serves a 206.
	const headers: Record<string, string> = {};
	const range = request.headers.get('range');
	if (range) headers['Range'] = range;

	const init: RequestInit = {
		redirect: 'follow', // transparently follow the 302 to GCS — final res is the audio body
		signal: AbortSignal.timeout(15000),
		headers
	};

	try {
		// fetchWithRetry returns a RAW Response (no JSON parse), so res.body is the audio stream.
		const res = await fetchWithRetry(upstream, init, 1);

		const outHeaders: Record<string, string> = {
			...corsHeaders(origin),
			'content-type': res.headers.get('content-type') ?? 'audio/mpeg'
		};
		// Propagate range-related headers only when present so 206 + seeking work end-to-end.
		const acceptRanges = res.headers.get('accept-ranges');
		if (acceptRanges != null) outHeaders['Accept-Ranges'] = acceptRanges;
		const contentRange = res.headers.get('content-range');
		if (contentRange != null) outHeaders['Content-Range'] = contentRange;
		const contentLength = res.headers.get('content-length');
		if (contentLength != null) outHeaders['Content-Length'] = contentLength;

		return new Response(res.body, { status: res.status, headers: outHeaders });
	} catch {
		return new Response('upstream error', { status: 502, headers: corsHeaders(origin) });
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
