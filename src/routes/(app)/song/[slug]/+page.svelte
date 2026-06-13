<script lang="ts">
	// MINIMAL SSR-safe song-share page (D-02), SSR-safe BY CONSTRUCTION. This page is the crawler
	// landing surface for /song/{slug}-{source}{id}: it emits a per-song OG head + a static entity
	// card in the server HTML; interactivity hydrates client-side.
	//
	// SSR-SAFETY (Pitfall 4): we DELIBERATELY do NOT clone album/[name]/+page.svelte — that page
	// imports player/library/settings/names/overlays + client-only actions at module top, which
	// would crash during SSR. Here the ONLY imports are PageOg, `browser`, and `page`. There is NO
	// top-level store import and NO store METHOD call at module scope. The "Play" CTA is a plain
	// link to `/?play=<token>` (home owns the queue-install + playback on mount), so this page never
	// touches the player store at all — zero hydration-time store coupling.
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import PageOg from '$lib/components/PageOg.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Display fields come from the SSR load (data.current from the decoded `?play=` token, else the
	// slug-derived title). All plain markup — bound via {expr}, never {@html} (T-24-07).
	const title = $derived(data.current?.title ?? data.og.title);
	const artist = $derived(data.current?.artist ?? '');
	const cover = $derived(data.og.image); // https-guarded by buildOg; null → no <img>

	// The Play CTA: when the link carried a `?play=` token, forward it to the home route which
	// installs the shared queue + starts playback on mount (the existing share-link entry path).
	// Otherwise fall back to a search for the entity title. Built reactively; no store access.
	const playToken = $derived(browser ? page.url.searchParams.get('play') : null);
	const playHref = $derived(
		playToken
			? `/?play=${encodeURIComponent(playToken)}`
			: `/?q=${encodeURIComponent(data.current?.title ?? title)}`
	);
</script>

<PageOg og={data.og} />

<section class="song-share">
	{#if cover}
		<img class="cover" src={cover} alt={title} width="240" height="240" />
	{:else}
		<div class="cover cover--placeholder" aria-hidden="true"></div>
	{/if}
	<h1 class="title">{title}</h1>
	{#if artist}
		<p class="artist">{artist}</p>
	{/if}
	<a class="play-cta" href={playHref} data-sveltekit-reload>Play on openmusic</a>
</section>

<style>
	.song-share {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem 1.25rem 6rem;
		text-align: center;
	}
	.cover {
		width: 240px;
		height: 240px;
		max-width: 70vw;
		max-height: 70vw;
		border-radius: 16px;
		object-fit: cover;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}
	.cover--placeholder {
		background: linear-gradient(135deg, #2a2a36, #14141a);
	}
	.title {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0.5rem 0 0;
		line-height: 1.2;
	}
	.artist {
		margin: 0;
		opacity: 0.7;
		font-size: 1rem;
	}
	.play-cta {
		margin-top: 0.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.75rem 1.75rem;
		border-radius: 999px;
		background: var(--accent, #6c5ce7);
		color: #fff;
		font-weight: 600;
		text-decoration: none;
	}
</style>
