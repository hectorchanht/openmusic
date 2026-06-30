<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Radio } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';

	// DISABLED placeholder ONLY. Real Last.fm auth (LASTFM_SECRET, httpOnly `sk` cookie,
	// api_sig, T-lfm-01/02/03) is reserved for v1.1 Phase 11 — explicitly out of scope.
	// No auth, no network/fetch, no secret, no env access here.
	onMount(() => settings.load());
</script>

<svelte:head><title>{t('lastfm.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')} use:tapBounce><ChevronLeft size={22} /></button>
	<h1>{t('lastfm.heading')}</h1>
</header>

<section>
	<button class="item" disabled>
		<Radio size={18} />
		<span class="label">{t('lastfm.connect')}</span>
		<span class="pill">{t('lastfm.comingSoon')}</span>
	</button>
	<p class="muted">{t('lastfm.note')}</p>
</section>

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	.item { width: 100%; display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; font-size: 15px; text-align: left; }
	.item:disabled { opacity: 0.55; cursor: default; }
	.label { flex: 1; min-width: 0; }
	.pill { flex: none; font-size: 11px; padding: 4px 10px; border-radius: 999px; background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
	.muted { color: var(--color-text-muted); font-size: 12px; margin: 10px 0 0; }
</style>
