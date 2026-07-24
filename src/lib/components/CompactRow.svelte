<script lang="ts">
	// CompactRow — the YT-Music quick-picks compact row (HOME-02/03, D-08/D-09, UI-SPEC §4.1).
	//
	// Two variants:
	//  - 'track' : 40×40 art (radius 6px) + title/subtitle (both marquee) + a trailing ⋮ option
	//              button. tap row = play (onplay), tap ⋮ = open menu (onrequestmenu),
	//              long-press row = open menu (onrequestmenu, via use:longpress).
	//  - 'artist': 40×40 ROUND avatar + name only (marquee). tap = open artist (onopen). NO ⋮,
	//              NO long-press (no meaningful artist menu — D-09).
	//
	// The HOST owns all TrackMenu / play / navigation state (callback props). This component is
	// pure presentation + interaction wiring, mirroring the search-row idiom (search/+page.svelte
	// 511-525): use:longpress onlongpress (blur guard MENU-03 + haptics.tick() + emit), onclick (emit),
	// use:lazyCover for the art, use:marquee + .marquee-inner for long labels (project memory rule).
	import { MoreVertical } from '@lucide/svelte';
	import type { Track } from '$lib/sources/types';
	import { longpress } from '$lib/actions/longpress';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { lazyCover } from '$lib/actions/lazyCover';
	import { marquee } from '$lib/actions/marquee';
	import { player } from '$lib/stores/player.svelte';
	import RowBadges from '$lib/components/RowBadges.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import { t } from '$lib/i18n';

	interface Props {
		variant?: 'track' | 'artist';
		/** Primary line: track title (track) or artist name (artist). */
		title: string;
		/** Secondary line (track variant only): artist. */
		subtitle?: string;
		/** A cover/avatar URL if already known; null → fallback gradient. */
		cover?: string | null;
		/** A seed used to derive the fallback gradient (uid / name / artist+title). */
		seed: string;
		/**
		 * Optional Track for use:lazyCover (track variant). When provided the art resolves a real
		 * cover on scroll-into-view via the shared lazyCover chain (same as the search/library rows).
		 * Library-track rows pass this; discovery stubs may omit it (they backfill via the host).
		 */
		track?: Track | null;
		/** track variant: tap row = play. */
		onplay?: () => void;
		/** track variant: tap ⋮ or long-press = open the track menu. */
		onrequestmenu?: () => void;
		/** artist variant: tap = open the artist page. */
		onopen?: () => void;
	}

	let {
		variant = 'track',
		title,
		subtitle = '',
		cover = null,
		seed,
		track = null,
		onplay,
		onrequestmenu,
		onopen
	}: Props = $props();

	// Locally-resolved cover (track variant, via use:lazyCover). Falls back to the passed `cover`.
	let resolvedCover = $state<string | null>(null);
	const effectiveCover = $derived(resolvedCover ?? cover);

	// WR-01 defense-in-depth: if this instance is ever reused for a DIFFERENT item (identity
	// change = new seed), drop the previous item's resolved art so it can't paint over the new
	// title. Pager rows are identity-keyed so this is normally a no-op.
	$effect(() => {
		void seed;
		resolvedCover = null;
	});

	function fallbackGradient(s: string): string {
		const h = (s.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}
</script>

{#if variant === 'artist'}
	<button class="crow" onclick={() => onopen?.()}>
		<span
			class="art round"
			style:background-image={effectiveCover ? `url(${effectiveCover})` : fallbackGradient(seed)}
		></span>
		<span class="meta">
			<span class="r-title" use:marquee><span class="marquee-inner">{title}</span></span>
		</span>
	</button>
{:else}
	<div class="crow-wrap">
		<button
			class="crow"
			class:is-active={track != null && player.current?.uid === track.uid}
			use:tapBounce
			use:longpress
			onlongpress={(e) => {
				(e.currentTarget as HTMLElement)?.blur();
				hapticTick();
				onrequestmenu?.();
			}}
			onclick={() => onplay?.()}
		>
			{#if track}
				<span
					class="art"
					use:lazyCover={{ track, onResolved: (_uid, url) => (resolvedCover = url) }}
					style:background-image={effectiveCover ? `url(${effectiveCover})` : fallbackGradient(seed)}
				></span>
			{:else}
				<span
					class="art"
					style:background-image={effectiveCover ? `url(${effectiveCover})` : fallbackGradient(seed)}
				></span>
			{/if}
			<span class="meta">
				<span class="r-title" use:marquee><span class="marquee-inner">{title}</span></span>
				{#if subtitle}<span class="r-sub" use:marquee><span class="marquee-inner">{subtitle}</span></span>{/if}
			</span>
		</button>
		<!-- DL-STATE-01: passive liked ♥ + downloaded ✓ indicators via the shared RowBadges (quick-260723
		     rollout to all song rows). Non-interactive; like/download INITIATION stays in the ⋮ menu here. -->
		{#if track}<RowBadges uid={track.uid} />{/if}
		<button class="opt" aria-label={t('menu.options')} onclick={() => onrequestmenu?.()}>
			<MoreVertical size={18} />
		</button>
	</div>
{/if}

<style>
	/* A track row = the row button + its trailing ⋮ button, laid out together so the ⋮ is a
	   sibling tap target (its own ≥44px hit area) rather than nested inside the play button. */
	.crow-wrap {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
	}
	.crow {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		padding: 0;
		background: none;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		text-align: left;
		color: var(--color-text);
		transition: background 0.12s ease;
	}
	/* MENU-03 / D-12: hover-capable devices only — touch otherwise latches this :hover under a
	   held finger while the track menu opens. */
	@media (hover: hover) {
		.crow:hover {
			background: var(--color-surface);
		}
	}
	/* Active/selected row = the currently-playing track. NOT hover-gated, so the light-grey
	   --color-surface highlight shows on touch too. Discovery stubs (track == null) never match. */
	.crow.is-active {
		background: var(--color-surface);
	}
	.art {
		/* quick-260618-goe (decision #3): scale the compact cover tile with the Cover Size
		   setting, mirroring how .album/.al-cover in +page.svelte read --cover-scale (applyTheme
		   sets it on <html>). The crow art previously ignored coverScale entirely. */
		width: calc(40px * var(--cover-scale, 1));
		height: calc(40px * var(--cover-scale, 1));
		border-radius: 6px;
		background-size: cover;
		background-position: center;
		background-color: var(--color-surface-2);
		flex: none;
	}
	.art.round {
		border-radius: var(--radius-full);
	}
	.meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	/* min-width:0 + overflow:hidden so use:marquee detects + scrolls the overflow (the parent
	   .meta is the locked-width box; the inner span scrolls). */
	.r-title {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		font-size: calc(14px * var(--fs-title, 1));
		font-weight: 600;
		line-height: 1.3;
	}
	.r-sub {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		font-size: calc(12px * var(--fs-artist, 1));
		font-weight: 400;
		line-height: 1.3;
		color: var(--color-text-muted);
	}
	.opt {
		flex: none;
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		background: none;
		border: none;
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	@media (hover: hover) {
		.opt:hover {
			background: var(--color-surface);
			color: var(--color-text);
		}
	}
</style>
