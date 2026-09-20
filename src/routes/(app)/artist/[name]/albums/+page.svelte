<script lang="ts">
	// Full discography page (quick-260831-qkx).
	//
	// The artist page's album shelf deliberately shows albums + EPs only — Coldplay's real Deezer
	// discography is 123 releases (17 albums, 5 EPs, 101 singles), and an unfiltered horizontal
	// shelf is precisely the "not official album" noise that was reported. Nothing is hidden
	// though: this page lists EVERYTHING, newest-first, with a type filter PRESET to albums + EPs
	// (user decision, 2026-09-01) and a type label on every row.
	//
	// Source + ordering come from the same helpers the shelf uses ($lib/services/discography), so
	// there is one source of truth for "what order" and "what counts as an album".
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { names } from '$lib/stores/names.svelte';
	import { online } from '$lib/stores/online.svelte';
	import { t, type TranslationKey } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { marquee } from '$lib/actions/marquee';
	import { loadDiscography } from '$lib/services/discography-source';
	import {
		filterByType,
		typeLabelKey,
		releaseYear,
		albumHref,
		type DiscographyEntry,
		fallbackCoverSeed,
		type DiscographyFilter
	} from '$lib/services/discography';
	// quick-260919-2jo: the shared tab-URL mechanism (F2) — `/artist/X/albums?tab=single` is now
	// a real cold-load target, and switching the filter writes it back.
	import { pickTab, syncTabUrl } from '$lib/services/url-tab';

	const name = $derived(decodeURIComponent(page.params.name ?? ''));

	let albums = $state<DiscographyEntry[]>([]);
	let albumsFor = '';
	let loading = $state(true);
	// Preset to albums + EPs (user decision) — the noise is opt-IN, not opt-out. quick-260919-2jo:
	// seeded from `?tab=`, validated against VALID_FILTERS; anything else falls back to the preset.
	const VALID_FILTERS: ReadonlySet<string> = new Set(['main', 'single', 'all']);
	let filter = $state<DiscographyFilter>(pickTab(page.url, 'tab', VALID_FILTERS, 'main'));

	const shown = $derived(filterByType(albums, filter));

	const FILTERS: { id: DiscographyFilter; key: TranslationKey }[] = [
		{ id: 'main', key: 'artist.filterMain' },
		{ id: 'single', key: 'artist.filterSingle' },
		{ id: 'all', key: 'artist.filterAll' }
	];

	// quick-260831-re9: source selection now lives in loadDiscography — MusicBrainz for CJK
	// artists (original-script titles, far deeper coverage), Deezer otherwise, Last.fm last.
	$effect(() => {
		const n = name;
		if (!online.isOnline) {
			loading = false;
			return;
		}
		if (n && albumsFor !== n) {
			albumsFor = n;
			albums = [];
			loading = true;
			void (async () => {
				try {
					const load = await loadDiscography(n);
					if (albumsFor !== n) return; // race guard
					albums = load.entries;
				} finally {
					if (albumsFor === n) loading = false;
				}
			})();
		}
	});
</script>

<svelte:head><title>{names.dnArtist(name)} — {t('artist.discography')}</title></svelte:head>

<PageHeader title={names.dnArtist(name)} subtitle={t('artist.discography')} backLabel={t('common.back')} />

<div class="chips" role="tablist">
	{#each FILTERS as f (f.id)}
		<button
			class="chip"
			class:on={filter === f.id}
			role="tab"
			aria-selected={filter === f.id}
			onclick={() => { filter = f.id; syncTabUrl(page.url, 'tab', f.id, 'main'); }}
			use:tapBounce>{t(f.key)}</button
		>
	{/each}
</div>

{#if loading}
	<ul class="list">
		{#each Array(10) as _, i (i)}
			<li><span class="row" aria-hidden="true"><span class="sk sk-cover"></span><span class="sk sk-text"></span></span></li>
		{/each}
	</ul>
{:else if !shown.length}
	<p class="empty">{t('artist.discographyEmpty')}</p>
{:else}
	<ul class="list">
		{#each shown as al (al.mbid ?? al.id ?? al.name)}
			<li>
				<button class="row" onclick={() => goto(albumHref(al, name))} use:tapBounce>
					<span class="cover" style:background-image={al.image ? `url(${al.image}), ${fallbackCoverSeed(al.name)}` : fallbackCoverSeed(al.name)}></span>
					<span class="meta">
						<span class="al-name" use:marquee><span class="marquee-inner">{names.dnTitle(al.name)}</span></span>
						<span class="al-sub">
							{#if typeLabelKey(al.type)}{t(typeLabelKey(al.type) as TranslationKey)}{:else}{t('artist.albumLabel')}{/if}{#if releaseYear(al.releaseDate)}{' · ' + releaseYear(al.releaseDate)}{/if}
						</span>
					</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.chips { display: flex; gap: 8px; padding: 10px 4px 4px; overflow-x: auto; }
	.chip { flex: 0 0 auto; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--color-border); background: none; color: var(--color-text-muted); font-size: 0.8rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
	.chip.on { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }

	.list { list-style: none; margin: 8px 0 0; padding: 0; }
	.row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 4px; background: none; border: none; color: var(--color-text); text-align: left; cursor: pointer; }
	.cover { flex: 0 0 auto; width: 56px; height: 56px; border-radius: 6px; background-size: cover; background-position: center; }
	.meta { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.al-name { font-size: calc(0.95rem * var(--fs-title, 1)); font-weight: 600; white-space: nowrap; overflow: hidden; }
	.al-sub { font-size: 0.78rem; color: var(--color-text-muted); }
	.empty { color: var(--color-text-muted); padding: 24px 4px; text-align: center; }

	.sk { display: block; background: var(--color-surface); border-radius: 6px; animation: pulse 1.2s ease-in-out infinite; }
	.sk-cover { width: 56px; height: 56px; flex: 0 0 auto; }
	.sk-text { height: 14px; width: 60%; }
	@keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.9; } }
	@media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
</style>
