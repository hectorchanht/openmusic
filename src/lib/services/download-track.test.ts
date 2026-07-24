import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Track } from '$lib/sources/types';

// download-track.ts is the ONE shared, node-testable single-song download orchestration extracted
// from TrackMenu.doDownload (DL-FILE-01 / DL-BUG-01 / DL-STATE-01). It must:
//   - bracket library.beginDownload/endDownload around the work (endDownload in a `finally`);
//   - reuse player.current's already-resolved URL when the uid matches AND its quality meets the
//     download tier (pzs-04 — no second concurrent resolve), else re-resolve on a COPY;
//   - RAW-fetch the resolved absolute CDN URL → Blob, persist via blobStore.put(uid, blob, filename)
//     (unless opts.persist === false), and save via saveBlobToDisk;
//   - NEVER throw, NEVER call window.open, and NEVER mutate player state (D-18 isolation).
// The node Vitest project has no jsdom, so every store/service dep is mocked here; the REAL pure
// download-filename helper runs so the exact `{artist} - {title}.{ext}` output is asserted end-to-end.

// ---- hoisted mocks (referenced inside the vi.mock factories below) --------------------------------
const mocks = vi.hoisted(() => ({
	library: {
		beginDownload: vi.fn((_uid: string) => {}),
		endDownload: vi.fn((_uid: string) => {}),
		addDownload: vi.fn((_t: unknown) => {}),
		isDownloaded: vi.fn((_uid: string) => false)
	},
	// player is READ-ONLY from the service — `current` / `playGen` here get throwing setters in the
	// isolation test to prove the service never writes them.
	player: { current: null as Track | null, playGen: 0 },
	settings: { downloadQuality: 'lossless' as string },
	names: {
		dnArtist: vi.fn((s: string) => s),
		dnTitle: vi.fn((s: string) => s)
	},
	ensureTrackDetails: vi.fn(async (_t: Track, _s?: unknown, _q?: unknown) => _t),
	put: vi.fn(async (_uid: string, _blob: Blob, _filename?: string) => true),
	saveBlobToDisk: vi.fn((_blob: Blob, _filename: string) => true)
}));

vi.mock('$lib/stores/library.svelte', () => ({ library: mocks.library }));
vi.mock('$lib/stores/player.svelte', () => ({ player: mocks.player }));
vi.mock('$lib/stores/settings.svelte', () => ({ settings: mocks.settings }));
vi.mock('$lib/stores/names.svelte', () => ({ names: mocks.names }));
vi.mock('$lib/services/catalog', () => ({ ensureTrackDetails: mocks.ensureTrackDetails }));
vi.mock('$lib/services/blob-store', () => ({ blobStore: { put: mocks.put }, put: mocks.put }));
vi.mock('$lib/services/download-save', () => ({ saveBlobToDisk: mocks.saveBlobToDisk }));

import { downloadTrack, type DownloadResult } from './download-track';

// A full Track (cast so optional source-specific extras can be omitted).
const mk = (over: Partial<Track> = {}): Track =>
	({
		uid: 'netease-1',
		source: 'netease',
		songid: '1',
		title: 'Song',
		artist: 'Artist',
		album: '',
		cover: null,
		audioUrl: 'https://cdn.example.com/a.mp3',
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		quality: 'lossless',
		qualityLabel: null,
		keyword: '',
		displayIndex: 1,
		...over
	}) as Track;

let windowOpen: ReturnType<typeof vi.fn>;

function stubFetch(blob: Blob) {
	const f = vi.fn(async (_url: string) => ({ ok: true, blob: async () => blob }));
	vi.stubGlobal('fetch', f);
	return f;
}
function stubFetchReject() {
	const f = vi.fn(async (_url: string) => {
		throw new Error('network down');
	});
	vi.stubGlobal('fetch', f);
	return f;
}

beforeEach(() => {
	mocks.library.beginDownload.mockReset();
	mocks.library.endDownload.mockReset();
	mocks.library.addDownload.mockReset();
	mocks.library.isDownloaded.mockReset().mockReturnValue(false);
	// reset player as PLAIN writable data props (the isolation test swaps in throwing accessors).
	Object.defineProperty(mocks.player, 'current', { configurable: true, writable: true, value: null });
	Object.defineProperty(mocks.player, 'playGen', { configurable: true, writable: true, value: 0 });
	mocks.settings.downloadQuality = 'lossless';
	mocks.names.dnArtist.mockReset().mockImplementation((s: string) => s);
	mocks.names.dnTitle.mockReset().mockImplementation((s: string) => s);
	mocks.ensureTrackDetails.mockReset();
	mocks.put.mockReset().mockResolvedValue(true);
	mocks.saveBlobToDisk.mockReset().mockReturnValue(true);
	windowOpen = vi.fn();
	vi.stubGlobal('window', { open: windowOpen });
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('downloadTrack — happy path (non-current re-resolve → saved)', () => {
	it('re-resolves at downloadQuality on a COPY, persists + saves, returns "saved"', async () => {
		const stub = mk({ uid: 'netease-1', audioUrl: null, detailsLoaded: false });
		const resolved = mk({
			uid: 'netease-1',
			artist: 'Artist',
			title: 'Song',
			audioUrl: 'https://cdn.example.com/song.flac',
			detailsLoaded: true,
			quality: 'lossless'
		});
		mocks.ensureTrackDetails.mockResolvedValue(resolved);
		const blob = new Blob(['audio']);
		const f = stubFetch(blob);

		const res = await downloadTrack(stub);

		expect(res).toBe('saved');
		// resolved on a COPY (not the passed-in reference), audioUrl/detailsLoaded cleared, download tier
		expect(mocks.ensureTrackDetails).toHaveBeenCalledTimes(1);
		const [copyArg, sigArg, qualArg] = mocks.ensureTrackDetails.mock.calls[0];
		expect(copyArg).not.toBe(stub);
		expect((copyArg as Track).detailsLoaded).toBe(false);
		expect((copyArg as Track).audioUrl).toBeNull();
		expect(sigArg).toBeUndefined();
		expect(qualArg).toBe('lossless');
		// referenced in the library downloads list
		expect(mocks.library.addDownload).toHaveBeenCalledWith(resolved);
		// RAW fetch of the resolved absolute CDN URL
		expect(f).toHaveBeenCalledWith('https://cdn.example.com/song.flac');
		// human filename threaded to BOTH the offline blob and the save seam
		expect(mocks.put).toHaveBeenCalledWith('netease-1', blob, 'Artist - Song.flac');
		expect(mocks.saveBlobToDisk).toHaveBeenCalledWith(blob, 'Artist - Song.flac');
		// begin/end bracket
		expect(mocks.library.beginDownload).toHaveBeenCalledWith('netease-1');
		expect(mocks.library.endDownload).toHaveBeenCalledWith('netease-1');
	});

	it('runs artist/title through names.dn* for the filename (DL-FILE-01 translation)', async () => {
		mocks.names.dnArtist.mockReturnValue('邓紫棋');
		mocks.names.dnTitle.mockReturnValue('光年之外');
		mocks.ensureTrackDetails.mockResolvedValue(
			mk({ audioUrl: 'https://cdn.example.com/x.mp3', artist: 'G.E.M.', title: 'Lightyears' })
		);
		stubFetch(new Blob(['a']));

		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));

		expect(mocks.names.dnArtist).toHaveBeenCalledWith('G.E.M.');
		expect(mocks.names.dnTitle).toHaveBeenCalledWith('Lightyears');
		expect(mocks.saveBlobToDisk).toHaveBeenCalledWith(expect.any(Blob), '邓紫棋 - 光年之外.mp3');
	});
});

describe('downloadTrack — reuse-current-quality (pzs-04 isolation)', () => {
	it('reuses player.current (no second resolve) when uid matches and quality is acceptable', async () => {
		const cur = mk({
			uid: 'netease-1',
			audioUrl: 'https://cdn.example.com/cur.mp3',
			detailsLoaded: true,
			quality: 'lossless'
		});
		mocks.player.current = cur;
		mocks.settings.downloadQuality = 'lossless';
		const f = stubFetch(new Blob(['a']));

		const res = await downloadTrack(mk({ uid: 'netease-1', audioUrl: null, detailsLoaded: false }));

		expect(res).toBe('saved');
		expect(mocks.ensureTrackDetails).not.toHaveBeenCalled();
		// fetched the REUSED current URL
		expect(f).toHaveBeenCalledWith('https://cdn.example.com/cur.mp3');
		// added a COPY of current (never the live reference), and current itself is untouched
		expect(mocks.library.addDownload).toHaveBeenCalledTimes(1);
		expect(mocks.library.addDownload.mock.calls[0][0]).not.toBe(cur);
		expect(mocks.player.current).toBe(cur);
	});

	it('re-resolves (does NOT reuse) when downloadQuality is lossless but current is a lower tier', async () => {
		mocks.player.current = mk({
			uid: 'netease-1',
			audioUrl: 'https://cdn.example.com/cur.mp3',
			detailsLoaded: true,
			quality: '320'
		});
		mocks.settings.downloadQuality = 'lossless';
		mocks.ensureTrackDetails.mockResolvedValue(mk({ uid: 'netease-1', audioUrl: 'https://cdn.example.com/hi.flac' }));
		stubFetch(new Blob(['a']));

		await downloadTrack(mk({ uid: 'netease-1', audioUrl: null, detailsLoaded: false }));

		expect(mocks.ensureTrackDetails).toHaveBeenCalledTimes(1);
	});

	it('does NOT reuse a DIFFERENT uid even when it is the current track', async () => {
		mocks.player.current = mk({ uid: 'netease-999', audioUrl: 'https://cdn.example.com/other.mp3', detailsLoaded: true });
		mocks.ensureTrackDetails.mockResolvedValue(mk({ uid: 'netease-1', audioUrl: 'https://cdn.example.com/x.mp3' }));
		stubFetch(new Blob(['a']));

		await downloadTrack(mk({ uid: 'netease-1', audioUrl: null, detailsLoaded: false }));

		expect(mocks.ensureTrackDetails).toHaveBeenCalledTimes(1);
	});
});

describe('downloadTrack — no-audio', () => {
	it('returns "no-audio" and never fetches when the resolved track has no audioUrl', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: null, detailsLoaded: true }));
		const f = vi.fn();
		vi.stubGlobal('fetch', f);

		const res = await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));

		expect(res).toBe('no-audio');
		expect(f).not.toHaveBeenCalled();
		// still referenced in the library (addDownload ran before the audioUrl check)
		expect(mocks.library.addDownload).toHaveBeenCalledTimes(1);
		// endDownload ran in the finally
		expect(mocks.library.endDownload).toHaveBeenCalledWith('netease-1');
	});
});

describe('downloadTrack — failure paths (DL-BUG-01: never window.open, never throw)', () => {
	it('returns "failed" and NEVER calls window.open when the fetch rejects', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/x.mp3' }));
		stubFetchReject();

		const res = await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));

		expect(res).toBe('failed');
		expect(windowOpen).not.toHaveBeenCalled();
		// the song stays in library.downloads (addDownload ran before the fetch)
		expect(mocks.library.addDownload).toHaveBeenCalledTimes(1);
		expect(mocks.library.endDownload).toHaveBeenCalledWith('netease-1');
	});

	it('returns "failed" (no window.open) when saveBlobToDisk returns false', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/x.mp3' }));
		stubFetch(new Blob(['a']));
		mocks.saveBlobToDisk.mockReturnValue(false);

		const res = await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));

		expect(res).toBe('failed');
		expect(windowOpen).not.toHaveBeenCalled();
		expect(mocks.library.endDownload).toHaveBeenCalledWith('netease-1');
	});

	it('never rejects — degrades to the original stub when ensureTrackDetails rejects', async () => {
		mocks.ensureTrackDetails.mockRejectedValue(new Error('resolve failed'));
		const stub = mk({ uid: 'netease-1', audioUrl: 'https://cdn.example.com/stub.mp3', detailsLoaded: false });
		const f = stubFetch(new Blob(['a']));

		const res = await downloadTrack(stub);

		// fell back to the stub's own audioUrl (the `.catch(() => track)` seam)
		expect(f).toHaveBeenCalledWith('https://cdn.example.com/stub.mp3');
		expect(res).toBe('saved');
	});
});

describe('downloadTrack — persist flag (album parity)', () => {
	it('skips blobStore.put when opts.persist === false but still saves + references + brackets', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/x.mp3' }));
		stubFetch(new Blob(['a']));

		const res = await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }), { persist: false });

		expect(res).toBe('saved');
		expect(mocks.put).not.toHaveBeenCalled();
		expect(mocks.saveBlobToDisk).toHaveBeenCalledTimes(1);
		expect(mocks.library.addDownload).toHaveBeenCalledTimes(1);
		expect(mocks.library.beginDownload).toHaveBeenCalledWith('netease-1');
		expect(mocks.library.endDownload).toHaveBeenCalledWith('netease-1');
	});

	it('persists via blobStore.put when persist is omitted (defaults TRUE)', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/x.mp3' }));
		stubFetch(new Blob(['a']));

		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));

		expect(mocks.put).toHaveBeenCalledTimes(1);
	});
});

describe('downloadTrack — DOWNLOAD ISOLATION CONTRACT (D-18)', () => {
	it('never assigns player.current and never bumps player.playGen during a download', async () => {
		// Swap in throwing setters — any write to current/playGen fails the test loudly.
		const cur = mk({
			uid: 'netease-1',
			audioUrl: 'https://cdn.example.com/cur.mp3',
			detailsLoaded: true,
			quality: 'lossless'
		});
		Object.defineProperty(mocks.player, 'current', {
			configurable: true,
			get: () => cur,
			set: () => {
				throw new Error('player.current was assigned — DOWNLOAD ISOLATION broken');
			}
		});
		Object.defineProperty(mocks.player, 'playGen', {
			configurable: true,
			get: () => 0,
			set: () => {
				throw new Error('player.playGen was bumped — DOWNLOAD ISOLATION broken');
			}
		});
		mocks.settings.downloadQuality = 'lossless';
		stubFetch(new Blob(['a']));

		let res: DownloadResult | undefined;
		await expect(
			(async () => {
				res = await downloadTrack(mk({ uid: 'netease-1', audioUrl: null, detailsLoaded: false }));
			})()
		).resolves.toBeUndefined();
		expect(res).toBe('saved');
	});
});

describe('downloadTrack — import contract (node compile safety + DL-BUG-01)', () => {
	it('imports neither $lib/i18n nor $lib/stores/toast, and contains no window.open', () => {
		const src = readFileSync(new URL('./download-track.ts', import.meta.url), 'utf8')
			.split('\n')
			.filter((l) => !l.trim().startsWith('//'))
			.join('\n');
		expect(src).not.toContain('$lib/i18n');
		expect(src).not.toContain('$lib/stores/toast');
		expect(src).not.toContain('window.open');
	});
});
