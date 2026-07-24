<script lang="ts">
	import "../app.css";
	import { untrack } from "svelte";
	import { browser } from "$app/environment";
	import { page } from "$app/state";
	import { player } from "$lib/stores/player.svelte";
	import { names } from "$lib/stores/names.svelte";

	let { children } = $props();
	let audioEl: HTMLAudioElement;

	const SITE = "https://openmusic.lol";
	const TITLE = "openmusic — music streaming for earth";
	const DESC =
		"Search and stream music for world. Synced lyrics, translation, playlists, library — a fast mobile-first web player.";
	const canonical = $derived(`${SITE}${page.url.pathname}`);

	// The single app-wide <audio> lives at the ROOT layout so it is mounted ONCE
	// and never torn down by client-side navigation between routes/route-groups —
	// playback persists across page changes. The visible now-playing bar + overlay
	// live in (app)/+layout and read the same singleton.
	$effect(() => {
		if (audioEl) {
			// ROOT CAUSE FIX (debug-song-click-lrc-flood-noplay): attach()/restore() WRITE player $state
			// (queue, current, resolvedCover, loading — resolvedCover + syncMetadata were added to
			// restore() in 26e413a). Running them tracked meant this effect READ that state and then
			// MUTATED it → the effect SELF-INVALIDATED and re-ran restore() over and over → repeated
			// audio.src re-set (the (canceled) media flood) + repeated lrc re-fetch + loading pinned true
			// (nowbar stuck on the loading line, never expands). Those "updated at … set queue/current …
			// restore … $effect" Svelte warnings were exactly this loop. untrack() runs the ONE-TIME
			// setup WITHOUT tracking, so the effect fires once per <audio> mount (its only real dep,
			// audioEl, is read OUTSIDE untrack) and never re-runs when player state changes.
			untrack(() => {
				player.attach(audioEl);
				// Restore the last played track + queue + progress + shuffle/repeat from localStorage so a
				// reload resumes mid-session. Doesn't autoplay (browser policy); user taps play. Fire-and-forget.
				void player.restore();
			});
		}
	});

	// quick-260723-spk: Spotify / YouTube-Music-style browser-tab title. While a track is current, the
	// tab reads "Song • Artist" using the TRANSLATED display names (names.dnTitle/dnArtist) so it
	// matches the on-screen text + honors the zhs→zht setting (• matches the share-card style). It
	// takes priority over each route's own <svelte:head><title>: reading page.url.pathname re-asserts
	// the title after a client navigation overwrites document.title, and dnTitle/dnArtist read
	// names.rev so it also re-runs when a lazy translation resolves. When nothing is current, the
	// route/app <title> stands. This effect WRITES a DOM property (document.title), never $state, so —
	// unlike the attach()/restore() effect above — it cannot self-invalidate (no untrack needed).
	// $effect never runs under SSR, so crawlers still get each route's SSR <title>; browser-guarded too.
	$effect(() => {
		const cur = player.current;
		void page.url.pathname; // re-apply after a route <title> overwrites document.title on nav
		if (!browser || !cur) return;
		const title = names.dnTitle(cur.title);
		const artist = names.dnArtist(cur.artist);
		document.title = artist ? `${title} • ${artist}` : title;
	});
</script>

<svelte:head>
	<link rel="canonical" href={canonical} />
	<!-- Open Graph -->
	<meta property="og:site_name" content="openmusic" />
	<!-- GLN-4: when the active page supplies its OWN og (page.data.og from a +page.ts load — shared
	     song / artist / album), render only the page's og:*/twitter:* so crawlers see exactly one of
	     each property with the page-specific value (PageOg.svelte sets og:type=music.song). The static
	     site-default block below is the FALLBACK for routes without per-page OG. og:site_name stays
	     site-wide; og:type is gated below so OG pages don't emit a duplicate. -->
	{#if !page.data?.og}
		<title>{TITLE}</title>
		<meta name="description" content={DESC} />
		<meta property="og:type" content="website" />
		<meta property="og:title" content={TITLE} />
		<meta property="og:description" content={DESC} />
		<meta property="og:url" content={canonical} />
		<meta property="og:image" content="{SITE}/og.svg" />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="630" />
		<!-- Twitter -->
		<meta name="twitter:card" content="summary_large_image" />
		<meta name="twitter:title" content={TITLE} />
		<meta name="twitter:description" content={DESC} />
		<meta name="twitter:image" content="{SITE}/og.svg" />
	{/if}
</svelte:head>

{@render children()}

<audio bind:this={audioEl} style="display:none"></audio>
