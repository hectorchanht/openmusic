<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Trash2, RefreshCw, Languages, Image, Search, SlidersHorizontal, Download, Upload, Undo2, CloudDownload, CircleStop } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import SettingRow from '$lib/components/SettingRow.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { clearCoverCache } from '$lib/services/cover-cache';
	import { SEARCH_HISTORY_KEY } from '$lib/search/search-history-logic';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';
	import { applyEnvelope, backupFilename, buildEnvelope, hasUndoSnapshot, serializeEnvelope, storageKeys, undoImport, validateEnvelope } from '$lib/backup/backup-logic';
	import { exportBackup } from '$lib/services/backup-io';
	import { findMissing, sweepMissing } from '$lib/backup/sweep';
	import { blobStore } from '$lib/services/blob-store';
	import { downloadTrack } from '$lib/services/download-track';
	import type { Track } from '$lib/sources/types';

	const TOP_PICKS_KEY = 'openmusic:top-picks:v1';
	const HOME_LIBRARY_KEY = 'openmusic:home-library:v1';
	let msg = $state('');
	let counts = $state({ liked: 0, playlists: 0, downloads: 0 });
	let canUndo = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	// null = not probed yet, so the button shows (0) rather than a wrong count on first paint.
	let missing = $state<Track[] | null>(null);
	let sweeping = $state(false);
	let sweepDone = $state(0);
	// House convention: a guard the UI never reads reactively stays a PLAIN field.
	let sweepCtl: AbortController | null = null;

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
		refreshMissing();
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

	// 35-D-07: "missing" means the bytes are absent per blobStore.has at render time. It is never
	// stored in the backup file, which is what reconciles a Replace-import with a device that has
	// real local downloads: an imported entry whose bytes happen to be here reads as present, one
	// whose bytes are absent reads as missing. Scope is this page only — DownloadControl.svelte is
	// deliberately NOT migrated in this phase (see TrackMenu.svelte:213-214).
	async function refreshMissing() {
		missing = await findMissing(library.downloads, blobStore.has);
	}

	// 35-D-06: NEVER auto-started — nothing on the import path calls this. A large unasked-for
	// network job, possibly on cellular, is exactly the mistake openmusic-pushes-autodeploy-live
	// already cost once. The same button doubles as Stop while a run is in flight.
	//
	// The injected download runs in the 31-D-12 SILENT-REPAIR mode: the offline blob is re-persisted
	// (IDB on web, Directory.Data + MediaStore on native) with no <a download> click, so 200 songs
	// pop zero save dialogs. Do NOT swap it for the album bulk mode that skips blobStore.put — that
	// is the exact opposite of what this sweep exists to restore.
	//
	// Sequential + a stop signal + a re-probe per iteration is the api-fetch-flood-freeze mitigation;
	// the full reasoning lives in sweep.ts. Do not add concurrency at this layer.
	async function redownloadMissing() {
		if (sweeping) { sweepCtl?.abort(); return; }
		sweeping = true;
		sweepCtl = new AbortController();
		sweepDone = 0;
		try {
			const r = await sweepMissing(missing ?? library.downloads, {
				has: blobStore.has,
				download: (tr) => downloadTrack(tr, { save: false }),
				signal: sweepCtl.signal,
				onProgress: (done) => (sweepDone = done)
			});
			flash(t('backup.sweepDone', { saved: r.saved, failed: r.failed }));
		} finally {
			sweeping = false;
			sweepCtl = null;
			counts = { liked: library.liked.length, playlists: library.playlists.length, downloads: library.downloads.length };
			await refreshMissing();
		}
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
	<!-- quick-260919-ebi (F2): these rows RUN something rather than flipping a boolean, so they are
	     the raised + chevron kind (SettingRow) — the same shape the /settings index uses, and now
	     visually distinct from a toggle row. The `.hint` paragraphs stay OUTSIDE the rows: they are
	     long enough that folding them into the row's second line would turn each action into a
	     paragraph-sized block. -->
	<SettingRow icon={Download} label={t('backup.export')} onclick={exportNow} />
	<p class="hint">{t('backup.exportDesc')}</p>
	<SettingRow icon={Upload} label={t('backup.import')} onclick={pickImport} />
	<p class="hint">{t('backup.importDesc')}</p>
	<!-- Leading with a real MIME type is load-bearing, not cosmetic. A type list that STARTS with a
	     bare extension makes Capacitor's BridgeWebChromeClient.showFilePicker:379 index validTypes[0]
	     outside its try block, and MimeTypeMap has no json mapping on many API levels — an uncaught
	     ArrayIndexOutOfBoundsException that kills the picker. Escape hatch if some device greys the
	     file out: drop the attribute entirely, validateEnvelope is the real gate. -->
	<input type="file" accept="application/json,.json" bind:this={fileInput} onchange={onPicked} hidden />
	{#if canUndo}
		<SettingRow icon={Undo2} label={t('backup.undo')} onclick={undoNow} />
		<p class="hint">{t('backup.undoDesc')}</p>
	{/if}
	<SettingRow
		icon={sweeping ? CircleStop : CloudDownload}
		label={sweeping
			? `${t('backup.stop')} (${sweepDone}/${missing?.length ?? 0})`
			: t('backup.redownload', { n: missing?.length ?? 0 })}
		onclick={redownloadMissing}
		disabled={!sweeping && (missing?.length ?? 0) === 0}
	/>
	<p class="hint">{t('backup.redownloadDesc')}</p>
	<SettingRow icon={RefreshCw} label={t('settings.clearPicks')} onclick={clearPicks} />
	<p class="hint">{t('settings.clearPicksDesc')}</p>
	<SettingRow icon={Languages} label={t('settings.clearNameCache')} onclick={clearNameCache} />
	<p class="hint">{t('settings.clearNameCacheDesc')}</p>
	<SettingRow icon={Image} label={t('settings.clearCoverCache')} onclick={clearCovers} />
	<p class="hint">{t('settings.clearCoverCacheHint')}</p>
	<SettingRow icon={Search} label={t('settings.clearSearchHistory')} onclick={clearSearchHistory} />
	<p class="hint">{t('settings.clearSearchHistoryDesc')}</p>
	<SettingRow icon={SlidersHorizontal} label={t('settings.resetAppearance')} onclick={resetAppearance} />
	<p class="hint">{t('settings.resetAppearanceDesc')}</p>
	<SettingRow icon={Trash2} label={t('settings.clearLibrary')} onclick={clearLibrary} danger />
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
	/* quick-260919-ebi: the action-row CSS (.item, :disabled, .danger) moved into SettingRow.svelte. */
	.flash { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--tabbar-h) + 70px); background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; }
</style>
