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
	import { ChevronLeft } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { names } from '$lib/stores/names.svelte';
	import { online } from '$lib/stores/online.svelte';
	import { t, type TranslationKey } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { marquee } from '$lib/actions/marquee';
	import { deezerArtistAlbums } from '$lib/services/deezer';
	import { getArtistTopAlbums, type DiscoveryAlbum } from '$lib/services/lastfm';
	import {
		sortByReleaseDesc,
		filterByType,
		typeLabelKey,
		releaseYear,
		albumHref,
		type DiscographyEntry,
		fallbackCoverSeed,
		type DiscographyFilter
	} from '$lib/services/discography';

	const name = $derived(decodeURIComponent(page.params.name ?? ''));

	let albums = $state<DiscographyEntry[]>([]);
	let albumsFor = '';
	let loading = $state(true);
	// Preset to albums + EPs (user decision) — the noise is opt-IN, not opt-out.
	let filter = $state<DiscographyFilter>('main');

	const shown = $derived(filterByType(albums, filter));

	const FILTERS: { id: DiscographyFilter; key: TranslationKey }[] = [
		{ id: 'main', key: 'artist.filterMain' },
		{ id: 'single', key: 'artist.filterSingle' },
		{ id: 'all', key: 'artist.filterAll' }
	];

	/** Drop obvious upstream stub names (mirrors the artist page's isStubAlbumName). */
	function isStubAlbumName(raw: string | null | undefined): boolean {
		const s = (raw ?? '').trim().toLowerCase();
		if (!s) return true;
		return s === '(null)' || s === 'null' || s === 'undefined' || s === 'unknown album' || s === 'unknown';
	}

	// Same two-path source + race-guard idiom as the artist page's albums effect: Deezer first
	// (native list, covers, dates, types), Last.fm only when Deezer does not cover the artist.
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
					const dzAlbums = await deezerArtistAlbums(n).catch(() => []);
					if (albumsFor !== n) return; // race guard
					if (dzAlbums.length) {
						const kept = sortByReleaseDesc(
							dzAlbums
								.filter((a) => !isStubAlbumName(a.title))
								.map(
									(a) =>
										({
											id: a.id,
											name: a.title,
											image: a.cover,
											releaseDate: a.release_date,
											type: a.record_type
										}) satisfies DiscographyEntry
								)
						);
						if (albumsFor === n) albums = kept;
						return;
					}
					const lfAlbums = await getArtistTopAlbums(n).catch((): DiscoveryAlbum[] => []);
					if (albumsFor !== n) return; // race guard
					const kept = lfAlbums
						.filter((a) => !isStubAlbumName(a.name))
						.map(
							(a) =>
								({ id: null, name: a.name, image: a.image, releaseDate: null, type: null }) satisfies DiscographyEntry
						);
					if (albumsFor === n) albums = kept;
				} finally {
					if (albumsFor === n) loading = false;
				}
			})();
		}
	});
</script>

<svelte:head><title>{names.dnArtist(name)} — {t('artist.discography')}</title></svelte:head>

<header class="head">
	<button class="back" onclick={() => history.back()} use:tapBounce aria-label={t('common.back')}>
		<ChevronLeft size={22} />
	</button>
	<div class="titles">
		<h1 use:marquee><span class="marquee-inner">{names.dnArtist(name)}</span></h1>
		<p class="sub">{t('artist.discography')}</p>
	</div>
</header>

<div class="chips" role="tablist">
	{#each FILTERS as f (f.id)}
		<button
			class="chip"
			class:on={filter === f.id}
			role="tab"
			aria-selected={filter === f.id}
			onclick={() => (filter = f.id)}
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
		{#each shown as al (al.id ?? al.name)}
			<li>
				<button class="row" onclick={() => goto(albumHref(al, name))} use:tapBounce>
					<span class="cover" style:background-image={al.image ? `url(${al.image})` : fallbackCoverSeed(al.name)}></span>
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
	.head { display: flex; align-items: center; gap: 8px; padding: 12px 4px 4px; }
	.back { background: none; border: none; color: var(--color-text); padding: 4px; cursor: pointer; }
	.titles { min-width: 0; }
	h1 { font-size: calc(1.25rem * var(--fs-title, 1)); margin: 0; white-space: nowrap; overflow: hidden; }
	.sub { margin: 2px 0 0; font-size: 0.8rem; color: var(--color-text-muted); }

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
