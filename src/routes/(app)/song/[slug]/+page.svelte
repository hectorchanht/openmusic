<script lang="ts">
	// SSR-safe SONG share page (D-02), SSR-safe BY CONSTRUCTION. This is the crawler landing surface
	// for /song/{slug}?n={title}&a={artist}: it emits a per-song OG head + a static card in the
	// server HTML; the resolve-and-play interactivity runs CLIENT-ONLY.
	//
	// SSR-SAFETY (Pitfall 4): the ONLY module-top imports are PageOg, `browser`, `onMount`, and the
	// page data type. There is NO top-level store import and NO store METHOD call at module scope —
	// the player store (which pulls the whole client graph) is imported LAZILY inside onMount under a
	// `browser` guard, so SSR never compiles the store graph in. i18n is likewise lazy-imported
	// client-side (its index imports the settings store), keeping this page store-free during SSR.
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import PageOg from '$lib/components/PageOg.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Display fields from the SSR load: data.name/data.artist are the authoritative readable carriers
	// (DQ-1). The cover is never carried, so the card always shows the placeholder block (no <img>).
	const title = $derived(data.name || data.og.title);
	const artist = $derived(data.artist);

	// DQ-3 resolve-and-play status. Drives the inline UI: 'resolving' shows a spinner, 'playing'
	// means the player took over, 'notfound' shows a clear message + retry. NEVER stays 'resolving'
	// forever — onMount always settles it to 'playing' or 'notfound' (no stuck loader).
	let status = $state<'idle' | 'resolving' | 'playing' | 'notfound'>('idle');
	// Lazily-imported i18n getter for the not-found message; null until the client import resolves,
	// in which case we render a plain English fallback (keeps the page SSR-safe + never blank).
	let notFoundMsg = $state('No playable version could be found for this song.');
	// Lazily-bound retry handler (re-runs the same playStub call for the autoplay-blocked case).
	let retry = $state<(() => void) | null>(null);

	async function resolveAndPlay() {
		if (!browser || !data.name) {
			// No name carrier → nothing to resolve (e.g. a hand-trimmed ASCII-only link). Treat as a
			// genuine miss rather than a stuck loader.
			status = 'notfound';
			return;
		}
		status = 'resolving';
		// Lazy imports keep SSR store-free (both pull the client store graph).
		const { player } = await import('$lib/stores/player.svelte');
		try {
			const { t } = await import('$lib/i18n');
			notFoundMsg = t('home.unplayable');
		} catch {
			/* keep the English fallback already set above */
		}
		const tr = await player.playStub(data.artist, data.name, null, 'home-discovery');
		// Mirror the home idiom: playStub returns null for BOTH a genuine miss AND a supersede; a
		// supersede leaves pendingTrack pointing at the newer song (don't flag notfound then).
		if (tr === null && player.pendingTrack == null) status = 'notfound';
		else status = 'playing';
	}

	onMount(() => {
		// Bind the retry handler client-side and kick off the initial resolve.
		retry = () => void resolveAndPlay();
		void resolveAndPlay();
	});
</script>

<PageOg og={data.og} />

<section class="song-share">
	<div class="cover cover--placeholder" aria-hidden="true"></div>
	<h1 class="title">{title}</h1>
	{#if artist}
		<p class="artist">{artist}</p>
	{/if}

	{#if status === 'resolving'}
		<p class="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span> Finding a playable version…</p>
	{:else if status === 'playing'}
		<p class="status" aria-live="polite">Now playing on openmusic.</p>
	{:else if status === 'notfound'}
		<p class="status status--error" aria-live="polite">{notFoundMsg}</p>
	{/if}

	<!-- Manual retry for the autoplay-blocked case: re-runs the same name+artist resolve. Disabled
	     while a resolve is in flight; available client-side only (retry is bound in onMount). -->
	<button class="play-cta" onclick={() => retry?.()} disabled={status === 'resolving' || retry === null}>
		Play on openmusic
	</button>
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
	.status {
		margin: 0.25rem 0 0;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.95rem;
		opacity: 0.85;
	}
	.status--error {
		color: #ff7a7a;
		opacity: 1;
	}
	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
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
		border: none;
		cursor: pointer;
	}
	.play-cta:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
