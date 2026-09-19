<script lang="ts" generics="T">
	// HomeGridPager — the YT-Music "Speed dial" paginated cover grid (quick-260618-goe,
	// decision #1). LAYOUT-ONLY: the host supplies the per-tile `row` snippet (the reused
	// .tile/.scrim/.label markup), exactly like CompactPager owns chunking + snap geometry only.
	//
	// Caps at MAX 27 tiles, chunks into PAGES, and lays the pages out in a horizontal scroll-snap
	// track (one page === one full-width snap stop). A dot page indicator renders only when there
	// is more than one page.
	//
	// quick-260919-et3 follow-up — THE COLUMN COUNT IS NO LONGER 3. The desktop build of this
	// component capped its columns at 220px so the 3×3 snap geometry survived a wide window; at
	// 1820px that rendered nine covers in the left third and left the rest of the screen empty,
	// which is what the user rejected. Columns are now measured from the track's own width
	// (gridColumns), so the grid fills whatever it is given. That makes TILES-PER-PAGE a derived
	// value — `cols × GRID_ROWS_PER_PAGE`, not the old constant 9 — which is the whole reason the
	// measurement happens in JS rather than in a media query: the dots count PAGES, so if the
	// columns change and the page size does not, the dots start lying about how many pages exist.
	// Mobile is untouched by construction: gridColumns cannot exceed 3 below a 750px track.
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import { gridColumns, GRID_ROWS_PER_PAGE } from './shelf-scroll';

	interface Props {
		items: T[];
		/** Stable identity for an item (WR-01): tiles are keyed by this, NOT by index, so when
		 *  `items` change Svelte recreates tiles instead of reusing stale resolved covers. */
		key: (item: T) => string;
		/** Renders ONE item (the host supplies the reused .tile markup). */
		row: Snippet<[T]>;
	}

	let { items, key, row }: Props = $props();

	const MAX_TILES = 27; // belt-and-braces cap; the host also slices

	// Measured column count. A ResizeObserver on the track covers both the initial layout (it
	// fires once on observe) and later width changes — a window resize, and the rail appearing or
	// disappearing at the 1024px breakpoint. The track's width does not depend on `cols`, so this
	// cannot feed back into itself.
	let trackEl = $state<HTMLDivElement | undefined>(undefined);
	let cols = $state(gridColumns(0));

	$effect(() => {
		// SSR/native guard per CLAUDE.md.
		if (!browser || !trackEl) return;
		const el = trackEl;
		const ro = new ResizeObserver(() => {
			cols = gridColumns(el.clientWidth);
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	const tilesPerPage = $derived(cols * GRID_ROWS_PER_PAGE);
	const capped = $derived(items.slice(0, MAX_TILES));

	// Chunk into pages of `tilesPerPage` (the last page may be short).
	const pages = $derived.by(() => {
		const out: T[][] = [];
		for (let i = 0; i < capped.length; i += tilesPerPage) {
			out.push(capped.slice(i, i + tilesPerPage));
		}
		return out;
	});

	// Active page for the dot indicator — derived from the scroll position of the snap track.
	let activePage = $state(0);
	function onScroll(e: Event) {
		const el = e.currentTarget as HTMLElement;
		if (el.clientWidth > 0) activePage = Math.round(el.scrollLeft / el.clientWidth);
	}
	// Widening the window can fold three pages into two while the user is looking at page 3. The
	// browser clamps scrollLeft and fires `scroll`, but clamping the READ too means the dots are
	// never briefly out of range.
	const activeDot = $derived(Math.min(activePage, pages.length - 1));
</script>

<div class="gridpager" style:--cols={cols}>
	<div class="track" bind:this={trackEl} onscroll={onScroll}>
		{#each pages as page, pi (pi)}
			<div class="page">
				{#each page as item (key(item))}
					{@render row(item)}
				{/each}
			</div>
		{/each}
	</div>
	{#if pages.length > 1}
		<div class="dots" aria-hidden="true">
			{#each pages as _page, di (di)}
				<span class="dot" class:active={di === activeDot}></span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.gridpager {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.track {
		display: flex;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		/* Hide the scrollbar — the dot indicator is the page cue (matches CompactPager). */
		scrollbar-width: none;
	}
	.track::-webkit-scrollbar {
		display: none;
	}
	.page {
		flex: 0 0 100%;
		max-width: 100%;
		scroll-snap-align: start;
		display: grid;
		/* --cols is measured in JS (see the header): the same number the page-size maths uses, so
		   the layout and the dot indicator can never disagree. The fallback keeps the pre-measure
		   frame at the mobile 3. Keep this gap in sync with GRID_GAP in shelf-scroll.ts. */
		grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr));
		gap: 10px;
		/* A short final page must not stretch its tiles to fill 3 full rows. */
		align-content: start;
	}
	.dots {
		display: flex;
		justify-content: center;
		gap: 6px;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--color-text-muted);
		opacity: 0.4;
		transition: opacity 0.18s ease, background 0.18s ease;
	}
	.dot.active {
		background: var(--color-primary);
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		.track {
			scroll-behavior: auto;
		}
		.dot {
			transition: none;
		}
	}
</style>
