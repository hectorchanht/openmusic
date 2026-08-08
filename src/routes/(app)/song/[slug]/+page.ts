// SSR-safe SONG share route (D-02, refined by quick-260614-1w3). A crawler hitting
// /song/{slug}?n={title}&a={artist} gets a per-song OG card baked into the SSR HTML (SHARE-01),
// ALWAYS populated from the readable n/a query carriers — there is no opaque token any more.
//
// D-01/D-03: this is a UNIVERSAL `+page.ts` with `ssr = true` — a per-route SSR opt-in. The root
// +layout.ts stays ssr=false; NEVER a +page.server.ts (that would break the adapter-static native
// build — Pitfall 5 / T-24-09).
//
// DQ-1/DQ-2 (supersedes Phase-24 D-04/D-06 for the SONG surface ONLY): the link is short and
// carries the song name + artist as the authoritative readable carriers `?n=&a=`. The OG title is
// the song name and the description includes the artist, ALWAYS set server-side (independent of any
// token — there is none). The cosmetic `{slug}` is a fallback display source for ASCII-only links.
//
// T-24-08 / SSRF: OG is built ONLY from the query params + the slug, never an arbitrary server-side
// fetch. quick-260723-r4p: the cover IS now carried via the readable `?c=` carrier so the card shows
// the album art (og:image). buildOg/isHttpsUrl gate it to an absolute https URL, and og:image is
// EMITTED into a meta tag (never fetched server-side), so carrying `c` adds no SSRF; a missing / non-
// https `c` falls back to the /og.svg branded image (D-07).
//
// Plain strings (NOT t()) — load runs server-side where the reactive i18n lookup is unsafe (same
// note as the album/artist loads).
import { buildOg } from '$lib/services/share';
import type { PageLoad } from './$types';

// Per-route SSR opt-in (D-01): the song-share surface renders server-side so crawlers see the OG
// head; prerender stays off (the slug space is unbounded / dynamic).
export const ssr = true;
export const prerender = false;

/**
 * Derive a human-readable display title from the cosmetic slug when the `n` carrier is absent
 * (e.g. an ASCII-only link a user hand-trimmed). There is no longer a trailing `{source}{id}`
 * suffix to strip — the whole slug is cosmetic — so we just split on '-' and Title-Case each word.
 * The `s` placeholder slug (slugify returned '') yields '' here → the caller falls back to a brand
 * default.
 */
function titleFromSlug(slug: string): string {
	if (!slug || slug === 's') return '';
	return slug
		.split('-')
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

export const load: PageLoad = ({ params, url }) => {
	// DQ-1: n/a are the authoritative readable carriers (standard URL-decoding via searchParams).
	const n = url.searchParams.get('n') ?? '';
	const a = url.searchParams.get('a') ?? '';
	// quick-260723-r4p: optional resolved cover carrier. buildOg gates it to https (else null → /og.svg).
	const c = url.searchParams.get('c') ?? '';

	// DQ-2: OG title = `Song • Artist`; prefer `n`, fall back to the slug-derived title, then a brand
	// default so the head is NEVER empty. Image = the carried `c` cover when https, else /og.svg (D-07).
	// OG-PAGE-01: og:type is now per-surface (PageOg used to hardcode it) — this is the song surface.
	const displayTitle = n || titleFromSlug(params.slug ?? '') || 'openmusic';
	const og = buildOg({
		title: displayTitle,
		artist: a || undefined,
		cover: c || null,
		type: 'music.song'
	});

	return { og, name: n, artist: a };
};
