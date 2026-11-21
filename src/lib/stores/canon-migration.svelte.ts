// canon-migration.svelte.ts — the ManyToCanon migration run state ("Re-download to Canon")
// (quick-261121-canon, Hector 2026-11-21). Mirrors heal.svelte.ts exactly: a run
// over dozens of songs takes minutes and the user WILL navigate while it runs,
// so the job state lives in a store, not on the Library page. Transient only —
// never persisted; a reload starts clean and the pre-Canon list is re-derived
// from the records (canon-migration's findPreCanonDownloads).
//
// THE RUN: the backup sweep's sequential loop (sweepMissing — concurrency 1 +
// 250 ms stagger, the hard requirement for raw-fetch download bodies). The
// sweep's per-iteration re-probe is the canon-bound check: a song upgraded
// mid-run (this run, a manual download, another surface) is skipped. Each song
// goes through redownloadToCanon — verify-then-replace, so a failed upgrade
// keeps the old copy and stays on the pre-Canon list for the next attempt.
import type { Track } from '$lib/sources/types';
import { sweepMissing } from '$lib/backup/sweep';
import { findPreCanonDownloads, isCanonBound, redownloadToCanon } from '$lib/services/canon-migration';

export interface CanonMigrationJob {
	done: number;
	total: number;
	saved: number;
}

class CanonMigration {
	/** The in-flight migration run, or null. Reactive via $state. */
	job = $state<CanonMigrationJob | null>(null);

	/** The pre-Canon downloads among the library's downloads (reactive detection). */
	preCanon(downloads: readonly Track[]): Track[] {
		return findPreCanonDownloads(downloads);
	}

	/**
	 * Upgrade every track in `tracks` onto its canonical record. Claim-once: a
	 * second call while a run is in flight — or with an empty list — is a no-op
	 * returning null. Resolves `{ saved, total }` when the run settles.
	 */
	async migrateAll(tracks: readonly Track[]): Promise<{ saved: number; total: number } | null> {
		if (this.job || !tracks.length) return null;
		const total = tracks.length;
		const byUid = new Map(tracks.map((t) => [t.uid, t] as const));
		this.job = { done: 0, total, saved: 0 };
		try {
			const r = await sweepMissing(tracks, {
				// Re-probe per iteration: already canon-bound → skip (upgraded ≠ missing,
				// but the sweep's contract is "has what it needs → skip"; here what a
				// song needs is its record binding).
				has: async (uid) => {
					const t = byUid.get(uid);
					return t ? isCanonBound(t.artist, t.title) : false;
				},
				download: async (tr) => {
					const res = await redownloadToCanon(tr);
					if (res === 'upgraded' && this.job) this.job = { ...this.job, saved: this.job.saved + 1 };
					return res === 'upgraded' ? 'saved' : 'failed';
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

export const canonMigration = new CanonMigration();
