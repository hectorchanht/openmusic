<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, ChevronRight, Globe, Type, LayoutGrid, Languages, Music, Radio, Database, ScrollText, Info } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { t, type TranslationKey } from '$lib/i18n';
	import type { Component } from 'svelte';

	onMount(() => settings.load());

	// Group rows: order = general, home, translation, playback, lastfm, data, about.
	// (Listen history moved to the Library page → /library "History" tab.)
	const groups: { href: string; icon: Component; title: TranslationKey; desc: TranslationKey }[] = [
		{ href: '/settings/general', icon: Globe, title: 'settings.groupGeneral', desc: 'settings.groupGeneralDesc' },
		{ href: '/settings/appearance', icon: Type, title: 'settings.groupAppearance', desc: 'settings.groupAppearanceDesc' },
		{ href: '/settings/home', icon: LayoutGrid, title: 'settings.groupHome', desc: 'settings.groupHomeDesc' },
		{ href: '/settings/translation', icon: Languages, title: 'settings.groupTranslation', desc: 'settings.groupTranslationDesc' },
		{ href: '/settings/playback', icon: Music, title: 'settings.groupPlayback', desc: 'settings.groupPlaybackDesc' },
		// { href: '/settings/lastfm', icon: Radio, title: 'settings.groupLastfm', desc: 'settings.groupLastfmDesc' },
		{ href: '/settings/data', icon: Database, title: 'settings.groupData', desc: 'settings.groupDataDesc' },
		{ href: '/settings/activity', icon: ScrollText, title: 'settings.groupActivity', desc: 'settings.groupActivityDesc' },
		{ href: '/settings/about', icon: Info, title: 'settings.groupAbout', desc: 'settings.groupAboutDesc' }
	];
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('common.back')} onclick={() => goto('/')}><ChevronLeft size={22} /></button>
	<h1>{t('settings.heading')}</h1>
</header>

<ul class="groups">
	{#each groups as g (g.href)}
		<li>
			<button class="item" onclick={() => goto(g.href)}>
				<g.icon size={20} />
				<span class="txt">
					<span class="g-title">{t(g.title)}</span>
					<span class="g-desc">{t(g.desc)}</span>
				</span>
				<ChevronRight size={18} class="chev" />
			</button>
		</li>
	{/each}
</ul>

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	.groups { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.item { width: 100%; display: flex; align-items: center; gap: 14px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; cursor: pointer; text-align: left; }
	.item:hover { background: var(--color-surface); }
	.txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.g-title { font-size: 15px; font-weight: 600; }
	.g-desc { font-size: 12px; color: var(--color-text-muted); }
	.item :global(.chev) { color: var(--color-text-muted); flex: none; }
</style>
