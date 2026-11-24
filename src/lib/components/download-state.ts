// download-state — the ONE precedence rule behind every download affordance (quick-260919-v71),
// lifted beside the component in the track-menu-gate.ts idiom: pure, no store import, no `$state`,
// node-testable under the server-only Vitest project.
//
// WHY THIS EXISTS: `library.isDownloaded(uid)` is NOT a "finished" signal. `downloadTrack` calls
// `library.addDownload` BEFORE the fetch, deliberately, so a failed save still leaves the song in
// the library (DL-BUG-01). The ONLY finished signal is `library.endDownload` in downloadTrack's
// `finally` — i.e. the uid leaving `library.downloading` (debug album-row-tick-before-file-done:
// after its OUTERMOST bracket, since the set is refcounted and an album holds one per song; a
// finish WITHOUT a file is marked `unavailable` there too). So `downloading` is the stronger, more
// specific state and MUST be tested before `downloaded`. DownloadControl had the branches the other
// way round, which made its DownloadRing unreachable during a real download (the tick showed the
// instant the resolve landed); TrackMenu tests `downloading` first and its bar works — proof the
// data pipeline was fine and only the branch order was wrong.
//
// This helper only DECIDES. Reading the store and the reassign-for-reactivity idiom stay in the
// COMPONENTS, so both surfaces (DownloadControl's active button, RowBadges' passive ✓) can never
// disagree about what mid-download looks like.

// quick-261123-dlsrc (Hector 2026-11-23 04:05, Billy Choi《分擔》): download STATUS follows the
// CURRENT source/variant only. A song downloaded under source X stays in the downloads library
// (and `library.downloadUidFor` still resolves it for offline PLAYBACK), but when the track's
// current source is Y that old-source file must NOT surface as this track's download status —
// the menu otherwise showed "✓ Downloaded · MP3 · 6.0 MB" (X's file) beside "Download from
// source" (for Y) at once, two contradictory statuses for one track. The pure decision lives
// here, beside downloadState, so the library store and every status surface share ONE rule.
export type DownloadIdentity = { uid: string; source: string };

/**
 * True only when `downloads` holds THIS track's exact variant: same uid AND same source.
 * A same-song entry under another source's uid (isSameShelfSong / downloadUidFor territory)
 * is deliberately NOT a match — it is a different source's file, not the current source's
 * download. An empty uid never matches (a name-stub has no variant identity yet).
 */
export function isDownloadedForCurrentSource(
	downloads: readonly DownloadIdentity[],
	track: DownloadIdentity | null | undefined
): boolean {
	if (!track?.uid) return false;
	return downloads.some((d) => d.uid === track.uid && d.source === track.source);
}

/** The current-source download's uid, or null — the status-surface twin of downloadUidFor. */
export function downloadUidForCurrentSource(
	downloads: readonly DownloadIdentity[],
	track: DownloadIdentity | null | undefined
): string | null {
	return isDownloadedForCurrentSource(downloads, track) ? (track?.uid ?? null) : null;
}

/**
 * The TrackMenu download-cell face for a track, computed against its CURRENT source only:
 * 'downloaded' when the current variant is downloaded, 'download-from-source' otherwise.
 * The two faces are mutually exclusive by construction — a menu can never show both at once.
 */
export function trackMenuDownloadFace(s: {
	downloads: readonly DownloadIdentity[];
	track: DownloadIdentity | null | undefined;
	blobPresent?: boolean | null;
}): 'downloaded' | 'download-from-source' {
	// blobPresent is probed by exact uid (blobStore.has(track.uid)), so it is already a
	// current-variant signal; the downloads-list read goes through the current-source rule.
	if (s.blobPresent === true || isDownloadedForCurrentSource(s.downloads, s.track)) return 'downloaded';
	return 'download-from-source';
}

export type DownloadState = 'busy' | 'unavailable' | 'downloaded' | 'idle';

export function downloadState(s: {
	downloading: boolean;
	downloaded: boolean;
	unavailable: boolean;
}): DownloadState {
	if (s.downloading) return 'busy';
	// 34-D-06: a download whose file the OS no longer has. Only meaningful FOR a download, which
	// mirrors the guard this replaced (`isDownloaded && isUnavailable`).
	if (s.downloaded) return s.unavailable ? 'unavailable' : 'downloaded';
	return 'idle';
}
