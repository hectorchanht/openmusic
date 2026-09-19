<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Music, Radio, Zap, Maximize2, BadgeCheck, Download, Sliders, ListMusic, SquareActivity, Mic2 } from '@lucide/svelte';
	import { settings, type DefaultQuality, type DefaultSource } from '$lib/stores/settings.svelte';
	import SettingPicker from '$lib/components/SettingPicker.svelte';
	import SettingHint from '$lib/components/SettingHint.svelte';
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
	// quick-260919-ebi: the preview picker hands back the PICKED state ('off'|'on'), so tapping the
	// card that is already selected must be a no-op — a bare `!x` flip would toggle it off again.
	function toggleExpand(v: 'off' | 'on') { settings.autoExpandOnPlay = v === 'on'; settings.save(); }
	// quick-260831-k5y: opt-in quality tag on the Now-Playing page.
	function toggleQualityTag(v: 'off' | 'on') { settings.showQualityTag = v === 'on'; settings.save(); }
	// quick-260919-1we (D-7): opt-in lyric line in the docked mini player.
	function toggleNowbarLyrics(v: 'off' | 'on') { settings.nowbarLyrics = v === 'on'; settings.save(); }
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

	// quick-260919-ebi: the labelled controls on this page now come from the ONE SettingPicker.
	// $derived so a live app-language change relabels them, exactly as the old inline t() calls did.
	const qualityOptions = $derived(
		qualities.map((q) => ({ v: q.v, label: q.key ? t(q.key as TranslationKey) : (q.literal ?? '') }))
	);
	// quick-260919-ebi: these two per-context buttons were icon-only with NO accessible name at all
	// — 16 unlabelled buttons. SettingPicker gives every option an aria-label for free, so the
	// icon-only look survives and the a11y hole closes.
	const upnextOptions = $derived([
		{ v: 'same-list' as UpnextMode, label: t('settings.upnextSameList'), icon: ListMusic },
		{ v: 'generated' as UpnextMode, label: t('settings.upnextGenerated'), icon: Radio }
	]);
	// quick-260919-ebi: Off/On captions for the three preview pickers below.
	const offOn = $derived([
		{ v: 'off' as const, label: t('settings.optOff') },
		{ v: 'on' as const, label: t('settings.optOn') }
	]);
	/** A boolean setting rendered as a two-card preview picker: 'off' | 'on' <-> false | true. */
	const boolValue = (b: boolean) => (b ? 'on' : 'off');
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')} use:tapBounce><ChevronLeft size={22} /></button>
	<h1>{t('settings.groupPlayback')}</h1>
	<button class="reset" onclick={() => { if (confirm(t('settings.resetConfirm'))) { settings.resetPlayback(); } }} use:tapBounce>{t('settings.resetGroup')}</button>
</header>

<section>
	<h2><Music size={15} /> {t('settings.defaultQuality')}<SettingHint label={t('settings.defaultQuality')} text={t('settings.defaultQualityNote')} /></h2>
	<!-- quick-260919-ebi: NO preview here on purpose — stream quality is a network + behaviour
	     setting. A mockup would have to draw a difference the user cannot see on screen, so the
	     labels and the note stay. -->
	<SettingPicker label={t('settings.defaultQuality')} options={qualityOptions} value={settings.defaultQuality} onpick={setQuality} />
</section>

<section>
	<h2><Download size={15} /> {t('settings.downloadQuality')}<SettingHint label={t('settings.downloadQuality')} text={t('settings.downloadQualityNote')} /></h2>
	<!-- quick-260919-ebi: kept beside defaultQuality (not moved to Downloads) precisely so the two
	     read as an identical control the user can compare. Same reason it gets no preview. -->
	<SettingPicker label={t('settings.downloadQuality')} options={qualityOptions} value={settings.downloadQuality} onpick={setDownloadQuality} />
</section>

<section>
	<h2><Radio size={15} /> {t('settings.defaultSource')}<SettingHint label={t('settings.defaultSource')} text={t('settings.defaultSourceNote')} /></h2>
	<div class="chips">
		{#each sources as s (s.v)}
			<button class="chip" class:on={settings.defaultSource === s.v} onclick={() => setSource(s.v)} use:tapBounce>{s.key ? t(s.key as TranslationKey) : s.literal}</button>
		{/each}
	</div>
</section>

<!-- quick-260919-ebi (F3): three booleans that are PURELY about what lands on screen, so each
     one is now picked by tapping the state you want rather than reading a paragraph about it.
     Every mock below is built from the shared .mock-* primitives in SettingPicker. -->

<!-- autoExpandOnPlay — Off: a content page with the docked mini bar at the bottom.
     On: the full-screen now-playing sheet (cover block, title lines, transport row). -->
{#snippet expandOff()}
	<span class="mock-chrome">
		<span class="mock-bar"><span class="mock-line" style:width="35%"></span></span>
		<span class="mock-col">
			{#each [0, 1, 2] as r (r)}
				<span class="mock-row">
					<span class="mock-tile" style:width="9px"></span>
					<span class="mock-line" style:width="60%"></span>
				</span>
			{/each}
		</span>
		<span class="mock-bar">
			<span class="mock-tile" style:width="10px"></span>
			<span class="mock-col">
				<span class="mock-line" style:width="70%"></span>
				<span class="mock-line dim" style:width="45%"></span>
			</span>
		</span>
	</span>
{/snippet}
{#snippet expandOn()}
	<span class="mock-chrome">
		<span class="mock-row" style:justify-content="center">
			<span class="mock-tile" style:width="30px"></span>
		</span>
		<span class="mock-col" style:align-items="center">
			<span class="mock-line" style:width="60%"></span>
			<span class="mock-line dim" style:width="40%"></span>
		</span>
		<span class="mock-row" style:justify-content="center" style:gap="8px">
			<span class="mock-tile" style:width="5px" style:border-radius="999px"></span>
			<span class="mock-tile" style:width="9px" style:border-radius="999px"></span>
			<span class="mock-tile" style:width="5px" style:border-radius="999px"></span>
		</span>
	</span>
{/snippet}

<!-- showQualityTag — the same title line with and without the FLAC badge. Literally the
     difference. `FLAC` is a format name, not chrome, so it needs no i18n key. -->
{#snippet tagOff()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-row">
			<span class="mock-tile" style:width="16px"></span>
			<span class="mock-col">
				<span class="mock-text">Stargazing</span>
				<span class="mock-line dim" style:width="50%"></span>
			</span>
		</span>
	</span>
{/snippet}
{#snippet tagOn()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-row">
			<span class="mock-tile" style:width="16px"></span>
			<span class="mock-col">
				<span class="mock-row">
					<span class="mock-text">Stargazing</span>
					<span class="mock-badge">FLAC</span>
				</span>
				<span class="mock-line dim" style:width="50%"></span>
			</span>
		</span>
	</span>
{/snippet}

<!-- nowbarLyrics — the mini bar showing the artist name vs showing a lyric line. The demo text
     is the same static fallback the Appearance demos use (Stargazing / Myles Smith), and the
     lyric is a generic stand-in rather than an invented lyric string, so nothing needs
     translating into 15 languages to draw a two-line mock. -->
{#snippet lyricsOff()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-bar">
			<span class="mock-tile" style:width="14px"></span>
			<span class="mock-col">
				<span class="mock-text">Stargazing</span>
				<span class="mock-text dim">Myles Smith</span>
			</span>
		</span>
	</span>
{/snippet}
{#snippet lyricsOn()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-bar">
			<span class="mock-tile" style:width="14px"></span>
			<span class="mock-col">
				<span class="mock-text">Stargazing</span>
				<span class="mock-text dim">&#9834; &#8212;&#8212;&#8212;&#8212;</span>
			</span>
		</span>
	</span>
{/snippet}

<section>
	<h2><Zap size={15} /> {t('settings.playbackMotion')}</h2>

	<h3 class="sub"><Maximize2 size={14} /> {t('settings.autoExpand')}<SettingHint label={t('settings.autoExpand')} text={t('settings.autoExpandDesc')} /></h3>
	<SettingPicker
		variant="preview"
		label={t('settings.autoExpand')}
		options={[
			{ ...offOn[0], preview: expandOff },
			{ ...offOn[1], preview: expandOn }
		]}
		value={boolValue(settings.autoExpandOnPlay)}
		onpick={toggleExpand}
	/>

	<h3 class="sub"><BadgeCheck size={14} /> {t('settings.showQualityTag')}<SettingHint label={t('settings.showQualityTag')} text={t('settings.showQualityTagDesc')} /></h3>
	<SettingPicker
		variant="preview"
		label={t('settings.showQualityTag')}
		options={[
			{ ...offOn[0], preview: tagOff },
			{ ...offOn[1], preview: tagOn }
		]}
		value={boolValue(settings.showQualityTag)}
		onpick={toggleQualityTag}
	/>

	<h3 class="sub"><Mic2 size={14} /> {t('settings.nowbarLyrics')}</h3>
	<!-- quick-260919-ebi: no hint here — the two mini bars ARE the sentence this used to carry
	     ("shows the current lyric line instead of the artist name"), word for word. -->
	<SettingPicker
		variant="preview"
		label={t('settings.nowbarLyrics')}
		options={[
			{ ...offOn[0], preview: lyricsOff },
			{ ...offOn[1], preview: lyricsOn }
		]}
		value={boolValue(settings.nowbarLyrics)}
		onpick={toggleNowbarLyrics}
	/>
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
			<!-- quick-260919-ebi: no preview — up-next is about where the NEXT song comes from,
			     which is behaviour, not a look. The two icons already carry it. -->
			<SettingPicker
				label={`${t(c.key)} · ${t('settings.upnextSourcing')}`}
				options={upnextOptions}
				value={settings.effectiveUpnextMode(c.ctx)}
				onpick={(v) => setUpnext(c.ctx, v)}
				iconOnly
			/>
		</div>
	{/each}
</section>

<!-- ii6: Advanced > Sources — tucked behind a <details> accordion so the Playback tab
	   stays speed/quality-first. Lets a user opt INTO 5sing (enabledByDefault:false). -->
<details class="advanced">
	<summary><Sliders size={15} /> {t('settings.sourcesAdvanced')}<SettingHint label={t('settings.sourcesAdvanced')} text={t('settings.sourcesAdvancedNote')} /></summary>
	<div class="chips">
		{#each Object.values(SOURCES) as adapter (adapter.id)}
			<button class="chip" class:on={sourceEnabled(adapter.id)} onclick={() => toggleSource(adapter.id)} use:tapBounce>{adapter.label}</button>
		{/each}
	</div>
</details>

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.head h1 { flex: 1; }
	.reset { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text-muted); padding: 6px 12px; border-radius: 999px; font-size: 12px; cursor: pointer; }
	.reset:hover { color: var(--color-text); }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	/* quick-260919-ebi: `position: relative` on every title that carries an inline (i) — it anchors
	   SettingHint's description panel, which is scoped and cannot set this on its host. */
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 10px; position: relative; }
	.muted { color: var(--color-text-muted); font-size: 12px; margin: 8px 0 0; display: flex; align-items: center; gap: 4px;}
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	/* quick-260919-ebi: the .seg CSS moved into SettingPicker.svelte; .row-toggle/.sw went with the
	   three toggle rows the previews replaced. */
	.sub { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; margin: 16px 0 8px; position: relative; }
	.upnext-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; }
	.upnext-row .ctx-label { font-size: 14px; color: var(--color-text); }
	.advanced { margin: 22px 0; padding: 10px 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; }
	.advanced summary { position: relative; display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); cursor: pointer; padding: 4px 0; }
	.advanced .chips { margin-top: 12px; }
</style>
