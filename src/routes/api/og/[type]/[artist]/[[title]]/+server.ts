// /api/og/{type}/{artist}/{title} — the PATH FORM of the own-origin share-card cover
// endpoint (quick-261120-mediacard). This is the spelling og:image is EMITTED in now
// (ogImageUrl in $lib/services/share): keywords only — artist / album / song name as path
// segments — no query, no parameters, no extras (Hector 2026-11-20). The artist form has
// no title segment (`/api/og/artist/{name}`), hence the optional [[title]].
//
// ONE handler, ONE resolver, two spellings: this shell only extracts the path params and
// delegates to $lib/proxy/og-handler, exactly like the legacy query form
// (src/routes/api/og/+server.ts). Do not add logic here.
//
// params are ALREADY decodeURIComponent'd by SvelteKit (decode_params) — decoding again
// throws URIError on a literal '%'. decodePathSegment only reverses the encoder's
// '-'-for-space transform (the same decode the /song loader applies), never a URL decode.
import type { RequestHandler } from './$types';
import { handleOgImage, handleOgOptions } from '$lib/proxy/og-handler';
import { decodePathSegment } from '$lib/services/share';

export const GET: RequestHandler = async ({ params, url, request, platform }) =>
	handleOgImage({
		type: params.type,
		artist: decodePathSegment(params.artist),
		title: decodePathSegment(params.title ?? ''),
		ci: '',
		url,
		request,
		platform
	});

// CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-wv8-02).
export const OPTIONS: RequestHandler = ({ request }) => handleOgOptions(request);
