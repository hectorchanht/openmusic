// download-track.ts — the ONE shared, node-testable single-song download orchestration.
//
// Extracted VERBATIM (behavior-preserving) from TrackMenu.doDownload so DL-FILE-01 / DL-BUG-01 /
// DL-STATE-01 all have a SINGLE tested initiation path: the filename format can never drift, the
// `window.open` bug can never come back, and per-song begin/endDownload is bracketed once here
// instead of duplicated per call site. 29-04 (UI) and 29-05 (native) consume this.
//
// CONTRACTS (all three MUST hold — asserted in download-track.test.ts):
//
//   D-17 NEVER-THROWS: every failure path resolves a DownloadResult sentinel ('no-audio' | 'failed'),
//     never rejects. The caller localizes a toast off the result — this module NEVER navigates and
//     NEVER opens a play page. It deliberately imports NEITHER `$lib/i18n` NOR `$lib/stores/toast`:
//     the i18n `t()` reads runes `$state` and would break the single node Vitest project, and text
//     localization is the UI layer's job (stores/services emit data, the caller localizes).
//
//   D-18 DOWNLOAD ISOLATION (quick-260625-pzs-04): download work must NOT cross into playback. This
//     function reads `player.current` READ-ONLY (to reuse an already-resolved URL) and NEVER assigns
//     player.current, NEVER clears its lrc, NEVER bumps player.playGen, and NEVER touches the shared
//     <audio> element. It operates on COPIES + its own fetch(). `library.addDownload` mutates the
//     LIBRARY downloads reference list — the intended download effect, NOT player state.
//
//   DL-BUG-01 (D-09): a failed save returns 'failed' — it NEVER `window.open`s the raw stream URL
//     (the "download opened a media page" bug). The caller shows toast.downloadFailedKeptInLibrary;
//     the song already sits in library.downloads (addDownload ran) and re-streams on tap.

import type { Track } from '$lib/sources/types';
import { library } from '$lib/stores/library.svelte';
import { player } from '$lib/stores/player.svelte';
import { settings, type DefaultQuality } from '$lib/stores/settings.svelte';
import { names } from '$lib/stores/names.svelte';
import { ensureTrackDetails } from '$lib/services/catalog';
import { blobStore } from '$lib/services/blob-store';
import { saveBlobToDisk } from '$lib/services/download-save';
import { buildDownloadFilename, extFromAudioUrl } from '$lib/services/download-filename';

/** 'saved' = blob fetched + saved to disk; 'no-audio' = nothing to download; 'failed' = fetch/save error. */
export type DownloadResult = 'saved' | 'no-audio' | 'failed';

// quick-260625-pzs-04: does the currently-playing track's already-resolved quality satisfy the
// requested DOWNLOAD tier? If so we reuse its URL instead of forcing a second concurrent resolve of
// the same song (T-pzs-02: a duplicate resolve + blob fetch saturate the shared CDN and have caused
// a stale-URL audio error → lyrics wipe on the active track). Conservative: reuse only when confident
// the streamed quality already meets/exceeds the wanted tier.
//   - 'auto' / '320' / '128' → any resolved stream (320k or lossless) meets/exceeds the tier
//   - 'lossless'             → reuse ONLY when the current stream is already lossless; else re-resolve
function currentQualityMeets(curQuality: string | null, want: DefaultQuality): boolean {
	if (want === 'auto' || want === '320' || want === '128') return true;
	// want === 'lossless'
	return (curQuality ?? '').toLowerCase() === 'lossless';
}

/**
 * Download ONE song: resolve→addDownload→fetch→(persist)→save. Isolation-safe, never-throws,
 * never-navigates. `opts.persist` defaults TRUE; `persist:false` (the album bulk path) skips
 * `blobStore.put` — matching album's current behavior (no offline blob / no native public copy) —
 * while addDownload + saveBlobToDisk + begin/end still run.
 *
 * 31-D-12: `opts.save` also defaults TRUE; `save:false` is the SILENT background repair mode — the
 * offline blob is re-persisted and the library record refreshed, but no `<a download>` click fires.
 * The repair is triggered by a playback error the user never asked about, so popping a file-save
 * dialog mid-song would itself be the bug.
 */
export async function downloadTrack(
	track: Track,
	opts?: { persist?: boolean; save?: boolean }
): Promise<DownloadResult> {
	// DL-STATE-01: bracket the per-uid spinner. beginDownload BEFORE the first await; endDownload in
	// the `finally` so EVERY exit (saved / no-audio / failed / any throw) clears the spinner exactly once.
	library.beginDownload(track.uid);
	try {
		let r: Track;
		// D-18: READ-ONLY snapshot of the playing track. We never write back to player.current.
		const cur = player.current;
		const reuseCurrent =
			cur != null &&
			cur.uid === track.uid &&
			!!cur.audioUrl &&
			cur.detailsLoaded &&
			currentQualityMeets(cur.quality, settings.downloadQuality);
		if (reuseCurrent) {
			// Reuse the already-resolved current track's URL/details (a fresh COPY — never the live
			// player.current reference, so nothing downstream can mutate the playing track).
			r = { ...(cur as Track) };
		} else {
			// Re-resolve at the user's DOWNLOAD quality (separate from the streaming default). WR-07: the
			// tier is threaded through ensureTrackDetails as an explicit per-call parameter — never a
			// temporary settings swap that races concurrent playback resolves. Force a fresh resolve by
			// clearing cached details on a COPY (the caller's queue track is left untouched). `.catch`
			// degrades a resolve failure to the original stub (never-throws).
			r = await ensureTrackDetails(
				{ ...track, detailsLoaded: false, audioUrl: null, lrc: null },
				undefined,
				settings.downloadQuality
			).catch(() => track);
		}
		// Intended download effect: reference the song in the LIBRARY downloads list (NOT player state).
		// Runs BEFORE the fetch so a later fetch/save failure still leaves the song in the list (it
		// re-streams on tap) — this is what makes DL-BUG-01's "keep in library" guarantee hold.
		library.addDownload(r);
		if (!r.audioUrl) return 'no-audio';

		// RAW fetch (not apiFetch — fetch→apiFetch audit): a MEDIA download-to-blob of the resolved
		// audio stream. audioUrl is often an ABSOLUTE CDN URL (qq/kuwo/joox) — apiFetch would corrupt it —
		// and a full-file body must not be routed through the JSON governor's dedup/cap.
		const resp = await fetch(r.audioUrl);
		const blob = await resp.blob();

		// DL-FILE-01 (D-05/D-06/D-07): controlled, translated filename `{artist} - {song}.{ext}`. The
		// caller-free display-name translation (names.dn*, synchronous cached-or-raw) is applied here;
		// the pure download-filename helper composes + sanitizes.
		const ext = extFromAudioUrl(r.audioUrl);
		const filename = buildDownloadFilename(names.dnArtist(r.artist), names.dnTitle(r.title), ext);

		// Offline cache (kyf): persist the SAME blob keyed by uid so a later player.play() of this uid
		// streams from the local blob instead of the CDN. The filename is threaded to the native public
		// (MediaStore) write. Skipped for the album bulk path (persist:false). Never throws.
		if (opts?.persist !== false) {
			await blobStore.put(r.uid, blob, filename);
		}

		// 31-D-12: silent background repair — the offline blob (and the library record) are refreshed
		// above, which is the whole point of the re-download; the disk save is skipped so no picker /
		// download-shelf appears for an action the user never initiated.
		if (opts?.save === false) return 'saved';

		// Web save via the anchor seam (DL-BUG-01/D-02/D-09): a same-origin blob: <a download> click,
		// NO save-picker prompt, NO new-tab navigation. Returns false (not a throw) on any DOM failure.
		return saveBlobToDisk(blob, filename) ? 'saved' : 'failed';
	} catch {
		// DL-BUG-01 (D-09): a fetch/blob failure returns 'failed' — it NEVER window.open's the raw
		// stream URL. The song is already in library.downloads and re-streams on tap; the caller shows
		// toast.downloadFailedKeptInLibrary.
		return 'failed';
	} finally {
		// DL-STATE-01: clear the per-uid spinner on every exit path.
		library.endDownload(track.uid);
	}
}
