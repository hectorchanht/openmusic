// heal.svelte.ts — the "Heal all failed downloads" run state (quick-261105-heal, Hector 2026-11-05).
//
// WHY A STORE: a heal run over dozens of failed songs takes minutes, and the user WILL navigate
// while it runs — the same reason album jobs live in the library store rather than on the album
// page (debug download-state-lost-on-page-return). The job state is $state here, so the Library
// downloads tab (and any future surface) re-reads the live counter on remount. Transient only —
// never persisted; a reload starts clean and the failed list is simply re-derived from
// `library.unavailable`.
//
// THE RUN: the backup sweep's sequential loop (`sweepMissing` — concurrency 1 + 250 ms stagger
// is a HARD requirement there, because a download's body fetch is a raw fetch outside the
// apiFetch governor; a parallel heal would recreate the flood this feature exists to fix). Each
// song goes through `downloadTrackWithDonor` in the silent-repair shape (`save: false` — the
// offline blob + native public copy are re-persisted, no per-song save dialog on web), so a
// song whose own provider is blocked heals from another source at the same quality tier under
// its original uid, and a song that healed mid-run (a manual retry, the player repair) is
// skipped by the sweep's per-iteration blob re-probe.
import type { Track } from '$lib/sources/types';
import { sweepMissing } from '$lib/backup/sweep';
import { blobStore } from '$lib/services/blob-store';
import { downloadTrackWithDonor } from '$lib/services/download-track';

export interface HealJob {
	done: number;
	total: number;
	saved: number;
}

class HealDownloads {
	/** The in-flight heal run, or null. Reactive via $state — surfaces read it one-way. */
	job = $state<HealJob | null>(null);

	/**
	 * Heal every track in `tracks` (the caller passes the failed/unavailable downloads).
	 * Claim-once: a second call while a run is in flight — or with an empty list — is a no-op
	 * returning null. Otherwise resolves `{ saved, total }` when the run settles; the job state
	 * is cleared in the `finally`, and healed songs drop off the caller's failed list on their
	 * own because a saved download clears its unavailable mark.
	 */
	async healAll(tracks: readonly Track[]): Promise<{ saved: number; total: number } | null> {
		if (this.job || !tracks.length) return null;
		const total = tracks.length;
		this.job = { done: 0, total, saved: 0 };
		try {
			const r = await sweepMissing(tracks, {
				has: (uid) => blobStore.has(uid),
				download: async (tr) => {
					const res = await downloadTrackWithDonor(tr, { save: false });
					if (res === 'saved' && this.job) this.job = { ...this.job, saved: this.job.saved + 1 };
					return res;
				},
				onProgress: (done) => {
					if (this.job) this.job = { ...this.job, done };
				}
			});
			return { saved: r.saved + r.skipped, total };
		} finally {
			this.job = null;
		}
	}
}

export const healDownloads = new HealDownloads();
