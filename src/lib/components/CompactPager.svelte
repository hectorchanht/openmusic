<script lang="ts" generics="T">
	// CompactPager — the YT-Music quick-picks horizontal pager (HOME-02, D-05/D-06, UI-SPEC §4.1).
	//
	// Chunks `items` into columns of 4 stacked rows, laid out in a horizontal scroll track with
	// CSS scroll-snap (`scroll-snap-type: x mandatory`, each column `scroll-snap-align: start`).
	// Each column is ~90vw wide so the NEXT column's edge peeks (signals scrollability, D-06).
	// Columns = ceil(items.length / 4). The HOST passes a `row` snippet rendering one item (a
	// CompactRow); the pager owns only the chunking + the snap track geometry.
	import type { Snippet } from 'svelte';
	import { dragScroll } from '$lib/actions/dragScroll';

	interface Props {
		items: T[];
		/**
		 * Stable identity for an item (WR-01): rows are keyed by this, NOT by index, so when
		 * `items` change (e.g. Randomize) Svelte recreates rows instead of reusing CompactRow
		 * instances whose locally-resolved cover would belong to the previous item.
		 */
		key: (item: T) => string;
		/** Renders ONE item (the host supplies a CompactRow). */
		row: Snippet<[T]>;
	}

	let { items, key, row }: Props = $props();

	const ROWS_PER_COLUMN = 4;
	// Chunk into columns of 4 (the last column may be short).
	const columns = $derived.by(() => {
		const out: T[][] = [];
		for (let i = 0; i < items.length; i += ROWS_PER_COLUMN) {
			out.push(items.slice(i, i + ROWS_PER_COLUMN));
		}
		return out;
	});
</script>

<!-- use:dragScroll — mouse drag-to-pan on desktop, matching .albumrow and HomeGridPager.
     The scrollbar is hidden here too, so without it a pointer user had no way to reach the
     later columns at all. -->
<div class="pager" use:dragScroll>
	{#each columns as col, ci (ci)}
		<div class="column">
			{#each col as item (key(item))}
				{@render row(item)}
			{/each}
		</div>
	{/each}
</div>

<style>
	.pager {
		display: flex;
		gap: 12px;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		padding-bottom: 4px;
		/* Hide the scrollbar — the peeking next column is the scroll cue (matches .albumrow). */
		scrollbar-width: none;
	}
	.pager::-webkit-scrollbar {
		display: none;
	}
	.column {
		flex: 0 0 90vw;
		max-width: 90vw;
		scroll-snap-align: start;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	/* On wide (desktop) viewports the page is constrained; cap the column so it doesn't sprawl. */
	@media (min-width: 640px) {
		.column {
			flex-basis: 420px;
			max-width: 420px;
		}
	}
</style>
