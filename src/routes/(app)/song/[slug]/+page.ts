// NEW minimal SSR-safe song-share route (D-02). This is the per-song share surface: a crawler
// hitting /song/{slug}-{source}{id} gets a per-song OG card baked into the SSR HTML (SHARE-01).
//
// D-01/D-03: this is a UNIVERSAL `+page.ts` with `ssr = true` — a per-route SSR opt-in. The root
// +layout.ts stays ssr=false; NEVER a +page.server.ts (that would break the adapter-static native
// build — Pitfall 5 / T-24-09).
//
// T-24-03: the attacker-controllable slug param is read ONLY through parseEntityParam (the pure
// validation gate, returns null on no-match, never throws) — we never goto(rawParam) or render the
// raw param as a URL. T-24-08: OG is built from the param + the decoded `?play=` token ONLY; no
// arbitrary server-side fetch (no SSRF surface; buildOg's image is https-guarded).
//
// Plain strings (NOT t()) — load runs server-side where the reactive i18n lookup is unsafe (same
// note as the album/artist loads).
import { buildOg, parseEntityParam, decodeShare } from '$lib/services/share';
import type { PageLoad } from './$types';

// Per-route SSR opt-in (D-01): the song-share surface renders server-side so crawlers see the OG
// head; prerender stays off (the slug space is unbounded / dynamic).
export const ssr = true;
export const prerender = false;

/**
 * Derive a human-readable display title from the cosmetic slug prefix. The route param is
 * `{slug}-{source}{id}`; the trailing `{source}{id}` is the authoritative key (parsed separately),
 * so for display we strip it and turn the remaining slug into Title Case words. An all-CJK title
 * has an empty slug → returns ''.
 */
function titleFromSlug(param: string, key: { source: string; id: string } | null): string {
	if (!key) return '';
	// Drop the trailing {source}{id} (and the joining hyphen, if any) to leave just the slug.
	const suffix = `${key.source}${key.id}`;
	let slug = param.endsWith(suffix) ? param.slice(0, -suffix.length) : param;
	slug = slug.replace(/-+$/g, '');
	if (!slug) return '';
	return slug
		.split('-')
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

export const load: PageLoad = ({ params, url }) => {
	const param = params.slug ?? '';
	// T-24-03: validation gate — null when the param carries no known {source}{id} key.
	const parsed = parseEntityParam(param);

	// The path identifies the entity; an optional `?play=` token carries richer display data
	// (title/artist/cover) + the queue (D-06). Decode it ONLY for OG enrichment here.
	const playToken = url.searchParams.get('play');
	const shared = playToken ? decodeShare(playToken) : { current: null, queue: [] };
	const current = shared.current;

	const displayTitle = current?.title || titleFromSlug(param, parsed) || 'openmusic';
	const og = buildOg({
		title: current ? displayTitle : `${displayTitle} · openmusic`,
		artist: current?.artist || undefined,
		album: current?.album || undefined,
		cover: current?.cover ?? null
	});
	if (!current) {
		og.description = `Listen on openmusic — fast mobile-first music streaming.`;
	}

	return { og, parsed, current };
};
