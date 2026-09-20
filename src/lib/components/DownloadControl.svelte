<script lang="ts">
	// DownloadControl — the ONE shared per-song download affordance (DL-STATE-01 / D-11 / D-12).
	//
	// Renders a single tri-state control keyed on the track's uid, reading the SHARED reactive
	// library state so one song's spinner never touches another's (T-29-04-02):
	//   idle        → Download icon, enabled  → tap runs the shared downloadTrack path (29-03)
	//   downloading → the shared DownloadRing, disabled, aria-busy (library.downloading.has(uid), plus
	//                 a per-instance localBusy that also covers the album-stub resolve gap).
	//                 quick-260919-dlring: the ring fills clockwise with REAL byte progress when
	//                 library.downloadProgress has a fraction for this uid, and spins when it does not
	//                 (no Content-Length, or the localBusy resolve window before any bytes exist).
	//                 quick-260919-v71: this state is evaluated FIRST (via the shared downloadState()
	//                 helper) — isDownloaded is true from addDownload onward, which runs PRE-fetch by
	//                 design (DL-BUG-01), so a downloading song is also "downloaded" and the tick
	//                 would otherwise hide the ring for the whole transfer.
	//   downloaded  → Check icon, greyed, disabled           (library.isDownloaded(uid))
	//   unavailable → CircleAlert, #ff7a90, non-interactive (library.isUnavailable — 34-D-06; re-import
	//                 is the fix, one tap away in Settings → Downloads; the badge does not try to be
	//                 a button)
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
	//
	// quick-260915-26g — THE `probe` PROP. The control can show what the tap will ACTUALLY produce
	// (`FLAC · 38.2 MB`) instead of the tier the user merely asked for: `settings.downloadQuality` is
	// a request, not a promise. That truth costs a resolve + a HEAD per render, so it is OPT-IN and
	// DEFAULTS OFF — see the prop doc. Today no call site sets it (every one is a list row); the prop
	// exists so the default-off contract is enforced by the component itself.
	import { untrack } from 'svelte';
	import { Download, Check, CircleAlert } from '@lucide/svelte';
	import { library } from '$lib/stores/library.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';
	import { downloadTrack } from '$lib/services/download-track';
	import DownloadRing from '$lib/components/DownloadRing.svelte';
	import { downloadState } from '$lib/components/download-state';
	import { probeDownload, formatDownloadMeta, type DownloadProbe } from '$lib/services/download-probe';
	import type { Track } from '$lib/sources/types';

	let {
		track = null,
		persist = true,
		resolve = null,
		probe = false
	}: {
		/** The resolved Track (library / history rows). Album rows pass null + a `resolve` closure. */
		track?: Track | null;
		/** Forwarded to downloadTrack. Album rows pass false (no offline blob / native public copy). */
		persist?: boolean;
		/** Album stubs: resolve {artist,title} → Track on tap. When set, click resolves before saving. */
		resolve?: (() => Promise<Track | null>) | null;
		/**
		 * Opt-in: resolve at settings.downloadQuality + HEAD the url to show the REAL format/size.
		 * DEFAULT OFF, and it must stay off for list rows (library, album, RowBadges) — a per-row
		 * probe is exactly the fan-out this app engineered away (T-26g-02, the apiFetch governor and
		 * the api-fetch-flood freeze). Only a single focused surface the user just opened may set it.
		 */
		probe?: boolean;
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
	const isUnavailable = $derived(!!uid && library.isUnavailable(uid));
	// quick-260919-v71: the render branches read THIS, not the three flags directly — the shared
	// helper owns the precedence (busy > unavailable > downloaded > idle) so this control and
	// RowBadges' passive ✓ can never disagree. run() and the probe $effect still read the flags.
	const dlState = $derived(
		downloadState({ downloading: isDownloading, downloaded: isDownloaded, unavailable: isUnavailable })
	);
	// quick-260919-dlring: 0..1 or undefined (= indeterminate). Read straight from the shared store —
	// no second pipeline, and an album stub mid-resolve (no uid yet) is correctly indeterminate.
	const dlFrac = $derived(uid ? library.downloadProgress[uid] : undefined);
	const busyLabel = $derived(
		dlFrac === undefined
			? t('toast.preparingDownload')
			: `${t('menu.download')} ${Math.round(dlFrac * 100)}%`
	);

	// quick-260915-26g: the probe, gated on the opt-in prop so an unset call site does nothing at all.
	// `untrack` the service call (memory: restore-effect self-invalidation loop) — it reads settings
	// and player state internally, and without untrack those reads would re-trigger this effect and
	// re-fire the probe. The AbortController cleanup is what stops an in-flight resolve/HEAD the
	// instant the surface closes, so a stale label can never land on the next song.
	let probed = $state<DownloadProbe | null>(null);
	let probing = $state(false);
	$effect(() => {
		const target = resolved ?? track;
		if (!probe || !target || isDownloaded) {
			probed = null;
			probing = false;
			return;
		}
		const ac = new AbortController();
		probing = true;
		untrack(() => probeDownload(target, ac.signal)).then((p) => {
			if (!ac.signal.aborted) {
				probed = p;
				probing = false;
			}
		});
		return () => ac.abort();
	});
	const meta = $derived(probed ? formatDownloadMeta(probed) : null);
	const dlLabel = $derived(meta ? `${t('menu.download')} · ${meta}` : t('menu.download'));

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
			// quick-260915-26g: hand back the PROBED Track when it is this same song — it already
			// carries a url resolved at the download tier, so downloadTrack's reuseInput branch skips a
			// third resolve and saves the file the label promised. A stale probe just re-resolves there.
			const picked = probed?.track && probed.track.uid === target.uid ? probed.track : target;
			// DL-BUG-01: downloadTrack never navigates; it returns a sentinel the UI localizes here.
			const res = await downloadTrack(picked, { persist });
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

{#if dlState === 'busy'}
	<span class="dc busy" aria-busy="true" aria-label={busyLabel} title={busyLabel}>
		<DownloadRing value={dlFrac}><Download size={18} /></DownloadRing>
	</span>
{:else if dlState === 'unavailable'}
	<!-- 34-D-06: still a download, but its file is gone — same 40×40 footprint, louder glyph. -->
	<span class="dc unavailable" aria-label={t('menu.unavailable')} title={t('menu.unavailable')}>
		<CircleAlert size={18} />
	</span>
{:else if dlState === 'downloaded'}
	<!-- Downloaded: a non-interactive span (greyed, disabled-by-absence-of-onclick) — D-11 label. -->
	<span class="dc downloaded" aria-label={t('menu.downloaded')} title={t('menu.downloaded')}>
		<Check size={18} />
	</span>
{:else if probe}
	<!-- quick-260915-26g: the probing branch is SEPARATE so the default (probe off) markup below stays
	     exactly what every list row renders today — one 40×40 button, no wrapper, no extra node. -->
	<span class="dc-wrap">
		<button class="dc" aria-label={dlLabel} title={dlLabel} onclick={run} use:tapBounce>
			<Download size={18} />
		</button>
		{#if probing}<span class="dc-meta skel" aria-hidden="true"></span>{:else if meta}<span class="dc-meta">{meta}</span>{/if}
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
		/* quick-260919-dlring: the idle state is a <button> and the busy/downloaded states are <span>s,
		   so the UA's default button padding made the control 6px wider in its idle state ONLY. List
		   rows never saw it (40×40 is fixed), but NowPlaying's `.t-dl` override sizes this control to
		   its content — where the transport is `space-between`, so the glyph JUMPED when a download
		   started. Zeroing it makes every state the same box everywhere. */
		padding: 0;
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
	/* quick-260915-26g: only ever rendered in the opt-in probe branch, so the 40×40 list footprint
	   is untouched. The skeleton is a plain sized block — an animation here would compete with the
	   download spinner two states over for the same "working" meaning. */
	.dc-wrap {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.dc-meta {
		font-size: 11px;
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.dc-meta.skel {
		width: 64px;
		height: 11px;
		border-radius: var(--radius-full);
		background: var(--color-surface);
	}
	/* Downloaded + busy are non-interactive; greyed to read as "done"/"working". */
	.dc.downloaded {
		opacity: 0.4;
		cursor: default;
	}
	.dc.busy {
		cursor: default;
	}
	/* 34-D-06: full opacity against .downloaded's 0.4 — this one is meant to catch the eye. */
	.dc.unavailable {
		color: #ff7a90;
		opacity: 1;
		cursor: default;
	}
	/* quick-260919-dlring: the local neutral `.row-spinner` is gone — the busy state is now the shared
	   DownloadRing, which owns the spin (indeterminate) AND the accent fill (determinate), including
	   the reduce-motion handling the old spinner carried inline. */
</style>
