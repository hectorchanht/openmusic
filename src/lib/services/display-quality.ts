// display-quality — the ONE derivation behind every quality / source tag the app paints
// (quick-261102-qtruth). Before this module the same `qualityLabel || quality` read lived
// inline in NowPlaying (the pill), TrackMenu (the Detail sheet) and VersionPicker, and the
// download-record merge lived inline in BOTH player.applyDownloadQuality and
// TrackMenu.doDetail — so the surfaces could disagree about the SAME playing track:
// Hector's 2026-11-02 report was the Now-Playing pill saying 320K while the Detail sheet
// said LOSSLESS for one joox track. The pill read player.current's stamps, which can be
// STALE relative to what is actually playing (a persisted restore snapshot, or a stream
// resolve stamped at the '320' tier whose src was then superseded by the downloaded
// file); the Detail sheet re-resolves fresh and merges the download record, so it told
// the truth. Every surface now derives through here, with ONE precedence:
//
//   download record  >  the track's own resolved stamps  >  the stub/search claim
//
// (the track's own fields ARE the resolved truth once ensureTrackDetails has run —
// play() installs the resolved object as current wholesale — so "resolved > stub" is
// just "read the live track object, never a snapshot copy".)
//
// This module is PURE: the download-record lookup stays with the callers (the library
// store owns the records), which pass the pair in — the same shape qualityForDownload
// already returns. No store imports, so components, the menu and tests all share it
// without a cycle.
import { SOURCES } from '$lib/sources/registry';
import type { Track } from '$lib/sources/types';

/** A quality pair as carried by Track and by a download record (library.qualityForDownload). */
export interface QualityPair {
	quality: string | null;
	qualityLabel: string | null;
}

/**
 * Merge a download record's quality pair over a track (quick-261007-abq3's rule, now
 * shared): the record describes the FILE on disk, so it wins over any stamp the track
 * object carries. Returns the input UNCHANGED when the record is absent or carries no
 * quality info — a merge must never blank a good label.
 */
export function withDownloadQuality(track: Track, q: QualityPair | null): Track {
	if (!q || (q.quality == null && q.qualityLabel == null)) return track;
	if (track.quality === q.quality && track.qualityLabel === q.qualityLabel) return track;
	return { ...track, ...q };
}

/** The track's own display label: the source's wording wins, the raw tier is the fallback. */
export function trackQualityLabel(track: Track | null | undefined): string | null {
	return track?.qualityLabel || track?.quality || null;
}

/**
 * THE display derivation: what a quality tag for this track must say, given the download
 * record's pair (or null). Null when nothing honest can be shown — an unresolved stub
 * with no tier, or a source that reports none; callers render nothing rather than an
 * empty pill.
 */
export function displayQualityLabel(track: Track | null | undefined, q: QualityPair | null): string | null {
	if (!track) return null;
	return trackQualityLabel(withDownloadQuality(track, q));
}

/**
 * The track's SOURCE label, exactly as the Play-from-source sheet shows it
 * (VersionPicker.sourceLabel): the registry adapter's own label (JOOX, Netease（GD）,
 * Kuwo（溯音）…), falling back to the raw source id for an unknown source. Callers apply
 * names.zhLock for display-language script locking, like VersionPicker does. Reads the
 * track it is handed — hand it player.current and the label follows a cross-source
 * fallback swap automatically, because play() installs the swap as current.
 */
export function trackSourceLabel(track: Track | null | undefined): string | null {
	if (!track) return null;
	return SOURCES[track.source]?.label ?? track.source;
}
