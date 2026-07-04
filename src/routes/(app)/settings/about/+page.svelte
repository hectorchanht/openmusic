<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Info, Mail, Code2 } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';

	onMount(() => settings.load());

	const CONTACT = 'zephyr9709@anglernook.com';
	const REPO = 'https://github.com/hectorchanht/openmusic';

	// What the app does today (literal — brand/credits text, not part of the translated UI chrome).
	const features = [
		'Search + stream across Netease, QQ, Kuwo & JOOX, plus 5sing, Jamendo & Audius — all searched by default, each toggleable in Settings → Playback',
		'Home discovery — the Deezer top-hits & top-artists chart plus Last.fm genre & region shelves you can pick, reorder & hide',
		'Tap-to-play that re-resolves the best match across the enabled sources',
		'Real album & artist art via Deezer → iTunes → CN fallback',
		'Synced lyrics + per-part translation (artist / title / lyrics) across 15 UI languages',
		'Favorites, playlists, listen history & downloads',
		'Installable PWA with background audio & media-session controls'
	];
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')} use:tapBounce><ChevronLeft size={22} /></button>
	<h1>{t('settings.about')}</h1>
</header>

<section>
	<div class="item static"><Info size={18} /> {t('settings.aboutLine')}</div>
</section>

<section>
	<h2>What's inside</h2>
	<ul class="features">
		{#each features as f (f)}<li>{f}</li>{/each}
	</ul>
</section>

<section>
	<a class="item link" href="mailto:{CONTACT}"><Mail size={18} /> <span>{CONTACT}</span></a>
	<a class="item link" href={REPO} target="_blank" rel="noopener noreferrer"><Code2 size={18} /> <span>Source code on GitHub</span></a>
</section>

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	section h2 { font-size: 0.95rem; margin: 0 0 8px; color: var(--color-text); }
	.item { width: 100%; display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; font-size: 15px; text-align: left; }
	.item.static { cursor: default; color: var(--color-text-muted); font-size: 13px; }
	.item.link { cursor: pointer; margin-bottom: 8px; }
	.item.link:hover { background: var(--color-surface); }
	.item.link span { word-break: break-all; }
	.features { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; color: var(--color-text-muted); font-size: 13px; line-height: 1.4; }
	.features li::marker { color: var(--color-primary); }
</style>
