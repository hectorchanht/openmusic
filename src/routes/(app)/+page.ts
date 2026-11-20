// Universal load (runs on the SERVER during SSR + on client navigation). When the home route is
// opened as a shared-song link (`/?play=<token>`), derive crawler-facing OG data from the decoded
// token so the values land in the SSR-rendered <svelte:head> (GLN-4 / item 4). A client-only
// <svelte:head> would silently fail for non-JS share-card crawlers.
//
// decodeShare is pure + server-importable. The cover is only surfaced when it is a usable absolute
// https URL (buildOg/isHttpsUrl); otherwise ogImage is null and the page/layout falls back to the
// static /og.svg. We deliberately do NOT call the deezer cover proxy here: those helpers use the
// module-global fetch with a RELATIVE own-origin URL, which does not resolve server-side without the
// load `fetch`, so the lookup would silently miss under SSR (T-gln-04 — best-effort, never blocks).
import { decodeShare, buildOg } from '$lib/services/share';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const token = url.searchParams.get('play');
	if (!token) return { og: null };
	const { current } = decodeShare(token);
	if (!current) return { og: null };
	const og = buildOg({
		title: current.title,
		artist: current.artist,
		album: current.album,
		cover: current.cover
	});
	return { og };
};
