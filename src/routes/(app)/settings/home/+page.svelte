<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		GripVertical,
		LayoutGrid,
		Globe,
		SlidersHorizontal,
		Compass,
		LayoutList,
		ToggleRight,
		TableOfContents,
		DiscAlbum,
		Grid3x3,
		Search,
		Shuffle,
		TrendingUp,
		MapPin,
		Archive,
		ChevronDown
	} from '@lucide/svelte';
	// quick-260919-ebi: GRID_COLS_MIN/MAX arrived with the Home grid columns slider.
	import { settings, GRID_COLS_MIN, GRID_COLS_MAX } from '$lib/stores/settings.svelte';
	import {
		resolveSectionOrder,
		resolveSubset,
		resolveChartRegion,
		resolveExtraRegions,
		resolveChartGenres,
		reorderListed,
		CLASSIC_SECTIONS,
		CHART_REGIONS,
		KKBOX_REGIONS,
		CHART_GENRE_IDS,
		SHELF_MIN,
		SHELF_MAX,
		type HomeSectionId,
		type HomeDensity,
		type HomeLandingTab,
		type ChartGenre,
		type ChartRegion
	} from '$lib/services/home-layout';
	import { regionLabel, regionListLabel, CHART_GENRE_LABEL } from '$lib/services/home-charts';
	import { DISCOVERY_TAGS, DISCOVERY_COUNTRIES } from '$lib/services/discovery';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SettingPicker from '$lib/components/SettingPicker.svelte';
	import SettingHint from '$lib/components/SettingHint.svelte';
	import { dragReorder } from '$lib/actions/dragReorder';
	import { chipReorder } from '$lib/actions/chipReorder';
	import { tapBounce } from '$lib/actions/tapBounce';
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
		radio: 'settings.homeSectionRadio',
		'fav-artists': 'settings.homeSectionFavArtists',
		playlists: 'settings.homeSectionPlaylists',
		history: 'settings.homeSectionHistory',
		'chart-songs': 'settings.homeSectionChartSongs',
		'new-releases': 'settings.homeSectionNewReleases',
		'chart-artists': 'settings.homeSectionChartArtists',
		'chart-albums': 'settings.homeSectionChartAlbums',
		'yt-trending': 'settings.homeSectionYtTrending',
		genres: 'settings.homeSectionGenres',
		// one key, one concept: the regions row IS the "More regions" setting
		regions: 'settings.moreRegions'
	};

	const order = $derived(resolveSectionOrder(settings.homeSectionOrder));

	// 39-D-42: dragReorder fires (from,to) as indices into `listed` (the non-classic rows).
	// reorderListed keeps every classic id at its exact array slot and bounds-checks (T-39-40).
	function onReorder(from: number, to: number) {
		settings.homeSectionOrder = reorderListed(order, from, to);
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

	// 39-D-42: the drag list shows every section EXCEPT the four classic ones, which live in the
	// Classic accordion instead (not draggable — they keep their saved array slot, UI-SPEC §2.2).
	const isClassic = (id: HomeSectionId) => (CLASSIC_SECTIONS as readonly string[]).includes(id);
	const listed = $derived(order.filter((id) => !isClassic(id)));
	const classicOn = $derived(CLASSIC_SECTIONS.filter((id) => !settings.homeHidden.includes(id)).length);

	// Chart region: resolved exactly as Home resolves it (same navigator.language refinement), so the
	// "Auto (…)" label names the region Home actually shows. `autoRegion` is what Auto WOULD pick —
	// kept separate from `chartRegion` so the Auto chip stays truthful while an explicit region is saved.
	const navLang = typeof navigator !== 'undefined' ? navigator.language : undefined;
	const chartRegion = $derived(resolveChartRegion(settings.homeChartRegion, settings.appLang, navLang));
	const autoRegion = $derived(resolveChartRegion('auto', settings.appLang, navLang));
	const isKkbox = $derived(KKBOX_REGIONS.includes(chartRegion));
	const selectedRegions = $derived(resolveExtraRegions(settings.homeExtraRegions, chartRegion));
	const unselectedRegions = $derived(
		CHART_REGIONS.filter((cc) => cc !== chartRegion && !selectedRegions.includes(cc))
	);
	const selectedGenres = $derived(resolveChartGenres(settings.homeChartGenres));
	const unselectedGenres = $derived(CHART_GENRE_IDS.filter((g) => !selectedGenres.includes(g)));

	// Chips are rendered ONLY from CHART_REGIONS / CHART_GENRE_IDS, so a tap can only write an
	// allowlisted id; the resolvers re-validate on read anyway (T-39-39).
	function setRegion(v: 'auto' | ChartRegion) {
		settings.homeChartRegion = v;
		settings.save();
	}
	function toggleRegion(cc: ChartRegion) {
		settings.homeExtraRegions = settings.homeExtraRegions.includes(cc)
			? settings.homeExtraRegions.filter((x) => x !== cc)
			: [...settings.homeExtraRegions, cc];
		settings.save();
	}
	function onReorderRegion(from: number, to: number) {
		settings.homeExtraRegions = reorderList(selectedRegions, from, to);
		settings.save();
	}
	// An empty genre selection is a real choice ("no genre shelves") — no fall-back-to-all.
	function toggleGenre(g: ChartGenre) {
		settings.homeChartGenres = selectedGenres.includes(g)
			? selectedGenres.filter((x) => x !== g)
			: [...selectedGenres, g];
		settings.save();
	}
	function onReorderGenre(from: number, to: number) {
		settings.homeChartGenres = reorderList(selectedGenres, from, to);
		settings.save();
	}

	// 39-D-42 / UI-SPEC §2.6: region names come from Intl (no i18n keys), genre names from the typed
	// CHART_GENRE_LABEL map (no template-string key cast).
	const regionName = (cc: string) => regionLabel(cc, settings.appLang);
	const autoLabel = $derived(t('settings.chartRegionAuto', { region: regionName(autoRegion) }));
	const regionCur = $derived(
		settings.homeChartRegion === 'auto' ? autoLabel : regionName(settings.homeChartRegion)
	);
	const moreRegionsCur = $derived(
		selectedRegions.length ? regionListLabel(selectedRegions, settings.appLang) : t('settings.moreRegionsNone')
	);
	const classicCur = $derived(
		classicOn === 0 ? t('settings.optOff') : t('settings.homeClassicOnCount', { n: classicOn })
	);
	const genreName = (g: ChartGenre) => t(CHART_GENRE_LABEL[g]);

	// UI-SPEC §2.2 source line under each row label. Brand names are LITERAL proper nouns, never
	// translated. Exhaustive on purpose: a new section id is a compile error here, not a silent
	// "Your library".
	function sourceLine(id: HomeSectionId): string {
		switch (id) {
			case 'chart-songs':
				return isKkbox ? 'KKBOX · Apple Music' : 'Apple Music';
			case 'new-releases':
				return isKkbox ? 'KKBOX' : t('settings.homeSrcUnavailable', { region: regionName(chartRegion) });
			case 'chart-artists':
			case 'yt-trending':
				return 'YouTube';
			case 'chart-albums':
			case 'regions':
				return 'Apple Music';
			case 'genres':
				return 'Apple Music · Deezer';
			case 'top-hits':
			case 'top-artists':
				return 'Deezer';
			case 'tags':
			case 'countries':
				return 'Last.fm';
			case 'liked':
			case 'downloads':
			case 'radio':
			case 'fav-artists':
			case 'playlists':
			case 'history':
				return t('settings.homeSrcLibrary');
		}
	}

	function setShelfSize(e: Event) {
		settings.homeShelfSize = Number((e.currentTarget as HTMLInputElement).value);
		settings.save();
	}
	// quick-260919-ebi: moved from /settings/appearance with its slider.
	function setCols(e: Event) {
		settings.homeGridCols = Number((e.currentTarget as HTMLInputElement).value);
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
	// quick-260919-ebi: the preview picker hands back the PICKED state ('off'|'on'), so tapping the
	// already-selected card must be a no-op — a bare `!x` flip would turn it straight back off.
	function toggleSearchPill(v: 'off' | 'on') {
		settings.homeShowSearchPill = v === 'on';
		settings.save();
	}
	function toggleRandomize(v: 'off' | 'on') {
		settings.homeShowRandomize = v === 'on';
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
	// quick-260919-ebi: the labelled + preview pickers below all come from the ONE SettingPicker.
	const landingOptions = $derived(landings.map((l) => ({ v: l.v, label: t(l.key) })));
	const densityLabels = $derived(densities.map((d) => ({ v: d.v, label: t(d.key) })));
	const offOn = $derived([
		{ v: 'off' as const, label: t('settings.optOff') },
		{ v: 'on' as const, label: t('settings.optOn') }
	]);
	const boolValue = (x: boolean) => (x ? 'on' : 'off');

	// Empty (or all-invalid) selection → home shows the FULL pool; surface that hint.
	const tagsShowingAll = $derived(resolveSubset(settings.homeTags, DISCOVERY_TAGS).length === DISCOVERY_TAGS.length && settings.homeTags.length === 0);
	const countriesShowingAll = $derived(resolveSubset(settings.homeCountries, DISCOVERY_COUNTRIES).length === DISCOVERY_COUNTRIES.length && settings.homeCountries.length === 0);
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<PageHeader title={t('settings.groupHome')} backLabel={t('settings.backToSettings')} onback={() => goto('/settings')}>
	{#snippet trailing()}
		<button class="reset" onclick={() => { if (confirm(t('settings.resetConfirm'))) { settings.resetHome(); } }}>{t('settings.resetGroup')}</button>
	{/snippet}
</PageHeader>

<!-- quick-260919-ebi (F3): the Home preview mocks, all built from the shared .mock-* primitives
     in SettingPicker — CSS/SVG only, theme tokens only, so they are correct in dark AND light
     with no per-theme branch. -->

<!-- One Home-header mock, rendered four times: the search pill present/absent, then the
     Randomize button present/absent. Same frame both times, so the ONLY thing that moves between
     the two cards is the thing being picked. -->
<!-- quick-260920-m0l: `focus` names the element THIS section configures, so the card marks what
     moves instead of making the user diff the Off and On frames (the reported bug against "Show
     search bar"). The OFF half has nothing to outline — the element is gone — so it draws an
     empty `.slot` box in the same place, which reads as "this is what disappears". The randomize
     pair had the identical defect and takes the identical fix, so both call sites pass a focus. -->
{#snippet homeHeader(pill: boolean, rnd: boolean, focus: 'pill' | 'rnd' | null)}
	<span class="mock-chrome">
		<span class="mock-row">
			<span class="mock-line" style:width="30%"></span>
			<span style:flex="1"></span>
			{#if rnd}
				<span class="mock-badge" class:mock-focus={focus === 'rnd'}><Shuffle size={6} /></span>
			{:else if focus === 'rnd'}
				<span class="mock-focus slot" style:width="14px" style:height="10px" style:border-radius="999px"></span>
			{/if}
		</span>
		{#if pill}
			<span class="mock-bar" class:mock-focus={focus === 'pill'} style:border-radius="999px">
				<Search size={7} />
				<span class="mock-line dim" style:width="55%"></span>
			</span>
		{:else if focus === 'pill'}
			<span class="mock-focus slot" style:height="13px" style:border-radius="999px"></span>
		{/if}
		<span class="mock-grid" style:grid-template-columns="repeat(3, 1fr)">
			{#each [0, 1, 2] as i (i)}<span class="mock-tile"></span>{/each}
		</span>
	</span>
{/snippet}
{#snippet pillOff()}{@render homeHeader(false, settings.homeShowRandomize, 'pill')}{/snippet}
{#snippet pillOn()}{@render homeHeader(true, settings.homeShowRandomize, 'pill')}{/snippet}
{#snippet randomizeOff()}{@render homeHeader(settings.homeShowSearchPill, false, 'rnd')}{/snippet}
{#snippet randomizeOn()}{@render homeHeader(settings.homeShowSearchPill, true, 'rnd')}{/snippet}

<!-- homeDensity — three tiny layout mockups, because this setting IS a layout shape. -->
{#snippet densityList()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-col">
			{#each [0, 1, 2] as r (r)}
				<span class="mock-row">
					<span class="mock-tile" style:width="11px"></span>
					<span class="mock-col">
						<span class="mock-line" style:width="70%"></span>
						<span class="mock-line dim" style:width="45%"></span>
					</span>
				</span>
			{/each}
		</span>
	</span>
{/snippet}
{#snippet densityPile()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-line" style:width="35%"></span>
		<!-- A horizontal cover shelf, with the fourth tile deliberately half-cut at the edge to
		     say "this one scrolls sideways". .mock already clips. -->
		<span class="mock-row" style:flex-wrap="nowrap">
			{#each [0, 1, 2, 3] as i (i)}<span class="mock-tile" style:width="26px"></span>{/each}
		</span>
	</span>
{/snippet}
{#snippet densityGrid()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-grid" style:grid-template-columns="repeat(3, 1fr)">
			{#each [0, 1, 2, 3, 4, 5] as i (i)}<span class="mock-tile"></span>{/each}
		</span>
	</span>
{/snippet}

<!-- D-07: per-section density (list/pile/grid). aria-pressed reflects the active mode; aria-label
     names the section + option for screen readers. Shared by the drag list and the Classic rows. -->
<!-- quick-260919-ebi: this one deliberately keeps its three icons and does NOT become a preview
     picker, even though it is the same enum as the global tile density below. A 44px drag-reorder
     row has no room for three mockups, and the global preview already teaches the same
     three-shape vocabulary — so the icons here read as shorthand for something the user is shown. -->
{#snippet densitySeg(id: HomeSectionId)}
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
{/snippet}

<!-- 1. SECTION ORDER + VISIBILITY -->
<!-- 39-D-43 / UI-SPEC §2.2: ONE global drag list in the true Home render order, minus the four
     classic ids (they live in the Classic accordion below). Group identity comes from each row's
     source line. An unavailable New releases row stays fully toggleable, no dimming. -->
<section>
	<h2><LayoutGrid size={15} /> {t('settings.homeSections')}</h2>
	<ul class="reorder" use:dragReorder={{ onReorder }}>
		{#each listed as id, i (id)}
			<li class="rrow" data-reorder-index={i}>
				<span class="grip" data-reorder-handle aria-label={t('settings.dragToReorder')}><GripVertical size={18} /></span>
				<span class="rtext"><span class="rlabel">{t(sectionLabel[id])}</span><span class="rsub">{sourceLine(id)}</span></span>
				{@render densitySeg(id)}
				<!-- UI-16: role=switch + aria-checked so the visibility state is announced. -->
				<button class="sw" class:on={!settings.homeHidden.includes(id)} role="switch" aria-checked={!settings.homeHidden.includes(id)} aria-label={t(sectionLabel[id])} onclick={() => toggleHidden(id)}></button>
			</li>
		{/each}
	</ul>
	<p class="muted">{t('settings.dragToReorder')}</p>
</section>

<!-- 2. CHARTS -->
<!-- 39-D-43 / UI-SPEC §2.3: the /settings/translation accordion row, reused verbatim. Collapsed by
     default; the open state is not persisted. -->
<section>
	<h2><TrendingUp size={15} /> {t('settings.homeGroupCharts')}</h2>

	<details class="advanced">
		<summary>
			<MapPin size={15} />
			{t('settings.chartRegion')}
			<SettingHint label={t('settings.chartRegion')} text={t('settings.chartRegionDesc')} />
			<span class="cur">{regionCur}</span>
			<span class="chev" aria-hidden="true"><ChevronDown size={15} /></span>
		</summary>
		<!-- Fixed research order (Asia-first, geographic) so it is stable in every UI language. -->
		<div class="chips" role="group" aria-label={t('settings.chartRegion')}>
			<button class="chip" class:on={settings.homeChartRegion === 'auto'} aria-pressed={settings.homeChartRegion === 'auto'} onclick={() => setRegion('auto')} use:tapBounce>{autoLabel}</button>
			{#each CHART_REGIONS as cc (cc)}
				<button class="chip" class:on={settings.homeChartRegion === cc} aria-pressed={settings.homeChartRegion === cc} onclick={() => setRegion(cc)} use:tapBounce>{regionName(cc)}</button>
			{/each}
		</div>
	</details>

	<details class="advanced">
		<summary>
			<Globe size={15} />
			{t('settings.moreRegions')}
			<SettingHint label={t('settings.moreRegions')} text={t('settings.moreRegionsDesc')} />
			<span class="cur">{moreRegionsCur}</span>
			<span class="chev" aria-hidden="true"><ChevronDown size={15} /></span>
		</summary>
		<!-- The countries-chip idiom: selected first in saved (= shelf) order and draggable, then the
		     pool (offered regions minus the main region minus the selected ones). -->
		<div class="chips" use:chipReorder={{ onReorder: onReorderRegion }}>
			{#each selectedRegions as cc, i (cc)}
				<button class="chip on" data-chip-index={i} aria-pressed="true" onclick={() => toggleRegion(cc)}>{regionName(cc)}</button>
			{/each}
			{#each unselectedRegions as cc (cc)}
				<button class="chip" aria-pressed="false" onclick={() => toggleRegion(cc)}>{regionName(cc)}</button>
			{/each}
		</div>
		<p class="muted">{t('settings.homeDragReorderChips')}</p>
	</details>

	<h3 class="sub">{t('settings.homeGenres')}<SettingHint label={t('settings.homeGenres')} text={t('settings.chartGenresDesc')} /></h3>
	<div class="chips" use:chipReorder={{ onReorder: onReorderGenre }}>
		{#each selectedGenres as g, i (g)}
			<button class="chip on" data-chip-index={i} aria-pressed="true" onclick={() => toggleGenre(g)}>{genreName(g)}</button>
		{/each}
		{#each unselectedGenres as g (g)}
			<button class="chip" aria-pressed="false" onclick={() => toggleGenre(g)}>{genreName(g)}</button>
		{/each}
	</div>
	<p class="muted">{selectedGenres.length ? t('settings.homeDragReorderChips') : t('settings.chartGenresNone')}</p>
</section>

<!-- 3. CLASSIC (Last.fm / Deezer) -->
<!-- 39-D-43 / UI-SPEC §2.4: collapsed by default, de-emphasised with the Playback uppercase summary.
     The `.cur` says whether any old shelf is on even while closed. Classic rows have no grip: a
     classic shelf keeps its saved array slot on Home (UI-3). The tag/country chips stay operable
     while their section is hidden, so they can be set up before turning it on. -->
<details class="advanced classic">
	<summary>
		<Archive size={15} />
		{t('settings.homeGroupClassic')}
		<SettingHint label={t('settings.homeGroupClassic')} text={t('settings.homeClassicDesc')} />
		<span class="cur">{classicCur}</span>
		<span class="chev" aria-hidden="true"><ChevronDown size={15} /></span>
	</summary>
	<ul class="classic-rows">
		{#each CLASSIC_SECTIONS as id (id)}
			<li class="rrow">
				<span class="rtext"><span class="rlabel">{t(sectionLabel[id])}</span><span class="rsub">{sourceLine(id)}</span></span>
				{@render densitySeg(id)}
				<button class="sw" class:on={!settings.homeHidden.includes(id)} role="switch" aria-checked={!settings.homeHidden.includes(id)} aria-label={t(sectionLabel[id])} onclick={() => toggleHidden(id)}></button>
			</li>
		{/each}
	</ul>

	<h3 class="sub">{t('settings.homeSectionTags')}</h3>
	<div class="chips" use:chipReorder={{ onReorder: onReorderTag }}>
		{#each selectedTags as tag, i (tag)}
			<button class="chip on" data-chip-index={i} aria-pressed="true" onclick={() => toggleTag(tag)}>{tag}</button>
		{/each}
		{#each unselectedTags as tag (tag)}
			<button class="chip" aria-pressed="false" onclick={() => toggleTag(tag)}>{tag}</button>
		{/each}
	</div>
	<p class="muted">{tagsShowingAll ? t('settings.homeShowingAll') : t('settings.homeDragReorderChips')}</p>

	<h3 class="sub">{t('settings.homeSectionCountries')}</h3>
	<div class="chips" use:chipReorder={{ onReorder: onReorderCountry }}>
		{#each selectedCountries as c, i (c)}
			<button class="chip on" data-chip-index={i} aria-pressed="true" onclick={() => toggleCountry(c)}>{c}</button>
		{/each}
		{#each unselectedCountries as c (c)}
			<button class="chip" aria-pressed="false" onclick={() => toggleCountry(c)}>{c}</button>
		{/each}
	</div>
	<p class="muted">{countriesShowingAll ? t('settings.homeShowingAll') : t('settings.homeDragReorderChips')}</p>
</details>

<!-- 4. ITEMS PER SHELF -->
<section>
	<h2><SlidersHorizontal size={15} /> {t('settings.itemsPerShelf', { n: settings.homeShelfSize })}<SettingHint label={t('settings.itemsPerShelf', { n: settings.homeShelfSize })} text={t('settings.itemsPerShelfDesc')} /></h2>
	<input class="range" type="range" min={SHELF_MIN} max={SHELF_MAX} step="1" value={settings.homeShelfSize} oninput={setShelfSize} aria-label={t('settings.itemsPerShelf', { n: settings.homeShelfSize })} />
</section>

<!-- 4b. HOME GRID COLUMNS -->
<!-- quick-260919-ebi: moved here from /settings/appearance — the label is literally "Home grid
     columns", and this page already owns shelf size and tile density. The quick-260618-goe live
     grid demo came across verbatim. -->
<section>
	<h2><Grid3x3 size={15} /> {t('settings.gridColumns')}<SettingHint label={t('settings.gridColumns')} text={t('settings.gridColumnsDesc')} /></h2>
	<div class="lab"><span>{t('settings.gridColumns')}</span><span class="val">{settings.homeGridCols}</span></div>
	<input class="range" type="range" min={GRID_COLS_MIN} max={GRID_COLS_MAX} step="1" value={settings.homeGridCols} oninput={setCols} aria-label={t('settings.gridColumns')} />
	<!-- quick-260618-goe (decision #4): live grid-columns demo — a mock grid whose
	     column count tracks homeGridCols (matches the home .grid var behavior). aria-hidden. -->
	<span class="demo-cap">{t('settings.preview')}</span>
	<div class="grid-demo" aria-hidden="true" style:grid-template-columns={`repeat(${settings.homeGridCols}, 1fr)`}>
		{#each Array(6) as _, i (i)}
			<span class="grid-demo-cell"></span>
		{/each}
	</div>
</section>

<!-- 5. DEFAULT LANDING TAB -->
<section>
	<h2><Compass size={15} /> {t('settings.defaultLandingTab')}<SettingHint label={t('settings.defaultLandingTab')} text={t('settings.defaultLandingTabDesc')} /></h2>
	<!-- quick-260919-ebi: NO preview — three tab labels with one ringed adds nothing over three
	     tab labels, which is what the segmented control already is. -->
	<SettingPicker label={t('settings.defaultLandingTab')} options={landingOptions} value={settings.homeLandingTab} onpick={setLanding} />
</section>

<!-- 6. TILE DENSITY -->
<section>
	<h2><LayoutList size={15} /> {t('settings.tileDensity')}<SettingHint label={t('settings.tileDensity')} text={t('settings.tileDensityDesc')} /></h2>
	<!-- quick-260919-ebi (F3): the first preview picker with THREE options — this setting IS a
	     layout shape, so three tiny layout mockups say it better than three words. -->
	<SettingPicker
		variant="preview"
		label={t('settings.tileDensity')}
		options={[
			{ ...densityLabels[0], preview: densityList },
			{ ...densityLabels[1], preview: densityPile },
			{ ...densityLabels[2], preview: densityGrid }
		]}
		value={settings.homeDensity}
		onpick={setDensity}
	/>
</section>

<!-- 7. HOME CHROME -->
<section>
	<h2><ToggleRight size={15} /> {t('settings.homeChrome')}</h2>
	<h3 class="sub">{t('settings.showSearchPill')}</h3>
	<!-- quick-260919-ebi: no hint — the header mock with and without the pill is the whole
	     sentence; the rest of the old paragraph was advice about when to turn it off. -->
	<SettingPicker
		variant="preview"
		label={t('settings.showSearchPill')}
		options={[
			{ ...offOn[0], preview: pillOff },
			{ ...offOn[1], preview: pillOn }
		]}
		value={boolValue(settings.homeShowSearchPill)}
		onpick={toggleSearchPill}
	/>

	<h3 class="sub">{t('settings.showRandomize')}<SettingHint label={t('settings.showRandomize')} text={t('settings.showRandomizeDesc')} /></h3>
	<SettingPicker
		variant="preview"
		label={t('settings.showRandomize')}
		options={[
			{ ...offOn[0], preview: randomizeOff },
			{ ...offOn[1], preview: randomizeOn }
		]}
		value={boolValue(settings.homeShowRandomize)}
		onpick={toggleRandomize}
	/>
</section>

<style>
	.reset { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text-muted); padding: 6px 12px; border-radius: 999px; font-size: 0.75rem; cursor: pointer; }
	.reset:hover { color: var(--color-text); }
	section { margin: 18px 0; }
	/* quick-260919-ebi: `position: relative` on every title that carries an inline (i) — it anchors
	   SettingHint's description panel, which is scoped and cannot set this on its host. */
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 10px; position: relative; }
	.muted { color: var(--color-text-muted); font-size: 0.75rem; margin: 8px 0 0; }
	/* Reorder list */
	.reorder { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.rrow { display: flex; align-items: center; gap: 10px; background: var(--color-surface-2); border: 1px solid var(--color-border); padding: 11px 12px; border-radius: 12px; }
	/* The grip OWNS the vertical gesture (touch-action:none) so a drag reorders, not scrolls. */
	.grip { display: grid; place-items: center; color: var(--color-text-muted); cursor: grab; touch-action: none; flex: none; }
	.grip:active { cursor: grabbing; }
	/* 39-D-43: label + source line stack. .rtext owns the flex slot; .rlabel may wrap to two lines,
	   .rsub is one ellipsized line (dragReorder measures real row heights, so mixed heights reorder). */
	.rtext { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.rlabel { min-width: 0; font-size: 0.875rem; }
	.rsub { font-size: 0.75rem; line-height: 1.3; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.classic-rows { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	/* D-07: compact/comfortable per-section density segment — a small two-button segmented
	   control. The active option carries aria-pressed + the accent fill. */
	.density-seg { display: inline-flex; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 999px; padding: 2px; gap: 2px; flex: none; }
	.dseg-btn { background: none; border: none; color: var(--color-text-muted); padding: 5px 10px; border-radius: 999px; font-size: 0.6875rem; cursor: pointer; white-space: nowrap; }
	.dseg-btn.on { background: var(--color-primary); color: #fff; }
	/* Chips (multiselect) */
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 0.8125rem; cursor: pointer; }
	.chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	/* Selected chips are draggable to reorder — own the touch gesture so a drag reorders
	   rather than scrolls the page; lift the chip while dragging. */
	.chip[data-chip-index] { touch-action: none; cursor: grab; }
	/* .chip-dragging is added at runtime by use:chipReorder — :global() tells svelte-check the
	   class is intentional (no false "unused selector"), while .chip keeps it scoped. */
	.chip:global(.chip-dragging) { cursor: grabbing; z-index: 5; opacity: 0.9; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45); }
	/* 39-D-43: the /settings/translation accordion (quick-260919-hm2), lifted verbatim — row-type
	   summary, right-aligned current value, explicit rotating chevron. */
	.advanced { margin: 10px 0; padding: 10px 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; }
	.advanced summary { position: relative; display: flex; align-items: center; gap: 6px; font-size: 0.875rem; color: var(--color-text); cursor: pointer; padding: 4px 0; }
	.advanced .chips { margin-top: 12px; }
	.cur { margin-left: auto; color: var(--color-text-muted); font-size: 0.8125rem; text-align: right; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.advanced .chev { display: inline-flex; flex: none; color: var(--color-text-muted); transition: transform 0.15s ease; }
	.advanced[open] .chev { transform: rotate(180deg); }
	@media (prefers-reduced-motion: reduce) {
		.advanced .chev { transition: none; }
	}
	/* Unselected chips and rows are --color-surface-2 and sit ON a --color-surface-2 panel, so drop
	   them a step; the selected chip is restated at the descendant selector's specificity. */
	.advanced .chip { background: var(--color-bg); }
	.advanced .chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	.advanced .rrow { background: var(--color-bg); }
	/* Classic is a GROUP disclosure, not a settings row: the Playback page's uppercase summary type
	   and its 22px margin (UI-SPEC §Spacing), so it reads as de-emphasised. */
	.advanced.classic { margin: 22px 0; }
	.advanced.classic summary { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); }
	/* The value keeps the translation `.cur` type ("Off" / "1 on"), not the uppercase heading type. */
	.advanced.classic .cur { text-transform: none; letter-spacing: normal; }
	/* Range slider */
	.range { width: 100%; accent-color: var(--color-primary); }
	/* quick-260919-ebi: slider label + live grid demo, carried verbatim from /settings/appearance
	   with the Home grid columns control. */
	.lab { display: flex; align-items: baseline; justify-content: space-between; font-size: 0.875rem; margin-bottom: 6px; }
	.val { color: var(--color-primary); font-variant-numeric: tabular-nums; font-size: 0.8125rem; }
	.demo-cap { display: block; margin-top: 10px; font-size: 0.6875rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.4px; }
	.grid-demo { display: grid; gap: 6px; margin-top: 6px; max-width: 220px; }
	.grid-demo-cell { aspect-ratio: 1 / 1; border-radius: var(--radius-sm, 6px); background: var(--color-surface-2); }
	/* quick-260919-ebi: the .seg CSS moved into SettingPicker.svelte, and .row-toggle left with the
	   two Home-chrome toggle rows the previews replaced. `.sw` below STAYS: it is the bare
	   section-visibility switch inside the 44px drag-reorder rows, which is not a settings row and
	   has no label of its own — SettingToggle does not fit there. */
	.sub { display: flex; align-items: center; gap: 6px; font-size: 0.8125rem; font-weight: 600; margin: 16px 0 8px; position: relative; }
	.sw { width: 40px; height: 22px; border-radius: 999px; background: var(--color-border); position: relative; transition: background 0.15s ease; flex: none; border: none; cursor: pointer; padding: 0; }
	.sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 0.15s ease; }
	.sw.on { background: var(--color-primary); }
	.sw.on::after { transform: translateX(18px); }
</style>
