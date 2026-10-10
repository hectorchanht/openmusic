<script lang="ts">
	// Songs of the Year hub — every year × every country (Hector 2026-10-10).
	// Year selector with live URL sync (?year=, the pickTab/syncTabUrl idiom from url-tab.ts):
	// 2026 = the five curated region packs; 2000–2025 = per-country year-end charts.
	// Countries without verified data show a "coming soon" state — never fabricated songs.
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SoyYearStrip from '$lib/components/SoyYearStrip.svelte';
	import { t, type TranslationKey } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { pickTab, syncTabUrl } from '$lib/services/url-tab';
	import {
		SOY_YEARS,
		SOY_COUNTRIES,
		soyHasData
	} from '$lib/data/songs-of-year/registry';
	import { PACK_META as CANTOPOP_META, CANTOPOP_2026 } from '$lib/data/cantopop-2026';
	import { PACK_META_MANDOPOP_2026, MANDOPOP_2026 } from '$lib/data/mandopop-2026';
	import { PACK_META_KPOP_2026, KPOP_2026 } from '$lib/data/kpop-2026';
	import { PACK_META_JPOP_2026, JPOP_2026 } from '$lib/data/jpop-2026';
	import { PACK_META_WESTERN_2026, WESTERN_2026 } from '$lib/data/western-2026';
	import { ChevronRight } from '@lucide/svelte';

	const YEAR_SET = new Set(SOY_YEARS.map(String));
	const DEFAULT_YEAR = '2026';

	// Seeded from ?year=, validated against the allowlist (tampered values fall back).
	let year = $state<string>(pickTab(page.url, 'year', YEAR_SET, DEFAULT_YEAR));

	function selectYear(y: string) {
		year = y;
		syncTabUrl('year', y, DEFAULT_YEAR); // updates the URL in time, no history entry
	}

	const packs: { meta: { id: string; titleEn: string }; count: number; href: string; titleKey: TranslationKey }[] = [
		{ meta: CANTOPOP_META, count: CANTOPOP_2026.length, href: '/charts/cantopop-2026', titleKey: 'pack.title.cantopop' },
		{ meta: PACK_META_MANDOPOP_2026, count: MANDOPOP_2026.length, href: '/charts/mandopop-2026', titleKey: 'pack.title.mandopop' },
		{ meta: PACK_META_KPOP_2026, count: KPOP_2026.length, href: '/charts/kpop-2026', titleKey: 'pack.title.kpop' },
		{ meta: PACK_META_JPOP_2026, count: JPOP_2026.length, href: '/charts/jpop-2026', titleKey: 'pack.title.jpop' },
		{ meta: PACK_META_WESTERN_2026, count: WESTERN_2026.length, href: '/charts/western-2026', titleKey: 'pack.title.western' }
	];

	const yearNum = $derived(Number(year));

	function openCountryPack(country: string) {
		goto(`/charts/songs-of-year/${yearNum}/${encodeURIComponent(country)}`);
	}
</script>

<PageHeader backLabel={t('common.back')} showSettings />

<header class="hero">
	<h1>{t('home.songsOfYear')}</h1>
	{#if year === DEFAULT_YEAR}
		<p class="sub">2026 · 5 regions</p>
	{:else}
		<p class="sub">{yearNum} · {t('soy.yearEndSub')}</p>
	{/if}
</header>

<!-- Year selector — shared strip; URL updates in time via syncTabUrl in selectYear. -->
<SoyYearStrip active={year} onselect={selectYear} />

{#if year === DEFAULT_YEAR}
	<ul class="packs">
		{#each packs as p (p.meta.id)}
			<li>
				<button type="button" class="pack" onclick={() => goto(p.href)} use:tapBounce>
					<span class="meta">
						<span class="title">{t(p.titleKey)}</span>
						<span class="count">{p.meta.titleEn} · {p.count} {t('pack.songs')}</span>
					</span>
					<ChevronRight size={20} />
				</button>
			</li>
		{/each}
	</ul>
{:else}
	<ul class="packs">
		{#each SOY_COUNTRIES as country (country)}
			{@const has = soyHasData(yearNum, country)}
			<li>
				<button
					type="button"
					class="pack"
					class:soon={!has}
					disabled={!has}
					onclick={() => openCountryPack(country)}
					use:tapBounce
				>
					<span class="meta">
						<span class="title">{country} · {yearNum}</span>
						<span class="count">
							{#if has}
								50 {t('pack.songs')} · {t('soy.yearEndSub')}
							{:else}
								{t('lastfm.comingSoon')}
							{/if}
						</span>
					</span>
					{#if has}<ChevronRight size={20} />{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.hero { padding: 24px 16px 8px; text-align: center; }
	.hero h1 { font-size: calc(1.6rem * var(--fs-title, 1)); margin: 0; }
	.sub { color: var(--color-text-muted); font-size: 0.85rem; margin: 6px 0 0; }
	.packs { list-style: none; margin: 16px 0 0; padding: 0 16px 32px; display: grid; gap: 12px; }
	.pack {
		display: flex; align-items: center; justify-content: space-between; width: 100%;
		padding: 16px; border-radius: 12px; border: 1px solid var(--color-border);
		background: var(--color-surface); cursor: pointer; text-align: left;
	}
	.pack.soon { opacity: 0.45; cursor: default; }
	.meta { display: flex; flex-direction: column; gap: 4px; }
	.title { font-size: 1.1rem; font-weight: 700; }
	.count { font-size: 0.85rem; color: var(--color-text-muted); }
</style>
