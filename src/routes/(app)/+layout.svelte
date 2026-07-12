<script lang="ts">
	import { onMount, untrack, type Component } from 'svelte';
	import { fly } from 'svelte/transition';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { House, Search, Library } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { online } from '$lib/stores/online.svelte';
	import { LANDING_PATHS } from '$lib/services/home-layout';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { t, type TranslationKey } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import NowPlaying from '$lib/components/NowPlaying.svelte';
	import Nowbar from '$lib/components/Nowbar.svelte';
	import SleepTimerSheet from '$lib/components/SleepTimerSheet.svelte';
	import ToastHost from '$lib/components/ToastHost.svelte';

	let { children } = $props();

	// --- Never-stop feedback toast host (PLAY-07 / PLAY-08) ---------------------------------
	// One-way reactive read of `player.notice` (the store→UI channel defined in 16-02), mirroring
	// the `player.error → Nowbar` convention: the host READS the store and INVOKES the store-
	// provided `notice.action`; it never mutates store internals.
	//
	// - kind 'skip'    (D-02/D-03): brief AUTO-DISMISSING pill, NO action button. Bursts replace
	//                  rather than stack — a single `notice` channel + a cleared timer collapse
	//                  rapid skips into one toast that updates its count.
	// - kind 'stopped' (D-04/D-05/D-08): PERSISTENT pill (no auto-dismiss timer). The loop-guard
	//                  variant (reason 'loop-guard') carries a Retry button wired to notice.action
	//                  (the store's recoverFromStop — skip ahead + reset + re-arm). The offline
	//                  variant (reason 'offline') has no action, so no button is shown.
	// Successful same-source failover is SILENT by design (D-01): 16-02 emits NO notice for it, so
	// this host naturally shows nothing — there is intentionally no branch for it here.
	//
	// `host` is a local snapshot so the fly-out transition still plays after the store clears
	// `notice` (e.g. a real `playing` event resets a 'stopped' notice to null).
	type HostToast = { kind: 'skip' | 'stopped'; text: string; action?: () => void };
	let host = $state<HostToast | null>(null);
	let skipTimer: ReturnType<typeof setTimeout> | null = null;
	const SKIP_DISMISS_MS = 2500;

	function clearSkipTimer() {
		if (skipTimer) {
			clearTimeout(skipTimer);
			skipTimer = null;
		}
	}

	$effect(() => {
		const n = player.notice;
		if (!n) {
			// Store cleared the channel (success reset / recovery / skip-window close) — dismiss any
			// toast still on screen.
			clearSkipTimer();
			host = null;
			return;
		}
		// WR-04: compute the localized text inside untrack() so the ONLY reactive dependency of this
		// effect is `player.notice` (read above, tracked). t() reads settings.appLang ($state); if it
		// were tracked here, a later language switch would re-run this effect against a stale notice
		// and re-show a dismissed toast (with a fresh timer) out of nowhere. untrack() severs that
		// hidden dependency — the store now also clears 'skip' notices when its window closes, so the
		// two together close the resurrection bug at the source and in the host.
		untrack(() => {
			if (n.kind === 'skip') {
				// D-02: count is always ≥ 1; >1 collapses into the batched "{n} songs skipped" wording.
				const text =
					(n.count ?? 1) > 1
						? t('toast.skippedMany', { count: n.count ?? 1 })
						: t('toast.skipped', { title: n.title ?? '' });
				host = { kind: 'skip', text };
				// Auto-dismiss; restart the timer on every new skip so a burst replaces, not stacks.
				clearSkipTimer();
				skipTimer = setTimeout(() => {
					host = null;
					skipTimer = null;
				}, SKIP_DISMISS_MS);
			} else {
				// kind 'stopped' — PERSISTENT (no auto-dismiss timer). offline vs loop-guard wording.
				clearSkipTimer();
				const text =
					n.reason === 'offline' ? t('toast.offlineNoDownloads') : t('toast.playbackStopped');
				// Retry only when the store provides a recovery action (loop-guard); offline has none.
				host = { kind: 'stopped', text, action: n.action };
			}
		});
	});

	function onRetry() {
		// Invoke the store-provided recovery (D-05) then clear the local host so the pill leaves.
		host?.action?.();
		host = null;
	}

	onMount(() => {
		library.load();
		settings.load();

		// quick-260712-et3: warm the offline zh-Hans→zh-Hant s2t dict at boot when the user's
		// content target is Traditional, so display names convert synchronously on their first
		// render instead of painting Simplified and flipping to Traditional (the marquee flash).
		// No-op for non-Traditional targets — keeps the ~72 KB dict out of non-Hant paths (D-03).
		names.warm();

		// w87: default landing-tab redirect. onMount is client-only (SSR-safe) and runs ONCE,
		// so a later manual nav back to '/' never re-triggers. Guards (all must hold):
		//  - path is EXACTLY '/' (don't hijack a deep route),
		//  - NO ?play= token present (don't break a shared deep link — the home page's own
		//    onMount still receives + plays it),
		//  - the chosen landing tab is not 'home' (else there's nothing to redirect).
		// The target is taken from the fixed LANDING_PATHS record, never the raw stored string
		// (T-w87-05 — no open-redirect). replaceState so Back doesn't bounce to '/'.
		if (
			location.pathname === '/' &&
			!new URLSearchParams(location.search).get('play') &&
			settings.homeLandingTab !== 'home'
		) {
			// CR-01 defense-in-depth: only redirect when the lookup resolves to a real path.
			// goto(undefined) would resolve to the relative "undefined" → 404 with replaceState.
			const dest = LANDING_PATHS[settings.homeLandingTab];
			if (dest && dest !== '/') goto(dest, { replaceState: true });
		}

		// Single back-gesture popstate listener for the whole app (overlays back-to-close).
		const teardownOverlays = overlays.init();
		// OFFL-03: attach the online/offline listeners ONCE for the app shell so every surface
		// (and the global indicator below) reads a live online.isOnline. init() is a no-op under
		// SSR and returns a teardown that removes the window listeners on destroy.
		const teardownOnline = online.init();
		return () => {
			teardownOverlays();
			teardownOnline();
		};
	});

	// Store a translation KEY per tab (not the literal) so the nav re-renders when appLang changes.
	const tabs: { href: string; labelKey: TranslationKey; icon: Component }[] = [
		{ href: '/', labelKey: 'nav.home', icon: House },
		{ href: '/search', labelKey: 'nav.search', icon: Search },
		{ href: '/library', labelKey: 'nav.library', icon: Library }
	];

</script>

<div class="app">
	<!-- OFFL-03 / D-09: global offline indicator — a thin unobtrusive banner shown whenever the
	     app is offline (driven by the online store). Purely ADDITIVE to the shell; it never forces
	     a navigation or redirect (D-09 — the user is never yanked between tabs). "Don't bloat" (D-10). -->
	{#if !online.isOnline}
		<div class="offline-bar" role="status" aria-live="polite">{t('offline.indicator')}</div>
	{/if}

	<main class="content">
		{@render children()}
	</main>

	<!-- Never-stop feedback toast host: skip toasts auto-dismiss + batch; the loop-guard/offline
	     notice is sticky, and the loop-guard variant carries a Retry button (D-04/D-05). Sits above
	     the nowbar (z:20) and tabbar (z:21). -->
	{#if host}
		<div
			class="notice-toast"
			class:sticky={host.kind === 'stopped'}
			transition:fly={{ y: -20, duration: 180 }}
		>
			<span class="msg">{host.text}</span>
			{#if host.kind === 'stopped' && host.action}
				<button type="button" class="retry" onclick={onRetry} use:tapBounce>{t('toast.retry')}</button>
			{/if}
		</div>
	{/if}

	{#if !player.expanded}
		<Nowbar />
	{/if}

	{#if player.expanded}
		<NowPlaying />
	{/if}

	<!-- Sleep-timer sheet: mounted ONCE, UNGATED — reachable from the nowbar (collapsed) AND the
	     expanded now-playing. Driven by the shared sleepTimer.sheetOpen flag (TIMER-01). -->
	<SleepTimerSheet />

	<!-- Single global toast host (D-15): mounted ONCE here so every page shares it. Pages call
	     toast.show(msg); this is the only place the message is rendered. -->
	<ToastHost />

	<nav class="tabbar">
		{#each tabs as tab (tab.href)}
			{@const Icon = tab.icon}
			{@const active = page.url.pathname === tab.href}
			<!-- quick-260611-fr9: active route's tab icon is FILLED, others OUTLINE. Lucide is
			     outline-only, so we use the established `fill` prop idiom (cf. NowPlaying Heart).
			     stroke-width is nudged down on the active (filled) glyph so it doesn't read heavy. -->
			<a class="tab" class:active href={tab.href} use:tapBounce>
				<span class="ic"><Icon size={20} fill={active ? 'currentColor' : 'none'} strokeWidth={active ? 1.5 : 2} /></span>{t(tab.labelKey)}
			</a>
		{/each}
	</nav>
	<!-- audio element lives in the ROOT layout (persists across navigation) -->
</div>

<style>
	.app {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		/* background: radial-gradient(120% 55% at 50% 0%, #1a1326 0%, var(--color-bg) 55%); */
		padding-bottom: calc(var(--nowbar-h) + var(--tabbar-h));
		/* Horizontal-overflow backstop. A page-internal widget that grows wider than the
		   viewport (flex child without min-width:0, abs-positioned overflow, etc.) was
		   making /search bidirectionally scrollable on narrow mobile widths. `overflow-x:
		   clip` blocks horizontal scroll on the shell without affecting fixed/sticky
		   descendants (unlike `hidden`, which would create a containing block for them
		   and break the docked .nowbar). */
		overflow-x: clip;
	}
	.content {
		flex: 1;
		max-width: 720px;
		width: 100%;
		margin: 0 auto;
		padding: 0 16px;
	}
	.tabbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		height: var(--tabbar-h);
		display: flex;
		justify-content: space-around;
		align-items: center;
		background: var(--color-bg);
		border-top: 1px solid var(--color-border);
		padding-bottom: env(safe-area-inset-bottom);
		z-index: 21;
		padding: 8px;
	}
	.tab {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		font-size: 10px;
		color: var(--color-text-muted);
		transition: color 0.15s ease;
	}
	.tab .ic { display: grid; place-items: center; }
	.tab.active { color: var(--color-text); }

	/* OFFL-03 global offline indicator: a thin, unobtrusive top banner. Sits in normal flow
	   above the page content (no fixed positioning — keeps it simple, never overlaps the nowbar
	   or tabbar). Muted/dark so it reads as a status hint, not an error. */
	.offline-bar {
		text-align: center;
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text-muted);
		background: var(--color-surface-2);
		border-bottom: 1px solid var(--color-border);
		padding: calc(env(safe-area-inset-top, 0px) + 6px) 12px 6px;
	}

	/* Never-stop feedback pill. Mirrors the +page.svelte .toast shape (fixed top, pill, dark
	   backdrop) but layout-level + z above the nowbar (z:20) / tabbar (z:21). The sticky variant
	   uses a row so the message and Retry button sit side by side; it wraps on narrow widths. */
	.notice-toast {
		position: fixed;
		left: 50%;
		transform: translateX(-50%);
		top: calc(env(safe-area-inset-top, 0px) + 14px);
		z-index: 90;
		max-width: min(92vw, 520px);
		display: flex;
		align-items: center;
		gap: 12px;
		background: #000;
		color: #fff;
		padding: 10px 16px;
		border-radius: 999px;
		font-size: 13px;
		box-shadow: var(--shadow-lg);
	}
	.notice-toast.sticky {
		flex-wrap: wrap;
		justify-content: center;
		text-align: center;
	}
	.notice-toast .msg {
		min-width: 0;
	}
	.notice-toast .retry {
		flex: none;
		background: var(--color-primary, #7c5cff);
		color: #fff;
		border: none;
		border-radius: 999px;
		padding: 5px 14px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
</style>
