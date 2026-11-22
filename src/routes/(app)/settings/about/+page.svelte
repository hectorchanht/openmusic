<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Info, Mail, Code2, Tag, Coffee, Sparkles, ShieldCheck, RotateCcw } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { PSEUDO_ANALYTICS_LIVE } from '$lib/config/pseudo-analytics';
	import { resetPseudoId } from '$lib/pseudo-id';
	import { toast } from '$lib/stores/toast.svelte';

	onMount(() => settings.load());

	const CONTACT = 'hello@openmusic.lol';
	const REPO = 'https://github.com/hectorchanht/openmusic';
	const TAGLIB = 'https://github.com/taglib/taglib';
	const TIPJAR = 'https://dawnlimited.gumroad.com/l/openmusic-tip';

	// App version baked at build time (VITE_APP_VERSION from CI); 'dev' locally.
	const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';

	// What the app does today (literal — brand/credits text, not part of the translated UI chrome).
	const features = [
		'Search + stream across Netease, QQ, Kuwo, Kugou, Migu, JOOX, 5sing, Bilibili, Jamendo, Audius, Internet Archive, YouTube Music & Bandcamp — plus independent second pipes for Netease (GD音乐台) and Kuwo （溯音）; all searched by default, each toggleable in Settings → Playback',
		'Home discovery — Deezer top-hits & top-artists charts plus Last.fm genre & region shelves you can pick, reorder & hide',
		'Tap-to-play that re-resolves the best match across the enabled sources; a failing source quietly hands off to another',
		'Real album & artist art via Deezer → iTunes → CN fallback',
		'Synced lyrics that scroll with the song + per-part translation (artist / title / lyrics) across 15 UI languages',
		'Favorites, playlists, listen history & offline downloads',
		'Sleep timer with a gentle fade-out, background audio & lock-screen controls',
		'Song comments + crowd-sourced cover picks — vote for better artwork',
		// quick-261118-datadoctrine: the data promise, stated where users can read it.
		// quick-261122-pseudo: once PSEUDO_ANALYTICS_LIVE flips, the totals-only line is WITHDRAWN
		// (it would be false) and the Privacy section below states the pseudonymous promise instead.
		...(PSEUDO_ANALYTICS_LIVE
			? []
			: [
					'Data promise — your data is used only to make this app better. Never sold. We don\'t track individual users: analytics are anonymous totals only (plays, likes & downloads counted per song per day), with no user IDs, no IP addresses and no device fingerprints'
				]),
		'Installable PWA, plus an Android app (same app in a Capacitor shell)',
		// 36-D-01: TagLib is dual-licensed LGPL-2.1 / MPL-1.1 — weak copyleft, so shipping it
		// obliges us to give notice. The npm tarball ships only the MIT wrapper LICENSE and omits
		// TagLib's own COPYING.LGPL/COPYING.MPL, so this line + the licence link below are the notice.
		// We consume the prebuilt wasm unmodified, so there is no contribute-back obligation.
		'Downloaded songs are tagged (title, artist, album, cover, lyrics) via TagLib — compiled to WebAssembly, used unmodified under its LGPL-2.1 / MPL-1.1 dual licence'
	];

	// quick-261122-pseudo: "Reset my anonymous ID". The UI says plainly what happens — this
	// device is counted as a NEW user from now on (acceptance: "the UI says so plainly").
	let resetDone = $state(false);
	function onResetId() {
		resetPseudoId();
		resetDone = true;
		toast.show(t('privacy.resetDone'));
	}
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<PageHeader title={t('settings.about')} backLabel={t('settings.backToSettings')} onback={() => goto('/settings')} />

<section>
	<div class="item static"><Info size={18} /> {t('settings.aboutLine')}</div>
	<div class="item static version"><Tag size={18} /> v{APP_VERSION}</div>
</section>

<section>
	<h2>What's inside</h2>
	<ul class="features">
		{#each features as f (f)}<li>{f}</li>{/each}
	</ul>
</section>

{#if PSEUDO_ANALYTICS_LIVE}
	<section data-section="privacy">
		<h2>{t('privacy.title')}</h2>
		<p class="promise"><ShieldCheck size={16} /> <span>{t('free.dataPromisePseudo')}</span></p>
		<p class="note">{t('privacy.collected')}</p>
		<button type="button" class="item link" onclick={onResetId} use:tapBounce><RotateCcw size={18} /> <span>{t('privacy.resetId')}</span></button>
		<p class="note" aria-live="polite">{resetDone ? t('privacy.resetDone') : t('privacy.resetIdHint')}</p>
	</section>
{/if}

<section>
	<a class="item link" href="mailto:{CONTACT}"><Mail size={18} /> <span>{CONTACT}</span></a>
	<a class="item link" href={REPO} target="_blank" rel="noopener noreferrer"><Code2 size={18} /> <span>Source code on GitHub</span></a>
	<a class="item link" href={TAGLIB} target="_blank" rel="noopener noreferrer"><Tag size={18} /> <span>TagLib licence (LGPL / MPL)</span></a>
	<!-- quick-261118-free: the /free manifesto page, beside the other about links. -->
	<a class="item link" href="/free"><Sparkles size={18} /> <span>{t('free.footerLink')}</span></a>
	<a class="item link" href="https://dawnstudio.app/#manifesto" target="_blank" rel="noopener noreferrer"><Sparkles size={18} /> <span>{t('settings.whyFree')}</span></a>
	<a class="item link" href={TIPJAR} target="_blank" rel="noopener noreferrer"><Coffee size={18} /> <span>☕ Tip jar</span></a>
</section>

<style>
	section { margin: 18px 0; }
	section h2 { font-size: 0.95rem; margin: 0 0 8px; color: var(--color-text); }
	.item { width: 100%; display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; font-size: 0.9375rem; text-align: start; }
	.item.static { cursor: default; color: var(--color-text-muted); font-size: 0.8125rem; }
	.item.version { font-variant-numeric: tabular-nums; }
	.item.link { cursor: pointer; margin-bottom: 8px; }
	.item.link:hover { background: var(--color-surface); }
	.item.link span { word-break: break-all; }
	.features { margin: 0; padding-inline-start: 18px; display: flex; flex-direction: column; gap: 6px; color: var(--color-text-muted); font-size: 0.8125rem; line-height: 1.4; }
	.promise { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 8px; color: var(--color-text); font-size: 0.8125rem; line-height: 1.45; }
	.promise :global(svg) { flex: none; margin-top: 2px; color: var(--color-primary); }
	.note { margin: 0 0 10px; color: var(--color-text-muted); font-size: 0.75rem; line-height: 1.45; }
	.features li::marker { color: var(--color-primary); }
</style>
