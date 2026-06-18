<script lang="ts" generics="T">
	// HomeGridPager — the YT-Music "Speed dial" 3×3 paginated cover grid (quick-260618-goe,
	// decision #1). LAYOUT-ONLY: the host supplies the per-tile `row` snippet (the reused
	// .tile/.scrim/.label markup), exactly like CompactPager owns chunking + snap geometry only.
	//
	// Caps at MAX 27 tiles (3 pages × 9), chunks into PAGES of 9, and lays the pages out in a
	// horizontal scroll-snap track (one page === one full-width snap stop). Each page is a 3-col
	// grid; columns are device-width-sized (3 × 1fr, NO size slider — locked decision). A dot
	// page indicator renders only when there is more than one page (the screenshot's 3 dots).
	import type { Snippet } from 'svelte';

	interface Props {
		items: T[];
		/** Stable identity for an item (WR-01): tiles are keyed by this, NOT by index, so when
		 *  `items` change Svelte recreates tiles instead of reusing stale resolved covers. */
		key: (item: T) => string;
		/** Renders ONE item (the host supplies the reused .tile markup). */
		row: Snippet<[T]>;
	}

	let { items, key, row }: Props = $props();

	const TILES_PER_PAGE = 9; // 3 cols × 3 rows
	const MAX_TILES = 27; // 3 pages

	// Belt-and-braces cap (the host also slices) so a too-long list can never exceed 3 pages.
	const capped = $derived(items.slice(0, MAX_TILES));

	// Chunk into pages of 9 (the last page may be short).
	const pages = $derived.by(() => {
		const out: T[][] = [];
		for (let i = 0; i < capped.length; i += TILES_PER_PAGE) {
			out.push(capped.slice(i, i + TILES_PER_PAGE));
		}
		return out;
	});

	// Active page for the dot indicator — derived from the scroll position of the snap track.
	let activePage = $state(0);
	function onScroll(e: Event) {
		const el = e.currentTarget as HTMLElement;
		if (el.clientWidth > 0) activePage = Math.round(el.scrollLeft / el.clientWidth);
	}
</script>

<div class="gridpager">
	<div class="track" onscroll={onScroll}>
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
				<span class="dot" class:active={di === activePage}></span>
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
		grid-template-columns: repeat(3, 1fr);
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
