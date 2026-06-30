<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		ChevronLeft,
		GripVertical,
		LayoutGrid,
		Tags,
		Globe,
		SlidersHorizontal,
		Compass,
		LayoutList,
		ToggleRight,
		TableOfContents,
		DiscAlbum,
		Grid3x3
	} from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import {
		resolveSectionOrder,
		resolveSubset,
		SHELF_MIN,
		SHELF_MAX,
		type HomeSectionId,
		type HomeDensity,
		type HomeLandingTab
	} from '$lib/services/home-layout';
	import { DISCOVERY_TAGS, DISCOVERY_COUNTRIES } from '$lib/services/discovery';
	import { dragReorder } from '$lib/actions/dragReorder';
	import { chipReorder } from '$lib/actions/chipReorder';
	import { t, type TranslationKey } from '$lib/i18n';

	onMount(() => settings.load());

	// Section id → i18n label key. Iterate the RESOLVED order so a corrupt saved order still
	// renders (resolveSectionOrder drops unknown ids + appends missing known ones).
	const sectionLabel: Record<HomeSectionId, TranslationKey> = {
		'top-hits': 'settings.homeSectionTopHits',
		'top-artists': 'settings.homeSectionTopArtists',
		tags: 'settings.homeSectionTags',
		countries: 'settings.homeSectionCountries',
		liked: 'settings.homeSectionLiked',
		downloads: 'settings.homeSectionDownloads',
		'fav-artists': 'settings.homeSectionFavArtists',
		playlists: 'settings.homeSectionPlaylists',
		history: 'settings.homeSectionHistory'
	};

	const order = $derived(resolveSectionOrder(settings.homeSectionOrder));

	// dragReorder fires (from,to) as indices into `order`. Splice on a COPY, persist.
	function onReorder(from: number, to: number) {
		const next = [...order];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		settings.homeSectionOrder = next;
		settings.save();
	}

	function toggleHidden(id: string) {
		settings.homeHidden = settings.homeHidden.includes(id)
			? settings.homeHidden.filter((x) => x !== id)
			: [...settings.homeHidden, id];
		settings.save();
	}

	// D-07: per-section density override. The home page resolves with 'list' as the global
	// default (list-by-default), so the EFFECTIVE density of a section with no stored override is
	// 'list'. We surface that here by treating an absent/garbage key as 'list'. Writing a value
	// persists the override; the resolver clamps any garbage back to the default at render time.
	// quick-260618-goe: values renamed to 'list' | 'pile' | 'grid'.
	function sectionDensity(id: HomeSectionId): HomeDensity {
		const v = settings.homeSectionDensity[id];
		return v === 'list' || v === 'pile' || v === 'grid' ? v : 'list';
	}
	function setSectionDensity(id: HomeSectionId, v: HomeDensity) {
		settings.homeSectionDensity = { ...settings.homeSectionDensity, [id]: v };
		settings.save();
	}

	// Tag/country multiselect: toggle membership, persist. resolveSubset handles the
	// empty-selection → full-pool fallback at render time on the home page.
	function toggleTag(tag: string) {
		settings.homeTags = settings.homeTags.includes(tag)
			? settings.homeTags.filter((x) => x !== tag)
			: [...settings.homeTags, tag];
		settings.save();
	}
	function toggleCountry(c: string) {
		settings.homeCountries = settings.homeCountries.includes(c)
			? settings.homeCountries.filter((x) => x !== c)
			: [...settings.homeCountries, c];
		settings.save();
	}

	// Chips render SELECTED-first (in saved order, draggable + reorderable via chipReorder),
	// then the unselected pool (tap to add). homeTags/homeCountries ARE the order the home
	// fans out / renders shelves in, so reordering the selected chips reorders the shelves.
	const selectedTags = $derived(settings.homeTags.filter((x) => DISCOVERY_TAGS.includes(x)));
	const unselectedTags = $derived(DISCOVERY_TAGS.filter((x) => !settings.homeTags.includes(x)));
	const selectedCountries = $derived(
		settings.homeCountries.filter((x) => DISCOVERY_COUNTRIES.includes(x))
	);
	const unselectedCountries = $derived(
		DISCOVERY_COUNTRIES.filter((x) => !settings.homeCountries.includes(x))
	);
	function reorderList(list: string[], from: number, to: number): string[] {
		const next = [...list];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		return next;
	}
	function onReorderTag(from: number, to: number) {
		settings.homeTags = reorderList(selectedTags, from, to);
		settings.save();
	}
	function onReorderCountry(from: number, to: number) {
		settings.homeCountries = reorderList(selectedCountries, from, to);
		settings.save();
	}

	function setShelfSize(e: Event) {
		settings.homeShelfSize = Number((e.currentTarget as HTMLInputElement).value);
		settings.save();
	}
	function setLanding(v: HomeLandingTab) {
		settings.homeLandingTab = v;
		settings.save();
	}
	function setDensity(v: HomeDensity) {
		settings.homeDensity = v;
		settings.save();
	}
	function toggleSearchPill() {
		settings.homeShowSearchPill = !settings.homeShowSearchPill;
		settings.save();
	}
	function toggleRandomize() {
		settings.homeShowRandomize = !settings.homeShowRandomize;
		settings.save();
	}

	const landings: { v: HomeLandingTab; key: TranslationKey }[] = [
		{ v: 'home', key: 'settings.landingHome' },
		{ v: 'search', key: 'settings.landingSearch' },
		{ v: 'library', key: 'settings.landingLibrary' }
	];
	const densities: { v: HomeDensity; key: TranslationKey }[] = [
		{ v: 'list', key: 'settings.densityList' },
		{ v: 'pile', key: 'settings.densityPile' },
		{ v: 'grid', key: 'settings.densityGrid' }
	];

	// Empty (or all-invalid) selection → home shows the FULL pool; surface that hint.
	const tagsShowingAll = $derived(resolveSubset(settings.homeTags, DISCOVERY_TAGS).length === DISCOVERY_TAGS.length && settings.homeTags.length === 0);
	const countriesShowingAll = $derived(resolveSubset(settings.homeCountries, DISCOVERY_COUNTRIES).length === DISCOVERY_COUNTRIES.length && settings.homeCountries.length === 0);
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')}><ChevronLeft size={22} /></button>
	<h1>{t('settings.groupHome')}</h1>
	<button class="reset" onclick={() => { if (confirm(t('settings.resetConfirm'))) { settings.resetHome(); } }}>{t('settings.resetGroup')}</button>
</header>

<!-- 1. SECTION ORDER + VISIBILITY -->
<section>
	<h2><LayoutGrid size={15} /> {t('settings.homeSections')}</h2>
	<ul class="reorder" use:dragReorder={{ onReorder }}>
		{#each order as id, i (id)}
			<li class="rrow" data-reorder-index={i}>
				<span class="grip" data-reorder-handle aria-label={t('settings.dragToReorder')}><GripVertical size={18} /></span>
				<span class="rlabel">{t(sectionLabel[id])}</span>
				<!-- D-07: per-section density (list/pile/grid). aria-pressed reflects the active
				     mode; aria-label names the section + option for screen readers. -->
				<span class="density-seg" role="group" aria-label={t('settings.homeSectionDensity')}>
					{#each densities as d (d.v)}
						<button
							class="dseg-btn"
							class:on={sectionDensity(id) === d.v}
							aria-pressed={sectionDensity(id) === d.v}
							aria-label={`${t(sectionLabel[id])} · ${t(d.key)}`}
							onclick={() => setSectionDensity(id, d.v)}
						>
							{#if d.v === 'pile'}
								<DiscAlbum size={14} />
							{:else if d.v === 'grid'}
								<Grid3x3 size={14} />
							{:else}
								<TableOfContents size={14} />
							{/if}
						</button>
					{/each}
				</span>
				<button class="sw" class:on={!settings.homeHidden.includes(id)} aria-label={t(sectionLabel[id])} onclick={() => toggleHidden(id)}></button>
			</li>
		{/each}
	</ul>
	<p class="muted">{t('settings.dragToReorder')}</p>
</section>

<!-- 2. GENRE TAGS -->
<section>
	<h2><Tags size={15} /> {t('settings.homeGenres')}</h2>
	<div class="chips" use:chipReorder={{ onReorder: onReorderTag }}>
		{#each selectedTags as tag, i (tag)}
			<button class="chip on" data-chip-index={i} onclick={() => toggleTag(tag)}>{tag}</button>
		{/each}
		{#each unselectedTags as tag (tag)}
			<button class="chip" onclick={() => toggleTag(tag)}>{tag}</button>
		{/each}
	</div>
	<p class="muted">{tagsShowingAll ? t('settings.homeShowingAll') : t('settings.homeDragReorderChips')}</p>
</section>

<!-- 3. COUNTRIES -->
<section>
	<h2><Globe size={15} /> {t('settings.homeCountriesLabel')}</h2>
	<div class="chips" use:chipReorder={{ onReorder: onReorderCountry }}>
		{#each selectedCountries as c, i (c)}
			<button class="chip on" data-chip-index={i} onclick={() => toggleCountry(c)}>{c}</button>
		{/each}
		{#each unselectedCountries as c (c)}
			<button class="chip" onclick={() => toggleCountry(c)}>{c}</button>
		{/each}
	</div>
	<p class="muted">{countriesShowingAll ? t('settings.homeShowingAll') : t('settings.homeDragReorderChips')}</p>
</section>

<!-- 4. ITEMS PER SHELF -->
<section>
	<h2><SlidersHorizontal size={15} /> {t('settings.itemsPerShelf', { n: settings.homeShelfSize })}</h2>
	<input class="range" type="range" min={SHELF_MIN} max={SHELF_MAX} step="1" value={settings.homeShelfSize} oninput={setShelfSize} aria-label={t('settings.itemsPerShelf', { n: settings.homeShelfSize })} />
	<p class="muted">{t('settings.itemsPerShelfDesc')}</p>
</section>

<!-- 5. DEFAULT LANDING TAB -->
<section>
	<h2><Compass size={15} /> {t('settings.defaultLandingTab')}</h2>
	<div class="seg">
		{#each landings as l (l.v)}
			<button class:on={settings.homeLandingTab === l.v} onclick={() => setLanding(l.v)}>{t(l.key)}</button>
		{/each}
	</div>
	<p class="muted">{t('settings.defaultLandingTabDesc')}</p>
</section>

<!-- 6. TILE DENSITY -->
<section>
	<h2><LayoutList size={15} /> {t('settings.tileDensity')}</h2>
	<div class="seg">
		{#each densities as d (d.v)}
			<button class:on={settings.homeDensity === d.v} onclick={() => setDensity(d.v)}>{t(d.key)}</button>
		{/each}
	</div>
	<p class="muted">{t('settings.tileDensityDesc')}</p>
</section>

<!-- 7. HOME CHROME -->
<section>
	<h2><ToggleRight size={15} /> {t('settings.homeChrome')}</h2>
	<button class="row-toggle" onclick={toggleSearchPill}>
		<span>{t('settings.showSearchPill')}</span>
		<span class="sw" class:on={settings.homeShowSearchPill}></span>
	</button>
	<p class="muted">{t('settings.showSearchPillDesc')}</p>
	<button class="row-toggle" onclick={toggleRandomize}>
		<span>{t('settings.showRandomize')}</span>
		<span class="sw" class:on={settings.homeShowRandomize}></span>
	</button>
	<p class="muted">{t('settings.showRandomizeDesc')}</p>
</section>

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.head h1 { flex: 1; }
	.reset { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text-muted); padding: 6px 12px; border-radius: 999px; font-size: 12px; cursor: pointer; }
	.reset:hover { color: var(--color-text); }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 10px; }
	.muted { color: var(--color-text-muted); font-size: 12px; margin: 8px 0 0; }
	/* Reorder list */
	.reorder { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.rrow { display: flex; align-items: center; gap: 10px; background: var(--color-surface-2); border: 1px solid var(--color-border); padding: 11px 12px; border-radius: 12px; }
	/* The grip OWNS the vertical gesture (touch-action:none) so a drag reorders, not scrolls. */
	.grip { display: grid; place-items: center; color: var(--color-text-muted); cursor: grab; touch-action: none; flex: none; }
	.grip:active { cursor: grabbing; }
	.rlabel { flex: 1; min-width: 0; font-size: 14px; }
	/* D-07: compact/comfortable per-section density segment — a small two-button segmented
	   control. The active option carries aria-pressed + the accent fill. */
	.density-seg { display: inline-flex; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 999px; padding: 2px; gap: 2px; flex: none; }
	.dseg-btn { background: none; border: none; color: var(--color-text-muted); padding: 5px 10px; border-radius: 999px; font-size: 11px; cursor: pointer; white-space: nowrap; }
	.dseg-btn.on { background: var(--color-primary); color: #fff; }
	/* Chips (multiselect) */
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	/* Selected chips are draggable to reorder — own the touch gesture so a drag reorders
	   rather than scrolls the page; lift the chip while dragging. */
	.chip[data-chip-index] { touch-action: none; cursor: grab; }
	/* .chip-dragging is added at runtime by use:chipReorder — :global() tells svelte-check the
	   class is intentional (no false "unused selector"), while .chip keeps it scoped. */
	.chip:global(.chip-dragging) { cursor: grabbing; z-index: 5; opacity: 0.9; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45); }
	/* Range slider */
	.range { width: 100%; accent-color: var(--color-primary); }
	/* Segmented control */
	.seg { display: inline-flex; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 999px; padding: 3px; gap: 3px; }
	.seg button { background: none; border: none; color: var(--color-text-muted); padding: 7px 16px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.seg button.on { background: var(--color-primary); color: #fff; }
	/* Toggle rows */
	.row-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 13px 14px; border-radius: 12px; font-size: 14px; cursor: pointer; margin-bottom: 8px; }
	.row-toggle span:first-child { display: inline-flex; align-items: center; gap: 10px; }
	.sw { width: 40px; height: 22px; border-radius: 999px; background: var(--color-border); position: relative; transition: background 0.15s ease; flex: none; border: none; cursor: pointer; padding: 0; }
	.sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 0.15s ease; }
	.sw.on { background: var(--color-primary); }
	.sw.on::after { transform: translateX(18px); }
</style>
