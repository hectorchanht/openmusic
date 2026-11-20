<script lang="ts">
	// Per-page OG / Twitter card tags (GLN-4 / item 4). Rendered into <svelte:head> by a route that
	// supplies `og` from its universal `+page.ts` load — so the values are baked into the SSR HTML
	// that non-JS share-card crawlers read. The root layout gates its static site-default OG behind
	// `{#if !page.data?.og}`, so exactly one of each og:*/twitter:* property renders per route.
	//
	// T-gln-02: all values are bound via `content={...}` (Svelte escapes attribute bindings), never
	// {@html}. The image is constrained to an https URL by buildOg; a null cover falls back to the
	// static branded RASTER so the card always has an image (quick-260807-vl1: /og.jpg, not /og.svg
	// — no major platform renders an SVG og:image, 30-RESEARCH §C.11/§D.15).
	import { page } from "$app/state";
	import type { OgType } from '$lib/services/share';

	let {
		og,
	}: {
		og: { title: string; description: string; image: string | null; type?: OgType };
	} = $props();

	// OG-PAGE-01: derive the origin from the REQUEST so a link shared from openmusic.pages.dev (or a
	// preview deploy) emits a same-origin og:url / og:image instead of always pointing at the primary
	// domain (folds the `pageog-hardcoded-site-origin` todo). og:image MUST stay an ABSOLUTE URL —
	// crawlers reject a relative one — which is why the fallback is built from `origin` here rather
	// than emitted as a bare path. SITE_FALLBACK covers an empty origin only.
	// `page.url` is server-provided and fully populated during the Cloudflare SSR render (the root
	// layout already reads it in its own <svelte:head>); NEVER derive this from `location`.
	const SITE_FALLBACK = 'https://openmusic.lol';
	const origin = $derived(page.url.origin || SITE_FALLBACK);
	const url = $derived(`${origin}${page.url.pathname}`);
	const image = $derived(og.image ?? `${origin}/og.jpg`);
</script>

<svelte:head>
	<!-- Per-entity document <title> + description. Injected at %sveltekit.head%, which sits ABOVE the
	     static site-default in app.html, so on an SSR entity route this <title> is FIRST in tree order
	     and out-ranks the fallback for crawlers (SvelteKit also drives document.title from it client-
	     side). The root +layout gates its generic <title>/description behind `{#if !page.data?.og}`, so
	     these are the only ones emitted on an entity route. -->
	<title>{og.title}</title>
	<meta name="description" content={og.description} />
	<!-- OG-PAGE-01: og:type is per-surface (music.song / music.album / profile), supplied by the
	     route's loader via buildOg. Optional with a 'music.song' default so a caller that has not
	     been converted yet emits exactly the card it emitted before. Still bound via content={} and
	     drawn from the closed OgType union (T-gln-02). The root layout's fallback og:type=website is
	     gated on `{#if !page.data?.og}`, so exactly ONE og:type renders per page. -->
	<meta property="og:type" content={og.type ?? 'music.song'} />
	<meta property="og:title" content={og.title} />
	<meta property="og:description" content={og.description} />
	<meta property="og:url" content={url} />
	<meta property="og:image" content={image} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={og.title} />
	<meta name="twitter:description" content={og.description} />
	<meta name="twitter:image" content={image} />
</svelte:head>
