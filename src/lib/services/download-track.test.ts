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

// The tagger's return shape, kept loose here so a test can stub ANY discriminant (the real union is
// narrow-by-result and would force a cast per outcome).
type TagOutcomeLike = { blob: Blob; result: string; format?: string };

// ---- hoisted mocks (referenced inside the vi.mock factories below) --------------------------------
const mocks = vi.hoisted(() => ({
	library: {
		beginDownload: vi.fn((_uid: string) => {}),
		endDownload: vi.fn((_uid: string) => {}),
		addDownload: vi.fn((_t: unknown) => {}),
		isDownloaded: vi.fn((_uid: string) => false)
	},
	// player is READ-ONLY from the service — `current` / `playGen` here get throwing setters in the
	// isolation test to prove the service never writes them. `resolvedCover` joins them for the
	// quick-260914-to2 display-cover ladder — also read-only.
	// quick-260920-oj8: `displayCover` is the ONE now-playing cover reader (pin → uid → name →
	// resolvedCover) and is what this service now embeds for the playing song — also read-only.
	player: {
		current: null as Track | null,
		playGen: 0,
		resolvedCover: null as string | null,
		displayCover: null as string | null
	},
	// quick-260914-to2: the shared reactive cover cache. Defaults to null so every PRE-EXISTING
	// artwork assertion (which expects `r.cover`) keeps passing through the ladder unchanged.
	readCoverByUidOrName: vi.fn((_u: string, _a: string, _t: string): string | null => null),
	settings: { downloadQuality: 'lossless' as string },
	names: {
		dnArtist: vi.fn((s: string) => s),
		dnTitle: vi.fn((s: string) => s),
		// quick-260919-2jo: the script lock on the album tag. Identity by default (the lock is
		// 'off' for a fresh install, D-1) so every PRE-EXISTING album assertion is unchanged.
		zhLock: vi.fn((s: string) => s)
	},
	ensureTrackDetails: vi.fn(async (_t: Track, _s?: unknown, _q?: unknown) => _t),
	put: vi.fn(async (_uid: string, _blob: Blob, _filename?: string) => true),
	saveBlobToDisk: vi.fn((_blob: Blob, _filename: string) => true),
	// 36-03: the tag seam. Default = a no-op passthrough reporting success, so every PRE-EXISTING
	// test above still asserts on the fetched blob's own identity/type.
	tagAudioBlob: vi.fn(
		async (blob: Blob, _f: unknown, _a?: unknown): Promise<TagOutcomeLike> => ({ blob, result: 'tagged', format: 'm4a' })
	),
	resolveArtworkDataUrl: vi.fn(async (_q: unknown): Promise<string | null> => null),
	logAction: vi.fn((_ev: string, _d?: Record<string, unknown>) => {})
}));

vi.mock('$lib/stores/library.svelte', () => ({ library: mocks.library }));
vi.mock('$lib/stores/player.svelte', () => ({ player: mocks.player }));
// cover-version is a RUNES store — it must be mocked here or the import chain pulls $app/environment
// into the single node Vitest project (quick-260914-to2).
vi.mock('$lib/stores/cover-version.svelte', () => ({ readCoverByUidOrName: mocks.readCoverByUidOrName }));
vi.mock('$lib/stores/settings.svelte', () => ({ settings: mocks.settings }));
vi.mock('$lib/stores/names.svelte', () => ({ names: mocks.names }));
vi.mock('$lib/services/catalog', () => ({ ensureTrackDetails: mocks.ensureTrackDetails }));
vi.mock('$lib/services/blob-store', () => ({ blobStore: { put: mocks.put }, put: mocks.put }));
vi.mock('$lib/services/download-save', () => ({ saveBlobToDisk: mocks.saveBlobToDisk }));
// quick-260919-0mw: spread the REAL module so `albumTag` (a pure string helper the download seam
// now calls) is present — only the codec entry point is stubbed.
vi.mock('$lib/services/audio-tags', async (orig) => ({
	...(await orig<typeof import('$lib/services/audio-tags')>()),
	tagAudioBlob: mocks.tagAudioBlob
}));
vi.mock('$lib/services/media-artwork', () => ({ resolveArtworkDataUrl: mocks.resolveArtworkDataUrl }));
vi.mock('$lib/stores/actionLog.svelte', () => ({ logAction: mocks.logAction }));

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
		// Shared readiness guard now requires a FRESH url, so the factory's "already resolved" track
		// carries a resolve stamp — that is what `detailsLoaded: true` alone used to mean.
		resolvedAt: Date.now(),
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
	Object.defineProperty(mocks.player, 'resolvedCover', { configurable: true, writable: true, value: null });
	Object.defineProperty(mocks.player, 'displayCover', { configurable: true, writable: true, value: null });
	mocks.readCoverByUidOrName.mockReset().mockReturnValue(null);
	mocks.settings.downloadQuality = 'lossless';
	mocks.names.dnArtist.mockReset().mockImplementation((s: string) => s);
	mocks.names.dnTitle.mockReset().mockImplementation((s: string) => s);
	mocks.names.zhLock.mockReset().mockImplementation((s: string) => s);
	mocks.ensureTrackDetails.mockReset();
	mocks.put.mockReset().mockResolvedValue(true);
	mocks.saveBlobToDisk.mockReset().mockReturnValue(true);
	mocks.tagAudioBlob.mockReset().mockImplementation(async (blob: Blob) => ({ blob, result: 'tagged', format: 'm4a' }));
	mocks.resolveArtworkDataUrl.mockReset().mockResolvedValue(null);
	mocks.logAction.mockReset();
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
		// human filename threaded to BOTH the offline blob and the save seam. quick-260913-tmi: the
		// blob is no longer the fetched object by IDENTITY — it is re-typed from the audio URL's
		// container extension because the upstream Content-Type cannot be trusted — so assert on the
		// bytes, the type and the filename, which is what those two seams actually consume.
		const [putUid, putBlob, putName] = mocks.put.mock.calls[0];
		expect([putUid, putName]).toEqual(['netease-1', 'Artist - Song.flac']);
		expect(putBlob.size).toBe(blob.size);
		expect(putBlob.type).toBe('audio/flac');
		const [saveBlob, saveName] = mocks.saveBlobToDisk.mock.calls[0];
		expect(saveName).toBe('Artist - Song.flac');
		expect(saveBlob).toBe(putBlob); // the SAME blob reaches disk and the offline cache
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
		expect(mocks.names.dnTitle).toHaveBeenCalledWith('Lightyears', 'G.E.M.');
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

describe('downloadTrack — reuse a tier-satisfying INPUT track (quick-260915-26g)', () => {
	it('does NOT re-resolve when the passed-in track is already fresh and meets the tier', async () => {
		mocks.settings.downloadQuality = 'lossless';
		const f = stubFetch(new Blob(['a']));

		const res = await downloadTrack(
			mk({ uid: 'kuwo-9', audioUrl: 'https://cdn.example.com/probed.flac', quality: 'lossless', resolvedAt: Date.now() })
		);

		expect(res).toBe('saved');
		expect(mocks.ensureTrackDetails).not.toHaveBeenCalled();
		// the SAME file the probe measured reaches the fetch — label and download agree
		expect(f).toHaveBeenCalledWith('https://cdn.example.com/probed.flac');
	});

	it('still re-resolves when the passed-in track is a lower tier than the wanted lossless', async () => {
		mocks.settings.downloadQuality = 'lossless';
		mocks.ensureTrackDetails.mockResolvedValue(mk({ uid: 'kuwo-9', audioUrl: 'https://cdn.example.com/hi.flac' }));
		stubFetch(new Blob(['a']));

		await downloadTrack(
			mk({ uid: 'kuwo-9', audioUrl: 'https://cdn.example.com/lo.mp3', quality: '320k', resolvedAt: Date.now() })
		);

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

// Strip whole-line comments in all three shapes (`//`, `/*`, ` *`) — a `//`-only filter lets a
// JSDoc line through, and these guards search for identifiers that comments legitimately NAME in
// order to forbid them (36-02 hit exactly that).
const stripComments = (src: string) =>
	src
		.split('\n')
		.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
		.join('\n');

describe('downloadTrack — import contract (node compile safety + DL-BUG-01)', () => {
	it('imports neither $lib/i18n nor $lib/stores/toast, and contains no window.open', () => {
		const src = stripComments(readFileSync(new URL('./download-track.ts', import.meta.url), 'utf8'));
		expect(src).not.toContain('$lib/i18n');
		expect(src).not.toContain('$lib/stores/toast');
		expect(src).not.toContain('window.open');
	});

	// 36-D-11: `displayIndex` is INTERLEAVE ORDERING across sources (sources/types.ts), not an album
	// position. It must never reach a tag, at the seam or at the album page.
	it('routes through the tag seam and never reads displayIndex', () => {
		const src = stripComments(readFileSync(new URL('./download-track.ts', import.meta.url), 'utf8'));
		expect(src).toContain('tagAudioBlob(');
		expect(src).toContain('resolveArtworkDataUrl(');
		expect(src).not.toContain('displayIndex');
	});

	it('the album page supplies a real 1-based album position, never displayIndex', () => {
		const page = readFileSync(new URL('../../routes/(app)/album/[name]/+page.svelte', import.meta.url), 'utf8');
		const start = page.indexOf('async function downloadAlbum()');
		expect(start).toBeGreaterThan(-1);
		// Function-level close brace: the first `\n\t}` after the opening line.
		const end = page.indexOf('\n\t}', start);
		expect(end).toBeGreaterThan(start);
		const body = stripComments(page.slice(start, end));
		expect(body).toContain('trackNumber: String(i + 1)');
		expect(body).not.toContain('displayIndex');
	});
});

describe('downloadTrack — 36-D-06 TAG-OR-INTACT', () => {
	async function runWith(outcome: (blob: Blob) => TagOutcomeLike, url = 'https://cdn.example.com/x.mp3') {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: url }));
		const fetched = new Blob(['audio']);
		stubFetch(fetched);
		mocks.tagAudioBlob.mockImplementation(async (blob: Blob) => outcome(blob));
		const res = await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));
		return { res, fetched };
	}

	it('saves the ORIGINAL bytes and still returns "saved" when the container is unrecognised', async () => {
		const { res } = await runWith((blob) => ({ blob, result: 'unknown-container' }));
		expect(res).toBe('saved');
		// same object identity as what the tagger was handed — untouched bytes reach disk
		const handed = mocks.tagAudioBlob.mock.calls[0][0];
		expect(mocks.put.mock.calls[0][1]).toBe(handed);
		expect(mocks.saveBlobToDisk.mock.calls[0][0]).toBe(handed);
	});

	it('returns "saved" when the file is over the tagger size ceiling', async () => {
		const { res } = await runWith((blob) => ({ blob, result: 'skipped-size' }));
		expect(res).toBe('saved');
	});

	it('returns "saved" when the codec itself errors', async () => {
		const { res } = await runWith((blob) => ({ blob, result: 'error' }));
		expect(res).toBe('saved');
	});

	it('writes the NEW blob to both seams when tagging succeeds, keeping the derived mime', async () => {
		const { res } = await runWith(
			(blob) => ({ blob: new Blob(['tagged-audio'], { type: blob.type }), result: 'tagged', format: 'm4a' }),
			'https://cdn.example.com/song.m4a'
		);
		expect(res).toBe('saved');
		const putBlob = mocks.put.mock.calls[0][1];
		expect(putBlob).toBe(mocks.saveBlobToDisk.mock.calls[0][0]);
		expect(putBlob).not.toBe(mocks.tagAudioBlob.mock.calls[0][0]);
		// quick-260913-tmi survives tagging: the type is still the one derived from the URL
		expect(putBlob.type).toBe('audio/mp4');
	});

	it('logs the outcome once to the Activity log', async () => {
		await runWith((blob) => ({ blob, result: 'skipped-size' }));
		expect(mocks.logAction).toHaveBeenCalledTimes(1);
		const [ev, data] = mocks.logAction.mock.calls[0];
		expect(ev).toBe('download.tag');
		expect(data).toMatchObject({ uid: 'netease-1', result: 'skipped-size', art: false });
	});
});

describe('downloadTrack — 36-D-11 / 36-D-12 album context', () => {
	const fields = () => mocks.tagAudioBlob.mock.calls[0][1] as Record<string, unknown>;

	beforeEach(() => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/x.mp3', artist: 'Artist', title: 'Song' }));
		stubFetch(new Blob(['a']));
	});

	it('sends NO track number and falls albumArtist back to the track artist by default', async () => {
		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));
		expect(fields()).toEqual({
			title: 'Song',
			artist: 'Artist',
			album: undefined,
			albumArtist: 'Artist',
			trackNumber: undefined,
			lyrics: undefined
		});
	});

	it('passes the album loop\'s trackNumber and albumArtist through verbatim', async () => {
		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }), {
			persist: false,
			trackNumber: '3',
			albumArtist: 'Various'
		});
		expect(fields()).toMatchObject({ trackNumber: '3', albumArtist: 'Various' });
	});

	it('omits an empty album rather than inventing one (36-D-10)', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/x.mp3', album: '' }));
		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));
		expect(fields().album).toBeUndefined();
	});

	it('drops an album that is only the song title, keeps a real one (quick-260919-0mw)', async () => {
		// `The Weeknd - The Hills (Explicit).flac` shipped with ALBUM=`The Hills (Explicit)`.
		mocks.ensureTrackDetails.mockResolvedValue(
			mk({ audioUrl: 'https://cdn.example.com/x.mp3', title: 'The Hills (Explicit)', album: 'The Hills (Explicit)' })
		);
		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));
		expect(fields().album).toBeUndefined();

		mocks.tagAudioBlob.mockClear();
		mocks.ensureTrackDetails.mockResolvedValue(
			mk({ audioUrl: 'https://cdn.example.com/x.mp3', title: 'The Hills', album: 'Beauty Behind the Madness' })
		);
		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));
		expect(fields().album).toBe('Beauty Behind the Madness');
	});

	it('SCRIPT MISMATCH: a Simplified album equal to the Traditional display title is dropped', async () => {
		// The `Polar G - 過一招 (feat. 拉天糖).m4a` case — the album rides the RAW catalog string while
		// the filename/tag carries dnTitle, which is why BOTH titles are handed to albumTag.
		mocks.names.dnTitle.mockReturnValue('過一招 (feat. 拉天糖)');
		mocks.ensureTrackDetails.mockResolvedValue(
			mk({ audioUrl: 'https://cdn.example.com/x.m4a', title: '过一招 (feat. 拉天糖)', album: '过一招 (feat. 拉天糖)' })
		);
		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));
		expect(fields().album).toBeUndefined();
	});

	it('SCRIPT LOCK: a DISTINCT album is written in the locked script (quick-260919-2jo)', async () => {
		// What 0mw could NOT fix. Its two-title compare only drops an album that IS the song title;
		// a genuine album name kept riding the RAW catalog script, so the file carried a Traditional
		// title tag next to a Simplified album tag. The album now goes through names.zhLock.
		mocks.names.dnTitle.mockReturnValue('過一招');
		mocks.names.zhLock.mockImplementation((s: string) => (s === '爱你的宇宙' ? '愛你的宇宙' : s));
		mocks.ensureTrackDetails.mockResolvedValue(
			mk({ audioUrl: 'https://cdn.example.com/x.m4a', title: '过一招', album: '爱你的宇宙' })
		);
		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));
		expect(mocks.names.zhLock).toHaveBeenCalledWith('爱你的宇宙'); // the RAW catalog album goes in
		expect(fields().album).toBe('愛你的宇宙'); // …and the LOCKED one is tagged
	});

	it('SCRIPT LOCK off: the album tag is byte-for-byte what it is today (D-1)', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(
			mk({ audioUrl: 'https://cdn.example.com/x.m4a', title: '过一招', album: '爱你的宇宙' })
		);
		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));
		expect(fields().album).toBe('爱你的宇宙');
	});

	it('tags with the SAME translated display names the filename uses (Pattern 5)', async () => {
		mocks.names.dnArtist.mockReturnValue('邓紫棋');
		mocks.names.dnTitle.mockReturnValue('光年之外');
		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));
		expect(fields()).toMatchObject({ title: '光年之外', artist: '邓紫棋', albumArtist: '邓紫棋' });
		expect(mocks.saveBlobToDisk.mock.calls[0][1]).toBe('邓紫棋 - 光年之外.mp3');
	});
});

describe('downloadTrack — quick-260915-062 lyrics through the seam', () => {
	const fields = () => mocks.tagAudioBlob.mock.calls[0][1] as Record<string, unknown>;
	const resolved = (lrc: string | null) =>
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/x.mp3', lrc }));

	beforeEach(() => {
		stubFetch(new Blob(['a']));
	});

	it('hands the resolved LRC to the tagger verbatim, timestamps and all', async () => {
		resolved('[00:01.00]hi');
		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));
		expect(fields().lyrics).toBe('[00:01.00]hi');
	});

	it('sends undefined — never an empty string — when the track has no lyrics', async () => {
		resolved(null);
		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));
		expect(fields().lyrics).toBeUndefined();
	});

	it('omits an empty LRC rather than writing an empty frame', async () => {
		resolved('');
		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));
		expect(fields().lyrics).toBeUndefined();
	});

	// The album bulk loop (persist:false) and 31-D-12 background repair (save:false) inherit lyrics
	// from the SAME seam — proof that neither path needs wiring of its own.
	it.each([
		['album bulk', { persist: false }],
		['background repair', { save: false }]
	])('%s embeds lyrics with no path-specific wiring', async (_name, opts) => {
		resolved('[00:02.00]yo');
		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }), opts);
		expect(fields().lyrics).toBe('[00:02.00]yo');
	});
});

describe('downloadTrack — 36-D-13 / 36-D-14 artwork', () => {
	beforeEach(() => {
		stubFetch(new Blob(['a']));
	});

	it('resolves the displayed cover once and hands it to the tagger', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(
			mk({ audioUrl: 'https://cdn.example.com/x.mp3', cover: 'https://cdn-images.dzcdn.net/c.jpg' })
		);
		mocks.names.dnTitle.mockReturnValue('光年之外');
		mocks.resolveArtworkDataUrl.mockResolvedValue('data:image/jpeg;base64,AAAA');

		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));

		expect(mocks.resolveArtworkDataUrl).toHaveBeenCalledTimes(1);
		expect(mocks.resolveArtworkDataUrl.mock.calls[0][0]).toEqual({
			cover: 'https://cdn-images.dzcdn.net/c.jpg',
			title: '光年之外',
			artist: 'Artist'
		});
		expect(mocks.tagAudioBlob.mock.calls[0][2]).toBe('data:image/jpeg;base64,AAAA');
	});

	it('still writes the text tags when no artwork resolves', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/x.mp3', cover: null }));
		mocks.resolveArtworkDataUrl.mockResolvedValue(null);

		expect(await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }))).toBe('saved');

		expect(mocks.tagAudioBlob).toHaveBeenCalledTimes(1);
		expect(mocks.tagAudioBlob.mock.calls[0][2]).toBeNull();
	});
});

// quick-260914-to2 — a download embedded the branded /api/og share card instead of the cover the app
// itself displays (板斧 / Novel Flash played with the right art while its file carried the card). Cause: this
// service read `r.cover` ONLY, and a CN `Track.cover` is frequently null / non-https / CORS-dead, so the
// resolver's direct tier was skipped or failed and its /api/og tier answered. The cover every UI surface
// shows lives in the SHARED reactive cover cache, or — for the playing song — on `player.resolvedCover`.
describe('downloadTrack — quick-260914-to2 display-cover ladder', () => {
	beforeEach(() => {
		stubFetch(new Blob(['a']));
	});

	const artCover = () => (mocks.resolveArtworkDataUrl.mock.calls[0][0] as { cover: string | null }).cover;

	it('prefers the shared cover cache over a dead r.cover', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(
			mk({ audioUrl: 'https://cdn.example.com/x.mp3', cover: 'http://y.gtimg.cn/dead.jpg' })
		);
		mocks.readCoverByUidOrName.mockReturnValue('https://cdn-images.dzcdn.net/real.jpg');

		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));

		expect(artCover()).toBe('https://cdn-images.dzcdn.net/real.jpg');
	});

	it('uses the cache when r.cover is null', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/x.mp3', cover: null }));
		mocks.readCoverByUidOrName.mockReturnValue('https://cdn-images.dzcdn.net/real.jpg');

		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));

		expect(artCover()).toBe('https://cdn-images.dzcdn.net/real.jpg');
	});

	// quick-260920-oj8 — this used to assert `resolvedCover` WINS for the playing song. That was the
	// old precedence and it is exactly the bug the user's "same song, same cover everywhere" call
	// closes: after quick-260920-nyq the hero paints from the shared cache, so a stale `resolvedCover`
	// meant the file carried art the app was never showing. The DIVERGENCE is constructed on purpose —
	// `displayCover` (what the hero shows) and `resolvedCover` (the play()-entry seed) hold different
	// URLs — so reverting this site to `resolvedCover` fails this test.
	it('embeds what the HERO shows, not a stale resolvedCover, when THIS is the playing song', async () => {
		Object.defineProperty(mocks.player, 'current', {
			configurable: true,
			writable: true,
			value: mk({ uid: 'netease-1', cover: 'http://y.gtimg.cn/dead.jpg' })
		});
		// What the hero / Nowbar / OS card are painting (cache-led, per nyq).
		Object.defineProperty(mocks.player, 'displayCover', {
			configurable: true,
			writable: true,
			value: 'https://cdn-images.dzcdn.net/cache.jpg'
		});
		// The stale synchronous seed the file used to get instead.
		Object.defineProperty(mocks.player, 'resolvedCover', {
			configurable: true,
			writable: true,
			value: 'https://is1-ssl.mzstatic.com/stale.jpg'
		});
		mocks.readCoverByUidOrName.mockReturnValue('https://cdn-images.dzcdn.net/cache.jpg');

		await downloadTrack(mk({ uid: 'netease-1' }));

		expect(artCover()).toBe('https://cdn-images.dzcdn.net/cache.jpg');
	});

	// 37-D-02 rides along for free: `displayCover` keeps an embedded local-file `data:` cover ahead of
	// the https-only cache, so a downloaded file gets the file's own art — the getter owns that rule,
	// this site just has to read it.
	it('embeds an embedded data: cover the hero is showing, over a cached https cover', async () => {
		Object.defineProperty(mocks.player, 'current', { configurable: true, writable: true, value: mk({ uid: 'netease-1' }) });
		Object.defineProperty(mocks.player, 'displayCover', {
			configurable: true,
			writable: true,
			value: 'data:image/jpeg;base64,AAAA'
		});
		mocks.readCoverByUidOrName.mockReturnValue('https://cdn-images.dzcdn.net/cache.jpg');

		await downloadTrack(mk({ uid: 'netease-1' }));

		expect(artCover()).toBe('data:image/jpeg;base64,AAAA');
	});

	it('ignores the hero cover when a DIFFERENT song is playing', async () => {
		Object.defineProperty(mocks.player, 'current', {
			configurable: true,
			writable: true,
			value: mk({ uid: 'qq-9' })
		});
		Object.defineProperty(mocks.player, 'resolvedCover', {
			configurable: true,
			writable: true,
			value: 'https://is1-ssl.mzstatic.com/hero.jpg'
		});
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/x.mp3', cover: null }));
		mocks.readCoverByUidOrName.mockReturnValue('https://cdn-images.dzcdn.net/cache.jpg');

		await downloadTrack(mk({ uid: 'netease-1', audioUrl: null, detailsLoaded: false }));

		expect(artCover()).toBe('https://cdn-images.dzcdn.net/cache.jpg');
	});

	// The name layer is matchKey'd on RAW CATALOG metadata, so a display-language lookup would miss the
	// cache for exactly the users the translation exists for. The dn* strings still feed the resolver's
	// /api/og TEXT query — a different consumer.
	it('queries the cache with RAW catalog names while the resolver keeps the display names', async () => {
		mocks.names.dnArtist.mockReturnValue('顯示歌手');
		mocks.names.dnTitle.mockReturnValue('顯示標題');
		mocks.ensureTrackDetails.mockResolvedValue(
			mk({ audioUrl: 'https://cdn.example.com/x.mp3', artist: 'catalog-artist', title: 'catalog-title' })
		);

		await downloadTrack(mk({ audioUrl: null, detailsLoaded: false }));

		expect(mocks.readCoverByUidOrName).toHaveBeenCalledWith('netease-1', 'catalog-artist', 'catalog-title');
		expect(mocks.resolveArtworkDataUrl.mock.calls[0][0]).toMatchObject({
			title: '顯示標題',
			artist: '顯示歌手'
		});
	});
});

// quick-260913-tmi — the qq CDN serves audio as `application/x-www-form-urlencoded`. `resp.blob()`
// took its type straight from that header, so a 24MB m4a was persisted to IndexedDB and handed to
// `<a download>` labelled as a form body; playback survived only because browsers sniff the bytes.
// downloadTrack now derives the type from the resolved URL and threads it into the read.
describe('downloadTrack — media type is derived, not trusted (quick-260913-tmi)', () => {
	function stubFetchWithHeaders(blob: Blob, headers: Record<string, string>) {
		const f = vi.fn(async (_url: string) => ({
			ok: true,
			headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
			body: null,
			blob: async () => blob
		}));
		vi.stubGlobal('fetch', f);
		return f;
	}

	it('overrides a junk upstream Content-Type with the type implied by the audio URL', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(
			mk({
				uid: 'qq-1',
				artist: 'Tame Impala',
				title: 'Dracula',
				audioUrl: 'https://isure6.stream.qqmusic.qq.com/C600002xIMbb0urBTq.m4a?guid=1&vkey=72BC34',
				detailsLoaded: true
			})
		);
		stubFetchWithHeaders(new Blob(['audio'], { type: 'application/x-www-form-urlencoded' }), {
			'content-type': 'application/x-www-form-urlencoded'
		});

		expect(await downloadTrack(mk({ uid: 'qq-1', audioUrl: null, detailsLoaded: false }))).toBe('saved');

		const [, storedBlob, storedName] = mocks.put.mock.calls[0];
		expect(storedBlob.type).toBe('audio/mp4');
		// the filename's extension and the media type now agree
		expect(storedName).toBe('Tame Impala - Dracula.m4a');
	});

	it('leaves a correct upstream audio Content-Type alone', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(
			mk({
				uid: 'netease-2',
				artist: 'A',
				title: 'B',
				audioUrl: 'https://cdn.example.com/song.mp3',
				detailsLoaded: true
			})
		);
		stubFetchWithHeaders(new Blob(['audio'], { type: 'audio/mpeg' }), { 'content-type': 'audio/mpeg' });

		await downloadTrack(mk({ uid: 'netease-2', audioUrl: null, detailsLoaded: false }));

		expect(mocks.put.mock.calls[0][1].type).toBe('audio/mpeg');
	});
});

// quick-260916-0d9 — `opts.audioFrom`: the "Download from…" picker measured a SPECIFIC source's file
// (`FLAC · 38.2 MB`) and the user tapped THAT row. The save must therefore carry the DONOR's bytes
// while being recorded under the ORIGINAL track's identity — `library.isDownloaded(original.uid)` and
// `player.play(original)`'s offline-blob branch both key off the original uid, so a donor-uid record
// would "download successfully" and then never play offline. It must also skip BOTH reuse tests and
// the re-resolve: reuseCurrent would substitute player.current's url whenever this song is playing,
// and a re-resolve at the settings tier could fetch a file the picker never showed (the 52 MB FLAC
// cellular incident).
describe('downloadTrack — audioFrom donor url under the original identity (quick-260916-0d9)', () => {
	const donor = () =>
		mk({
			uid: 'kuwo-77',
			source: 'kuwo',
			songid: '77',
			title: 'Donor Title',
			artist: 'Donor Artist',
			audioUrl: 'https://cdn.kuwo.example/x.flac',
			quality: 'lossless',
			qualityLabel: 'FLAC',
			resolvedAt: Date.now()
		});

	it('fetches the DONOR url, records the ORIGINAL identity, keys the blob by the ORIGINAL uid', async () => {
		const original = mk({ uid: 'netease-1', source: 'netease', songid: '1', artist: 'Artist', title: 'Song' });
		const f = stubFetch(new Blob(['audio']));

		const res = await downloadTrack(original, { audioFrom: donor() });

		expect(res).toBe('saved');
		expect(f).toHaveBeenCalledWith('https://cdn.kuwo.example/x.flac');
		const saved = mocks.library.addDownload.mock.calls[0][0] as Track;
		expect(saved).toMatchObject({
			uid: 'netease-1',
			source: 'netease',
			songid: '1',
			title: 'Song',
			artist: 'Artist',
			audioUrl: 'https://cdn.kuwo.example/x.flac'
		});
		// the offline blob is keyed by the ORIGINAL uid — this is what makes player.play(original)
		// take the offline branch — and the filename uses the original names + the donor's container.
		const [putUid, , putName] = mocks.put.mock.calls[0];
		expect(putUid).toBe('netease-1');
		expect(putName).toBe('Artist - Song.flac');
	});

	it('bypasses the reuseCurrent branch — the donor url wins even while this song is playing', async () => {
		Object.defineProperty(mocks.player, 'current', {
			configurable: true,
			writable: true,
			value: mk({ uid: 'netease-1', audioUrl: 'https://cdn.example.com/PLAYING.mp3' })
		});
		const f = stubFetch(new Blob(['a']));

		await downloadTrack(mk({ uid: 'netease-1' }), { audioFrom: donor() });

		expect(f).toHaveBeenCalledWith('https://cdn.kuwo.example/x.flac');
		expect(mocks.ensureTrackDetails).not.toHaveBeenCalled();
	});

	it('bypasses the tier gate — a 320k donor under downloadQuality "lossless" is NOT re-resolved', async () => {
		mocks.settings.downloadQuality = 'lossless';
		const f = stubFetch(new Blob(['a']));

		await downloadTrack(mk({ uid: 'netease-1' }), {
			audioFrom: mk({ uid: 'kuwo-77', source: 'kuwo', audioUrl: 'https://cdn.kuwo.example/y.mp3', quality: '320k' })
		});

		expect(mocks.ensureTrackDetails).not.toHaveBeenCalled();
		expect(f).toHaveBeenCalledWith('https://cdn.kuwo.example/y.mp3');
	});

	it('DL-BUG-01 holds: a donor with no audioUrl returns "no-audio" and still keeps the ORIGINAL in the library', async () => {
		stubFetch(new Blob(['a']));

		const res = await downloadTrack(mk({ uid: 'netease-1' }), {
			audioFrom: mk({ uid: 'kuwo-77', source: 'kuwo', audioUrl: null })
		});

		expect(res).toBe('no-audio');
		expect(mocks.library.addDownload.mock.calls[0][0]).toMatchObject({ uid: 'netease-1', source: 'netease' });
		expect(mocks.library.endDownload).toHaveBeenCalledWith('netease-1');
	});

	it('embeds the donor lyrics when the original has none, and prefers the original lyrics when it does', async () => {
		stubFetch(new Blob(['a']));
		await downloadTrack(mk({ uid: 'netease-1', lrc: null }), { audioFrom: mk({ ...donor(), lrc: '[00:01.00]x' }) });
		expect((mocks.tagAudioBlob.mock.calls[0][1] as { lyrics?: string }).lyrics).toBe('[00:01.00]x');

		mocks.tagAudioBlob.mockClear();
		await downloadTrack(mk({ uid: 'netease-1', lrc: 'own' }), { audioFrom: mk({ ...donor(), lrc: '[00:01.00]x' }) });
		expect((mocks.tagAudioBlob.mock.calls[0][1] as { lyrics?: string }).lyrics).toBe('own');
	});
});
