<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	// quick-260919-ebi: ChevronRight + tapBounce now live inside SettingRow; Radio stays only for
	// the commented-out Last.fm row below.
	import { Globe, Type, LayoutGrid, Languages, Music, Radio, HardDriveDownload, Database, ScrollText, Info, Heart, ChevronRight, CircleUserRound, Share2, RotateCcw } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { support } from '$lib/stores/support.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SettingRow from '$lib/components/SettingRow.svelte';
	import SettingToggle from '$lib/components/SettingToggle.svelte';
	import SettingHint from '$lib/components/SettingHint.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t, ensureLocale, type AppLang, type TranslationKey } from '$lib/i18n';
	import type { Component } from 'svelte';
	import { isSupporter } from '$lib/config/sponsored';
	// quick-261010-posthog: settings_opened on entering the settings index.
	import { track } from '$lib/posthog';

	// SUPPORTER CHOICE MODEL (Hector 2026-10-10): verified tippers get a
	// ☕ Supporter badge on the support card below (SSR-safe — false pre-hydration).
	let supporter = $state(false);

	onMount(() => {
		settings.load();
		supporter = isSupporter();
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
		{ href: '/settings/appearance', icon: Type, title: 'settings.groupAppearance', desc: 'settings.groupAppearanceDesc' },
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
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<PageHeader title={t('settings.heading')} backLabel={t('common.back')} onback={() => goto('/')} />

<!-- quick-261023-settings: the old General tab's content, promoted to a top-level section —
     the language switcher is important enough to be visible without tapping through. -->
<section class="general" aria-label={t('settings.groupGeneral')}>
	<div class="general-head">
		<h2><Globe size={15} /> {t('settings.appLanguage')}<SettingHint label={t('settings.appLanguage')} text={t('settings.appLanguageDesc')} /></h2>
		<!-- quick-261006-ico: icon-only reset (icon-first UI pass) — the existing resetGroup
		     string doubles as the aria-label + title, so no new i18n key. -->
		<button class="reset" onclick={() => (resetOpen = true)} use:tapBounce aria-label={t('settings.resetGroup')} title={t('settings.resetGroup')}><RotateCcw size={16} /></button>
	</div>
	<div class="chips">
		{#each appLangs as l (l.v)}
			<button class="chip" class:on={settings.appLang === l.v} onclick={() => setAppLang(l.v)} use:tapBounce>{l.label}</button>
		{/each}
	</div>
	<!-- quick-260808-vzu — no <h2> heading here on purpose: the row label already says what it does,
	     and a heading would cost a third i18n key across all 15 locales for no extra information. -->
	<div class="share-row">
		<SettingToggle
			icon={Share2}
			label={t('settings.shareIncludeTitle')}
			checked={settings.shareIncludeTitle}
			onchange={toggleShareTitle}
			hint={t('settings.shareIncludeTitleDesc')}
		/>
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
		<span class="sc-title">{t('support.title')}{supporter ? ' ☕' : ''}</span>
		<span class="sc-desc">“{t('support.tagline')}”</span>
	</span>
	<ChevronRight size={18} class="sc-chev" />
</button>

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
	/* quick-260919-ebi: the row CSS (.item/.txt/.g-title/.g-desc/.chev) moved into SettingRow.svelte;
	   SettingRow owns its own 8px bottom margin, so the list gap is gone. */
	.groups { list-style: none; margin: 8px 0 0; padding: 0; }
	/* quick-261023-settings: the promoted General section — language chips + share toggle,
	   carried VERBATIM from the old /settings/general page so nothing jumps. */
	.general { margin: 8px 0 4px; padding: 14px; border: 1px solid var(--color-border); border-radius: 14px; background: var(--color-surface-1); }
	.general-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
	.general h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0; position: relative; }
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
		margin-top: 10px;
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
	.chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	.share-row { margin-top: 4px; }
	/* donor-wall-ui 2026-10-14: the featured support card — the app's primary accent
	   surface, so the donor wall is visible without scrolling. */
	.support-card { display: flex; align-items: center; gap: 12px; width: 100%; margin: 8px 0 4px; padding: 14px; border: 1px solid var(--color-primary); border-radius: 14px; background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface-2)); color: var(--color-text); cursor: pointer; text-align: left; }
	.sc-heart { flex: none; color: var(--color-primary); }
	.sc-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.sc-title { font-weight: 700; font-size: 0.9375rem; }
	.sc-desc { font-size: 0.8125rem; font-style: italic; color: var(--color-text-muted); }
	.sc-chev { flex: none; color: var(--color-text-muted); }
</style>
