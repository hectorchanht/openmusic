<script lang="ts">
	// SSR-safe carrier-free ALBUM share page (OG-PATH-01), SSR-safe BY CONSTRUCTION.
	//
	// PLANNER DECISION (Claude's discretion per CONTEXT): this route is an SSR OG *landing*, not a
	// second album implementation. It emits the crawler card + a minimal title block server-side, then
	// hands the recipient to the ONE existing album page (~1000 lines: tracklist, Last.fm enrich,
	// Deezer album info, download/share controls) instead of duplicating it. Crawlers never run JS, so
	// they keep the SSR head; a human gets replaceState-forwarded on hydration. OG-PATH-02's
	// getAlbumTracklist / enrichAlbum resolution therefore runs on the legacy page, keyed by the same
	// decoded segments this route forwards.
	//
	// DEVIATION from RESEARCH Open Question 2 / Pitfall 10 (which recommends repointing the in-app
	// album nav at artist/[name]/+page.svelte:464 to the 2-segment shape): because THIS route
	// redirects to the legacy one, doing that would make every in-app album tap a double hop. The
	// internal nav deliberately STAYS on the legacy `?artist=` shape; the 2-segment loader is exercised
	// by its own unit test and by shared links.
	//
	// SSR-SAFETY (Pitfall 4): the ONLY module-top imports are PageOg, `browser`, `onMount`, `goto` and
	// the page data type. NO store import and NO store method call at module scope, so SSR never
	// compiles the client store graph in. `goto` is a $app/navigation function — import-safe on the
	// server and only ever CALLED under the `browser` guard below.
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import PageOg from '$lib/components/PageOg.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const name = $derived(data.name || data.og.title);
	const artist = $derived(data.artist);

	onMount(() => {
		if (!browser || !data.name) return;
		// Forward to the single album implementation, which keys off params.name + ?artist=.
		// encodeURIComponent (not encodePathSegment) — the legacy route decodes with SvelteKit's own
		// single decode and reads `artist` as a plain query param, so the literal text must survive.
		// replaceState so the share URL does not linger in history behind the real page.
		const target =
			'/album/' +
			encodeURIComponent(data.name) +
			(data.artist ? '?artist=' + encodeURIComponent(data.artist) : '');
		void goto(target, { replaceState: true });
	});
</script>

<PageOg og={data.og} />

<section class="album-share">
	<h1 class="title">{name}</h1>
	{#if artist}
		<p class="artist">{artist}</p>
	{/if}
	<p class="status" aria-live="polite">Opening album on openmusic…</p>
</section>

<style>
	.album-share {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 3rem 1.25rem 6rem;
		text-align: center;
	}
	.title {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0;
		line-height: 1.2;
	}
	.artist {
		margin: 0;
		opacity: 0.7;
		font-size: 1rem;
	}
	.status {
		margin: 0.5rem 0 0;
		font-size: 0.95rem;
		opacity: 0.85;
	}
</style>
