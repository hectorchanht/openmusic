// Universal load (SSR + client nav). Derives crawler-facing artist OG data from the route param so
// it lands in the SSR-rendered <svelte:head> (GLN-4 / item 4). The hi-res hero cover is resolved
// client-side (enrichArtist/deezerArtistCover), so the SSR cover is null here and the page/layout
// falls back to the static /og.svg — crawlers still get a page-specific title + description. We use
// a plain string (NOT t()) since load runs server-side where the reactive i18n lookup is unsafe.
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

export const load: PageLoad = ({ params }) => {
	const name = decodeURIComponent(params.name ?? '');
	const og = buildOg({ title: `${name} · openmusic`, cover: null });
	og.description = `${name} on openmusic — hit songs, albums and similar artists. Fast mobile-first music streaming.`;
	return { og };
};
