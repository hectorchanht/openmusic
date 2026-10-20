<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	// quick-260919-ebi: ChevronRight + tapBounce now live inside SettingRow; Radio stays only for
	// the commented-out Last.fm row below.
	import { Globe, Type, LayoutGrid, Languages, Music, Radio, HardDriveDownload, Database, ScrollText, Info, HandCoins, Heart, ChevronRight, CircleUserRound } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { support } from '$lib/stores/support.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SettingRow from '$lib/components/SettingRow.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t, type TranslationKey } from '$lib/i18n';
	import type { Component } from 'svelte';
	import { isSupporter } from '$lib/config/sponsored';
	// quick-261010-posthog: settings_opened on entering the settings index.
	import { track } from '$lib/posthog';

	// SUPPORTER CHOICE MODEL (Hector 2026-10-10): verified tippers get a
	// ☕ Supporter badge on the Supporter row below (SSR-safe — false pre-hydration).
	let supporter = $state(false);

	onMount(() => {
		settings.load();
		supporter = isSupporter();
		track('settings_opened', {});
	});

	// Group rows: order = account, playback, downloads, appearance, home, translation, general,
	// data, activity, about (2026-10-06, Hector: most-used first).
	// quick-261020-acct: Account goes FIRST — sign-in gates cross-device sync, and a signed-out
	// user landing in Settings is most likely looking for exactly this row.
	// (Listen history moved to the Library page → /library "History" tab.)
	// 34 (UI-SPEC contract 7) asked for the Downloads row to be HIDDEN on web, on the grounds that a
	// row leading to a capability the web build can never have is a lie in the navigation. That no
	// longer holds: Phase 36 shipped RETAG on the same page and it works on web, so hiding the row
	// would orphan a working feature. The native gate lives in the page body instead — device import
	// shows one honest line there on web, and retag stays reachable.
	const groups: { href: string; icon: Component; title: TranslationKey; desc: TranslationKey; badge?: boolean }[] = [
		{ href: '/settings/account', icon: CircleUserRound, title: 'settings.groupAccount', desc: 'settings.groupAccountDesc' },
		{ href: '/settings/playback', icon: Music, title: 'settings.groupPlayback', desc: 'settings.groupPlaybackDesc' },
		{ href: '/settings/downloads', icon: HardDriveDownload, title: 'settings.groupDownloads', desc: 'settings.groupDownloadsDesc' },
		{ href: '/settings/appearance', icon: Type, title: 'settings.groupAppearance', desc: 'settings.groupAppearanceDesc' },
		{ href: '/settings/home', icon: LayoutGrid, title: 'settings.groupHome', desc: 'settings.groupHomeDesc' },
		{ href: '/settings/translation', icon: Languages, title: 'settings.groupTranslation', desc: 'settings.groupTranslationDesc' },
		{ href: '/settings/general', icon: Globe, title: 'settings.groupGeneral', desc: 'settings.groupGeneralDesc' },
		// { href: '/settings/lastfm', icon: Radio, title: 'settings.groupLastfm', desc: 'settings.groupLastfmDesc' },
		{ href: '/settings/data', icon: Database, title: 'settings.groupData', desc: 'settings.groupDataDesc' },
		{ href: '/settings/activity', icon: ScrollText, title: 'settings.groupActivity', desc: 'settings.groupActivityDesc' },
		// quick-261010-spon: V2 hide flow — tippers verify their Gumroad license key here.
		// SUPPORTER CHOICE MODEL (2026-10-10): supporters see a ☕ badge on this row.
		{ href: '/settings/sponsored', icon: HandCoins, title: 'settings.groupSponsored', desc: 'settings.groupSponsoredDesc', badge: true },
		{ href: '/settings/about', icon: Info, title: 'settings.groupAbout', desc: 'settings.groupAboutDesc' }
	];
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<PageHeader title={t('settings.heading')} backLabel={t('common.back')} onback={() => goto('/')} />

<!-- donor-wall-ui 2026-10-14: featured support card (the donor wall) — sits above the
     nav rows; opens the SupporterSheet. -->
<button class="support-card" onclick={() => support.openSheet()} use:tapBounce>
	<Heart size={22} fill="currentColor" class="sc-heart" />
	<span class="sc-txt">
		<span class="sc-title">{t('support.title')}</span>
		<span class="sc-desc">“{t('support.tagline')}”</span>
	</span>
	<ChevronRight size={18} class="sc-chev" />
</button>

<ul class="groups">
	{#each groups as g (g.href)}
		<li>
			<!-- quick-260919-ebi (F2): every row here LEADS SOMEWHERE, so they are all the raised +
			     chevron kind. The shared component is now the only place that shape is declared. -->
			<SettingRow icon={g.icon} label={t(g.title)} desc={t(g.desc)} value={g.badge && supporter ? '☕ Supporter' : undefined} onclick={() => goto(g.href)} />
		</li>
	{/each}
</ul>

<style>
	/* quick-260919-ebi: the row CSS (.item/.txt/.g-title/.g-desc/.chev) moved into SettingRow.svelte;
	   SettingRow owns its own 8px bottom margin, so the list gap is gone. */
	.groups { list-style: none; margin: 8px 0 0; padding: 0; }
	/* donor-wall-ui 2026-10-14: the featured support card — the app's primary accent
	   surface, so the donor wall is visible without scrolling. */
	.support-card { display: flex; align-items: center; gap: 12px; width: 100%; margin: 8px 0 4px; padding: 14px; border: 1px solid var(--color-primary); border-radius: 14px; background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface-2)); color: var(--color-text); cursor: pointer; text-align: left; }
	.sc-heart { flex: none; color: var(--color-primary); }
	.sc-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.sc-title { font-weight: 700; font-size: 0.9375rem; }
	.sc-desc { font-size: 0.8125rem; font-style: italic; color: var(--color-text-muted); }
	.sc-chev { flex: none; color: var(--color-text-muted); }
</style>
