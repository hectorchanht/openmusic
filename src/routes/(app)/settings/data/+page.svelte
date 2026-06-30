<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Trash2, RefreshCw, Languages, Image, Search, SlidersHorizontal } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { clearCoverCache } from '$lib/services/cover-cache';
	import { SEARCH_HISTORY_KEY } from '$lib/search/search-history-logic';
	import { t } from '$lib/i18n';

	const TOP_PICKS_KEY = 'openmusic:top-picks:v1';
	const HOME_LIBRARY_KEY = 'openmusic:home-library:v1';
	let msg = $state('');
	let counts = $state({ liked: 0, playlists: 0, downloads: 0 });

	onMount(() => {
		settings.load();
		library.load();
		counts = { liked: library.liked.length, playlists: library.playlists.length, downloads: library.downloads.length };
	});

	function flash(m: string) { msg = m; setTimeout(() => (msg = ''), 1800); }

	function clearPicks() {
		try { localStorage.removeItem(TOP_PICKS_KEY); } catch { /* */ }
		try { localStorage.removeItem(HOME_LIBRARY_KEY); } catch { /* */ } // hhd: also reset library shelves
		flash(t('settings.picksCleared'));
	}
	function clearNameCache() { names.clearCache(); flash(t('settings.nameCacheCleared')); }
	function clearCovers() { clearCoverCache(); flash(t('settings.coverCacheCleared')); }
	function clearSearchHistory() { try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch { /* */ } flash(t('settings.searchHistoryCleared')); }
	function resetAppearance() { settings.resetAppearance(); flash(t('settings.appearanceReset')); }
	function clearLibrary() {
		if (confirm(t('settings.clearLibraryConfirm'))) {
			library.clearAll();
			counts = { liked: 0, playlists: 0, downloads: 0 };
			flash(t('settings.libraryCleared'));
		}
	}
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')}><ChevronLeft size={22} /></button>
	<h1>{t('settings.data')}</h1>
</header>

<section>
	<p class="muted">{t('settings.dataCounts', { liked: counts.liked, playlists: counts.playlists, downloads: counts.downloads })}</p>
	<button class="item" onclick={clearPicks}><RefreshCw size={18} /> {t('settings.clearPicks')}</button>
	<button class="item" onclick={clearNameCache}><Languages size={18} /> {t('settings.clearNameCache')}</button>
	<button class="item" onclick={clearCovers}><Image size={18} /> {t('settings.clearCoverCache')}</button>
	<p class="hint">{t('settings.clearCoverCacheHint')}</p>
	<button class="item" onclick={clearSearchHistory}><Search size={18} /> {t('settings.clearSearchHistory')}</button>
	<button class="item" onclick={resetAppearance}><SlidersHorizontal size={18} /> {t('settings.resetAppearance')}</button>
	<button class="item danger" onclick={clearLibrary}><Trash2 size={18} /> {t('settings.clearLibrary')}</button>
</section>

{#if msg}<p class="flash">{msg}</p>{/if}

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	.muted { color: var(--color-text-muted); font-size: 12px; margin: 0 0 12px; }
	.hint { color: var(--color-text-muted); font-size: 12px; margin: -2px 0 10px 4px; }
	.item { width: 100%; display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; font-size: 15px; cursor: pointer; text-align: left; margin-bottom: 8px; }
	.item.danger { color: #ff7a90; }
	.flash { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--tabbar-h) + 70px); background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; }
</style>
