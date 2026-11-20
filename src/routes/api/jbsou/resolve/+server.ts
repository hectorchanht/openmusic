// JBSou fallback resolve edge route (quick-261101-jbs).
//
// GET /api/jbsou/resolve?type=netease|qq&id=<songid>&title=<t>&artist=<a>
//   → 200 { url }          a playable CDN URL for the confidently-matched song
//   → 200 { url: null }    JBSou answered but the song is not confidently in its rows
//   → 503 { error }        the upstream chain (cookie / search / redirect) failed
//
// This is a RESOLVE-ONLY pipe, not a source: no search surface, no SourceId, no registry
// entry. The whole JBSou protocol (mk_visit cookie session, form search, signed-path
// redirect) runs edge-side in $lib/proxy/jbsou — the client adapters only ever see the
// final URL JSON (the /api/stream-url shape), never JBSou itself. Response discipline
// mirrors /api/stream-url: never 502/504 (Cloudflare's edge replaces those bodies), and
// no-store throughout — the signed paths and CDN URLs are short-lived.
import type { RequestHandler } from './$types';
import { corsHeaders, corsPreflight } from '$lib/proxy/http';
import { resolveViaJbsou, type JbsouType } from '$lib/proxy/jbsou';

function jsonResult(body: unknown, origin: string | null, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			...corsHeaders(origin),
			'content-type': 'application/json',
			'cache-control': 'no-store'
		}
	});
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const type = url.searchParams.get('type') ?? '';
	const title = (url.searchParams.get('title') ?? '').trim();
	const artist = (url.searchParams.get('artist') ?? '').trim();
	const id = (url.searchParams.get('id') ?? '').trim();
	if ((type !== 'netease' && type !== 'qq') || !title) {
		return jsonResult({ error: 'bad params' }, origin, 400);
	}
	const result = await resolveViaJbsou(type as JbsouType, { id: id || undefined, title, artist });
	// The three outcomes stay distinct so the client health gate (jbsou-health.ts) can tell a
	// dead pipe (503 → recordFail) from a live pipe with no match (200 {url:null} → recordOk).
	if (result.kind === 'fail') return jsonResult({ error: 'jbsou upstream failed' }, origin, 503);
	return jsonResult({ url: result.kind === 'ok' ? result.url : null }, origin);
};

export const OPTIONS: RequestHandler = ({ request }) => corsPreflight(request);
