<script lang="ts">
	import "../app.css";
	import { page } from "$app/state";
	import { player } from "$lib/stores/player.svelte";

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
			player.attach(audioEl);
			// Restore the last played track + queue + progress + shuffle/repeat from
			// localStorage so a reload resumes mid-session. Doesn't autoplay (browser
			// autoplay policy); the user taps play to resume. Fire-and-forget.
			void player.restore();
		}
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
