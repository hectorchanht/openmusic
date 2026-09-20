// download-state — the ONE precedence rule behind every download affordance (quick-260919-v71),
// lifted beside the component in the track-menu-gate.ts idiom: pure, no store import, no `$state`,
// node-testable under the server-only Vitest project.
//
// WHY THIS EXISTS: `library.isDownloaded(uid)` is NOT a "finished" signal. `downloadTrack` calls
// `library.addDownload` BEFORE the fetch, deliberately, so a failed save still leaves the song in
// the library (DL-BUG-01). The ONLY finished signal is `library.endDownload` in downloadTrack's
// `finally` — i.e. the uid leaving `library.downloading`. So `downloading` is the stronger, more
// specific state and MUST be tested before `downloaded`. DownloadControl had the branches the other
// way round, which made its DownloadRing unreachable during a real download (the tick showed the
// instant the resolve landed); TrackMenu tests `downloading` first and its bar works — proof the
// data pipeline was fine and only the branch order was wrong.
//
// This helper only DECIDES. Reading the store and the reassign-for-reactivity idiom stay in the
// COMPONENTS, so both surfaces (DownloadControl's active button, RowBadges' passive ✓) can never
// disagree about what mid-download looks like.

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
