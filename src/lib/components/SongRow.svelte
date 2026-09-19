<script lang="ts">
	// SongRow — the ONE song row for list surfaces (quick-260919-l9e). CLAUDE.md's Anti-Patterns
	// section has been asking for this: `swipeQueue` / `swipeNext` / `openMenu` / `rowKey` were
	// re-declared across 6+ pages in three variants. They live here now, once.
	//
	// STRANGLER MIGRATION — today exactly ONE surface consumes this (the artist page's Hit songs).
	// Album / library / search / charts / NpUpNext / NpRelated follow in a later commit; their prop
	// needs are already priced into the shape below (`swipe` and `actions` exist for Up Next, which
	// overrides both). CompactRow is deliberately NOT yet folded in (D-3): it serves the home
	// shelves, which had a live layout regression hours before this was written, and re-expressing
	// it would put that surface inside the blast radius of a brand-new component for zero visible
	// gain. CONVERGENCE CONDITION: once >=3 surfaces run on SongRow, re-express CompactRow's
	// `variant='track'` branch as <SongRow index={null} actions={[]}> at the 40x40 art scale.
	// `variant='artist'` (round avatar, one line, no menu) is NEVER unified — D-4, and CLAUDE.md
	// already records that the item-type difference is real.
	//
	// D-6 — WHY A <div> WITH A STRETCHED .hit BUTTON, not a <button> row. The inline Like/Download
	// controls are real buttons, and a <button> inside a <button> is invalid HTML that browsers
	// resolve by making the inner one unreachable. So the row is a div; a transparent `.hit` button
	// is stretched over it (inset: 0) and carries the play onclick + use:longpress; the visual
	// content is `pointer-events: none` so it never swallows a tap meant for `.hit`; and the action
	// buttons are SIBLINGS painted above it. This is the quick-260919-1eh solution, verbatim.
	// use:swipeAction and use:tapBounce go on the WRAPPER, not on `.hit` — swipeAction writes inline
	// translateX on its own node, and on an absolutely-positioned child the row would not visibly
	// slide.
	//
	// D-2 — WIDTH: THE TITLE GIVES. Every control here is fixed-width (rank 18, art 44, each inline
	// action 36, the menu 44) and `.meta` is the only flexible box, so it absorbs 100% of the
	// squeeze. At 360px with both buttons on, `.meta` gets ~130px — which a CJK title overruns. That
	// is exactly what use:marquee exists for, so the two lines SCROLL rather than sit clipped.
	// Nothing else shrinks, nothing wraps, no responsive hiding, no row-height change.
	//
	// D-7 — THE 24+-ROW BUDGET, which every future edit here has to keep:
	//   * an action that is OFF renders NO node (no hidden placeholder, no visibility trick);
	//   * ONE $effect per instance, the WR-01 identity-change cover reset CompactRow already pays;
	//   * ZERO new network per row — the cover chain is the same pickRowCover READ + the one
	//     use:lazyCover the migrated pages already ran;
	//   * DownloadControl is never passed `probe` (its own doc-comment forbids it on a list row —
	//     that is the api-fetch-flood lesson), so its probe $effect early-returns on line one;
	//   * each inline button reads library.isLiked / isDownloaded — the SAME reads RowBadges
	//     performed on these rows before, and `hideLiked`/`hideDownloaded` below removes the
	//     badge's copy, so the net subscription count per row is UNCHANGED.
	import { Heart, MoreVertical, GripVertical } from '@lucide/svelte';
	import type { Track } from '$lib/sources/types';
	import { longpress } from '$lib/actions/longpress';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { lazyCover } from '$lib/actions/lazyCover';
	import { marquee } from '$lib/actions/marquee';
	import { swipeAction, type SwipeActionOpts } from '$lib/actions/swipeAction';
	import { pickRowCover } from '$lib/services/row-cover';
	import { readCoverByUidOrName, readPinnedCover } from '$lib/stores/cover-version.svelte';
	import { coverGradient } from '$lib/services/cover-gradient';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { settings, type RowAction } from '$lib/stores/settings.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import { t } from '$lib/i18n';
	import RowBadges from '$lib/components/RowBadges.svelte';
	import DownloadControl from '$lib/components/DownloadControl.svelte';

	interface Props {
		/** The song. `uid = ${source}:${songid}` is IDENTITY (makeUid). */
		track: Track;
		/** displayIndex — ORDERING ONLY, never identity. null/omitted = no rank column. */
		index?: number | null;
		/** REQUIRED. Tap-to-play. Each surface installs its OWN queue here. */
		onplay: () => void;
		/** REQUIRED. Long-press or the ⋮. The HOST owns TrackMenu state (the CompactRow contract). */
		onrequestmenu: () => void;
		/** undefined = the app convention (right = add to queue, left = play next), implemented
		 *  below. `null` = no swipe. An object OVERRIDES both directions — the seam Up Next needs
		 *  (its left-swipe is remove-with-undo, its right-swipe is the version picker). */
		swipe?: SwipeActionOpts | null;
		/** Drag handle. Off by default; only a surface with real reordering turns it on. */
		grip?: boolean;
		/** Which inline buttons render, IN ORDER. undefined = settings.rowActions (the user's
		 *  choice); an array FORCES it — Up Next passes ['like'] or [] so it cannot grow a Download
		 *  button just because the setting is on. The ⋮ is NOT in this union: it always renders,
		 *  which is what makes an empty list a safe choice rather than a dead-end row. */
		actions?: RowAction[];
		/** Second line. Default `names.dnArtist(track.album || track.artist)`. */
		subtitle?: string;
		/** A host-known cover → rung 2 of pickRowCover. Omit and the shared chain resolves it. */
		cover?: string | null;
		/** Highlight. Default: this is the currently-playing track. */
		active?: boolean;
	}

	let {
		track,
		index = null,
		onplay,
		onrequestmenu,
		swipe = undefined,
		grip = false,
		actions = undefined,
		subtitle = undefined,
		cover = null,
		active = undefined
	}: Props = $props();

	// The prop FORCES; the setting is the fallback. Order is load-bearing — `acts` IS the
	// left-to-right layout, so `['download','like']` really does put the download button first.
	const acts = $derived(actions ?? settings.rowActions);
	const sub = $derived(subtitle ?? names.dnArtist(track.album || track.artist));
	const isActive = $derived(active ?? player.current?.uid === track.uid);
	const liked = $derived(library.isLiked(track.uid));

	// The shared three-rung row cover read (quick-260910-qwt + quick-260915-w4f rung 0): the user's
	// PINNED cover, then this row's own lazyCover result, then a host-provided cover, then the
	// shared reactive cache. A reactive READ, not a fetch — use:lazyCover below is the only network.
	let resolvedCover = $state<string | null>(null);
	const art = $derived(
		pickRowCover(
			readPinnedCover(track.uid),
			resolvedCover ?? undefined,
			cover,
			readCoverByUidOrName(track.uid, track.artist, track.title)
		)
	);
	// WR-01 defense-in-depth: if this instance is ever reused for a DIFFERENT song (identity
	// change), drop the previous song's resolved art so it cannot paint over the new title. Lists
	// are uid-keyed so this is normally a no-op — it is insurance against a non-keyed {#each}
	// reorder, and it is the ONE $effect D-7 permits.
	$effect(() => {
		void track.uid;
		resolvedCover = null;
	});

	// The app-wide swipe convention, lifted verbatim from the per-page copies it replaces (UX-04
	// D-03/D-04). swipeAction is a PURE DOM gesture and fires no haptics — the consumer must.
	function queueTrack() {
		player.addToQueue(track);
		hapticTick();
		toast.show(t('toast.addedToQueue'));
	}
	function nextTrack() {
		player.playNext(track);
		hapticTick();
		toast.show(t('toast.playingNext'));
	}
	const swipeOpts = $derived<SwipeActionOpts>(
		swipe === null ? { enabled: false } : (swipe ?? { onSwipeRight: queueTrack, onSwipeLeft: nextTrack })
	);

	function toggleLike() {
		library.toggleLike(track);
		toast.show(library.isLiked(track.uid) ? t('toast.liked') : t('toast.unliked'));
	}
</script>

<div class="srow" class:is-active={isActive} use:tapBounce use:swipeAction={swipeOpts}>
	<!-- D-6: the stretched transparent hit target. It carries play + long-press and nothing else;
	     its aria-label is the row's whole readable content, since the visuals below are inert. -->
	<button
		class="hit"
		aria-label={`${names.dnTitle(track.title)} — ${sub}`}
		use:longpress
		onlongpress={(e) => {
			(e.currentTarget as HTMLElement)?.blur();
			hapticTick();
			onrequestmenu();
		}}
		onclick={onplay}
	></button>
	{#if grip}<span class="grip" aria-hidden="true"><GripVertical size={16} /></span>{/if}
	{#if index != null}<span class="rank">{index + 1}</span>{/if}
	<span
		class="art"
		use:lazyCover={{ track, onResolved: (_uid, url) => (resolvedCover = url) }}
		style:background-image={art ? `url(${art})` : coverGradient(track.uid)}
	></span>
	<span class="meta">
		<span class="r-title" use:marquee><span class="marquee-inner">{names.dnTitle(track.title)}</span></span>
		<span class="r-sub" use:marquee><span class="marquee-inner">{sub}</span></span>
	</span>
	<!-- D-5: the passive badge stands down for whichever state this row draws a live control for. -->
	<RowBadges uid={track.uid} hideLiked={acts.includes('like')} hideDownloaded={acts.includes('download')} />
	{#each acts as a (a)}
		{#if a === 'like'}
			<button
				class="ract"
				class:on={liked}
				aria-pressed={liked}
				aria-label={t(liked ? 'menu.liked' : 'menu.like')}
				title={t(liked ? 'menu.liked' : 'menu.like')}
				use:tapBounce
				onclick={toggleLike}
			>
				<Heart size={18} fill={liked ? 'currentColor' : 'none'} />
			</button>
		{:else if a === 'download'}
			<!-- No `probe`, ever: this is a list row (see D-7 / DownloadControl's own contract). -->
			<DownloadControl {track} />
		{/if}
	{/each}
	<button class="opt" aria-label={t('menu.options')} onclick={onrequestmenu}>
		<MoreVertical size={18} />
	</button>
</div>

<style>
	.srow {
		position: relative;
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		padding: 6px;
		border-radius: 8px;
		transition: background 0.12s ease;
	}
	/* MENU-03 / D-12: hover-capable devices only — touch otherwise latches this :hover under a
	   held finger while the track menu opens. */
	@media (hover: hover) {
		.srow:hover {
			background: var(--color-surface);
		}
	}
	.srow.is-active {
		background: var(--color-surface);
	}
	/* D-6: the row's real tap target, stretched under everything. Transparent and label-only. */
	.hit {
		position: absolute;
		inset: 0;
		width: 100%;
		padding: 0;
		background: none;
		border: none;
		border-radius: inherit;
		cursor: pointer;
	}
	/* Inert visuals: `pointer-events: none` so they never swallow a tap meant for .hit, and
	   `position: relative` so they still paint ABOVE it. */
	.grip,
	.rank,
	.art,
	.meta,
	.srow :global(.row-badges) {
		position: relative;
		pointer-events: none;
	}
	.grip {
		flex: none;
		display: grid;
		place-items: center;
		color: var(--color-text-muted);
	}
	.rank {
		flex: none;
		width: 18px;
		text-align: center;
		font-size: 12px;
		color: var(--color-text-muted);
	}
	.art {
		/* quick-260618-goe: the row tile scales with the Cover size setting, like CompactRow's. */
		width: calc(44px * var(--cover-scale, 1));
		height: calc(44px * var(--cover-scale, 1));
		border-radius: 6px;
		background-size: cover;
		background-position: center;
		background-color: var(--color-surface-2);
		flex: none;
	}
	/* D-2: the ONLY flexible box, so it absorbs the whole squeeze — by design. */
	.meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	/* min-width:0 + overflow:hidden so use:marquee measures a REAL overflow and scrolls it. */
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
	/* The inline actions keep their pointer events (they are siblings of .hit, not children, so
	   tapping one never fires the row's click — no stopPropagation needed). 36px, not
	   DownloadControl's own 40, so TWO of them still cost less than one ⋮: the menu keeps the full
	   44px because it is the always-reachable control. */
	.ract {
		position: relative;
		flex: none;
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		padding: 0;
		background: none;
		border: none;
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.ract.on {
		color: var(--color-primary);
	}
	/* DownloadControl owns its own markup (it swaps between a <button> and three <span> states),
	   so its 40x40 default is re-sized to the 36px row action from here. `position: relative` is
	   what lifts it above the stretched .hit — without it the download tap would land on play. */
	.srow :global(.dc) {
		position: relative;
		width: 36px;
		height: 36px;
	}
	@media (hover: hover) {
		.ract:hover {
			background: var(--color-surface);
		}
	}
	.opt {
		position: relative;
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
