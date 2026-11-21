import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	isCanonBound,
	findPreCanonDownloads,
	estimateSizeBytes,
	redownloadToCanon,
	type CanonMigrationDeps
} from './canon-migration';
import { recordTrackCoverCandidates, markTrackDownloaded, bustTrackRecord } from './track-record';
import { makeUid, type Track } from '$lib/sources/types';

// canon-migration (quick-261121-canon, Hector 2026-11-21 02:21 CST) — pins:
//   DETECTION: pre-Canon = the song's record is not flagged downloaded.
//   VERIFY-THEN-REPLACE: a failed re-download restores the old blob byte-for-
//   byte and clears the unavailable mark; only a saved payload upgrades.
//   GOLDEN RE-BASE: the record resolves BEFORE the download; when the default
//   variant (official-first) is another instance, its audio is the payload —
//   saved under the ORIGINAL uid.
//   USER DATA SURVIVES: the migration's dep surface contains no user-data seam
//   (likes / play counts / pins / playlists) at all, and the download is always
//   addressed to the original track identity.

class MemStorage {
	private m = new Map<string, string>();
	getItem(k: string): string | null {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string): void {
		this.m.set(k, String(v));
	}
	removeItem(k: string): void {
		this.m.delete(k);
	}
	clear(): void {
		this.m.clear();
	}
}

beforeEach(() => {
	(globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
});

function track(source: 'qq' | 'bilibili', songid: string, artist: string, title: string): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		artist,
		title,
		album: '',
		cover: null,
		duration: 0,
		audioUrl: null,
		lrc: null,
		detailsLoaded: false
	} as Track;
}

const OLD_BLOB = new Blob(['old-bytes'], { type: 'audio/mpeg' });

function deps(overrides: Partial<CanonMigrationDeps> = {}): CanonMigrationDeps & {
	calls: string[];
	putBlob: ReturnType<typeof vi.fn>;
	clearUnavailable: ReturnType<typeof vi.fn>;
	download: ReturnType<typeof vi.fn>;
} {
	const calls: string[] = [];
	const base = {
		calls,
		resolveRecord: vi.fn(async () => {
			calls.push('resolve');
			return null;
		}),
		defaultVariantUid: vi.fn(() => null),
		fetchVariantTrack: vi.fn(async () => null),
		download: vi.fn(async () => {
			calls.push('download');
			return 'saved' as const;
		}),
		getBlob: vi.fn(async () => OLD_BLOB),
		putBlob: vi.fn(async () => {
			calls.push('restore');
			return true;
		}),
		clearUnavailable: vi.fn(() => {
			calls.push('clearUnavailable');
		}),
		...overrides
	};
	return base as never;
}

describe('detection — pre-Canon downloads', () => {
	it('a download is pre-Canon until its record is flagged downloaded', () => {
		const t = track('qq', '1', 'Artist', 'Song');
		expect(isCanonBound('Artist', 'Song')).toBe(false);
		expect(findPreCanonDownloads([t])).toEqual([t]);
		// A resolved-but-not-downloaded record does NOT bind the download.
		recordTrackCoverCandidates('Artist', 'Song', [{ url: 'https://cdn/c.jpg', source: 'chain' }]);
		expect(isCanonBound('Artist', 'Song')).toBe(false);
		markTrackDownloaded('Artist', 'Song', t.uid);
		expect(isCanonBound('Artist', 'Song')).toBe(true);
		expect(findPreCanonDownloads([t])).toEqual([]);
		bustTrackRecord('Artist', 'Song');
		expect(isCanonBound('Artist', 'Song')).toBe(false);
	});

	it('size estimate sums the CURRENT blobs and tolerates missing ones', async () => {
		const a = track('qq', '1', 'A', 'One');
		const b = track('qq', '2', 'B', 'Two');
		const stat = vi.fn(async (uid: string) => (uid === a.uid ? { bytes: 5_000_000 } : null));
		await expect(estimateSizeBytes([a, b], stat)).resolves.toBe(5_000_000);
	});
});

describe('verify-then-replace', () => {
	it('success: record resolves BEFORE the download; no restore happens', async () => {
		const t = track('qq', '1', 'Artist', 'Song');
		const d = deps();
		await expect(redownloadToCanon(t, d)).resolves.toBe('upgraded');
		expect(d.calls).toEqual(['resolve', 'download']);
		expect(d.putBlob).not.toHaveBeenCalled();
		expect(d.clearUnavailable).not.toHaveBeenCalled();
		// The download is addressed to the ORIGINAL track identity (uid survival).
		expect(d.download).toHaveBeenCalledWith(t, undefined);
	});

	it('failure: the old blob is restored byte-for-byte and the mark is cleared', async () => {
		const t = track('qq', '1', 'Artist', 'Song');
		const d = deps({ download: vi.fn(async () => 'failed' as const) });
		await expect(redownloadToCanon(t, d)).resolves.toBe('kept-old');
		expect(d.putBlob).toHaveBeenCalledWith(t.uid, OLD_BLOB);
		expect(d.clearUnavailable).toHaveBeenCalledWith(t.uid);
	});

	it('a throwing download still restores and never throws', async () => {
		const t = track('qq', '1', 'Artist', 'Song');
		const d = deps({
			download: vi.fn(async () => {
				throw new Error('network died');
			})
		});
		await expect(redownloadToCanon(t, d)).resolves.toBe('kept-old');
		expect(d.putBlob).toHaveBeenCalledWith(t.uid, OLD_BLOB);
	});

	it('no snapshot (blob already gone): failure restores nothing, still kept-old', async () => {
		const t = track('qq', '1', 'Artist', 'Song');
		const d = deps({
			getBlob: vi.fn(async () => null),
			download: vi.fn(async () => 'failed' as const)
		});
		await expect(redownloadToCanon(t, d)).resolves.toBe('kept-old');
		expect(d.putBlob).not.toHaveBeenCalled();
	});
});

describe('golden re-base — the default variant supplies the payload', () => {
	it('default variant is another instance → its audio rides audioFrom under the original uid', async () => {
		const t = track('bilibili', 'L1', 'Artist', 'Song (Live)');
		const official = track('qq', 'O1', 'Artist', 'Song (Live)');
		const d = deps({
			defaultVariantUid: vi.fn(() => official.uid),
			fetchVariantTrack: vi.fn(async () => official)
		});
		await expect(redownloadToCanon(t, d)).resolves.toBe('upgraded');
		expect(d.download).toHaveBeenCalledWith(t, { audioFrom: official });
	});

	it('default variant unfetchable → falls back to a plain re-download of the original', async () => {
		const t = track('bilibili', 'L1', 'Artist', 'Song (Live)');
		const d = deps({
			defaultVariantUid: vi.fn(() => 'qq:O1'),
			fetchVariantTrack: vi.fn(async () => null)
		});
		await expect(redownloadToCanon(t, d)).resolves.toBe('upgraded');
		expect(d.download).toHaveBeenCalledWith(t, undefined);
	});

	it('default variant IS the download itself → no donor fetch at all', async () => {
		const t = track('qq', 'O1', 'Artist', 'Song');
		const d = deps({ defaultVariantUid: vi.fn(() => t.uid) });
		await redownloadToCanon(t, d);
		expect(d.fetchVariantTrack).not.toHaveBeenCalled();
		expect(d.download).toHaveBeenCalledWith(t, undefined);
	});
});
