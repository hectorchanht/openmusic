<script lang="ts">
	// Settings → Downloads. Today it holds one control: retro-tagging the offline copies the app
	// still has (36-D-17). Phase 34's "import songs from this device" button joins this page later —
	// this is the home for anything about the FILES, while /settings/playback keeps download QUALITY.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Tags } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { blobStore } from '$lib/services/blob-store';
	import { retagDownloads, type RetagEntry } from '$lib/services/retag';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';

	let msg = $state('');
	let eligible = $state<RetagEntry[]>([]);
	let busy = $state(false);
	let progress = $state<{ done: number; total: number } | null>(null);

	onMount(async () => {
		settings.load();
		library.load();
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
	.muted { color: var(--color-text-muted); font-size: 12px; margin: 0 0 12px; }
	.hint { color: var(--color-text-muted); font-size: 12px; margin: -2px 0 10px 4px; }
	.item { width: 100%; display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; font-size: 15px; cursor: pointer; text-align: left; margin-bottom: 8px; }
	.item:disabled { opacity: 0.5; cursor: default; }
	.flash { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--tabbar-h) + 70px); background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; }
</style>
