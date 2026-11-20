// Universal load (SSR + client nav). Derives crawler-facing artist OG data from the route param +
// query carriers so it lands in the SSR-rendered <svelte:head> (GLN-4 / item 4). quick-260723-ry1
// (match the song card): the share link now carries the resolved hero cover via `?c=` (buildOg
// https-gates it → og:image; else /og.svg) and an OPTIONAL zhs→zht display override `dn` (the
// Traditional artist name shown on the card when the sharer's lang setting is Traditional). The path
// `params.name` stays the ORIGINAL literal RESOLUTION key — `dn` is display-only, so the artist still
// resolves against the original CJK name. Plain string (NOT t()) — load runs server-side where the
// reactive i18n lookup is unsafe.
//
// OG-COMPAT-01 + OG-PATH-01 — this is the DUAL-SHAPE handler. Unlike song/album, the artist path
// shape did not change this phase (an artist page has no secondary name), so this ONE loader serves
// both link generations off the same 1-segment path:
//  - LEGACY `/artist/{name}?c=&dn=` — the https-gated `c` carrier still wins the card image and `dn`
//    still overrides the display name, with today's precedence, so links already in the wild keep
//    their card verbatim.
//  - CARRIER-FREE `/artist/{name}` — with no usable `c`, og:image becomes the own-origin
//    `/api/og?type=artist&artist=…` card instead of null, so a bare link gets real art too.
import { buildOg, decodePathSegment, ogImageUrl, isHttpsUrl } from '$lib/services/share';
import type { PageLoad } from './$types';

// Per-route SSR opt-in (D-01/D-02): the artist entity page renders server-side so its `og` data
// reaches crawlers. The root +layout.ts stays ssr=false — a scoped subtree opt-in, NOT a
// +page.server.ts (Pitfall 5). SSR-safety audit (24-04): the +page.svelte module top has NO direct
// window/document/localStorage/navigator access — those live only inside event handlers
// (shareArtist) which never run during SSR. Store imports/construction + use: actions are SSR-safe.
// prerender stays off (the artist slug space is dynamic).
export const ssr = true;
export const prerender = false;

export const load: PageLoad = ({ params, url }) => {
	// OG-COMPAT-01 / Pitfall 1: NEVER decodeURIComponent a route param. SvelteKit already did it
	// (decode_params, utils/routing.js:304), so the second decode that used to live here threw
	// URIError on any name containing a literal '%' — a live 500 (`GET /artist/50%25%20Cent`).
	// decodePathSegment does NOT decode; it only reverses OG-PATH-01's '-'-for-space transform.
	//
	// KNOWN LOSSY EDGE, LOCKED (CONTEXT / RESEARCH §B.8): every '-' becomes a space, so a genuinely
	// hyphenated name (`Jay-Z`) also reads as `Jay Z`. Accepted because matchKey's norm() strips all
	// punctuation AND whitespace, making resolution byte-identical either way — and because the
	// in-app nav emits the %20 form, which decodes to exactly the same string.
	const name = decodePathSegment(params.name ?? '');
	// quick-260723-ry1: cover carrier (https-gated by buildOg) + zhs→zht display override. `dn` is
	// display-only — resolution below still keys off the literal `name`.
	const c = url.searchParams.get('c') ?? '';
	const displayName = url.searchParams.get('dn') || name;
	// YouTube-Music-style card (match the song card): title = the artist name alone, short `Listen on
	// openmusic` tagline (buildOg's default — no bespoke description override). OG-PAGE-01: this is
	// the artist surface, so og:type is `profile`.
	const og = buildOg({ title: displayName, cover: c || null, type: 'profile' });
	// Carrier-free fallback: no usable legacy `c` → point og:image at our own /api/og artist card.
	// Spliced OVER buildOg's result rather than passed in as `cover` because that input is
	// isHttpsUrl-gated for SHARER-supplied URLs, which would drop an own-origin http dev URL. The
	// legacy `c` keeps going through the gate exactly as before, so its precedence is unchanged.
	if (!isHttpsUrl(c)) og.image = ogImageUrl(url.origin, 'artist', name);
	return { og };
};
