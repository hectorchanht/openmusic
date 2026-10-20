// download-upgrade — PURE decision helpers for the playing-track quality upgrade
// (quick-261020-hqswitch). NO runes, NO `$app`, NO store imports — the player store
// passes plain values in, exactly like media-session.ts's helpers, so this is
// node-Vitest-testable without mocking any store.
//
// THE FEATURE: a song is streaming at a standard tier; the user downloads that same
// song at a higher tier (the Download row at downloadQuality, or a "Download from…"
// pick). When the save lands, the player hot-swaps the loaded track's src to the
// downloaded local file — same position, same play/pause state — instead of waiting
// for the next play() to take the offline-blob branch. This module owns ONLY the
// "should we swap" decision; the swap itself (blob read, pendingSeek, driveSrc)
// lives in player.svelte.ts next to reresolveCurrent, its shape-twin.

/**
 * Coarse quality ladder for a source's quality TAG: 0 unknown · 1 standard band ·
 * 2 the 320k band · 3 lossless. The bands mirror donorRank's tag regexes in
 * download-track.ts (qq 'hq' is its 320k tier; netease/kuwo spell it '320k';
 * 'standard' is qq's 128k tier) — donorRank additionally weighs container evidence
 * from a probe, which a saved record does not carry, so the tag is all we rank here.
 * An unknown/null tag ranks 0: it can be upgraded FROM, never upgraded TO (we never
 * swap toward a file whose tier we cannot name — the conservative posture
 * currentQualityMeets takes in download-track.ts).
 */
export function qualityRank(quality: string | null | undefined): 0 | 1 | 2 | 3 {
	if (!quality) return 0;
	const q = quality.toLowerCase();
	if (/lossless|flac|sq|hi-?res|无损/.test(q)) return 3;
	if (/320|hq/.test(q)) return 2;
	// donorRank's standard band, plus 'std' — this helper may be handed a qualityLabel
	// (the record fallback in the caller), and 'std' is how labels spell the same band.
	if (/128|160|192|standard|std|low/.test(q)) return 1;
	return 0;
}

/** Everything the adopt decision needs, as plain values (the store reads them off
 *  `player.current`, the download record and the <audio> element). */
export interface AdoptDownloadInput {
	/** uid of the track loaded in the player (null = nothing loaded). */
	currentUid: string | null;
	/** uid the completed download was keyed by. */
	downloadedUid: string | null;
	/** Quality tag of what is actually streaming right now (may be stale for a
	 *  previously-downloaded track — that staleness IS the pre-upgrade truth). */
	currentQuality: string | null;
	/** Quality tag of the file just saved (from the download record, the authority
	 *  on what is on disk — abq3's rule). */
	downloadedQuality: string | null;
	/** Seconds left in the loaded src (duration − position); null when the duration
	 *  is not known yet. */
	remainingSec: number | null;
}

/**
 * Don't swap into the track's final breath: the remaining seconds would play at the
 * old tier either way, and the next play / repeat-one loop takes the offline-blob
 * branch and gets the new file then. 2s is below any audible benefit and above the
 * clamp noise between two encodes of the same song (durations differ by ~1s).
 */
export const ADOPT_MIN_REMAINING_SEC = 2;

/**
 * Should the player hot-swap the loaded track to the just-downloaded file?
 * True only when ALL of:
 *  - the download is for the track actually loaded (uid match, both non-null);
 *  - the saved file's tier is STRICTLY higher than the streaming tier (an equal
 *    tier is the same listening experience — swapping would only glitch it; a
 *    lower tier is a downgrade the user picked for storage, not for playback);
 *  - the track is not about to end (see ADOPT_MIN_REMAINING_SEC).
 */
export function shouldAdoptDownloaded(i: AdoptDownloadInput): boolean {
	if (!i.currentUid || !i.downloadedUid || i.currentUid !== i.downloadedUid) return false;
	if (qualityRank(i.downloadedQuality) <= qualityRank(i.currentQuality)) return false;
	if (i.remainingSec != null && i.remainingSec < ADOPT_MIN_REMAINING_SEC) return false;
	return true;
}
