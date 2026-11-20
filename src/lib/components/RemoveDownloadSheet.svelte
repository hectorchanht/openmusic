<script lang="ts">
	// RemoveDownloadSheet — THE remove-download confirm, shared (quick-261119-dldelete).
	//
	// Extracted from TrackMenu's private sheet (quick-260919-vrq) so the downloaded ✓ in
	// DownloadControl (Now Playing transport, Nowbar, song rows, album rows) opens the SAME
	// confirm the ⋮ menu opens — one dialog, one behaviour, never two divergent flows. It
	// follows the ConfirmModal precedent (scrim + fly + dragClose + focusTrap): Cancel, the
	// scrim, a drag-down and the Back gesture all dismiss with NOTHING removed; only an
	// explicit delete button acts.
	//
	// DELETE MEANS DELETE (Hector 2026-11-19): the old sheet's `rmDeleteFile` toggle is GONE.
	// Its off path dropped the library row but kept the offline bytes — the app then showed
	// "not downloaded" while a copy still sat on the device, exactly the lie he rejected
	// ("downloaded 應該係直接映照 user local download folder"). Every delete here calls
	// `library.removeDownload(uid)` with its default: record AND blob bytes together, always.
	// The one honest limit stays as plain body copy (menu.removeDownloadBody): a file the user
	// saved through the browser's own download folder is theirs — the app cannot reach it and
	// never claims it deleted it.
	//
	// VERSIONS: when the song has downloads under more than one uid (another source, another
	// rendition — library.downloadVersionsFor), the sheet lists each version (source · quality
	// · real blob size) with its own delete, plus a remove-all action. One version keeps the
	// sheet exactly as simple as the old confirm — no version chrome.
	//
	// MANAGE MODE (Hector 2026-11-19 gesture spec): a LONG-PRESS on the downloaded ✓ opens
	// this sheet with `manage` set — the version list renders even for a SINGLE version, so
	// the user always has a surface that shows what copy they hold (source · quality · size)
	// with its delete. A plain tap (manage off) with several versions lists them too: the
	// tap-confirm never pretends this control's copy is the only one.
	//
	// PLAYING-TRACK SAFETY: deleting the version the player is currently sounding from its
	// blob does NOT cut playback — the element holds an object URL over the in-memory Blob,
	// and nothing in removeDownload/blobStore.del revokes it. Only the NEXT play streams.
	import { untrack } from 'svelte';
	import { Trash2 } from '@lucide/svelte';
	import { fly } from '$lib/motion'; // quick-261102-u4t: reduce-motion aware
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { library } from '$lib/stores/library.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { blobStore } from '$lib/services/blob-store';
	import { formatBytes } from '$lib/services/download-probe';
	import { trackQualityLabel, trackSourceLabel } from '$lib/services/display-quality';
	import { t } from '$lib/i18n';
	import MenuActionButton from '$lib/components/MenuActionButton.svelte';
	import type { Track } from '$lib/sources/types';

	let {
		track,
		open,
		manage = false,
		onclose,
		onremoved
	}: {
		/** The tapped track (any copy of the song — versions are resolved from the library). */
		track: Track | null;
		open: boolean;
		/** Long-press entry: always render the version list, even for a single version. */
		manage?: boolean;
		/** Dismiss with nothing removed (cancel / scrim / drag / Back). */
		onclose: () => void;
		/** Fired once when a delete empties the version list (hosts may also close their menu). */
		onremoved?: () => void;
	} = $props();

	const versions = $derived(open && track ? library.downloadVersionsFor(track) : []);
	const multi = $derived(versions.length > 1);
	const showList = $derived(multi || manage);

	// Real on-device size per version, read from the blob itself (blobStore.stat) — the same
	// truth the Detail sheet shows, never the record's claim. Best-effort: a missing blob
	// (list-only record) simply renders no size.
	let sizes = $state<Record<string, string>>({});
	$effect(() => {
		const uids = versions.map((v) => v.uid);
		if (!open || uids.length === 0) return;
		let alive = true;
		untrack(() => {
			for (const uid of uids) {
				void blobStore
					.stat(uid)
					.then((s) => {
						const label = s ? formatBytes(s.bytes) : null;
						if (alive && label) sizes = { ...sizes, [uid]: label };
					})
					.catch(() => {});
			}
		});
		return () => {
			alive = false;
		};
	});

	const versionLabel = (v: Track) =>
		[names.zhLock(trackSourceLabel(v) ?? v.source), trackQualityLabel(v), sizes[v.uid]]
			.filter(Boolean)
			.join(' · ');

	function finishIfEmpty() {
		if (track && library.downloadVersionsFor(track).length === 0) {
			onremoved?.();
			onclose();
		}
	}

	function deleteOne(uid: string) {
		library.removeDownload(uid);
		toast.show(t('toast.downloadRemoved'));
		finishIfEmpty();
	}

	function deleteAll() {
		for (const v of versions) library.removeDownload(v.uid);
		toast.show(t('toast.downloadRemoved'));
		onremoved?.();
		onclose();
	}
</script>

{#if open && track && versions.length > 0}
	<button class="scrim" aria-label={t('menu.close')} onclick={onclose}></button>
	<div
		class="menu"
		role="dialog"
		aria-modal="true"
		aria-label={t('menu.removeDownload')}
		transition:fly={{ y: 240, duration: 200 }}
		use:dragClose={{ onclose }}
		use:focusTrap
	>
		<div class="menu-head">{t('menu.removeDownload')}</div>
		<p class="hint">{t('menu.removeDownloadBody')}</p>
		{#if showList}
			{#if multi}<p class="hint strong">{t('menu.removeDownloadVersions', { count: versions.length })}</p>{/if}
			<div class="versions">
				{#each versions as v (v.uid)}
					<div class="vrow">
						<span class="vlabel">{versionLabel(v)}</span>
						<button
							class="vdel"
							aria-label={`${t('menu.removeDownload')} · ${versionLabel(v)}`}
							title={t('menu.removeDownload')}
							onclick={() => deleteOne(v.uid)}
							use:tapBounce
						>
							<Trash2 size={16} />
						</button>
					</div>
				{/each}
			</div>
			<div class="actions">
				<MenuActionButton onclick={onclose}>{t('tags.cancel')}</MenuActionButton>
				{#if multi}
					<button class="mi danger" onclick={deleteAll} use:tapBounce>
						<Trash2 size={18} /> {t('menu.removeDownloadAll')}
					</button>
				{/if}
			</div>
		{:else}
			<div class="actions">
				<MenuActionButton onclick={onclose}>{t('tags.cancel')}</MenuActionButton>
				<button class="mi danger" onclick={() => deleteOne(versions[0].uid)} use:tapBounce>
					<Trash2 size={18} /> {t('menu.removeDownloadAction')}
				</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* Mirrors TrackMenu's sheet chrome (the precedent ConfirmModal also follows) — same
	   scrim/sheet geometry so the shared confirm reads as the same surface everywhere. */
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 80;
		background: rgba(0, 0, 0, 0.45);
		border: none;
	}
	.menu {
		position: fixed;
		left: 12px;
		right: 12px;
		bottom: 16px;
		z-index: 81;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 16px;
		padding: 8px;
		max-width: 680px;
		margin: 0 auto;
		box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
		max-height: 90vh;
		overflow-y: auto;
	}
	.menu-head {
		font-size: calc(0.8125rem * var(--fs-title, 1));
		color: var(--color-text-muted);
		padding: 8px 10px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hint {
		color: var(--color-text-muted);
		font-size: 0.75rem;
		line-height: 1.4;
		padding: 10px 12px 4px;
		margin: 0;
	}
	.hint.strong {
		color: var(--color-text);
		font-size: 0.8125rem;
	}
	.actions {
		display: flex;
		gap: 8px;
		padding: 4px;
	}
	.mi {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		background: none;
		border: none;
		color: var(--color-text);
		font-size: 0.9375rem;
		padding: 12px;
		border-radius: 10px;
		cursor: pointer;
		text-align: start;
	}
	.mi.danger {
		color: var(--color-danger-text);
	}
	.versions {
		padding: 4px 4px 0;
		display: flex;
		flex-direction: column;
	}
	.vrow {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px 6px 12px;
		border-top: 1px solid var(--color-border);
	}
	.vlabel {
		flex: 1;
		min-width: 0;
		font-size: 0.875rem;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.vdel {
		flex: none;
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		background: none;
		border: none;
		border-radius: var(--radius-full);
		color: var(--color-danger-text);
		cursor: pointer;
	}
</style>
