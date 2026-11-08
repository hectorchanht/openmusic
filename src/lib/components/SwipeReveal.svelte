<script lang="ts">
	import { settings } from '$lib/stores/settings.svelte';
	import { SWIPE_ICON } from '$lib/components/swipe-act';

	// quick-261108-swp: the two glyphs BEHIND a swipeable song row, following the user's swipe map —
	// a right-drag exposes the LEFT edge (the right-swipe action), a left-drag the RIGHT edge. The
	// host keeps its `position: relative; overflow: hidden` wrapper and the row's opaque background
	// (both already there on every surface); this only replaces the hard-coded icon pair.
	const Right = $derived(SWIPE_ICON[settings.swipeRow.right]);
	const Left = $derived(SWIPE_ICON[settings.swipeRow.left]);
</script>

{#if Right}<span class="reveal at-start" aria-hidden="true"><Right size={20} /></span>{/if}
{#if Left}<span class="reveal at-end" aria-hidden="true"><Left size={20} /></span>{/if}

<style>
	.reveal {
		position: absolute; top: 0; bottom: 0; width: 96px; display: flex; align-items: center;
		justify-content: center; color: var(--color-text-muted); pointer-events: none;
	}
	/* Physical edges, not logical: the row's translateX is physical, so a right-drag exposes the
	   LEFT edge under RTL too. */
	.at-start { left: 0; }
	.at-end { right: 0; }
</style>
