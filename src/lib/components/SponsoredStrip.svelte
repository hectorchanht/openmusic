<script lang="ts">
	// The Dawn "Sponsored" strip — one slim row pinned as the FIRST content block
	// under the home header. URLs + slot guards are centralized in
	// $lib/config/sponsored.ts; an empty URL renders nothing, and pasting a real
	// link there makes the button appear automatically.
	//
	// DISMISS (honor system, not license verification): the trailing × stores
	// `dawn_sponsored_hidden = "1"` in localStorage and hides the strip
	// immediately; when the flag is set the strip renders nothing at all. There
	// is intentionally no restore UI. localStorage is touched ONLY in onMount
	// (never during SSR/prerender) and always inside try/catch (private mode).
	import { onMount } from 'svelte';
	import {
		TIP_JAR_URL,
		WISE_URL,
		COINBASE_URL,
		BINANCE_URL,
		AIRALO_URL,
		KOINLY_URL,
		AIRWALLEX_URL,
		hasLink,
		hasAnySponsorLink
	} from '$lib/config/sponsored';

	const HIDE_KEY = 'dawn_sponsored_hidden';

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
			if (localStorage.getItem(HIDE_KEY) === '1') hidden = true;
		} catch {
			/* storage unavailable (private mode) — keep the strip for this session */
		}
	});

	function dismiss() {
		try {
			localStorage.setItem(HIDE_KEY, '1');
		} catch {
			/* storage unavailable — in-session hide only */
		}
		hidden = true;
	}
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
				>{slot.label}</a>
			{/if}
		{/each}
		<button
			type="button"
			class="sp-x"
			onclick={dismiss}
			title="Tipped? Hide the sponsored strip"
			aria-label="Hide the sponsored strip"
		>×</button>
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
		padding: 2px 0 12px;
	}
	.sponsored::-webkit-scrollbar { display: none; } /* Chrome/Safari */
	.disclosure {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
		flex-shrink: 0;
		padding: 0 2px;
	}
	.sp-btn {
		flex-shrink: 0;
		font-size: 11px;
		font-weight: 700;
		line-height: 1;
		padding: 7px 11px;
		border-radius: 999px;
		background: var(--sp-bg);
		color: var(--sp-fg);
		text-decoration: none;
		white-space: nowrap;
	}
	/* Subtle × for tippers — honor-system hide, no restore UI. */
	.sp-x {
		flex-shrink: 0;
		background: none;
		border: none;
		opacity: 0.45;
		color: var(--color-text-muted);
		font-size: 16px;
		line-height: 1;
		padding: 4px 6px;
		cursor: pointer;
	}
	.sp-x:hover { opacity: 1; }
</style>
