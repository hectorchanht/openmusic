// Stream-URL resolver for direct-first playback.
//
// GET /api/stream-url?source=<id>&id=<songid> → { url } | { error }
//
// The edge follows the source's redirect server-side (Audius 302 → signed GCS mp3,
// Meting 307 → music.126.net mp3) and returns ONLY the final URL as JSON. It NEVER
// pipes audio bytes: the client attaches <audio>.src to the returned URL directly
// (media elements don't need CORS — only fetch() does), so our server stops relaying
// copyrighted audio on the primary playback path. The existing byte-piping routes
// (/api/audius/stream/[id], /api/netease/url) stay as the client-side proxy fallback
// when direct playback fails.
//
// Per-source allowlist: `source` maps to a FIXED upstream template (mirrors the PROXIES
// registry discipline) — a client-supplied URL is never fetched (threat T-01-01).
// ytmusic is deliberately ABSENT: its edge-signed URLs are IP-locked to the caller's IP,
// so a browser fetch 403s by construction — the client skips the direct leg for it.
import type { RequestHandler } from './$types';
import { corsHeaders, fetchWithRetry } from '$lib/proxy/http';

// Free-text identifier, NOT a key (mirrors the audius stream route).
const AUDIUS_APP_NAME = 'musicsquare';

const UPSTREAMS: Record<string, (id: string) => string> = {
	netease: (id) =>
		`https://api.qijieya.cn/meting/?server=netease&type=url&id=${encodeURIComponent(id)}`,
	audius: (id) =>
		`https://api.audius.co/v1/tracks/${encodeURIComponent(id)}/stream?app_name=${AUDIUS_APP_NAME}`
};

function jsonResult(body: unknown, origin: string | null, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			...corsHeaders(origin),
			'content-type': 'application/json',
			// A resolved stream URL is signed/expiring — never let any cache freeze one.
			'cache-control': 'no-store'
		}
	});
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const source = url.searchParams.get('source') ?? '';
	const id = url.searchParams.get('id') ?? '';
	const build = UPSTREAMS[source];
	if (!build || !id) {
		return jsonResult({ error: 'unsupported source' }, origin, 400);
	}
	try {
		// redirect:'manual' — we want the Location header, NOT the bytes. fetchWithRetry
		// only retries 429/5xx (a 3xx returns immediately); the body is never read, just
		// cancelled so the upstream connection can be reused.
		const upstream = await fetchWithRetry(
			build(id),
			{ redirect: 'manual', signal: AbortSignal.timeout(10000) },
			1
		);
		await upstream.body?.cancel().catch(() => {});
		const location = upstream.headers.get('location');
		// Never 502/504: Cloudflare's edge replaces the body AND headers of any 502/504 from a
		// Pages Function with its own "error code: 502" text page, so the JSON error would never
		// reach the client. 503 passes through intact and fits "upstream didn't cooperate".
		if (!location) return jsonResult({ error: 'no redirect' }, origin, 503);
		// Mixed-content guard: Meting answers http:// — an https page must not attach it.
		const final = location.startsWith('http://') ? `https://${location.slice(7)}` : location;
		if (!final.startsWith('https://')) return jsonResult({ error: 'not https' }, origin, 503);
		return jsonResult({ url: final }, origin);
	} catch {
		return jsonResult({ error: 'upstream failed' }, origin, 503);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
