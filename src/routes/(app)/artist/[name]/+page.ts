// Universal load (SSR + client nav). Derives crawler-facing artist OG data from the route param +
// query carriers so it lands in the SSR-rendered <svelte:head> (GLN-4 / item 4). quick-260723-ry1
// (match the song card): the share link now carries the resolved hero cover via `?c=` (buildOg
// https-gates it → og:image; else /og.svg) and an OPTIONAL zhs→zht display override `dn` (the
// Traditional artist name shown on the card when the sharer's lang setting is Traditional). The path
// `params.name` stays the ORIGINAL literal RESOLUTION key — `dn` is display-only, so the artist still
// resolves against the original CJK name. Plain string (NOT t()) — load runs server-side where the
// reactive i18n lookup is unsafe.
import { buildOg } from '$lib/services/share';
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
	const name = decodeURIComponent(params.name ?? '');
	// quick-260723-ry1: cover carrier (https-gated by buildOg) + zhs→zht display override. `dn` is
	// display-only — resolution below still keys off the literal `name`.
	const c = url.searchParams.get('c') ?? '';
	const displayName = url.searchParams.get('dn') || name;
	// YouTube-Music-style card (match the song card): title = the artist name alone, short `Listen on
	// openmusic` tagline (buildOg's default — no bespoke description override).
	const og = buildOg({ title: displayName, cover: c || null });
	return { og };
};
