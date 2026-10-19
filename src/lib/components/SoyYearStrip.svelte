<script lang="ts">
	// Shared Songs-of-the-Year year pill strip (quick-261010-soy9).
	// One strip, every page: the songs-of-year hub, the five 2026 region pack pages,
	// and the [year]/[country] pack pages all render this same component so the year
	// selector looks and behaves identically everywhere. The HOST owns selection state:
	// the hub syncs ?year= via pickTab/syncTabUrl; pack pages goto the hub for other years.
	import { SOY_YEARS, SOY_AVAILABLE } from '$lib/data/songs-of-year/registry';
	import { tapBounce } from '$lib/actions/tapBounce';

	interface Props {
		/** Currently selected year, as a string (e.g. '2026'). */
		active: string;
		/** Called with the tapped year string. */
		onselect: (year: string) => void;
		/**
		 * When set, only years with this country's verified data get a pill
		 * (Hector 2026-10-18: pills must be dynamic to available data).
		 * Omit for the hub (all years stay).
		 */
		country?: string;
	}
	let { active, onselect, country }: Props = $props();

	// The active year and the live 2026 year are always kept so the current
	// selection never vanishes and the 2026 pack stays one tap away.
	const years = $derived(
		SOY_YEARS.filter(
			(y) =>
				y === 2026 ||
				String(y) === active ||
				!country ||
				(SOY_AVAILABLE[y] ?? []).includes(country)
		)
	);
</script>

<nav class="years" aria-label="year">
	{#each years as y (y)}
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
