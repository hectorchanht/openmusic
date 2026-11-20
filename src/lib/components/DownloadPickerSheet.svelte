<script lang="ts">
	// DownloadPickerSheet — THE "Download from…" source/quality picker, shared
	// (quick-261119-dldelete, extracted from TrackMenu quick-260916-0d9).
	//
	// Until now the picker lived privately inside TrackMenu, reachable only from the menu's
	// Download row (tap = default download, long-press / caret = this picker). Hector's
	// gesture spec (2026-11-19) gives DownloadControl the same two gestures everywhere it
	// renders — tap downloads, LONG-PRESS chooses the source — so the picker is a shared
	// component now (one component system: reuse or create shared, never duplicate).
	// TrackMenu mounts it with its menu-scoped overlay id and its own-source probe as the
	// seed; DownloadControl mounts it with its own overlay id and no seed.
	//
	// Q1 IDENTITY. `track` (the ORIGINAL the host opened on) carries the identity; the
	// picked row carries the MEASURED audio. downloadTrack spreads the original, so
	// library.addDownload and blobStore.put both key by the original uid — which is what
	// makes `library.isDownloaded(track.uid)` true and `player.play(track)` take the
	// offline-blob branch and play the source the user actually chose. It also skips the
	// re-resolve, so the bytes saved are the bytes the row promised (never a larger
	// re-resolved file — the 52 MB-FLAC-on-cellular incident).
	//
	// Q2 PROBE COST. The sheet opens on the SAME tick with the own-source row already
	// labelled when the host passes `seedProbe` (TrackMenu's main Download row probe,
	// measured under the exact `uid|downloadQuality` memo key `probeDownload` would use —
	// seeding costs zero network). `fetchVariants` then runs behind a spinner line (its
	// searchAll is D-04 TTL-memoised, so a re-open is free), and every OTHER candidate is
	// probed through `mapWithConcurrency(…, 2, …)`.
	//
	// WHY 2, AND DO NOT RAISE IT. Each probe is one governed `ensureTrackDetails` + one raw
	// HEAD/Range, so 2 in flight can hold at most 2 of `apiFetch`'s
	// MAX_CONCURRENT_REQUESTS=8 slots, leaving >=6 for playback. An uncapped `/api/*`
	// fan-out is precisely what froze this app (api-fetch-flood-freeze).
	//
	// Closing the sheet (scrim / drag / Back / a pick) aborts every probe still in flight
	// (T-0d9-01) via the open-effect cleanup, whatever route closed it.
	import { untrack } from 'svelte';
	import { Download, X } from '@lucide/svelte';
	import { fly } from '$lib/motion'; // quick-261102-u4t: reduce-motion aware
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { player } from '$lib/stores/player.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { t } from '$lib/i18n';
	import { SOURCES } from '$lib/sources/registry';
	import { fetchVariants, versionsIncludingOwn } from '$lib/services/variants';
	import { mapWithConcurrency } from '$lib/services/discovery';
	import { downloadTrack, pickedFileAlreadyOnDisk } from '$lib/services/download-track';
	import { downloadLabel } from '$lib/services/download-label';
	import { blobStore } from '$lib/services/blob-store';
	import {
		probeDownload,
		formatDownloadMeta,
		isLosslessContainer,
		type DownloadProbe
	} from '$lib/services/download-probe';
	import MenuActionButton from '$lib/components/MenuActionButton.svelte';
	import type { Track } from '$lib/sources/types';

	let {
		track,
		open,
		seedProbe = null,
		overlayId,
		onclose,
		onpicked
	}: {
		/** The song whose sources are offered (identity for the saved download). */
		track: Track | null;
		open: boolean;
		/** The host's already-measured own-source probe, if it has one (zero-network seed). */
		seedProbe?: DownloadProbe | null;
		/** Distinct per host so Back pops exactly this sheet (balanced overlay entry). */
		overlayId: string;
		/** Dismiss (scrim / drag / Back / after a pick). */
		onclose: () => void;
		/** Fired after a pick settles (TrackMenu refreshes its own blob probe with it). */
		onpicked?: () => void | Promise<void>;
	} = $props();

	// `probes` is uid → probe; ABSENT means still probing (skeleton), a probe whose `track`
	// is null means that source refused (disabled "Unavailable" row). `extra` is the sibling
	// map for the quick-261020-dl320 second row: uid → the 320k-tier probe of a source whose
	// main probe landed lossless, rendered as its own row under the source's row.
	// gen / ac are PLAIN fields — supersedence guards the UI never reads reactively.
	let loading = $state(false);
	let list = $state<Track[]>([]);
	let probes = $state<Record<string, DownloadProbe | undefined>>({});
	let extra = $state<Record<string, DownloadProbe | undefined>>({});
	let gen = 0;
	let ac: AbortController | null = null;

	function closePicker() {
		ac?.abort(); // closing the sheet cancels every probe still in flight (T-0d9-01)
		onclose();
	}

	// The open effect owns the whole run: seed → variants fan-out → probe pool. Its cleanup
	// (close, host unmount, re-open) aborts the pool and bumps the generation, so no close
	// route can leave probes running behind a dead sheet. Deps are `open` ONLY (the target
	// is read untracked at open time, like TrackMenu's imperative opener did) — a host
	// reassigning `track` stub→resolved mid-open must not restart the fan-out.
	$effect(() => {
		if (!open) return;
		const target = untrack(() => track);
		if (!target?.uid) return;
		const seed = untrack(() => seedProbe);
		const myGen = ++gen;
		ac?.abort();
		const ctrl = new AbortController();
		ac = ctrl;
		// quick-261004-o9t: the seed is the song's OWN probe for every source now (ytmusic
		// included), so this seeds the song's own row by its uid.
		probes = seed?.track ? { [seed.track.uid]: seed } : {};
		extra = {};
		// quick-261004-o9t: the YouTube Music row is offered again (own track or donor) — the
		// quick-260930-uia filter left with the rule it enforced.
		list = versionsIncludingOwn(target, []);
		loading = true;
		void (async () => {
			const found = await fetchVariants(target, ctrl.signal);
			if (myGen !== gen || ctrl.signal.aborted) return; // superseded / cancelled
			list = versionsIncludingOwn(target, found);
			loading = false;
			// Per-item write INSIDE fn so each row fills the instant its own probe lands,
			// rather than the whole sheet unblanking at the end. untrack: probeDownload reads
			// settings/player internally and this runs inside an effect — the guard matches
			// the dlProbe effect's in TrackMenu.
			await mapWithConcurrency(list, 2, async (v) => {
				// The own-source row arrives pre-seeded (the zero-network seed above); every
				// other row probes at the download tier first. Sequential per item, so the
				// 2-in-flight cap the api-fetch-flood-freeze rule demands still holds.
				let p = probes[v.uid];
				if (!p) {
					p = await untrack(() => probeDownload(v, ctrl.signal));
					if (myGen !== gen || ctrl.signal.aborted) return;
					probes = { ...probes, [v.uid]: p };
				}
				// quick-261020-dl320: a lossless probe proves this source HAS a full quality
				// ladder — FLAC sits at its top, so the 320k rung below is near-certainly
				// present too. Probe it as a second, cheaper row for the same source. Only
				// stored when the probe lands a REAL 320k file: a ladder that falls through
				// to its own FLAC at the 320 tier must not produce a duplicate row.
				if (p?.track?.audioUrl && isLosslessContainer(p.container) && !(v.uid in extra)) {
					const p320 = await untrack(() => probeDownload(v, ctrl.signal, '320'));
					if (myGen !== gen || ctrl.signal.aborted) return;
					if (p320?.track?.audioUrl && !isLosslessContainer(p320.container)) {
						extra = { ...extra, [v.uid]: p320 };
					}
				}
			});
		})();
		return () => {
			gen++;
			ctrl.abort();
		};
	});

	// The picker's own balanced overlay entry — distinct id per host so Back pops exactly
	// this sheet, and its close handler aborts the probe pool on every dismiss route.
	$effect(() => {
		if (open && track) {
			untrack(() => overlays.open(overlayId, () => closePicker()));
			return () => untrack(() => overlays.dismiss(overlayId));
		}
	});

	// quick-261020-dl320: the sheet's second (320k) row passes its own probe — the tapped
	// row's MEASURED audio is what downloadTrack saves, so the label and the bytes agree.
	async function pickDownload(v: Track, probe?: DownloadProbe) {
		const target = track;
		if (!target) return;
		const p = probe ?? probes[v.uid];
		if (!p?.track?.audioUrl) return; // the row is disabled in that state anyway
		if (library.downloading.has(target.uid)) return; // D-03 equivalent: a second tap while busy is a no-op
		// quick-261001-grb: label by the ORIGINAL track (the identity), display-language.
		const label = downloadLabel(names.dnArtist(target.artist), names.dnTitle(target.title, target.artist));
		// quick-261007-abq2: the picked source's file may ALREADY be the on-disk file — a
		// replace done before the auto quality-refresh (quick-261007-abq) left the bytes right
		// but the record's quality label stale ("std" with the 320k file size). Same byte
		// count = same file: skip the re-download and just repair the record's quality
		// metadata from the probe. A null byte count (CDN with no content-length) falls
		// through to the normal replace path — never a wrong skip.
		if (library.isDownloaded(target.uid)) {
			const st = await blobStore.stat(target.uid).catch(() => null);
			if (pickedFileAlreadyOnDisk(p.bytes, st?.bytes ?? null)) {
				library.updateDownloadQuality(target.uid, {
					quality: p.track.quality,
					qualityLabel: p.track.qualityLabel
				});
				closePicker();
				toast.show(t('toast.downloadAlreadyThisQuality', { label }));
				// D-12: the host surface stays as it was — it reflects the repaired label inline.
				await onpicked?.();
				return;
			}
		}
		closePicker();
		toast.show(t('toast.downloading', { label }));
		const res = await downloadTrack(target, { audioFrom: p.track });
		// quick-261020-hqswitch: a picked higher-tier version of the PLAYING song swaps the
		// live stream to the downloaded file (the picker's raison d'être).
		if (res === 'saved') void player.adoptDownloadedCurrent(target.uid);
		toast.show(
			res === 'saved'
				? t('toast.downloaded', { label })
				: res === 'no-audio'
					? t('toast.noAudioFor', { label })
					: t('toast.downloadFailedKeptInLibrary', { label })
		);
		// D-12: the host surface stays as it was — it reflects downloading/downloaded inline.
		await onpicked?.();
	}
</script>

{#if open && track}
	<button class="scrim" aria-label={t('menu.close')} onclick={closePicker}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: closePicker }} use:focusTrap>
		<div class="menu-head row"><span>{t('menu.downloadFrom')}</span><button class="x" aria-label={t('menu.close')} onclick={closePicker} use:tapBounce><X size={18} /></button></div>
		{#each list as v (v.uid)}
			{@const p = probes[v.uid]}
			{@const meta = p ? formatDownloadMeta(p) : null}
			{@const unavailable = p !== undefined && !p.track?.audioUrl}
			<MenuActionButton icon={Download} disabled={unavailable} onclick={() => pickDownload(v)}>
				<!-- quick-261006-zh: source labels ride the tongwentang script lock like all page content. -->
				<span class="dl-src">{names.zhLock(SOURCES[v.source]?.label ?? v.source)}</span>
				{#if p === undefined}<span class="count skel" aria-hidden="true"></span>
				{:else if unavailable}<span class="count">{t('menu.downloadUnavailable')}</span>
				{:else if meta}<span class="count">{meta}</span>{/if}
			</MenuActionButton>
			<!-- quick-261020-dl320: the cheaper second row — this source's real 320k file, probed only
			     because the main row proved the ladder exists. Tapping it downloads the 320k file. -->
			{@const p320 = extra[v.uid]}
			{#if p320?.track?.audioUrl}
				{@const meta320 = formatDownloadMeta(p320)}
				<MenuActionButton icon={Download} onclick={() => pickDownload(v, p320)}>
					<span class="dl-src">{names.zhLock(SOURCES[v.source]?.label ?? v.source)}</span>
					{#if meta320}<span class="count">{meta320}</span>{/if}
				</MenuActionButton>
			{/if}
		{/each}
		{#if loading}
			<p class="dl-wait" aria-busy="true"><span class="row-spinner motion-always"></span>{t('versions.loading')}</p>
		{/if}
	</div>
{/if}

<style>
	/* Sheet chrome mirrors TrackMenu / RemoveDownloadSheet — same scrim/sheet geometry so
	   the shared picker reads as the same surface everywhere it is hosted. */
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.45); border: none; }
	.menu { position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px; padding: 8px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0,0,0,0.5); max-height: 90vh; overflow-y: auto; }
	.menu-head { font-size: calc(0.8125rem * var(--fs-title, 1)); color: var(--color-text-muted); padding: 8px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.menu-head.row { display: flex; align-items: center; justify-content: space-between; }
	.x { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; }
	.dl-src { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.count { margin-inline-start: auto; font-size: 0.75rem; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
	.count.skel { display: inline-block; width: 64px; height: 11px; border-radius: var(--radius-full); background: var(--color-surface); }
	.dl-wait { display: flex; align-items: center; gap: 10px; color: var(--color-text-muted); font-size: 0.8125rem; padding: 10px 12px; margin: 0; }
	.row-spinner { width: 16px; height: 16px; flex: none; border: 2px solid var(--color-text-muted); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
