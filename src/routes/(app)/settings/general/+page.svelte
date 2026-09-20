<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	// quick-260919-ebi: theme / accent / reduce-motion moved General → Appearance, so the Palette,
	// Sun, Moon and Zap icons left with them.
	import { Globe, Share2 } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
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

<PageHeader title={t('settings.groupGeneral')} backLabel={t('settings.backToSettings')} onback={() => goto('/settings')}>
	{#snippet trailing()}
		<button class="reset" onclick={() => { if (confirm(t('settings.resetConfirm'))) { settings.resetGeneral(); } }} use:tapBounce>{t('settings.resetGroup')}</button>
	{/snippet}
</PageHeader>

<section>
	<h2><Globe size={15} /> {t('settings.appLanguage')}<SettingHint label={t('settings.appLanguage')} text={t('settings.appLanguageDesc')} /></h2>
	<div class="chips">
		{#each appLangs as l (l.v)}
			<button class="chip" class:on={settings.appLang === l.v} onclick={() => setAppLang(l.v)} use:tapBounce>{l.label}</button>
		{/each}
	</div>
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
		hint={t('settings.shareIncludeTitleDesc')}
	/>
</section>

<style>
	.reset { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text-muted); padding: 6px 12px; border-radius: 999px; font-size: 12px; cursor: pointer; }
	.reset:hover { color: var(--color-text); }
	section { margin: 18px 0; }
	/* quick-260919-ebi: `position: relative` anchors the inline (i)'s description panel to the
	   heading — SettingHint is scoped and cannot set this on its host. */
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 10px; position: relative; }
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	/* quick-260919-ebi: .seg / .swatches / .swatch left with the theme + accent controls; the
	   toggle-row CSS moved into SettingToggle.svelte. */
</style>
