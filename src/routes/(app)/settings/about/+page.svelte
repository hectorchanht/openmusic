<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Info, Mail, Code2, Tag } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';

	onMount(() => settings.load());

	const CONTACT = 'hello@openmusic.lol';
	const REPO = 'https://github.com/hectorchanht/openmusic';
	const TAGLIB = 'https://github.com/taglib/taglib';

	// What the app does today (literal — brand/credits text, not part of the translated UI chrome).
	const features = [
		'Search + stream across Netease, QQ, Kuwo, JOOX, 5sing, Jamendo, Audius & YouTube Music — all searched by default, each toggleable in Settings → Playback',
		'Home discovery — Deezer top-hits & top-artists charts plus Last.fm genre & region shelves you can pick, reorder & hide',
		'Tap-to-play that re-resolves the best match across the enabled sources; a failing source quietly hands off to another',
		'Real album & artist art via Deezer → iTunes → CN fallback',
		'Synced lyrics that scroll with the song + per-part translation (artist / title / lyrics) across 15 UI languages',
		'Favorites, playlists, listen history & offline downloads',
		'Sleep timer with a gentle fade-out, background audio & lock-screen controls',
		'Song comments + crowd-sourced cover picks — vote for better artwork',
		'Installable PWA, plus an Android app (same app in a Capacitor shell)',
		// 36-D-01: TagLib is dual-licensed LGPL-2.1 / MPL-1.1 — weak copyleft, so shipping it
		// obliges us to give notice. The npm tarball ships only the MIT wrapper LICENSE and omits
		// TagLib's own COPYING.LGPL/COPYING.MPL, so this line + the licence link below are the notice.
		// We consume the prebuilt wasm unmodified, so there is no contribute-back obligation.
		'Downloaded songs are tagged (title, artist, album, cover, lyrics) via TagLib — compiled to WebAssembly, used unmodified under its LGPL-2.1 / MPL-1.1 dual licence'
	];
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<PageHeader title={t('settings.about')} backLabel={t('settings.backToSettings')} onback={() => goto('/settings')} />

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
	<a class="item link" href={TAGLIB} target="_blank" rel="noopener noreferrer"><Tag size={18} /> <span>TagLib licence (LGPL / MPL)</span></a>
</section>

<style>
	section { margin: 18px 0; }
	section h2 { font-size: 0.95rem; margin: 0 0 8px; color: var(--color-text); }
	.item { width: 100%; display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; font-size: 0.9375rem; text-align: left; }
	.item.static { cursor: default; color: var(--color-text-muted); font-size: 0.8125rem; }
	.item.link { cursor: pointer; margin-bottom: 8px; }
	.item.link:hover { background: var(--color-surface); }
	.item.link span { word-break: break-all; }
	.features { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; color: var(--color-text-muted); font-size: 0.8125rem; line-height: 1.4; }
	.features li::marker { color: var(--color-primary); }
</style>
