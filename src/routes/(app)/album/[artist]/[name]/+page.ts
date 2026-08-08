// OG-PATH-01: carrier-free ALBUM share route. A crawler hitting /album/{artist}/{name} gets a
// `Name • Artist` OG card baked into the SSR HTML, built ENTIRELY from the two decoded path
// segments — the former `?artist=` FUNCTIONAL carrier plus `c`/`dn`/`da` are all gone, because the
// artist IS segment 1 (the legacy /album/[name]?artist= handler keeps working, OG-COMPAT-01; path
// depth differs so the two shapes coexist with no route-matching conflict).
//
// This is the song/[slug] / song/[artist]/[title] SPECIES, deliberately NOT a copy of
// album/[name]/+page.ts — that loader double-decodes its param (a live 500 on any name containing a
// literal '%') and returns `{ og }` only, leaving its page to re-derive from page.params.
//
// D-01/D-03: UNIVERSAL `+page.ts` with `ssr = true` — a per-route SSR opt-in. The root +layout.ts
// stays ssr=false; NEVER a +page.server.ts (that would break the adapter-static native build —
// Pitfall 5 / T-24-09).
//
// T-24-08 / SSRF: this loader performs NO fetch and is SYNCHRONOUS. og.image is an own-origin
// /api/og URL merely EMITTED into a meta tag; the crawler fetches it and /api/og applies the
// per-tier host allowlist server-side. Because that URL is one WE construct on the request's own
// origin, it deliberately bypasses buildOg's isHttpsUrl carrier gate (which exists for
// sharer-supplied covers and would drop an http dev-origin image), so it is spliced over buildOg's
// result instead of being passed in as `cover`.
//
// params.artist/params.name are ALREADY decodeURIComponent'd by SvelteKit (decode_params,
// utils/routing.js) — decoding a second time throws URIError on a literal '%' (Pitfall 1).
// decodePathSegment only reverses the '-'-for-space transform; it never decodes.
//
// Plain strings (NOT t()) — load runs server-side where the reactive i18n lookup is unsafe (same
// note as the legacy album/artist loads).
import { buildOg, decodePathSegment, ogImageUrl } from '$lib/services/share';
import type { PageLoad } from './$types';

// Per-route SSR opt-in (D-01): the album-share surface renders server-side so crawlers see the OG
// head; prerender stays off (the artist/name space is unbounded / dynamic).
export const ssr = true;
export const prerender = false;

export const load: PageLoad = ({ params, url }) => {
	const artist = decodePathSegment(params.artist);
	const name = decodePathSegment(params.name);

	// RESEARCH Open Question 4: pass BOTH segments so the new card reads `Name • Artist`, matching the
	// legacy album card. A brand default keeps the head non-empty when the name segment is the '-'
	// guard (which decodes to '').
	const og = {
		...buildOg({ title: name || 'openmusic', artist: artist || undefined, type: 'music.album' }),
		image: ogImageUrl(url.origin, 'album', artist, name)
	};

	// Same `{ og, name, artist }` contract as the song routes — the page forwards these two decoded
	// values to the one real album implementation.
	return { og, name, artist };
};
