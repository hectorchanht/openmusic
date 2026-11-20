// sweep.ts — "re-download the downloads whose bytes are not on THIS device" (35-D-06 / 35-D-07).
//
// D-07: "missing" is DERIVED from blob presence at probe time and is never stored in the backup
// file. That is what reconciles a Replace-import with a device that has real local downloads: an
// imported entry whose bytes happen to be here reads as downloaded, one whose bytes are absent
// reads as missing. It is also what makes the sweep idempotent and resumable for free — a run that
// dies halfway simply has a smaller missing set next time. No progress bookmark, no resume token,
// no new persisted key.
//
// CONCURRENCY 1 IS A HARD REQUIREMENT, NOT A STYLE CHOICE. The audio-bytes fetch inside
// downloadTrack (download-track.ts) is a RAW fetch, deliberately outside the apiFetch governor —
// a full-file body must not go through the JSON governor's dedupe/cap. So the governor's
// concurrency cap and circuit breaker protect the RESOLVE half of a download and nothing else. A
// parallel sweep over a few hundred songs would issue that many simultaneous multi-megabyte body
// reads against a ~6-connection pool: exactly the shape of the api-fetch-flood-freeze incident,
// with far larger bodies. Sequential + a small stagger + a stop signal is the complete mitigation,
// and it is ten lines. The loop shape is copied from the album page's bulk download, the only
// pacing precedent in the repo.
//
// DEPENDENCY INJECTION, not vi.mock: download-track.ts transitively imports the player / library /
// settings / names runes stores, so importing it here would drag runes into the single node Vitest
// project. Both dependencies arrive as function arguments (the same trick download-save.ts uses for
// its injectable `doc`), which keeps this module pure `.ts` and its test free of module mocking.
//
// Type-only imports below are erased at build time, so they create no runtime dependency.

import type { Track } from '$lib/sources/types';
import type { DownloadResult } from '$lib/services/download-track';

export interface SweepDeps {
	/** "are the bytes actually here?" — inject blobStore.has. Must never throw; a throw reads as absent. */
	has: (uid: string) => Promise<boolean>;
	/** inject `(t) => downloadTrack(t, { save: false })` — the silent-repair mode, so N songs pop zero save dialogs. */
	download: (track: Track) => Promise<DownloadResult>;
	/** the user's Stop. Checked at the top of every iteration. */
	signal?: AbortSignal;
	/** inter-item stagger; default 250 ms (the album bulk path's proven value). Tests pass 0. */
	delayMs?: number;
	/** called once per PROCESSED track, skipped ones included, so a progress bar reaches the end. */
	onProgress?: (done: number, total: number) => void;
}

export interface SweepResult {
	saved: number;
	failed: number;
	skipped: number;
	stopped: boolean;
}

/**
 * Which of `tracks` have no bytes on this device. Probes are issued together: on web each is an
 * index-only IndexedDB lookup against one cached connection (single-digit milliseconds for a few
 * hundred entries); on native each is a `stat` over the bridge, the slower branch, but this runs
 * once when the page mounts, not per frame.
 *
 * ACCEPTED ASYMMETRY: the native probe applies a minimum-size floor and the web probe does not, so
 * on web a truncated zero-byte record reports present here while playback treats it as a miss. The
 * player's own repair path already re-downloads such a file on the next play attempt — widening
 * the sweep's job to cover it would mean reading every blob's bytes just to count them.
 */
export async function findMissing(tracks: readonly Track[], has: SweepDeps['has']): Promise<Track[]> {
	const present = await Promise.all(tracks.map((t) => has(t.uid).catch(() => false)));
	return tracks.filter((_, i) => !present[i]);
}

/**
 * Re-download every track whose bytes are absent, one at a time. Never throws: an injected
 * `download` that rejects counts as a failure, same as a 'failed' sentinel.
 */
export async function sweepMissing(tracks: readonly Track[], deps: SweepDeps): Promise<SweepResult> {
	const delayMs = deps.delayMs ?? 250;
	const total = tracks.length;
	let saved = 0;
	let failed = 0;
	let skipped = 0;
	let done = 0;
	let stopped = false;

	for (const track of tracks) {
		if (deps.signal?.aborted) {
			stopped = true;
			break;
		}
		// Re-probe HERE rather than filtering up front: state can change underneath a run that
		// takes minutes (the player's repair path, another tab, a manual download), and a
		// per-iteration probe is what makes the whole loop restartable with no state of its own.
		const present = await deps.has(track.uid).catch(() => false);
		if (present) {
			skipped++;
			deps.onProgress?.(++done, total);
			continue;
		}
		let result: DownloadResult;
		try {
			result = await deps.download(track);
		} catch {
			result = 'failed';
		}
		// 'no-audio' folds into failed on purpose: the user wants one number for "did not come back".
		if (result === 'saved') saved++;
		else failed++;
		deps.onProgress?.(++done, total);
		// Stagger so browser doesn't squash concurrent downloads / hit per-origin caps.
		if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
	}

	return { saved, failed, skipped, stopped };
}
