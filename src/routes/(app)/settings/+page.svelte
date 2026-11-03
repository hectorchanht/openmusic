<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	// quick-260919-ebi: ChevronRight + tapBounce now live inside SettingRow; Radio stays only for
	// the commented-out Last.fm row below.
	import { Globe, Type, LayoutGrid, Languages, Music, Radio, HardDriveDownload, Database, ScrollText, Info, Heart, ChevronRight, CircleUserRound, Share2, RotateCcw, Sun, Palette, Zap, Paintbrush } from '@lucide/svelte';
	import { settings, ACCENT_PRESETS, SUPPORTER_THEMES, FONT_SCALE_MIN, FONT_SCALE_MAX, type Theme } from '$lib/stores/settings.svelte';
	import { support } from '$lib/stores/support.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SettingRow from '$lib/components/SettingRow.svelte';
	import SettingToggle from '$lib/components/SettingToggle.svelte';
	import SettingPicker from '$lib/components/SettingPicker.svelte';
	import SettingHint from '$lib/components/SettingHint.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t, ensureLocale, type AppLang, type TranslationKey } from '$lib/i18n';
	import type { Component } from 'svelte';
	import { isSupporter, supporterBadge } from '$lib/config/sponsored';
	// quick-261010-posthog: settings_opened on entering the settings index.
	import { track } from '$lib/posthog';

	// SUPPORTER CHOICE MODEL (Hector 2026-10-10): verified tippers get a
	// tier badge on the support card below (SSR-safe — false pre-hydration).
	// quick-261023-perks: the badge renders the stored tier (☕/🥈/🥇).
	let supporter = $state(false);
	let tierBadge = $state('');

	onMount(() => {
		settings.load();
		supporter = isSupporter();
		tierBadge = supporterBadge();
		track('settings_opened', {});
	});

	// Group rows: order = account, playback, downloads, appearance, home, translation,
	// data, activity, about (2026-10-06, Hector: most-used first).
	// quick-261020-acct: Account goes FIRST — sign-in gates cross-device sync, and a signed-out
	// user landing in Settings is most likely looking for exactly this row.
	// (Listen history moved to the Library page → /library "History" tab.)
	// quick-261023-settings: the General group is GONE as a row — its content (app language,
	// the important one, + share payload) now lives as a top-level section above, so the
	// language switcher is visible without tapping through. /settings/general no longer exists.
	// 34 (UI-SPEC contract 7) asked for the Downloads row to be HIDDEN on web, on the grounds that a
	// row leading to a capability the web build can never have is a lie in the navigation. That no
	// longer holds: Phase 36 shipped RETAG on the same page and it works on web, so hiding the row
	// would orphan a working feature. The native gate lives in the page body instead — device import
	// shows one honest line there on web, and retag stays reachable.
	const groups: { href: string; icon: Component; title: TranslationKey; desc: TranslationKey }[] = [
		{ href: '/settings/account', icon: CircleUserRound, title: 'settings.groupAccount', desc: 'settings.groupAccountDesc' },
		{ href: '/settings/playback', icon: Music, title: 'settings.groupPlayback', desc: 'settings.groupPlaybackDesc' },
		{ href: '/settings/downloads', icon: HardDriveDownload, title: 'settings.groupDownloads', desc: 'settings.groupDownloadsDesc' },
		{ href: '/settings/appearance', icon: Paintbrush, title: 'settings.groupAppearance', desc: 'settings.groupAppearanceDesc' },
		{ href: '/settings/home', icon: LayoutGrid, title: 'settings.groupHome', desc: 'settings.groupHomeDesc' },
		{ href: '/settings/translation', icon: Languages, title: 'settings.groupTranslation', desc: 'settings.groupTranslationDesc' },
		// { href: '/settings/lastfm', icon: Radio, title: 'settings.groupLastfm', desc: 'settings.groupLastfmDesc' },
		{ href: '/settings/data', icon: Database, title: 'settings.groupData', desc: 'settings.groupDataDesc' },
		{ href: '/settings/activity', icon: ScrollText, title: 'settings.groupActivity', desc: 'settings.groupActivityDesc' },
		// quick-261023-support: the /settings/sponsored page is GONE — folded into the
		// SupporterSheet (tip-key verify + hide-strip toggle). The featured support card
		// below is now the single Support entry.
		{ href: '/settings/about', icon: Info, title: 'settings.groupAbout', desc: 'settings.groupAboutDesc' }
	];

	// quick-261023-settings: the old /settings/general page's content, moved up here. The
	// reset button opens an in-app confirm modal (not window.confirm) — carried over verbatim.
	let resetOpen = $state(false);

	// App-language endonyms render literally (NOT through t()).
	const appLangs: { v: AppLang; label: string }[] = [
		{ v: 'en', label: 'English' },
		{ v: 'zh-Hant', label: '繁體中文' },
		{ v: 'zh-Hans', label: '简体中文' },
		{ v: 'es', label: 'Español' },
		{ v: 'fr', label: 'Français' },
		{ v: 'de', label: 'Deutsch' },
		{ v: 'pt', label: 'Português' },
		{ v: 'it', label: 'Italiano' },
		{ v: 'ru', label: 'Русский' },
		{ v: 'tr', label: 'Türkçe' },
		{ v: 'ar', label: 'العربية' },
		{ v: 'hi', label: 'हिन्दी' },
		{ v: 'id', label: 'Bahasa Indonesia' },
		{ v: 'vi', label: 'Tiếng Việt' },
		{ v: 'th', label: 'ไทย' }
	];

	// quick-261006-i18n: fetch the newly-selected locale's chunk now; t() falls back
	// to en until it lands, then repaints via dictSignal.
	function setAppLang(v: AppLang) { settings.appLang = v; settings.save(); void ensureLocale(v); }
	function toggleShareTitle() { settings.shareIncludeTitle = !settings.shareIncludeTitle; settings.save(); }

	// quick-261103-stg: the app-wide LOOK controls (theme, accent, app text size, reduce motion)
	// moved up here from /settings/appearance, beside App language. They change every screen, so
	// they belong above the per-area tabs; Appearance keeps only the surface editors (song rows,
	// Now Playing, lyrics position) and the on-screen badges. Handlers carried verbatim.
	// quick-261023-perks: supporter themes are locked for non-supporters — tapping one opens the
	// support sheet instead of applying it (the store ALSO demotes a stored supporter theme on load).
	function setTheme(v: Theme) {
		if (!supporter && (SUPPORTER_THEMES as readonly string[]).includes(v)) {
			support.openSheet();
			return;
		}
		settings.theme = v;
		settings.save();
	}
	function setAccent(hex: string) { settings.accent = hex; settings.save(); }
	function toggleMotion() { settings.reduceMotion = !settings.reduceMotion; settings.save(); }
	// Commits LIVE (quick-261024-sets): save() → applyTheme() re-renders this page at the size
	// being dragged, so the page is the preview.
	function setAppTextSize(e: Event) { settings.fontScaleApp = Number((e.currentTarget as HTMLInputElement).value); settings.save(); }

	// quick-260919-ebi (F3): THE sanctioned literal-colour exception — each theme card must look
	// like ITS theme while another one is active, so it cannot read the live tokens. Values are
	// the real app.css `:root` / `[data-theme]` palettes; if app.css changes, these change with it.
	type Swatch = { bg: string; surface2: string; border: string; text: string; muted: string };
	const PALETTE: Record<Theme, Swatch> = {
		dark: { bg: '#0b0b0f', surface2: '#1d1d27', border: '#888888', text: '#f4f4f6', muted: '#a0a0ad' },
		light: { bg: '#f7f7fa', surface2: '#ececf2', border: '#80808a', text: '#1a1a22', muted: '#5a5a66' }, // quick-261103-pga
		gold: { bg: '#100c06', surface2: '#241b0e', border: '#6b5a2e', text: '#f7f0dd', muted: '#b3a684' },
		sakura: { bg: '#120b10', surface2: '#261722', border: '#6e4a5a', text: '#faeef3', muted: '#bd9fab' }
	};
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<PageHeader title={t('settings.heading')} backLabel={t('common.back')} onback={() => goto('/')} />

<!-- quick-261103-stg: ONE "General" card holds every app-wide setting — language, theme, accent,
     text size, motion, sharing — ABOVE the per-area rows below. It replaces two separate cards
     (language, text size) while theme/accent/motion were buried a tap deep in Appearance. One
     reset covers the whole card (resetGeneral). -->
{#snippet chrome(p: Swatch)}
	<span class="mock-chrome" style:background={p.bg} style:border-radius="3px" style:padding="5px">
		<span class="mock-bar" style:background={p.surface2}><span class="mock-line" style:background={p.text} style:width="40%"></span></span>
		<span class="mock-row">
			<span class="mock-tile" style:background={p.surface2} style:border-color={p.border} style:width="18px"></span>
			<span class="mock-col">
				<span class="mock-line" style:background={p.text} style:width="80%"></span>
				<span class="mock-line" style:background={p.muted} style:width="55%"></span>
			</span>
		</span>
		<span class="mock-bar" style:background={p.surface2}>
			<span class="mock-tile" style:background={p.bg} style:border-color={p.border} style:width="10px"></span>
			<span class="mock-col">
				<span class="mock-line" style:background={p.text} style:width="70%"></span>
				<span class="mock-line" style:background={p.muted} style:width="45%"></span>
			</span>
		</span>
	</span>
{/snippet}
{#snippet darkCard()}{@render chrome(PALETTE.dark)}{/snippet}
{#snippet lightCard()}{@render chrome(PALETTE.light)}{/snippet}
{#snippet goldCard()}{@render chrome(PALETTE.gold)}{/snippet}
{#snippet sakuraCard()}{@render chrome(PALETTE.sakura)}{/snippet}

<section class="general" aria-labelledby="general-h">
	<div class="general-head">
		<h2 id="general-h">{t('settings.groupGeneral')}</h2>
		<!-- quick-261006-ico: icon-only reset — resetGroup doubles as aria-label + title. -->
		<button class="reset" onclick={() => (resetOpen = true)} use:tapBounce aria-label={t('settings.resetGroup')} title={t('settings.resetGroup')}><RotateCcw size={16} /></button>
	</div>

	<div class="block">
		<h3><Globe size={15} /> {t('settings.appLanguage')}<SettingHint label={t('settings.appLanguage')} text={t('settings.appLanguageDesc')} /></h3>
		<div class="chips">
			{#each appLangs as l (l.v)}
				<button class="chip" class:on={settings.appLang === l.v} onclick={() => setAppLang(l.v)} use:tapBounce>{l.label}</button>
			{/each}
		</div>
	</div>

	<div class="block">
		<h3><Sun size={15} /> {t('settings.theme')}</h3>
		<div class="theme-pick">
		<SettingPicker
			variant="preview"
			label={t('settings.theme')}
			value={settings.theme}
			onpick={setTheme}
			options={[
				{ v: 'dark' as Theme, label: t('settings.themeDark'), preview: darkCard },
				{ v: 'light' as Theme, label: t('settings.themeLight'), preview: lightCard },
				{ v: 'gold' as Theme, label: t('settings.themeGold'), preview: goldCard, locked: !supporter, lockLabel: t('settings.themeLocked') },
				{ v: 'sakura' as Theme, label: t('settings.themeSakura'), preview: sakuraCard, locked: !supporter, lockLabel: t('settings.themeLocked') }
			]}
		/>
		</div>
	</div>

	<div class="block">
		<h3><Palette size={15} /> {t('settings.accentColor')}<SettingHint label={t('settings.accentColor')} text={t('settings.accentColorDesc')} /></h3>
		<div class="swatches">
			{#each ACCENT_PRESETS as c (c)}
				<button class="swatch" class:on={settings.accent === c} style:background={c} aria-label={c} aria-pressed={settings.accent === c} onclick={() => setAccent(c)} use:tapBounce></button>
			{/each}
		</div>
		<!-- quick-261023-perks: supporter themes carry their own primary; the accent drives the free two. -->
		{#if (SUPPORTER_THEMES as readonly string[]).includes(settings.theme)}
			<p class="note">{t('settings.accentThemed')}</p>
		{/if}
	</div>

	<div class="block">
		<h3><Type size={15} /> {t('settings.fontSizeApp')}<SettingHint label={t('settings.fontSizeApp')} text={t('settings.fontSizeAppDesc')} /><span class="val">{settings.fontScaleApp}%</span></h3>
		<input type="range" min={FONT_SCALE_MIN} max={FONT_SCALE_MAX} step="5" value={settings.fontScaleApp} oninput={setAppTextSize} aria-label={t('settings.fontSizeApp')} />
		<p class="note">{t('settings.appearanceNote')}</p>
	</div>

	<div class="block toggles">
		<!-- quick-260919-ebi (F2): the shared boolean row — inset + switch + accent edge. -->
		<SettingToggle icon={Zap} label={t('settings.reduceMotion')} checked={settings.reduceMotion} onchange={toggleMotion} hint={t('settings.reduceMotionDesc')} />
		<SettingToggle icon={Share2} label={t('settings.shareIncludeTitle')} checked={settings.shareIncludeTitle} onchange={toggleShareTitle} hint={t('settings.shareIncludeTitleDesc')} />
	</div>
</section>

<ConfirmModal
	open={resetOpen}
	title={t('settings.resetGroup')}
	body={t('settings.resetConfirm')}
	confirmLabel={t('settings.resetGroup')}
	onconfirm={() => settings.resetGeneral()}
	onclose={() => (resetOpen = false)}
/>

<!-- donor-wall-ui 2026-10-14: featured support card (the donor wall) — sits above the
     nav rows; opens the SupporterSheet. quick-261023-support: now the SINGLE Support
     entry (the /settings/sponsored page folded into the sheet). -->
<button class="support-card" onclick={() => support.openSheet()} use:tapBounce>
	<Heart size={22} fill="currentColor" class="sc-heart" />
	<span class="sc-txt">
		<span class="sc-title">{t('support.title')}{supporter && tierBadge ? ` ${tierBadge}` : ''}</span>
		<span class="sc-desc">“{t('support.tagline')}”</span>
	</span>
	<ChevronRight size={18} class="sc-chev dir-flip" />
</button>

<!-- Supporters wall (2026-10-24): one quiet real link under the support card —
     the public /supporters page (opt-in names from verified tippers). -->
<!-- quick-261103-stg: was a hard-coded English string — now support.wallLink in every locale. -->
<a class="wall-row" href="/supporters" use:tapBounce>{t('support.wallLink')}</a>

<ul class="groups">
	{#each groups as g (g.href)}
		<li>
			<!-- quick-260919-ebi (F2): every row here LEADS SOMEWHERE, so they are all the raised +
			     chevron kind. The shared component is now the only place that shape is declared. -->
			<SettingRow icon={g.icon} label={t(g.title)} desc={t(g.desc)} onclick={() => goto(g.href)} />
		</li>
	{/each}
</ul>

<style>
	/* Supporters wall link (2026-10-24): quiet, centered, under the support card. */
	.wall-row { display: block; text-align: center; margin: 8px 0 2px; font-size: 0.8125rem; font-weight: 600; color: var(--color-text-muted); text-decoration: none; }
	/* quick-260919-ebi: the row CSS (.item/.txt/.g-title/.g-desc/.chev) moved into SettingRow.svelte;
	   SettingRow owns its own 8px bottom margin, so the list gap is gone. */
	.groups { list-style: none; margin: 8px 0 0; padding: 0; }
	/* quick-261103-stg: the General card — app-wide settings, one block per setting split by
	   hairlines. Block titles are sentence-case row labels (h3), the card title the only
	   uppercase overline, so the card reads as ONE group rather than five stacked cards. */
	.general { margin: 8px 0 12px; padding: 4px 14px 6px; border: 1px solid var(--color-border); border-radius: 14px; background: var(--color-surface-1); }
	.general-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 6px; }
	.general h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0; }
	.block { padding: 14px 0; border-top: 1px solid color-mix(in srgb, var(--color-border) 45%, transparent); }
	.general-head + .block { border-top: none; padding-top: 6px; }
	.block h3 { position: relative; display: flex; align-items: center; gap: 8px; font-size: 0.9375rem; font-weight: 600; color: var(--color-text); margin: 0 0 12px; }
	.block h3 :global(svg:first-child) { color: var(--color-text-muted); flex: none; }
	.val { margin-inline-start: auto; color: var(--color-primary); font-variant-numeric: tabular-nums; font-size: 0.8125rem; font-weight: 400; }
	.note { color: var(--color-text-muted); font-size: 0.75rem; margin: 8px 0 0; }
	input[type='range'] { width: 100%; accent-color: var(--color-primary); }
	.swatches { display: flex; flex-wrap: wrap; gap: 12px; }
	.swatch { width: 34px; height: 34px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
	.swatch.on { border-color: var(--color-bg); box-shadow: 0 0 0 2px var(--color-text); }
	.toggles { padding-bottom: 6px; }
	/* Four theme cards: a 2×2 grid on phones (flex-wrap 3+1 left an orphan), one row from 640px. */
	.theme-pick :global(.card) { flex: 1 1 calc(50% - 5px); }
	@media (min-width: 640px) { .theme-pick :global(.card) { flex-basis: 0; } }
	/* quick-261006-ico: icon-only reset — 40px ghost circle. */
	.reset { background: none; border: 1px solid var(--color-border); color: var(--color-text-muted); width: 40px; height: 40px; padding: 0; border-radius: 50%; cursor: pointer; display: inline-grid; place-items: center; flex: none; }
	.reset:hover { color: var(--color-text); }
	/* quick-261007-hscroll: chip strips scroll horizontally (never wrap, never clip) —
	   same pattern as the realufo.org chip rows: overflow-x + hidden scrollbar. */
	.chips {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		scrollbar-width: none;
		-ms-overflow-style: none;
		padding-bottom: 4px;
	}
	.chips::-webkit-scrollbar {
		display: none;
		width: 0;
	}
	.chips > .chip {
		flex: none;
		white-space: nowrap;
	}
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 0.8125rem; cursor: pointer; }
	.chip.on { background: var(--color-primary); color: var(--color-on-primary); /* quick-261102-rrb */ border-color: transparent; }
	/* donor-wall-ui 2026-10-14: the featured support card — the app's primary accent
	   surface, so the donor wall is visible without scrolling. */
	.support-card { display: flex; align-items: center; gap: 12px; width: 100%; margin: 8px 0 4px; padding: 14px; border: 1px solid var(--color-primary); border-radius: 14px; background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface-2)); color: var(--color-text); cursor: pointer; text-align: start; }
	.sc-heart { flex: none; color: var(--color-primary); }
	.sc-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.sc-title { font-weight: 700; font-size: 0.9375rem; }
	.sc-desc { font-size: 0.8125rem; font-style: italic; color: var(--color-text-muted); }
	.sc-chev { flex: none; color: var(--color-text-muted); }
</style>
