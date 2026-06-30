<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Globe, Palette, Zap, Sun, Moon } from '@lucide/svelte';
	import { settings, ACCENT_PRESETS, type Theme } from '$lib/stores/settings.svelte';
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
	function setAccent(hex: string) { settings.accent = hex; settings.save(); }
	function toggleMotion() { settings.reduceMotion = !settings.reduceMotion; settings.save(); }
	function setTheme(v: Theme) { settings.theme = v; settings.save(); }
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')}><ChevronLeft size={22} /></button>
	<h1>{t('settings.groupGeneral')}</h1>
	<button class="reset" onclick={() => { if (confirm(t('settings.resetConfirm'))) { settings.resetGeneral(); } }}>{t('settings.resetGroup')}</button>
</header>

<section>
	<h2><Globe size={15} /> {t('settings.appLanguage')}</h2>
	<div class="chips">
		{#each appLangs as l (l.v)}
			<button class="chip" class:on={settings.appLang === l.v} onclick={() => setAppLang(l.v)}>{l.label}</button>
		{/each}
	</div>
	<p class="muted">{t('settings.appLanguageDesc')}</p>
</section>

<section>
	<h2><Sun size={15} /> {t('settings.theme')}</h2>
	<div class="seg">
		<button class:on={settings.theme === 'dark'} onclick={() => setTheme('dark')}><Moon size={15} /> {t('settings.themeDark')}</button>
		<button class:on={settings.theme === 'light'} onclick={() => setTheme('light')}><Sun size={15} /> {t('settings.themeLight')}</button>
	</div>
	<p class="muted">{t('settings.themeDesc')}</p>
</section>

<section>
	<h2><Palette size={15} /> {t('settings.accentColor')}</h2>
	<div class="swatches">
		{#each ACCENT_PRESETS as c (c)}
			<button class="swatch" class:on={settings.accent === c} style:background={c} aria-label={c} onclick={() => setAccent(c)}></button>
		{/each}
	</div>
	<p class="muted">{t('settings.accentColorDesc')}</p>
</section>

<section>
	<h2><Zap size={15} /> {t('settings.playbackMotion')}</h2>
	<button class="row-toggle" onclick={toggleMotion}>
		<span><Zap size={16} /> {t('settings.reduceMotion')}</span>
		<span class="sw" class:on={settings.reduceMotion}></span>
	</button>
	<p class="muted">{t('settings.reduceMotionDesc')}</p>
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
	.seg { display: inline-flex; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 999px; padding: 3px; gap: 3px; }
	.seg button { background: none; border: none; color: var(--color-text-muted); padding: 7px 16px; border-radius: 999px; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
	.seg button.on { background: var(--color-primary); color: #fff; }
	.swatches { display: flex; gap: 12px; }
	.swatch { width: 34px; height: 34px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
	.swatch.on { border-color: #fff; box-shadow: 0 0 0 2px var(--color-bg), 0 0 0 4px currentColor; }
	.row-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 13px 14px; border-radius: 12px; font-size: 14px; cursor: pointer; margin-bottom: 8px; }
	.row-toggle span:first-child { display: inline-flex; align-items: center; gap: 10px; }
	.sw { width: 40px; height: 22px; border-radius: 999px; background: var(--color-border); position: relative; transition: background 0.15s ease; flex: none; }
	.sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 0.15s ease; }
	.sw.on { background: var(--color-primary); }
	.sw.on::after { transform: translateX(18px); }
</style>
