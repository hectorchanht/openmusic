<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Music, Radio, Zap, Maximize2, Download, Sliders, ListMusic, SquareActivity } from '@lucide/svelte';
	import { settings, type DefaultQuality, type DefaultSource } from '$lib/stores/settings.svelte';
	import type { UpnextMode, QueueContext } from '$lib/config/defaults';
	import { SOURCES } from '$lib/sources/registry';
	import type { SourceId } from '$lib/sources/types';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t, type TranslationKey } from '$lib/i18n';

	onMount(() => settings.load());

	// Quality tokens (320k/128k) are literal; Auto/Lossless are chrome.
	const qualities: { v: DefaultQuality; key?: string; literal?: string }[] = [
		{ v: 'auto', key: 'settings.optAuto' },
		{ v: 'lossless', key: 'settings.optLossless' },
		{ v: '320', literal: '320k' },
		{ v: '128', literal: '128k' }
	];
	// Proper-noun source labels stay literal; only 'Auto (all)' is chrome.
	const sources: { v: DefaultSource; key?: string; literal?: string }[] = [
		{ v: 'auto', key: 'settings.optAutoAll' },
		{ v: 'netease', literal: 'NetEase' },
		{ v: 'qq', literal: 'QQ' },
		{ v: 'kuwo', literal: 'Kuwo' },
		{ v: 'joox', literal: 'JOOX' }
	];

	function setQuality(v: DefaultQuality) { settings.defaultQuality = v; settings.save(); }
	function setDownloadQuality(v: DefaultQuality) { settings.downloadQuality = v; settings.save(); }
	function setSource(v: DefaultSource) { settings.defaultSource = v; settings.save(); }
	function toggleExpand() { settings.autoExpandOnPlay = !settings.autoExpandOnPlay; settings.save(); }
	// ii6: per-source enable/disable. Precedence in getEnabledAdapters: explicit prefs >
	// settings.enabledSources > adapter.enabledByDefault. Helper resolves the effective state.
	function sourceEnabled(id: SourceId): boolean {
		const v = settings.enabledSources[id];
		return v !== undefined ? v : SOURCES[id].enabledByDefault;
	}
	function toggleSource(id: SourceId) {
		const cur = sourceEnabled(id);
		settings.enabledSources = { ...settings.enabledSources, [id]: !cur };
		settings.save();
	}

	// Phase 17 (QUEUE-03 / D-01/D-02): per-context up-next sourcing. One selector row per
	// context (Settings → Playback ONLY — no queue-header chip). Each row reflects the
	// effective mode and writes a per-context override, mirroring the setSource handler.
	// Labels reuse existing surface keys where they exist (liked/playlists/downloads/history/
	// album) and use the Phase-17 ctx* keys for the rest.
	const upnextContexts: { ctx: Exclude<QueueContext, null>; key: TranslationKey }[] = [
		{ ctx: 'liked', key: 'library.liked' },
		{ ctx: 'search', key: 'settings.ctxSearch' },
		{ ctx: 'downloads', key: 'library.downloads' },
		{ ctx: 'playlist', key: 'library.playlists' },
		{ ctx: 'album', key: 'settings.ctxAlbum' },
		{ ctx: 'artist', key: 'settings.ctxArtist' },
		{ ctx: 'home-discovery', key: 'settings.ctxHomeDiscovery' },
		{ ctx: 'history', key: 'history.heading' }
	];
	function setUpnext(ctx: Exclude<QueueContext, null>, v: UpnextMode) {
		settings.upnextPerContext = { ...settings.upnextPerContext, [ctx]: v };
		settings.save();
	}
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')} use:tapBounce><ChevronLeft size={22} /></button>
	<h1>{t('settings.groupPlayback')}</h1>
	<button class="reset" onclick={() => { if (confirm(t('settings.resetConfirm'))) { settings.resetPlayback(); } }} use:tapBounce>{t('settings.resetGroup')}</button>
</header>

<section>
	<h2><Music size={15} /> {t('settings.defaultQuality')}</h2>
	<div class="seg">
		{#each qualities as q (q.v)}
			<button class:on={settings.defaultQuality === q.v} onclick={() => setQuality(q.v)} use:tapBounce>{q.key ? t(q.key as TranslationKey) : q.literal}</button>
		{/each}
	</div>
	<p class="muted">{t('settings.defaultQualityNote')}</p>
</section>

<section>
	<h2><Download size={15} /> {t('settings.downloadQuality')}</h2>
	<div class="seg">
		{#each qualities as q (q.v)}
			<button class:on={settings.downloadQuality === q.v} onclick={() => setDownloadQuality(q.v)} use:tapBounce>{q.key ? t(q.key as TranslationKey) : q.literal}</button>
		{/each}
	</div>
	<p class="muted">{t('settings.downloadQualityNote')}</p>
</section>

<section>
	<h2><Radio size={15} /> {t('settings.defaultSource')}</h2>
	<div class="chips">
		{#each sources as s (s.v)}
			<button class="chip" class:on={settings.defaultSource === s.v} onclick={() => setSource(s.v)} use:tapBounce>{s.key ? t(s.key as TranslationKey) : s.literal}</button>
		{/each}
	</div>
	<p class="muted">{t('settings.defaultSourceNote')}</p>
</section>

<section>
	<h2><Zap size={15} /> {t('settings.playbackMotion')}</h2>
	<button class="row-toggle" onclick={toggleExpand}>
		<span><Maximize2 size={16} /> {t('settings.autoExpand')}</span>
		<span class="sw" class:on={settings.autoExpandOnPlay}></span>
	</button>
	<p class="muted">{t('settings.autoExpandDesc')}</p>
</section>

<section>
	<h2><SquareActivity size={15} /> {t('settings.upnextSourcing')}</h2>
		<span class="muted">
			<ListMusic size={12} />	
			{t('settings.upnextSameList')}
			/
			<Radio size={14} />	
			{t('settings.upnextGenerated')}
		</span>

	{#each upnextContexts as c (c.ctx)}
		<div class="upnext-row">
			<span class="ctx-label">{t(c.key)}</span>
			<div class="seg">
				<button
					class:on={settings.effectiveUpnextMode(c.ctx) === 'same-list'}
					onclick={() => setUpnext(c.ctx, 'same-list')} use:tapBounce><ListMusic size={12} /></button
				>
				<button
					class:on={settings.effectiveUpnextMode(c.ctx) === 'generated'}
					onclick={() => setUpnext(c.ctx, 'generated')} use:tapBounce><Radio size={12} /></button
				>
			</div>
		</div>
	{/each}
</section>

<!-- ii6: Advanced > Sources — tucked behind a <details> accordion so the Playback tab
	   stays speed/quality-first. Lets a user opt INTO 5sing (enabledByDefault:false). -->
<details class="advanced">
	<summary><Sliders size={15} /> {t('settings.sourcesAdvanced')}</summary>
	<div class="chips">
		{#each Object.values(SOURCES) as adapter (adapter.id)}
			<button class="chip" class:on={sourceEnabled(adapter.id)} onclick={() => toggleSource(adapter.id)} use:tapBounce>{adapter.label}</button>
		{/each}
	</div>
	<p class="muted">{t('settings.sourcesAdvancedNote')}</p>
</details>

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.head h1 { flex: 1; }
	.reset { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text-muted); padding: 6px 12px; border-radius: 999px; font-size: 12px; cursor: pointer; }
	.reset:hover { color: var(--color-text); }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 10px; }
	.muted { color: var(--color-text-muted); font-size: 12px; margin: 8px 0 0; display: flex; align-items: center; gap: 4px;}
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	.seg { display: inline-flex; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 999px; padding: 3px; gap: 3px; }
	.seg button { background: none; border: none; color: var(--color-text-muted); padding: 7px 16px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.seg button.on { background: var(--color-primary); color: #fff; }
	.row-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 13px 14px; border-radius: 12px; font-size: 14px; cursor: pointer; margin-bottom: 8px; }
	.row-toggle span:first-child { display: inline-flex; align-items: center; gap: 10px; }
	.sw { width: 40px; height: 22px; border-radius: 999px; background: var(--color-border); position: relative; transition: background 0.15s ease; flex: none; }
	.sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 0.15s ease; }
	.sw.on { background: var(--color-primary); }
	.sw.on::after { transform: translateX(18px); }
	.upnext-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; }
	.upnext-row .ctx-label { font-size: 14px; color: var(--color-text); }
	.upnext-row .seg button { padding: 6px 12px; font-size: 12px; }
	.advanced { margin: 22px 0; padding: 10px 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; }
	.advanced summary { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); cursor: pointer; padding: 4px 0; }
	.advanced .chips { margin-top: 12px; }
</style>
