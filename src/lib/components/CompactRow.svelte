<script lang="ts">
	// CompactRow — the YT-Music quick-picks compact row (HOME-02/03, D-08/D-09, UI-SPEC §4.1).
	//
	// Three variants:
	//  - 'track' : 40×40 art (radius 6px) + title/subtitle (both marquee) + a trailing ⋮ option
	//              button. tap row = play (onplay), tap ⋮ = open menu (onrequestmenu),
	//              long-press row = open menu (onrequestmenu, via use:longpress).
	//  - 'artist': 40×40 ROUND avatar + name only (marquee). tap = open artist (onopen). NO ⋮,
	//              NO long-press (no meaningful artist menu — D-09).
	//  - 'album' : 40×40 SQUARE art + title/subtitle (both marquee); the whole row is ONE button
	//              firing onopen. NO ⋮, NO long-press, NO RowBadges — an album tile has no song to
	//              resolve (39-D-35, parity with the artist variant).
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
	// quick-260910-qwt: the shared row cover read (resolved → cover → the shared cache).
	import { pickRowCover } from '$lib/services/row-cover';
	import { readCoverByUidOrName, readPinnedCover } from '$lib/stores/cover-version.svelte';
	import { marquee } from '$lib/actions/marquee';
	import { player } from '$lib/stores/player.svelte';
	import RowBadges from '$lib/components/RowBadges.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import { t } from '$lib/i18n';

	interface Props {
		variant?: 'track' | 'artist' | 'album';
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
		/** artist / album variant: tap = open the artist / album page. */
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
	//
	// quick-260910-qwt: the read is now the shared three-rung `pickRowCover` — resolvedCover (rung 1,
	// this row's own lazyCover result, kept FIRST so a D-15 repaired URL still beats a broken seed) →
	// the host-provided `cover` (rung 2) → the shared reactive cover cache (rung 3), so a cover
	// resolved on ANY other surface paints here on first render and repaints live via coverVersion().
	// Rung 3 needs an identity: a DISCOVERY STUB (`track == null`, e.g. a quick-picks tile the host
	// backfills itself) has none, so it keeps exactly the old host-provided `cover` behaviour.
	// A reactive READ, not a fetch — use:lazyCover below is unchanged.
	let resolvedCover = $state<string | null>(null);
	const effectiveCover = $derived(
		pickRowCover(
			// quick-260915-w4f rung 0: the user's pinned cover. Like rung 3 it needs an identity, so a
			// uid-less discovery stub (track == null) keeps exactly the old host-provided behaviour.
			track ? readPinnedCover(track.uid) : null,
			resolvedCover ?? undefined,
			cover,
			track ? readCoverByUidOrName(track.uid, track.artist, track.title) : null
		)
	);

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
	<!-- quick-260910-qjv: artist tap feedback, parity with song rows -->
	<!-- quick-260919-et3: `is-artist` exists for ONE CSS rule (see .crow.is-artist below) — this
	     button is the pager column's direct child, where .crow's `flex: 1` grows it vertically. -->
	<button class="crow is-artist" use:tapBounce onclick={() => onopen?.()}>
		<span
			class="art round"
			style:background-image={effectiveCover ? `url(${effectiveCover})` : fallbackGradient(seed)}
		></span>
		<span class="meta">
			<span class="r-title" use:marquee><span class="marquee-inner">{title}</span></span>
		</span>
	</button>
{:else if variant === 'album'}
	<!-- 39-D-35: same direct-child-of-the-pager-column situation as the artist row, so it reuses
	     `is-artist` for the one flex rule (quick-260919-et3). -->
	<button class="crow is-artist" use:tapBounce onclick={() => onopen?.()}>
		<span
			class="art"
			style:background-image={effectiveCover ? `url(${effectiveCover})` : fallbackGradient(seed)}
		></span>
		<span class="meta">
			<span class="r-title" use:marquee><span class="marquee-inner">{title}</span></span>
			<span class="r-sub" use:marquee><span class="marquee-inner">{subtitle}</span></span>
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
			<!-- DL-STATE-01: passive liked ♥ + downloaded ✓ indicators via the shared RowBadges (quick-260723
				 rollout to all song rows). Non-interactive; like/download INITIATION stays in the ⋮ menu here. -->
			{#if track}<RowBadges uid={track.uid} />{/if}
		</button>
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
	/* quick-260919-et3: the artist variant has NO .crow-wrap — the button IS the direct child of
	   CompactPager's `.column` (a COLUMN flex container), so `flex: 1` above resolves to
	   "grow along the BLOCK axis" and each row stretched to an equal share of the column's height.
	   In a full 4-row column that share is exactly 44px, so nothing looked wrong; a SHORT last
	   column (2 artists of a 10-artist shelf) split the same 200px two ways instead of four, giving
	   96px rows whose centred avatars no longer lined up with the 44px track rows in the shelves
	   above and below. Track rows are immune: their flex parent is the row-direction .crow-wrap,
	   which is where that `flex: 1` is meant to apply (fill the width beside the ⋮).
	   `flex: none` restores the natural height, which min-height: 44px above already pins.
	   39-D-35: the album variant is the same bare button in the same column, so it carries the
	   class too and this one rule covers both. */
	.crow.is-artist {
		flex: none;
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
		font-size: calc(0.875rem * var(--fs-title, 1));
		font-weight: 600;
		line-height: 1.3;
	}
	.r-sub {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		font-size: calc(0.75rem * var(--fs-artist, 1));
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
