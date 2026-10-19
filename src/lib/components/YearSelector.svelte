<script lang="ts">
	// Year picker for the 2026 chart pack pages — a horizontal pill strip
	// (mobile-first, native touch scroll), rendered as a sibling below the
	// PageHeader (the PageHeader D-5 pattern: tabs-like UI lives outside the
	// header in the page's own markup). Pill visual language matches the
	// songs-of-year hub's own year strip.
	//
	// The page's own year is the active chip (aria-current). Every other year
	// links to the real songs-of-year route for the region's country.
	// Only years with this region's country data get a pill (Hector 2026-10-18:
	// pills must be dynamic to available data, not the full 1946–2026 range).
	import { t } from '$lib/i18n';
	import { SOY_YEARS, SOY_AVAILABLE } from '$lib/data/songs-of-year/registry';
	import { chartYearHref, CHART_REGION_COUNTRY, type ChartRegion } from '$lib/data/chart-years';

	interface Props {
		region: ChartRegion;
		year: number;
	}

	let { region, year }: Props = $props();

	// Years with verified data for this region's country. The page's own year
	// is always kept — it's the live curated pack, not a SOY_AVAILABLE row.
	const country = CHART_REGION_COUNTRY[region];
	const years = $derived(
		SOY_YEARS.filter((y) => y === year || (SOY_AVAILABLE[y] ?? []).includes(country))
	);
</script>

<nav class="years" aria-label={t('pack.chooseYear')}>
	{#each years as y (y)}
		{#if y === year}
			<span class="ypill active" aria-current="page">{y}</span>
		{:else}
			<a class="ypill" href={chartYearHref(region, y)}>{y}</a>
		{/if}
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
		text-decoration: none;
		cursor: pointer;
	}
	.ypill.active {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: #fff;
		cursor: default;
	}
</style>
