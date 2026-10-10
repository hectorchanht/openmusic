<script lang="ts">
	// Shared Songs-of-the-Year year pill strip (quick-261010-soy9).
	// One strip, every page: the songs-of-year hub, the five 2026 region pack pages,
	// and the [year]/[country] pack pages all render this same component so the year
	// selector looks and behaves identically everywhere. The HOST owns selection state:
	// the hub syncs ?year= via pickTab/syncTabUrl; pack pages goto the hub for other years.
	import { SOY_YEARS } from '$lib/data/songs-of-year/registry';
	import { tapBounce } from '$lib/actions/tapBounce';

	interface Props {
		/** Currently selected year, as a string (e.g. '2026'). */
		active: string;
		/** Called with the tapped year string. */
		onselect: (year: string) => void;
	}
	let { active, onselect }: Props = $props();
</script>

<nav class="years" aria-label="year">
	{#each SOY_YEARS as y (y)}
		<button
			type="button"
			class="ypill"
			class:active={String(y) === active}
			onclick={() => onselect(String(y))}
			use:tapBounce
		>
			{y}
		</button>
	{/each}
</nav>

<style>
	.years {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		padding: 12px 16px 4px;
		scrollbar-width: none;
	}
	.years::-webkit-scrollbar {
		display: none;
	}
	.ypill {
		flex: 0 0 auto;
		padding: 8px 16px;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.ypill.active {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: #fff;
	}
</style>
