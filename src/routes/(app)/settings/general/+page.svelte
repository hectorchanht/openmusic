<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	// quick-260919-ebi: theme / accent / reduce-motion moved General → Appearance, so the Palette,
	// Sun, Moon and Zap icons left with them.
	import { ChevronLeft, Globe, Share2 } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import SettingToggle from '$lib/components/SettingToggle.svelte';
	import SettingHint from '$lib/components/SettingHint.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t, type AppLang } from '$lib/i18n';

	onMount(() => settings.load());

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

	function setAppLang(v: AppLang) { settings.appLang = v; settings.save(); }
	function toggleShareTitle() { settings.shareIncludeTitle = !settings.shareIncludeTitle; settings.save(); }
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')} use:tapBounce><ChevronLeft size={22} /></button>
	<h1>{t('settings.groupGeneral')}</h1>
	<button class="reset" onclick={() => { if (confirm(t('settings.resetConfirm'))) { settings.resetGeneral(); } }} use:tapBounce>{t('settings.resetGroup')}</button>
</header>

<section>
	<h2><Globe size={15} /> {t('settings.appLanguage')}</h2>
	<div class="chips">
		{#each appLangs as l (l.v)}
			<button class="chip" class:on={settings.appLang === l.v} onclick={() => setAppLang(l.v)} use:tapBounce>{l.label}</button>
		{/each}
	</div>
	<SettingHint label={t('settings.appLanguage')} text={t('settings.appLanguageDesc')} />
</section>

<!-- quick-260919-ebi: Theme, Accent colour and Reduce motion moved OUT of here, into
     /settings/appearance — a page literally named Appearance that did not contain dark mode was the
     single worst findability bug in Settings. General now holds the two things that are neither
     visual nor playback: the UI language and the share payload. -->

<!-- quick-260808-vzu — no <h2> heading here on purpose: the row label already says what it does,
     and a heading would cost a third i18n key across all 15 locales for no extra information. -->
<section>
	<!-- quick-260919-ebi (F2): the one shared boolean row — inset + switch + accent edge. -->
	<SettingToggle
		icon={Share2}
		label={t('settings.shareIncludeTitle')}
		checked={settings.shareIncludeTitle}
		onchange={toggleShareTitle}
	/>
	<SettingHint label={t('settings.shareIncludeTitle')} text={t('settings.shareIncludeTitleDesc')} />
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
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	/* quick-260919-ebi: .seg / .swatches / .swatch left with the theme + accent controls; the
	   toggle-row CSS moved into SettingToggle.svelte. */
</style>
