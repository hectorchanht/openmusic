// Universal load (SSR + client nav). Derives crawler-facing album OG data from the route param +
// query carriers so it lands in the SSR-rendered <svelte:head> (GLN-4 / item 4). quick-260723-ry1
// (match the song card): the share link now carries the resolved cover via `?c=` (buildOg https-gates
// it → og:image; else /og.svg) and OPTIONAL zhs→zht display overrides `dn`/`da` (the Traditional
// album/artist name shown on the card when the sharer's lang setting is Traditional). The path
// `params.name` + `?artist=` stay the ORIGINAL literal RESOLUTION key — dn/da are display-only, so the
// tracklist still resolves against the original CJK name. Plain strings (NOT t()) — load runs
// server-side where the reactive i18n lookup is unsafe.
import { buildOg } from '$lib/services/share';
import type { PageLoad } from './$types';

// Per-route SSR opt-in (D-01/D-02): the album entity page renders server-side so its `og` data
// reaches crawlers. The root +layout.ts stays ssr=false — this is a scoped subtree opt-in, NOT a
// +page.server.ts (Pitfall 5). SSR-safety audit (24-04): the +page.svelte module top has NO direct
// window/document/localStorage/navigator access — those live only inside event handlers (download
// blob, shareAlbum) which never run during SSR. Store imports/construction + use: actions are
// SSR-safe. prerender stays off (the album slug space is dynamic).
export const ssr = true;
export const prerender = false;

export const load: PageLoad = ({ params, url }) => {
	// OG-COMPAT-01 / Pitfall 1: read `params.name` DIRECTLY. SvelteKit already ran
	// decodeURIComponent on every route param (decode_params, utils/routing.js:304) before `load` is
	// called, so the second decode that used to live here threw URIError on any name containing a
	// literal '%' — a live 500 (`GET /album/50%25%20Off`). Never decode a param again.
	const name = params.name ?? '';
	const artist = url.searchParams.get('artist') ?? '';
	// quick-260723-ry1: cover carrier (https-gated by buildOg) + zhs→zht display overrides. dn/da are
	// display-only — resolution below still keys off the literal `name`/`artist`.
	const c = url.searchParams.get('c') ?? '';
	const displayName = url.searchParams.get('dn') || name;
	const displayArtist = url.searchParams.get('da') || artist;
	// YouTube-Music-style card (match the song card): title `Album • Artist`, short `Listen on
	// openmusic` tagline (buildOg's default — no bespoke description override). OG-PAGE-01: the
	// per-surface og:type — this is the album surface, so `music.album` (PageOg used to hardcode
	// `music.song` for every route).
	const og = buildOg({
		title: displayName,
		artist: displayArtist || undefined,
		cover: c || null,
		type: 'music.album'
	});
	return { og };
};
