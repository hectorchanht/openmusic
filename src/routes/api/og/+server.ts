// /api/og — the LEGACY QUERY FORM of the own-origin share-card cover endpoint (OG-EP-01/02).
//
// LEGACY COMPAT (quick-261120-mediacard): og:image is now emitted in PATH form
// (`/api/og/song/{artist}/{title}`, see src/routes/api/og/[type]/[artist]/[[title]]), and
// this query spelling (`?type=&artist=&title=`, with or without a `ci` cover-id token) is no
// longer emitted anywhere. It stays SERVED — byte-identically — because og:image URLs
// already rendered into pages and chats use it. Both spellings delegate to the ONE handler
// core in $lib/proxy/og-handler (one handler, one resolver); this file is a verb-only shell
// that only extracts the query params. Do not add logic here.
import type { RequestHandler } from './$types';
import { handleOgImage, handleOgOptions } from '$lib/proxy/og-handler';

export const GET: RequestHandler = async ({ url, request, platform }) =>
	handleOgImage({
		type: url.searchParams.get('type') ?? 'song',
		artist: url.searchParams.get('artist') ?? '',
		title: url.searchParams.get('title') ?? '',
		// LEGACY COMPAT: the `ci` cover-id carrier (quick-260809-3uo) — reception only;
		// emission stopped at quick-261120-mediacard. The retired `?u=` param is not read:
		// the keyword seam in the handler core supersedes it.
		ci: url.searchParams.get('ci') ?? '',
		url,
		request,
		platform
	});

// CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-wv8-02).
export const OPTIONS: RequestHandler = ({ request }) => handleOgOptions(request);
