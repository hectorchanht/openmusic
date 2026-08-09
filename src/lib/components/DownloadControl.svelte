<script lang="ts">
	// DownloadControl — the ONE shared per-song download affordance (DL-STATE-01 / D-11 / D-12).
	//
	// Renders a single tri-state control keyed on the track's uid, reading the SHARED reactive
	// library state so one song's spinner never touches another's (T-29-04-02):
	//   idle        → Download icon, enabled  → tap runs the shared downloadTrack path (29-03)
	//   downloading → neutral spinner, disabled, aria-busy   (library.downloading.has(uid), plus a
	//                 per-instance localBusy that also covers the album-stub resolve gap)
	//   downloaded  → Check icon, greyed, disabled           (library.isDownloaded(uid))
	//
	// DL-BUG-01: the tap NEVER window.open()s / showSaveFilePicker()s — downloadTrack owns save and
	// returns a 'saved' | 'no-audio' | 'failed' sentinel we localize to a toast (never a media page).
	// DOWNLOAD ISOLATION (D-18) is preserved by downloadTrack (reads player.current READ-ONLY, never
	// mutates playback).
	//
	// Album rows pass `track={null}` + a `resolve` closure (their rows are {artist,title} STUBS with no
	// uid until resolved) + `persist={false}` (album downloads intentionally stay OUT of the offline
	// blob / native public folder this phase — 29-CONTEXT / RESEARCH Open Q2; only the human filename +
	// the bug-fix apply). The resolved Track is cached so the greyed Downloaded state shows after a
	// successful album-row save.
	import { Download, Check } from '@lucide/svelte';
	import { library } from '$lib/stores/library.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';
	import { downloadTrack } from '$lib/services/download-track';
	import type { Track } from '$lib/sources/types';

	let {
		track = null,
		persist = true,
		resolve = null
	}: {
		/** The resolved Track (library / history rows). Album rows pass null + a `resolve` closure. */
		track?: Track | null;
		/** Forwarded to downloadTrack. Album rows pass false (no offline blob / native public copy). */
		persist?: boolean;
		/** Album stubs: resolve {artist,title} → Track on tap. When set, click resolves before saving. */
		resolve?: (() => Promise<Track | null>) | null;
	} = $props();

	// Cache a stub's resolved Track so post-download state (Downloaded) reads its uid.
	let resolved = $state<Track | null>(null);
	// Per-instance in-flight flag: covers the album-stub resolve→download window (whose uid isn't in
	// library.downloading yet) AND the instant before downloadTrack's synchronous beginDownload lands.
	// Local-only so it never spins another row (isolation).
	let localBusy = $state(false);

	const uid = $derived(resolved?.uid ?? track?.uid ?? '');
	const isDownloaded = $derived(!!uid && library.isDownloaded(uid));
	const isDownloading = $derived(localBusy || (!!uid && library.downloading.has(uid)));

	async function run() {
		if (isDownloaded || isDownloading) return;
		toast.show(t('toast.preparingDownload'));
		localBusy = true;
		try {
			let target: Track | null = resolved ?? track ?? null;
			if (resolve && !target) {
				target = await resolve();
				if (target) resolved = target;
			}
			if (!target) {
				toast.show(t('toast.noAudio'));
				return;
			}
			// DL-BUG-01: downloadTrack never navigates; it returns a sentinel the UI localizes here.
			const res = await downloadTrack(target, { persist });
			toast.show(
				res === 'saved'
					? t('toast.downloaded')
					: res === 'no-audio'
						? t('toast.noAudio')
						: t('toast.downloadFailedKeptInLibrary')
			);
		} finally {
			localBusy = false;
		}
	}
</script>

{#if isDownloaded}
	<!-- Downloaded: a non-interactive span (greyed, disabled-by-absence-of-onclick) — D-11 label. -->
	<span class="dc downloaded" aria-label={t('menu.downloaded')} title={t('menu.downloaded')}>
		<Check size={18} />
	</span>
{:else if isDownloading}
	<span class="dc busy" aria-busy="true" aria-label={t('toast.preparingDownload')}>
		<span class="row-spinner motion-always"></span>
	</span>
{:else}
	<button class="dc" aria-label={t('menu.download')} title={t('menu.download')} onclick={run} use:tapBounce>
		<Download size={18} />
	</button>
{/if}

<style>
	.dc {
		flex: none;
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		background: none;
		border: none;
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	button.dc:hover {
		background: var(--color-surface);
		color: var(--color-text);
	}
	/* Downloaded + busy are non-interactive; greyed to read as "done"/"working". */
	.dc.downloaded {
		opacity: 0.4;
		cursor: default;
	}
	.dc.busy {
		cursor: default;
	}
	/* Neutral inline resolve spinner (copied from TrackMenu .row-spinner) — NOT accent. quick-260809-mvz:
	   it keeps rotating under BOTH reduce-motion gates (the markup carries `.motion-always`, app.css's
	   escape hatch) — a frozen spinner reads as a hung app, so the rotation is the message, not polish. */
	.row-spinner {
		width: 16px;
		height: 16px;
		flex: none;
		border: 2px solid var(--color-text-muted);
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
