<script lang="ts">
	// The Dawn "Sponsored" strip — one slim row pinned as the FIRST content block
	// under the home header. URLs + slot guards are centralized in
	// $lib/config/sponsored.ts; an empty URL renders nothing, and pasting a real
	// link there makes the button appear automatically.
	//
	// HIDE RULE V2 (Hector 2026-10-10; supporter-choice model 2026-10-10): the
	// honor-system × is gone and auto-hide-on-verify is gone too. Verifying a
	// tip-jar key only sets localStorage dawn_supporter=1; hiding is the
	// supporter's explicit choice via the Settings → Supporter toggle, which
	// sets localStorage dawn_sponsored_hidden=1. This component only READS that
	// flag — supporter status alone never hides the strip. localStorage is
	// touched ONLY in onMount (never during SSR/prerender) and always inside
	// try/catch (private mode).
	import { onMount } from 'svelte';
	import {
		TIP_JAR_URL,
		WISE_URL,
		COINBASE_URL,
		BINANCE_URL,
		AIRALO_URL,
		KOINLY_URL,
		AIRWALLEX_URL,
		SPONSORED_HIDE_KEY,
		hasLink,
		hasAnySponsorLink
	} from '$lib/config/sponsored';
	// quick-261010-posthog: tip_jar_opened(location:'sponsored_strip') on the
	// ☕ Tip jar slot click only (referral slots stay untracked).
	import { track } from '$lib/posthog';

	type Slot = {
		url: string;
		label: string;
		title: string;
		bg: string;
		fg: string;
		/** Referral slots carry rel="sponsored"; the tip jar (his own product) does not. */
		sponsored: boolean;
	};

	const slots: Slot[] = [
		{ url: TIP_JAR_URL, label: '☕ Tip jar', title: 'Support openmusic — tip jar', bg: '#F0A832', fg: '#000000', sponsored: false },
		{ url: WISE_URL, label: 'Wise · Send money abroad', title: 'Wise — send money abroad (referral link)', bg: '#9FE870', fg: '#000000', sponsored: true },
		{ url: COINBASE_URL, label: 'Coinbase · Buy crypto', title: 'Coinbase — buy crypto (referral link)', bg: '#0052FF', fg: '#FFFFFF', sponsored: true },
		{ url: BINANCE_URL, label: 'Binance · Trade on Binance', title: 'Binance — trade on Binance (referral link)', bg: '#F0B90B', fg: '#000000', sponsored: true },
		{ url: AIRALO_URL, label: 'Airalo', title: 'Airalo eSIM (referral link)', bg: '#1B2A4A', fg: '#FFFFFF', sponsored: true },
		{ url: KOINLY_URL, label: 'Koinly', title: 'Koinly crypto tax (referral link)', bg: '#1E1E2E', fg: '#FFFFFF', sponsored: true },
		{ url: AIRWALLEX_URL, label: 'Airwallex', title: 'Airwallex business banking (referral link)', bg: '#4B26E8', fg: '#FFFFFF', sponsored: true }
	];

	let hidden = $state(false);

	onMount(() => {
		try {
			if (localStorage.getItem(SPONSORED_HIDE_KEY) === '1') hidden = true;
		} catch {
			/* storage unavailable (private mode) — keep the strip for this session */
		}
	});
</script>

{#if !hidden && hasAnySponsorLink()}
	<div class="sponsored" role="complementary" aria-label="Sponsored">
		<span class="disclosure">Sponsored</span>
		{#each slots as slot (slot.label)}
			{#if hasLink(slot.url)}
				<a
					class="sp-btn"
					href={slot.url}
					target="_blank"
					rel={slot.sponsored ? 'noopener sponsored' : 'noopener'}
					title={slot.title}
					style:--sp-bg={slot.bg}
					style:--sp-fg={slot.fg}
					onclick={() => {
						if (slot.url === TIP_JAR_URL) track('tip_jar_opened', { location: 'sponsored_strip' });
					}}
				>{slot.label}</a>
			{/if}
		{/each}
	</div>
{/if}

<style>
	/* One slim row: horizontally scrollable on narrow screens (buttons are
	   flex-shrink:0, so none ever clips), scrollbar hidden everywhere. */
	.sponsored {
		display: flex;
		align-items: center;
		gap: 6px;
		overflow-x: auto;
		flex-wrap: nowrap;
		scrollbar-width: none; /* Firefox */
		/* quick-261102-sfc: 12px top AND bottom (was 2px 0 12px) to make room for the chips' 48dp
		   hit band below. overflow-x:auto forces overflow-y to auto as well, so a hit extension that
		   leaves this padding box would add a VERTICAL scroll — do not trim this padding back down
		   without shrinking .sp-btn::after with it. Keeping the band inside the strip also stops it
		   overlapping the gear's / search pill's own hit boxes. */
		padding: 12px 0;
	}
	.sponsored::-webkit-scrollbar { display: none; } /* Chrome/Safari */
	.disclosure {
		font-size: 0.5625rem; /* 9px; quick-261102-sfc: rem-only font sizes */
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
		flex-shrink: 0;
		padding: 0 2px;
	}
	.sp-btn {
		position: relative;
		flex-shrink: 0;
		font-size: 0.6875rem; /* 11px; quick-261102-sfc: rem-only font sizes */
		font-weight: 700;
		line-height: 1;
		padding: 7px 11px;
		border-radius: 999px;
		background: var(--sp-bg);
		color: var(--sp-fg);
		text-decoration: none;
		white-space: nowrap;
	}
	/* quick-261102-sfc: Android 48dp touch floor. The chip is ~25px tall (11px × line-height 1 +
	   7px × 2); a 12px vertical extension gives a 49px hit band that the <a> owns for hit-testing.
	   x stays 0 so neighbouring chips (6px gap) never overlap. */
	.sp-btn::after { content: ''; position: absolute; inset: -12px 0; }
</style>
