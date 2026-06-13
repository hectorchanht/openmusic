<script lang="ts">
	// Per-page OG / Twitter card tags (GLN-4 / item 4). Rendered into <svelte:head> by a route that
	// supplies `og` from its universal `+page.ts` load — so the values are baked into the SSR HTML
	// that non-JS share-card crawlers read. The root layout gates its static site-default OG behind
	// `{#if !page.data?.og}`, so exactly one of each og:*/twitter:* property renders per route.
	//
	// T-gln-02: all values are bound via `content={...}` (Svelte escapes attribute bindings), never
	// {@html}. The image is constrained to an https URL by buildOg; a null cover falls back to the
	// static /og.svg so the card always has an image.
	import { page } from "$app/state";

	let {
		og,
	}: { og: { title: string; description: string; image: string | null } } =
		$props();

	const SITE = "https://openmusic.lol";
	const FALLBACK_IMG = `${SITE}/og.svg`;
	const url = $derived(`${SITE}${page.url.pathname}`);
	const image = $derived(og.image ?? FALLBACK_IMG);
</script>

<svelte:head>
	<!-- Per-entity document <title> + description. Injected at %sveltekit.head%, which sits ABOVE the
	     static site-default in app.html, so on an SSR entity route this <title> is FIRST in tree order
	     and out-ranks the fallback for crawlers (SvelteKit also drives document.title from it client-
	     side). The root +layout gates its generic <title>/description behind `{#if !page.data?.og}`, so
	     these are the only ones emitted on an entity route. -->
	<title>{og.title}</title>
	<meta name="description" content={og.description} />
	<meta property="og:type" content="music.song" />
	<meta property="og:title" content={og.title} />
	<meta property="og:description" content={og.description} />
	<meta property="og:url" content={url} />
	<meta property="og:image" content={image} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={og.title} />
	<meta name="twitter:description" content={og.description} />
	<meta name="twitter:image" content={image} />
</svelte:head>
