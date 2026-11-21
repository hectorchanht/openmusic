// canon-migration — "Re-download to Canon" (quick-261121-canon, Hector 2026-11-21
// 02:21 CST: "After Canon is done we have to let user re-download their songs to
// Canon"). Downloads made before the canonical system live under the old
// per-source regime (divergent covers/metadata). This module is the migration
// engine; the job state + Library bar live in stores/canon-migration.svelte.ts
// and the downloads tab (the heal-downloads idiom).
//
// THE RULES (Hector's spec):
//   - DETECTION: a download is pre-Canon when its song's canonical record is not
//     flagged downloaded. Post-Canon downloads carry their record at save time
//     (download-track → carryRecordWithDownload), so the flag IS the boundary.
//   - USER-INITIATED ONLY, at the point of use (FORCE REFRESH philosophy): this
//     never runs silently; the Library bar shows the count + total size first.
//   - VERIFY-THEN-REPLACE: the old blob is snapshotted before anything moves;
//     the fresh payload must land ('saved') before the song counts as upgraded,
//     and ANY failure restores the snapshot byte-for-byte and clears the
//     unavailable mark the failed attempt set — the old copy keeps playing.
//   - USER DATA SURVIVES UNTOUCHED: likes, play counts, pins and playlists are
//     keyed by the download's uid, and the re-download keeps that exact identity
//     (the donor bytes, when the default variant differs, are saved UNDER the
//     original uid via downloadTrack's audioFrom contract). This module never
//     references a user-data seam at all — survival is structural.
//   - RE-BASED ON THE GOLDEN RECORD: the record resolves FIRST (canonical
//     cover/title/lyrics), and when the record's default variant (pin >
//     official/original > auto) is a different instance, its audio is the
//     payload — the official-first rule applied to the bytes themselves.

import type { Track } from '$lib/sources/types';
import { getTrackRecord, getDefaultVariantUid } from './track-record';
import { resolveTrackRecord } from './track-resolve';
import { downloadTrack, type DownloadResult } from './download-track';
import { fetchVariants } from './variants';
import { ensureTrackDetails } from './catalog';
import { blobStore } from './blob-store';
import { library } from '$lib/stores/library.svelte';

/** True when the song's canonical record exists and is flagged downloaded. */
export function isCanonBound(artist: string, title: string): boolean {
	return getTrackRecord(artist ?? '', title ?? '')?.downloaded === true;
}

/** The pre-Canon downloads among `tracks` (detection — pure read, never throws). */
export function findPreCanonDownloads<T extends { artist: string; title: string }>(tracks: readonly T[]): T[] {
	return tracks.filter((t) => !isCanonBound(t.artist, t.title));
}

/**
 * Total size of the CURRENT copies (the honest number to show before starting:
 * fresh copies are re-fetched at the user's download quality). Sums blob stats;
 * entries without a blob count as 0. Never throws.
 */
export async function estimateSizeBytes(
	tracks: readonly Track[],
	stat: (uid: string) => Promise<{ bytes: number } | null> = (uid) => blobStore.stat(uid)
): Promise<number> {
	let total = 0;
	for (const t of tracks) {
		try {
			const s = t.uid ? await stat(t.uid) : null;
			if (s && Number.isFinite(s.bytes)) total += s.bytes;
		} catch {
			/* a stat failure just under-counts — never block the offer on it */
		}
	}
	return total;
}

export interface CanonMigrationDeps {
	resolveRecord: (track: Track) => Promise<unknown>;
	defaultVariantUid: (track: Track) => string | null;
	fetchVariantTrack: (track: Track, uid: string) => Promise<Track | null>;
	download: (track: Track, opts?: { audioFrom?: Track }) => Promise<DownloadResult>;
	getBlob: (uid: string) => Promise<Blob | null>;
	putBlob: (uid: string, blob: Blob) => Promise<unknown>;
	clearUnavailable: (uid: string) => void;
}

const realDeps: CanonMigrationDeps = {
	resolveRecord: (track) => resolveTrackRecord(track.artist, track.title, track),
	defaultVariantUid: (track) => getDefaultVariantUid(track.artist, track.title),
	fetchVariantTrack: async (track, uid) => {
		try {
			const list = await fetchVariants(track);
			const v = list.find((x) => x.uid === uid);
			if (!v) return null;
			const r = await ensureTrackDetails({ ...v, detailsLoaded: false, audioUrl: null }).catch(() => null);
			return r?.audioUrl ? r : null;
		} catch {
			return null;
		}
	},
	download: (track, opts) => downloadTrack(track, opts),
	getBlob: (uid) => blobStore.get(uid).catch(() => null),
	putBlob: (uid, blob) => blobStore.put(uid, blob),
	clearUnavailable: (uid) => library.clearUnavailable(uid)
};

export type CanonUpgradeResult = 'upgraded' | 'kept-old';

/**
 * Re-download ONE song onto its canonical record, verify-then-replace.
 * Returns 'upgraded' only when the fresh payload actually saved (which also
 * carries the record — downloadTrack's save seam flags it downloaded, so the
 * song leaves the pre-Canon list on its own). Any failure restores the old
 * blob and returns 'kept-old'. Never throws.
 */
export async function redownloadToCanon(
	track: Track,
	deps: CanonMigrationDeps = realDeps
): Promise<CanonUpgradeResult> {
	const uid = track?.uid ?? '';
	// (1) Snapshot the old copy BEFORE anything moves — the replace is only
	//     allowed to become visible once the new payload is verified saved.
	const snapshot = uid ? await deps.getBlob(uid).catch(() => null) : null;
	try {
		// (2) The golden record resolves first: canonical cover/title/lyrics and
		//     the variant set the default is picked from.
		await deps.resolveRecord(track).catch(() => null);
		// (3) Default variant per the official-first rule: when it is a DIFFERENT
		//     instance, its audio becomes the payload — saved under the ORIGINAL
		//     uid (audioFrom contract), so every uid-keyed user datum survives.
		let audioFrom: Track | undefined;
		const defUid = deps.defaultVariantUid(track);
		if (defUid && defUid !== uid) {
			audioFrom = (await deps.fetchVariantTrack(track, defUid).catch(() => null)) ?? undefined;
		}
		// (4) The download itself (never throws by its own contract, but be safe).
		const res = await deps.download(track, audioFrom ? { audioFrom } : undefined).catch(
			() => 'failed' as DownloadResult
		);
		if (res === 'saved') return 'upgraded';
	} catch {
		/* fall through to the restore — a failed upgrade keeps the old copy */
	}
	// (5) Verify-then-replace's other half: put the old bytes back and lift the
	//     unavailable mark the failed attempt set, so the entry is byte- and
	//     state-identical to before the attempt.
	if (snapshot && uid) {
		await deps.putBlob(uid, snapshot).catch(() => {});
		try {
			deps.clearUnavailable(uid);
		} catch {
			/* the restore of the bytes already landed; the mark is cosmetic */
		}
	}
	return 'kept-old';
}
