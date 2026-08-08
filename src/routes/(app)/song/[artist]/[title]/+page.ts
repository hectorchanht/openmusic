// OG-PATH-01: carrier-free SONG share route. A crawler hitting /song/{artist}/{title} gets a
// per-song OG card baked into the SSR HTML, built ENTIRELY from the two decoded path segments —
// no query carriers at all (this supersedes DQ-1/DQ-2's ?n=&a=&c= for the NEW shape; the legacy
// /song/[slug] handler keeps those verbatim, OG-COMPAT-01). Path depth differs, so the two shapes
// coexist with no route-matching conflict.
//
// D-01/D-03: this is a UNIVERSAL `+page.ts` with `ssr = true` — a per-route SSR opt-in. The root
// +layout.ts stays ssr=false; NEVER a +page.server.ts (that would break the adapter-static native
// build — Pitfall 5 / T-24-09).
//
// T-24-08 / SSRF: this loader performs NO fetch and is SYNCHRONOUS. og.image is an own-origin
// /api/og URL merely EMITTED into a meta tag; the crawler fetches it, and /api/og applies the
// per-tier host allowlist server-side. The input is path TEXT, not a sharer-supplied https URL —
// a strictly tighter posture than the retired `?c=` carrier. Because /api/og is a URL WE construct
// on the request's own origin, it deliberately bypasses buildOg's isHttpsUrl carrier gate (that
// gate exists for sharer-supplied covers, and would drop the image on an http dev origin), so the
// image is spliced over buildOg's result rather than passed in as `cover`.
//
// params.artist/params.title are ALREADY decodeURIComponent'd by SvelteKit (decode_params,
// utils/routing.js) — decoding again throws URIError on a literal '%' (a live 500 on the legacy
// /album/{name} route today, Pitfall 1). decodePathSegment only reverses the '-'-for-space
// transform; it never decodes.
//
// Plain strings (NOT t()) — load runs server-side where the reactive i18n lookup is unsafe (same
// note as the album/artist loads).
import { buildOg, decodePathSegment, ogImageUrl } from '$lib/services/share';
import type { PageLoad } from './$types';

// Per-route SSR opt-in (D-01): the song-share surface renders server-side so crawlers see the OG
// head; prerender stays off (the artist/title space is unbounded / dynamic).
export const ssr = true;
export const prerender = false;

export const load: PageLoad = ({ params, url }) => {
	const artist = decodePathSegment(params.artist);
	const title = decodePathSegment(params.title);

	// OG title = `Song • Artist`, with a brand default so the head is NEVER empty (an empty segment
	// arrives as the '-' guard, which decodes to ''). The card image is absolute + origin-derived so
	// it stays crawler-valid from ANY deploy origin.
	const og = {
		...buildOg({ title: title || 'openmusic', artist: artist || undefined, type: 'music.song' }),
		image: ogImageUrl(url.origin, 'song', artist, title)
	};

	// Same page-data contract as song/[slug] so the page component is a near-copy.
	return { og, name: title, artist };
};
