<script lang="ts">
	import { onMount, untrack, type Component } from 'svelte';
	import { fly } from 'svelte/transition';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { House, Search, Library, Settings } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { online } from '$lib/stores/online.svelte';
	import { swUpdate } from '$lib/stores/swUpdate.svelte';
	import { LANDING_PATHS } from '$lib/services/home-layout';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { deviceImport } from '$lib/stores/device-import.svelte';
	import { toast } from '$lib/stores/toast.svelte';
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
			if (n.kind === 'corrupt-download') {
				// 31-D-14: the downloaded copy was corrupt — it has been evicted and the song is now
				// streaming. Rendered with the auto-dismissing 'skip' host shape (informational, no
				// Retry): playback did NOT stop, so a sticky pill would overstate it.
				host = { kind: 'skip', text: t('toast.downloadCorrupted') };
				clearSkipTimer();
				skipTimer = setTimeout(() => {
					host = null;
					skipTimer = null;
				}, SKIP_DISMISS_MS);
			} else if (n.kind === 'skip') {
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

	// --- Device-import notice host (34) ------------------------------------------------------
	// The second, much smaller store→UI channel, mirroring the player-notice host above: the store
	// emits a TranslationKey + params, this host localises it. UI-SPEC contract 3 is why it lives
	// here and not on /settings/downloads — a scan keeps running when the user navigates away, so
	// the completion toast must fire from a host that is always mounted.
	//
	// untrack() keeps settings.appLang out of this effect's dependencies (WR-04: t() reads it, and a
	// later language switch would otherwise re-run this against a stale notice), and clearing the
	// channel here is what stops a remount from re-showing a toast the user already saw.
	$effect(() => {
		const n = deviceImport.notice;
		if (!n) return;
		untrack(() => {
			toast.show(t(n.key, n.params));
			deviceImport.notice = null;
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
		// quick-260713-7pi: watch for a new service-worker build and surface a Reload prompt
		// (the .update-bar banner below). No-op on the native build / no-SW browsers.
		const teardownSwUpdate = swUpdate.init();
		return () => {
			teardownOverlays();
			teardownOnline();
			teardownSwUpdate();
		};
	});

	// Store a translation KEY per tab (not the literal) so the nav re-renders when appLang changes.
	//
	// quick-260919-et3 follow-up: `desktopOnly` marks a destination that belongs on the DESKTOP
	// RAIL but not on the phone's bottom bar. It exists because D-2 made the rail and the bottom
	// bar the SAME <nav> — that is the property worth keeping (one navigation definition, keyboard
	// and screen-reader parity for free), so "add Settings to the rail" has to be expressed as a
	// per-item visibility flag rather than a second nav. The mobile bar therefore still renders
	// exactly three tabs: the fourth is display:none below 1024px, which keeps it out of the
	// layout, out of the tab order and out of the accessibility tree — the same mechanism
	// <ShelfChevrons /> already uses. Settings stays reachable on mobile via the home-header gear,
	// which is unchanged; the rail has no header, which is why it needs this.
	// Reuses the existing `home.settings` string (that gear's aria-label) — no new i18n key.
	const tabs: { href: string; labelKey: TranslationKey; icon: Component; desktopOnly?: boolean }[] = [
		{ href: '/', labelKey: 'nav.home', icon: House },
		{ href: '/search', labelKey: 'nav.search', icon: Search },
		{ href: '/library', labelKey: 'nav.library', icon: Library },
		{ href: '/settings', labelKey: 'home.settings', icon: Settings, desktopOnly: true }
	];

</script>

<div class="app">
	<!-- OFFL-03 / D-09: global offline indicator — a thin unobtrusive banner shown whenever the
	     app is offline (driven by the online store). Purely ADDITIVE to the shell; it never forces
	     a navigation or redirect (D-09 — the user is never yanked between tabs). "Don't bloat" (D-10). -->
	{#if !online.isOnline}
		<div class="offline-bar" role="status" aria-live="polite">{t('offline.indicator')}</div>
	{/if}

	<!-- quick-260713-7pi: PWA update prompt. Shown when a new service-worker build is waiting;
	     tapping Reload activates it (SKIP_WAITING) and reloads once. In-flow top banner (mirrors
	     .offline-bar) so it never overlaps the nowbar/tabbar. -->
	{#if swUpdate.updateReady}
		<div class="update-bar" role="status" aria-live="polite">
			<span class="update-msg">{t('update.available')}</span>
			<button type="button" class="update-btn" onclick={() => swUpdate.applyUpdate()} use:tapBounce>
				{t('update.reload')}
			</button>
		</div>
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

	<!-- quick-260919-npfix (Fix 1) — the nav is GATED on the overlay, not merely painted under it.
	     Reported as "tabbar is still visible when now playing page opens", and that is literally what
	     it was: *while it opens*. `.np` is `fixed; inset:0; z-index:50` against the nav's `z-index:21`,
	     so once the overlay is at rest it already covers the bottom bar AND the >=1024px rail
	     completely (measured: elementFromPoint(44,450) with the sheet open is inside `.np`). What was
	     NOT covered is the 320ms `transition:fly={{y:600}}` mount — Svelte's `fly` animates opacity
	     0->1 as well as the offset, so for the whole open animation the overlay is BOTH translated
	     down and semi-transparent and the nav shows straight through it (captured at t=90ms: the
	     rail's Home/Search/Library/Settings column is fully legible beside the rising sheet).
	     That is why the two obvious "fixes" are both wrong here and are deliberately NOT applied:
	     bumping z-index changes nothing (50 already beats 21), and forcing the sheet to `full` changes
	     nothing either (the snap machine is healthy — `closed` is the correct landing state for a
	     Nowbar tap, and `.np` is full-viewport in every sheet state). Occlusion cannot fix a window in
	     which the occluder is transparent; only absence can. YouTube Music's keep-the-rail desktop
	     layout is a legitimate design, but the user is reporting the leak as a bug and wants the
	     overlay to own the viewport, so honour that — on BOTH layouts, since the bottom bar leaks
	     through the same translucent window at 375px.
	     Same `{#if !player.expanded}` idiom as <Nowbar /> six lines up, so open/close symmetry is
	     already the established behaviour here; it also drops the nav out of the tab order and the
	     accessibility tree while NowPlaying's focusTrap is active, which is what a modal overlay
	     wants anyway. -->
	{#if !player.expanded}
	<nav class="tabbar">
		{#each tabs as tab (tab.href)}
			{@const Icon = tab.icon}
			<!-- Exact match, plus a subpath match so the rail's Settings tab stays lit on
			     /settings/general etc. Provably inert for the three mobile tabs: '/' can never
			     match '//', and /search and /library have no child routes. -->
			{@const active = page.url.pathname === tab.href || page.url.pathname.startsWith(tab.href + '/')}
			<!-- quick-260611-fr9: active route's tab icon is FILLED, others OUTLINE. Lucide is
			     outline-only, so we use the established `fill` prop idiom (cf. NowPlaying Heart).
			     stroke-width is nudged down on the active (filled) glyph so it doesn't read heavy. -->
			<!-- quick-260919-et3 (D-4): aria-current marks the active destination for assistive tech.
			     One attribute, no new strings, no visual change — and it improves the announcement on
			     mobile too, which is why it is the one delta this task makes outside a media query. -->
			<a
				class="tab"
				class:active
				class:desktop-only={tab.desktopOnly}
				href={tab.href}
				aria-current={active ? 'page' : undefined}
				use:tapBounce
			>
				<span class="ic"><Icon size={20} fill={active ? 'currentColor' : 'none'} strokeWidth={active ? 1.5 : 2} /></span>{t(tab.labelKey)}
			</a>
		{/each}
	</nav>
	{/if}
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
	/* quick-260919-et3 follow-up — THE ONE RULE THIS TASK PUTS OUTSIDE THE DESKTOP MEDIA QUERY,
	   and the rule that makes the fourth tab free on mobile: display:none means Settings is not
	   rendered as a box, not focusable and not in the accessibility tree below 1024px, so the
	   bottom bar is still the same three tabs it has always been. It is switched back on in the
	   desktop block, which keeps CSS the single source of truth for the breakpoint — same
	   mechanism as <ShelfChevrons />. It cannot affect any existing tab: nothing else carries
	   the class. */
	.tab.desktop-only { display: none; }

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

	/* quick-260713-7pi: PWA update banner — same in-flow top-banner idiom as .offline-bar, but
	   actionable (a Reload button). Accent-tinted so it reads as an offer, not an error. */
	.update-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		flex-wrap: wrap;
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text);
		background: var(--color-surface-2);
		border-bottom: 1px solid var(--color-border);
		padding: calc(env(safe-area-inset-top, 0px) + 6px) 12px 6px;
	}
	.update-msg { min-width: 0; }
	.update-btn {
		flex: none;
		background: var(--color-primary, #7c5cff);
		color: #fff;
		border: none;
		border-radius: 999px;
		padding: 4px 14px;
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
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

	/* ---- quick-260919-et3: the DESKTOP layout ------------------------------------------------
	   Everything desktop lives inside this one media block and NOTHING above it was modified, so
	   the mobile cascade is provably untouched — the only mobile-visible delta in this whole task
	   is the additive `aria-current` attribute on the active tab.

	   D-5 — `.content` is 1920px at >=1024, not unlimited. Every laptop (1440/1512/1728) therefore
	   fills edge to edge, which is the ask, while a 3440px ultrawide does not stretch a CompactRow
	   to 3400px (that reads as broken, not generous).
	   ponytail: hard cap. Revisit only if someone actually runs this on an ultrawide. */
	@media (min-width: 1024px) {
		.content {
			max-width: 1920px;
			padding: 0 24px;
		}

		/* D-2 — the rail IS the bottom tab bar. Same `<nav>`, same `<a>` children, same `tabs`
		   array above (still the only navigation definition in the codebase): a second nav
		   component would be a second source of truth, and the cheapest way to guarantee there
		   isn't one is to not create a second DOM node. Keyboard and screen-reader parity is
		   therefore structural, not something we had to re-implement — it is literally the same
		   navigation landmark with the same anchors in the same order.
		   D-9 — no transition between the two layouts: this is a viewport-size restyle, not a
		   state change, so there is no animation for `prefers-reduced-motion` to gate. */
		.app {
			/* The bar no longer occupies bottom space; the rail occupies left space. Only the
			   nowbar remains docked at the bottom. */
			padding-left: var(--rail-w);
			padding-bottom: var(--nowbar-h);
		}
		.tabbar {
			top: 0;
			bottom: 0;
			right: auto;
			/* quick-260919-et3 — MUST cancel the mobile `height: var(--tabbar-h)`. With top, bottom AND
			   height all set on a fixed element the box is over-constrained and `height` wins, so the
			   rail resolved to a 56px stub: the tabs still PAINTED (overflow is visible) but the
			   background and the border-right divider covered only the top 56px, and the nav's own box
			   stopped above two of its three tabs. `auto` lets top/bottom drive the full height. */
			height: auto;
			width: var(--rail-w);
			flex-direction: column;
			justify-content: flex-start;
			gap: 4px;
			border-top: none;
			border-right: 1px solid var(--color-border);
			/* Re-stated deliberately: the mobile rule's env(safe-area-inset-bottom) is meaningless
			   on a full-height rail (there is no home indicator along the left edge). */
			padding: 16px 8px 8px;
		}
		.tab.desktop-only {
			display: flex;
		}
		.tab {
			/* flex:1 MUST be cancelled here or the tabs stretch to fill 100dvh. */
			flex: none;
			width: 100%;
			font-size: 11px;
			gap: 4px;
			padding: 10px 0;
			border-radius: 10px;
		}
	}

	/* Pointer devices only — an iPad in landscape is >=1024px and would otherwise latch a sticky
	   hover on the last-tapped tab. House style is a separate `@media (hover: hover)` block. */
	@media (min-width: 1024px) and (hover: hover) {
		.tab:hover {
			color: var(--color-text);
			background: var(--color-surface-2);
		}
	}
</style>
