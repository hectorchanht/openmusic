<script lang="ts">
	// SSR-safe carrier-free SONG share page (OG-PATH-01), SSR-safe BY CONSTRUCTION. This is the
	// crawler landing surface for /song/{artist}/{title}: it emits a per-song OG head + a static card
	// in the server HTML; the resolve-and-play interactivity runs CLIENT-ONLY. Near-copy of the legacy
	// /song/[slug] page — it consumes the same `{ og, name, artist }` load contract — with the cover
	// block upgraded from a bare gradient to the real /api/og card image (OG-PAGE-01).
	//
	// SSR-SAFETY (Pitfall 4): the ONLY module-top imports are PageOg, `browser`, `onMount`, the page
	// data type, and `apiUrl` (pure + store-free, so it does not pull the client graph). There is NO
	// top-level store import and NO store METHOD call at module scope — the player store (which pulls
	// the whole client graph) is imported LAZILY inside onMount under a `browser` guard, so SSR never
	// compiles the store graph in. i18n is likewise lazy-imported client-side (its index imports the
	// settings store), keeping this page store-free during SSR.
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import PageOg from '$lib/components/PageOg.svelte';
	import { apiUrl } from '$lib/services/api-base';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Display fields from the SSR load: data.name/data.artist are the decoded path segments, which are
	// the authoritative identity on this shape (OG-PATH-01 — there are no query carriers).
	const title = $derived(data.name || data.og.title);
	const artist = $derived(data.artist);

	// OG-PAGE-01 / Pitfall 7: the in-app cover goes through apiUrl(), NEVER data.og.image. og.image is
	// an ABSOLUTE origin-derived URL for the meta tag; inside the Capacitor WebView that origin is
	// https://localhost, which has no server, so reusing it here would render a broken image in the
	// APK. apiUrl() stays relative on web and resolves to VITE_API_BASE on native.
	const coverSrc = $derived(
		apiUrl(
			`/api/og?type=song&artist=${encodeURIComponent(data.artist)}&title=${encodeURIComponent(data.name)}`
		)
	);
	// A broken <img> is worse than a gradient (the healCover precedent treats a cover error as a
	// first-class event), so an error falls back to the existing .cover--placeholder block.
	let coverFailed = $state(false);

	// DQ-3 resolve-and-play status. Drives the inline UI: 'resolving' shows a spinner, 'playing'
	// means the player took over, 'notfound' shows a clear message + retry. NEVER stays 'resolving'
	// forever — every resolveAndPlay() settles it to 'playing' or 'notfound' (no stuck loader).
	// quick-260809-38i: it now starts at 'idle' and STAYS there until the user taps play, so opening a
	// shared link renders no status line and, more importantly, starts no audio.
	let status = $state<'idle' | 'resolving' | 'playing' | 'notfound'>('idle');
	// Lazily-imported i18n getter for the not-found message; null until the client import resolves,
	// in which case we render a plain English fallback (keeps the page SSR-safe + never blank).
	let notFoundMsg = $state('No playable version could be found for this song.');
	// Lazily-bound play handler — the PRIMARY path since quick-260809-38i (it was the fallback for the
	// autoplay-blocked case; removing the autoplay removes that whole class of failure). Still named
	// `retry` because it is also what re-runs the resolve after a 'notfound'.
	let retry = $state<(() => void) | null>(null);

	async function resolveAndPlay() {
		if (!browser || !data.name) {
			// No title segment → nothing to resolve (only reachable via the '-' empty guard). Treat as a
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
		// quick-260809-38i: bind the handler ONLY — no resolve, no playback. Opening a share link must
		// start NO audio; the "Play on openmusic" control below runs the exact same resolve on a real
		// user gesture, which is also the gesture mobile browsers require for playback anyway.
		retry = () => void resolveAndPlay();
	});
</script>

<PageOg og={data.og} />

<section class="song-share">
	{#if coverFailed}
		<div class="cover cover--placeholder" aria-hidden="true"></div>
	{:else}
		<!-- Decorative: the title + artist are rendered as text immediately below. -->
		<img class="cover" src={coverSrc} alt="" onerror={() => (coverFailed = true)} />
	{/if}
	<h1 class="title">{title}</h1>
	{#if artist}
		<p class="artist">{artist}</p>
	{/if}

	{#if status === 'resolving'}
		<p class="status" aria-live="polite"><span class="spinner motion-always" aria-hidden="true"></span> Finding a playable version…</p>
	{:else if status === 'playing'}
		<p class="status" aria-live="polite">Now playing on openmusic.</p>
	{:else if status === 'notfound'}
		<p class="status status--error" aria-live="polite">{notFoundMsg}</p>
	{/if}

	<!-- quick-260809-38i: the PRIMARY play path — the page no longer resolves or plays on mount, so
	     this tap is what starts everything (and it re-runs the resolve after a 'notfound'). Disabled
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
