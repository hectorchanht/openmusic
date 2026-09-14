<script lang="ts">
	// Settings → Downloads. The home for anything about the FILES (/settings/playback keeps download
	// QUALITY). Two controls now share it:
	//   1. Device import (34) — scan this phone's Music/Download folders and list what is found.
	//   2. Retag (36-D-17)    — retro-tag the offline copies the app still holds.
	// Import is NATIVE-ONLY; retag works on the web build too, so the import block is the only thing
	// behind the native gate and the retag section below stays outside it.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Capacitor } from '@capacitor/core';
	import {
		ChevronLeft,
		Tags,
		HardDriveDownload,
		Smartphone,
		CircleAlert,
		Check,
		FolderSearch,
		SlidersHorizontal
	} from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { blobStore } from '$lib/services/blob-store';
	import { retagDownloads, type RetagEntry } from '$lib/services/retag';
	import { deviceImport } from '$lib/stores/device-import.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';

	let msg = $state('');
	let eligible = $state<RetagEntry[]>([]);
	let busy = $state(false);
	let progress = $state<{ done: number; total: number } | null>(null);

	// 34-UI-SPEC contract 7: the FIRST UI-layer native gate in the app (every other isNativePlatform
	// call lives in $lib/services/* or the player). Read in onMount rather than at module scope so it
	// stays inside the browser-guard discipline, and kept to this page body — the settings-index row
	// is NOT gated, because the retag control below works on web and the row leads to it.
	let native = $state(false);

	// Progress is read from the STORE, never from page-local state: navigating away must not cancel
	// the scan and coming back must re-attach to it (contract 3).
	const scanning = $derived(deviceImport.phase === 'requesting' || deviceImport.phase === 'scanning');
	const pct = $derived(
		deviceImport.total > 0 ? Math.min(100, Math.round((deviceImport.done / deviceImport.total) * 100)) : 0
	);
	const s = $derived(deviceImport.summary);

	onMount(async () => {
		settings.load();
		library.load();
		deviceImport.load();
		native = Capacitor.isNativePlatform();
		// 36-D-18: the scope is the app's OWN downloads it STILL HOLDS A COPY OF — never a device-wide
		// sweep. `library.downloads` is the reference list (a row survives a failed/cancelled save), so
		// `blobStore.has` is what makes the count honest. Sequential because the list is small and
		// `has` is a cheap index/stat probe, not a read.
		const out: RetagEntry[] = [];
		for (const d of library.downloads) {
			if (!d?.uid) continue;
			if (!(await blobStore.has(d.uid))) continue;
			// The display-name translation happens HERE, not in retag.ts — the service stays store-free,
			// and the tag and the filename it writes then agree with what the user sees in the app.
			out.push({
				uid: d.uid,
				title: names.dnTitle(d.title),
				artist: names.dnArtist(d.artist),
				album: d.album,
				cover: d.cover
			});
		}
		eligible = out;
	});

	function flash(m: string) { msg = m; setTimeout(() => (msg = ''), 2600); }

	// 36-D-17: opt-in ONLY. This runs from a tap, after a confirm naming the count, and from nowhere
	// else — no onMount call, no $effect, no background pass. Retag rewrites files the user already
	// has, so it never happens without them asking for it.
	// 36-D-19: the per-file isolation lives in retag.ts; this page only reports what came back, and
	// the report is the truth (tagged vs skipped), not an optimistic "done".
	async function retag() {
		if (busy) return;
		if (eligible.length === 0) { flash(t('settings.retagNone')); return; }
		if (!confirm(t('settings.retagConfirm', { count: eligible.length }))) return;
		busy = true;
		try {
			const r = await retagDownloads(eligible, (done, total) => (progress = { done, total }));
			flash(t('settings.retagDone', { tagged: r.tagged, total: r.total, skipped: r.total - r.tagged }));
		} finally {
			busy = false;
			progress = null;
		}
	}
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')} use:tapBounce><ChevronLeft size={22} /></button>
	<h1>{t('settings.groupDownloads')}</h1>
</header>

<section>
	<h2><HardDriveDownload size={15} /> {t('import.heading')}</h2>
	{#if !native}
		<!-- Contract 7: one honest line on the web build. No disabled button, no "coming soon". -->
		<p class="muted">{t('import.webOnly')}</p>
	{:else}
		<!-- CTA SLOT: the button is REPLACED IN PLACE while scanning, same footprint, so nothing
		     below it reflows (contract 3). -->
		{#if scanning}
			<div
				class="cta busy"
				aria-busy="true"
				role="progressbar"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={deviceImport.total > 0 ? pct : undefined}
				aria-valuetext={deviceImport.total > 0 ? undefined : t('import.scanning')}
			>
				<!-- quick-260809-mvz: `.motion-always` on the indeterminate sliver — the global
				     `:root[data-reduce-motion] * { animation: none }` rule would otherwise freeze it,
				     and a frozen progress indicator reads as a hung app. The determinate fill has no
				     such exemption; losing its width transition is harmless. -->
				<div class="rail" class:indet={deviceImport.total === 0}>
					<i
						class="fill"
						class:sliver={deviceImport.total === 0}
						class:motion-always={deviceImport.total === 0}
						style:width={deviceImport.total > 0 ? `${pct}%` : undefined}
					></i>
				</div>
				<span class="lbl-prog">
					{deviceImport.total > 0
						? t('import.scanProgress', {
								done: deviceImport.done.toLocaleString(),
								total: deviceImport.total.toLocaleString()
							})
						: t('import.scanning')}
				</span>
				<button class="chip cancel" onclick={() => deviceImport.cancel()} use:tapBounce aria-label={t('import.cancel')}>{t('import.cancel')}</button>
			</div>
		{:else}
			<button class="cta" onclick={() => deviceImport.runImport()} use:tapBounce>
				<Smartphone size={18} aria-hidden="true" /> {t('import.cta')}
			</button>
		{/if}
		<p class="muted">{t('import.ctaNote')}</p>

		<!-- RESULT SLOT: exactly ONE of permission / empty / summary renders (contracts 3/4/7). The
		     CTA stays tappable in BOTH denied states — a dead control is worse than a re-prompt. -->
		{#if deviceImport.permission === 'denied-permanently'}
			<p class="hint perm"><CircleAlert size={14} aria-hidden="true" /> {t('import.permBlocked')}</p>
		{:else if deviceImport.permission === 'denied'}
			<p class="hint perm"><CircleAlert size={14} aria-hidden="true" /> {t('import.permDenied')}</p>
		{:else if s && !scanning}
			{#if s.added === 0 && s.relinked === 0 && s.removed === 0 && s.complete}
				<div class="empty-block">
					<FolderSearch size={20} aria-hidden="true" />
					<strong>{t('import.none')}</strong>
					<span class="hint">{t('import.noneBody')}</span>
				</div>
			{:else}
				<!-- Contract 4: a ZERO-count category renders NOTHING. A column of "0 skipped" lines
				     buries the one line that matters. A cancelled run has no separate flag — it is
				     `complete: false` plus whatever was added before it stopped. -->
				<div class="summary">
					<strong>
						<Check size={16} aria-hidden="true" />
						{s.complete ? t('import.summaryAdded', { count: s.added }) : t('import.summaryCancelled', { count: s.added })}
					</strong>
					{#if s.relinked > 0}<span class="hint">{t('import.summaryRelinked', { count: s.relinked })}</span>{/if}
					{#if s.already > 0}<span class="hint">{t('import.skipAlready', { count: s.already })}</span>{/if}
					{#if s.skippedShort > 0}<span class="hint">{t('import.skipTooShort', { count: s.skippedShort, seconds: s.minSeconds })}</span>{/if}
					{#if s.skippedExt > 0}<span class="hint">{t('import.skipExtension', { count: s.skippedExt })}</span>{/if}
					{#if s.skippedRule > 0}<span class="hint">{t('import.skipRule', { count: s.skippedRule })}</span>{/if}
					<!-- Last, and the only line in the error colour: it is the only one describing a loss. -->
					{#if s.removed > 0}<span class="hint removed">{t('import.summaryRemoved', { count: s.removed })}</span>{/if}
				</div>
			{/if}
		{/if}
	{/if}
</section>

{#if native}
	<!-- Contract 2: the rules are a COLLAPSED accordion below the CTA, never a sub-page and never an
	     inline wall — D-14 says the defaults must already work, so the config must not be in the way.
	     Open state is deliberately NOT persisted; every visit starts collapsed. -->
	<details class="advanced">
		<summary use:tapBounce><SlidersHorizontal size={15} aria-hidden="true" /> {t('import.rules')}</summary>
	</details>
{/if}

<section>
	<h2><Tags size={15} /> {t('settings.groupDownloads')}</h2>
	<button class="item" onclick={retag} disabled={busy || eligible.length === 0} use:tapBounce>
		<Tags size={18} /> {t('settings.retagDownloads', { count: eligible.length })}
	</button>
	<p class="hint">{t('settings.retagDownloadsDesc')}</p>
	{#if progress}<p class="muted">{t('settings.retagProgress', { done: progress.done, total: progress.total })}</p>{/if}
</section>

{#if msg}<p class="flash">{msg}</p>{/if}

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 10px; }
	.muted { color: var(--color-text-muted); font-size: 12px; margin: 8px 0 0; }
	.hint { color: var(--color-text-muted); font-size: 12px; margin: -2px 0 10px 4px; }
	.item { width: 100%; display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; font-size: 15px; cursor: pointer; text-align: left; margin-bottom: 8px; }
	.item:disabled { opacity: 0.5; cursor: default; }
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.advanced { margin: 22px 0; padding: 10px 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; }
	.advanced summary { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); cursor: pointer; padding: 4px 0; min-height: 44px; }
	.flash { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--tabbar-h) + 70px); background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; }

	/* Contract 3/4 + UI-SPEC Color: the import CTA is this page's single accent-filled action. */
	.cta { width: 100%; min-height: 48px; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--color-primary); color: #fff; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; }
	.cta:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
	.cta.busy { background: var(--color-surface-2); color: var(--color-text); border: 1px solid var(--color-border); justify-content: space-between; padding: 0 8px 0 14px; gap: 12px; font-weight: 400; }
	.lbl-prog { font-size: 13px; color: var(--color-text-muted); white-space: nowrap; }
	.rail { flex: 1; height: 6px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 999px; overflow: hidden; position: relative; }
	.rail .fill { display: block; height: 100%; background: var(--color-primary); border-radius: 999px; transition: width 0.25s linear; }
	.rail.indet .fill.sliver { width: 35%; transition: none; animation: np-indet 1.1s ease-in-out infinite; }
	@keyframes np-indet {
		0% { transform: translateX(-110%); }
		100% { transform: translateX(310%); }
	}
	.chip.cancel { min-height: 44px; min-width: 44px; color: var(--color-text-muted); }
	.hint.perm { display: flex; gap: 6px; align-items: flex-start; color: var(--color-text-muted); font-size: 12px; margin: 8px 0; }
	.summary, .empty-block { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; padding: 14px; margin: 12px 0; display: flex; flex-direction: column; gap: 6px; }
	.summary strong { font-size: 15px; font-weight: 600; display: flex; gap: 6px; align-items: center; }
	.summary .hint { font-size: 12px; color: var(--color-text-muted); margin: 0; }
	.summary .hint.removed { color: #ff7a90; }
	.empty-block { align-items: center; text-align: center; color: var(--color-text-muted); }
	.empty-block .hint { margin: 0; }
</style>
