<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	// quick-260919-ebi: ChevronRight + tapBounce now live inside SettingRow; Radio stays only for
	// the commented-out Last.fm row below.
	import { Globe, Type, LayoutGrid, Languages, Music, Radio, HardDriveDownload, Database, ScrollText, Info } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SettingRow from '$lib/components/SettingRow.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t, type TranslationKey } from '$lib/i18n';
	import type { Component } from 'svelte';

	onMount(() => settings.load());

	// Group rows: order = general, home, translation, playback, downloads, lastfm, data, about.
	// (Listen history moved to the Library page → /library "History" tab.)
	// 34 (UI-SPEC contract 7) asked for the Downloads row to be HIDDEN on web, on the grounds that a
	// row leading to a capability the web build can never have is a lie in the navigation. That no
	// longer holds: Phase 36 shipped RETAG on the same page and it works on web, so hiding the row
	// would orphan a working feature. The native gate lives in the page body instead — device import
	// shows one honest line there on web, and retag stays reachable.
	const groups: { href: string; icon: Component; title: TranslationKey; desc: TranslationKey }[] = [
		{ href: '/settings/general', icon: Globe, title: 'settings.groupGeneral', desc: 'settings.groupGeneralDesc' },
		{ href: '/settings/appearance', icon: Type, title: 'settings.groupAppearance', desc: 'settings.groupAppearanceDesc' },
		{ href: '/settings/home', icon: LayoutGrid, title: 'settings.groupHome', desc: 'settings.groupHomeDesc' },
		{ href: '/settings/translation', icon: Languages, title: 'settings.groupTranslation', desc: 'settings.groupTranslationDesc' },
		{ href: '/settings/playback', icon: Music, title: 'settings.groupPlayback', desc: 'settings.groupPlaybackDesc' },
		{ href: '/settings/downloads', icon: HardDriveDownload, title: 'settings.groupDownloads', desc: 'settings.groupDownloadsDesc' },
		// { href: '/settings/lastfm', icon: Radio, title: 'settings.groupLastfm', desc: 'settings.groupLastfmDesc' },
		{ href: '/settings/data', icon: Database, title: 'settings.groupData', desc: 'settings.groupDataDesc' },
		{ href: '/settings/activity', icon: ScrollText, title: 'settings.groupActivity', desc: 'settings.groupActivityDesc' },
		{ href: '/settings/about', icon: Info, title: 'settings.groupAbout', desc: 'settings.groupAboutDesc' }
	];
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<PageHeader title={t('settings.heading')} backLabel={t('common.back')} onback={() => goto('/')} />

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
</style>
