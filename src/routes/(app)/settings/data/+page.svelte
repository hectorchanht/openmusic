<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Trash2, RefreshCw, Languages, Image, Search, SlidersHorizontal, Download, Upload, Undo2 } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { clearCoverCache } from '$lib/services/cover-cache';
	import { SEARCH_HISTORY_KEY } from '$lib/search/search-history-logic';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';
	import { applyEnvelope, backupFilename, buildEnvelope, hasUndoSnapshot, serializeEnvelope, storageKeys, undoImport, validateEnvelope } from '$lib/backup/backup-logic';
	import { exportBackup } from '$lib/services/backup-io';

	const TOP_PICKS_KEY = 'openmusic:top-picks:v1';
	const HOME_LIBRARY_KEY = 'openmusic:home-library:v1';
	let msg = $state('');
	let counts = $state({ liked: 0, playlists: 0, downloads: 0 });
	let canUndo = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	onMount(() => {
		settings.load();
		library.load();
		counts = { liked: library.liked.length, playlists: library.playlists.length, downloads: library.downloads.length };
		// 35-D-09: the rollback snapshot lives in sessionStorage — it survives the full 35-D-13 reload, has
		// its own quota (the live keys already fill ~740 KB of a ~5 MB origin budget shared with the
		// cover cache) and expires with the tab. Unverified on the Capacitor WebView: if Undo never
		// appears after the reload on the APK (plan 05 checkpoint), pass localStorage here and at the
		// two call sites below plus a snapshot.length > 2_000_000 pre-check. That is the whole swap.
		try { canUndo = hasUndoSnapshot(sessionStorage); } catch { /* */ }
	});

	function flash(m: string) { msg = m; setTimeout(() => (msg = ''), 1800); }

	// 35-D-14: the envelope is built SYNCHRONOUSLY inside the tap handler and handed straight to the
	// seam. iOS Safari discards a programmatic <a download> click once the gesture task has ended, so
	// anything asynchronous above exportBackup() presents as "Export does nothing, only on iPhone"
	// (35-RESEARCH Pitfall 5). The storage read is synchronous, so nothing is lost by doing it here.
	// 35-D-18: platform branching lives entirely in backup-io.ts — this page stays platform-blind.
	function exportNow() {
		let json: string;
		let name: string;
		try {
			json = serializeEnvelope(buildEnvelope((k) => localStorage.getItem(k), storageKeys(localStorage)));
			name = backupFilename(new Date());
		} catch {
			flash(t('backup.exportFailed'));
			return;
		}
		exportBackup(json, name).then((r) => {
			if (r === 'ok') flash(t('backup.exported'));
			else if (r === 'failed') flash(t('backup.exportFailed'));
			// 'dismissed' = the user backed out of the share sheet. Not a failure; say nothing.
		});
	}

	function pickImport() { fileInput?.click(); }

	async function onPicked() {
		const f = fileInput?.files?.[0];
		// Reset first so re-picking the SAME file fires `change` again. The File reference survives.
		if (fileInput) fileInput.value = '';
		if (!f) return;
		const text = await f.text().catch(() => null);
		if (text == null) { flash(t('backup.errDamaged')); return; }
		const res = validateEnvelope(text);
		// 35-D-10 / 35-D-11: a refusal writes NOTHING. The pure module returns a machine reason and
		// this page localizes it — services never import $lib/i18n.
		if (!res.ok) {
			flash(res.reason === 'not-ours' ? t('backup.errNotOurs') : res.reason === 'newer' ? t('backup.errNewer') : t('backup.errDamaged'));
			return;
		}
		// 35-D-08: Capacitor 8 renders confirm() as a native AlertDialog (BridgeWebChromeClient:168),
		// so the clearLibrary() idiom already on this page works in the APK too — no custom sheet.
		if (!confirm(t('backup.importConfirm'))) return;
		const r = applyEnvelope(res.envelope, localStorage, sessionStorage);
		if (r === 'no-snapshot') { flash(t('backup.errNoSnapshot')); return; }
		if (r === 'write-failed') { flash(t('backup.errWriteFailed')); return; }
		canUndo = true;
		flash(res.skipped.length ? t('backup.importedSkipped', { n: res.skipped.length }) : t('backup.imported'));
		// 35-D-13: a FULL reload so every store re-runs load() on a cold path — never a live
		// re-hydrate (restore-effect-self-invalidation-loop). The delay lets the toast render before
		// the APK's splash takes the screen; observe it at the device checkpoint, do not redesign it.
		setTimeout(() => location.reload(), 600);
	}

	function undoNow() {
		if (!confirm(t('backup.undoConfirm'))) return;
		const r = undoImport(localStorage, sessionStorage);
		if (r === 'ok') {
			flash(t('backup.undone'));
			setTimeout(() => location.reload(), 600);
			return;
		}
		// Nothing to put back (or it was unreadable and has been discarded): drop the affordance.
		canUndo = false;
		if (r === 'write-failed') flash(t('backup.errWriteFailed'));
	}

	function clearPicks() {
		try { localStorage.removeItem(TOP_PICKS_KEY); } catch { /* */ }
		try { localStorage.removeItem(HOME_LIBRARY_KEY); } catch { /* */ } // hhd: also reset library shelves
		flash(t('settings.picksCleared'));
	}
	function clearNameCache() { names.clearCache(); flash(t('settings.nameCacheCleared')); }
	function clearCovers() { clearCoverCache(); flash(t('settings.coverCacheCleared')); }
	function clearSearchHistory() { try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch { /* */ } flash(t('settings.searchHistoryCleared')); }
	function resetAppearance() { settings.resetAppearance(); flash(t('settings.appearanceReset')); }
	function clearLibrary() {
		if (confirm(t('settings.clearLibraryConfirm'))) {
			library.clearAll();
			counts = { liked: 0, playlists: 0, downloads: 0 };
			flash(t('settings.libraryCleared'));
		}
	}
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')} use:tapBounce><ChevronLeft size={22} /></button>
	<h1>{t('settings.data')}</h1>
</header>

<section>
	<p class="muted">{t('settings.dataCounts', { liked: counts.liked, playlists: counts.playlists, downloads: counts.downloads })}</p>
	<button class="item" onclick={exportNow} use:tapBounce><Download size={18} /> {t('backup.export')}</button>
	<p class="hint">{t('backup.exportDesc')}</p>
	<button class="item" onclick={pickImport} use:tapBounce><Upload size={18} /> {t('backup.import')}</button>
	<p class="hint">{t('backup.importDesc')}</p>
	<!-- Leading with a real MIME type is load-bearing, not cosmetic. A type list that STARTS with a
	     bare extension makes Capacitor's BridgeWebChromeClient.showFilePicker:379 index validTypes[0]
	     outside its try block, and MimeTypeMap has no json mapping on many API levels — an uncaught
	     ArrayIndexOutOfBoundsException that kills the picker. Escape hatch if some device greys the
	     file out: drop the attribute entirely, validateEnvelope is the real gate. -->
	<input type="file" accept="application/json,.json" bind:this={fileInput} onchange={onPicked} hidden />
	{#if canUndo}
		<button class="item" onclick={undoNow} use:tapBounce><Undo2 size={18} /> {t('backup.undo')}</button>
		<p class="hint">{t('backup.undoDesc')}</p>
	{/if}
	<button class="item" onclick={clearPicks} use:tapBounce><RefreshCw size={18} /> {t('settings.clearPicks')}</button>
	<p class="hint">{t('settings.clearPicksDesc')}</p>
	<button class="item" onclick={clearNameCache} use:tapBounce><Languages size={18} /> {t('settings.clearNameCache')}</button>
	<p class="hint">{t('settings.clearNameCacheDesc')}</p>
	<button class="item" onclick={clearCovers} use:tapBounce><Image size={18} /> {t('settings.clearCoverCache')}</button>
	<p class="hint">{t('settings.clearCoverCacheHint')}</p>
	<button class="item" onclick={clearSearchHistory} use:tapBounce><Search size={18} /> {t('settings.clearSearchHistory')}</button>
	<p class="hint">{t('settings.clearSearchHistoryDesc')}</p>
	<button class="item" onclick={resetAppearance} use:tapBounce><SlidersHorizontal size={18} /> {t('settings.resetAppearance')}</button>
	<p class="hint">{t('settings.resetAppearanceDesc')}</p>
	<button class="item danger" onclick={clearLibrary} use:tapBounce><Trash2 size={18} /> {t('settings.clearLibrary')}</button>
	<p class="hint">{t('settings.clearLibraryDesc')}</p>
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
	.item.danger { color: #ff7a90; }
	.flash { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--tabbar-h) + 70px); background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; }
</style>
