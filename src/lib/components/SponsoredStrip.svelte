<script lang="ts">
	// quick-261119-tiponly (Hector 2026-11-19, supersedes his 2026-11-18 "keep the
	// Sponsored strip as-is" call): ALL referral sponsors are cancelled (the six
	// former slots are named only in sponsored-strip.test.ts, which bans them),
	// and so is the "Sponsored" disclosure label. The ONLY element left is his own gold
	// ☕ Tip jar pill, and it now lives in the Home header row (mounted by the
	// home page inside <header class="topnav">) so the top of Home takes ONE
	// row only — there is no separate strip row any more. The file/component
	// name stays SponsoredStrip because the home page imports it under that
	// name and the hide flag below keeps its historical key.
	//
	// HIDE RULE V2 (Hector 2026-10-10; supporter-choice model 2026-10-10): the
	// honor-system × is gone and auto-hide-on-verify is gone too. Verifying a
	// tip-jar key only sets localStorage dawn_supporter=1; hiding is the
	// supporter's explicit choice via the Settings → Supporter toggle, which
	// sets localStorage dawn_sponsored_hidden=1. This component only READS that
	// flag — supporter status alone never hides the button. localStorage is
	// touched ONLY in onMount (never during SSR/prerender) and always inside
	// try/catch (private mode).
	import { onMount } from 'svelte';
	import { TIP_JAR_URL, SPONSORED_HIDE_KEY, hasTipJarLink } from '$lib/config/sponsored';
	// quick-261010-posthog, location updated quick-261119-tiponly: the pill now
	// sits in the header, so the click tracks tip_jar_opened(location:'header').
	import { track } from '$lib/posthog';

	let hidden = $state(false);

	onMount(() => {
		try {
			if (localStorage.getItem(SPONSORED_HIDE_KEY) === '1') hidden = true;
		} catch {
			/* storage unavailable (private mode) — keep the button for this session */
		}
	});
</script>

{#if !hidden && hasTipJarLink()}
	<a
		class="tip-btn"
		href={TIP_JAR_URL}
		target="_blank"
		rel="noopener"
		title="Support openmusic — tip jar"
		onclick={() => track('tip_jar_opened', { location: 'header' })}
	>☕ Tip jar</a>
{/if}

<style>
	/* One compact gold pill sized to sit in the header row next to the gear:
	   no row of its own, no horizontal scrolling, no label beside it. */
	.tip-btn {
		position: relative;
		flex-shrink: 0;
		font-size: 0.6875rem; /* 11px; quick-261102-sfc: rem-only font sizes */
		font-weight: 700;
		line-height: 1;
		padding: 7px 11px;
		border-radius: 999px;
		background: #F0A832;
		color: #000000;
		text-decoration: none;
		white-space: nowrap;
	}
	/* quick-261102-sfc: Android 48dp touch floor. The pill is ~25px tall (11px × line-height 1 +
	   7px × 2); a 12px vertical extension gives a 49px hit band that the <a> owns for hit-testing.
	   x stays 0 so the neighbouring gear's own hit box is never overlapped. */
	.tip-btn::after { content: ''; position: absolute; inset: -12px 0; }
</style>
