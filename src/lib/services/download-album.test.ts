import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Track } from '$lib/sources/types';
import * as zipStore from './zip-store';

// download-album.ts drives the album "Download all" (40-D-01 D-03 D-04 D-05 D-06). Every store and
// side-effecting service is mocked; zip-store and download-filename run for real so entry names and
// the zip itself are the real output.

const mocks = vi.hoisted(() => ({
	native: false,
	library: { downloads: [] as Track[] },
	names: {
		dnArtist: (s: string) => s,
		dnTitle: (s: string) => s
	},
	downloadTrack: vi.fn(),
	blob: {
		put: vi.fn(async () => true),
		get: vi.fn(async (_uid: string): Promise<Blob | null> => null),
		has: vi.fn(async (_uid: string) => false),
		moveToDir: vi.fn(async (_uid: string, _dir: string) => true),
		getStoredName: vi.fn((_uid: string): string | null => null)
	},
	saveBlobToDisk: vi.fn((_b: Blob, _f: string) => true)
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.native } }));
vi.mock('$lib/stores/library.svelte', () => ({ library: mocks.library }));
vi.mock('$lib/stores/names.svelte', () => ({ names: mocks.names }));
vi.mock('$lib/services/download-track', () => ({ downloadTrack: mocks.downloadTrack }));
vi.mock('$lib/services/blob-store', () => ({ blobStore: mocks.blob }));
vi.mock('$lib/services/download-save', () => ({ saveBlobToDisk: mocks.saveBlobToDisk }));

import { downloadAlbum } from './download-album';

const mk = (n: number, over: Partial<Track> = {}): Track =>
	({
		uid: `qq:${n}`,
		source: 'qq',
		songid: String(n),
		title: `Song${n}`,
		artist: 'Artist',
		album: 'Album',
		cover: null,
		audioUrl: 'https://cdn.example/a.m4a',
		lrc: null,
		quality: null,
		detailsLoaded: true,
		...over
	}) as Track;

const META = { artist: 'Artist', album: 'Album' };

/** downloadTrack stub: 'saved' and fire onSaved with a per-uid blob + `Artist - Title.m4a`. */
function savedImpl() {
	mocks.downloadTrack.mockImplementation(
		async (tr: Track, opts: { onSaved?: (u: string, f: string, b: Blob) => void }) => {
			opts.onSaved?.(tr.uid, `${tr.artist} - ${tr.title}.m4a`, new Blob([tr.uid]));
			return 'saved';
		}
	);
}

let buildZipSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.native = false;
	mocks.library.downloads = [];
	mocks.blob.get.mockImplementation(async () => null);
	mocks.blob.has.mockImplementation(async () => false);
	mocks.blob.moveToDir.mockImplementation(async () => true);
	mocks.blob.getStoredName.mockImplementation(() => null);
	mocks.saveBlobToDisk.mockImplementation(() => true);
	savedImpl();
	buildZipSpy?.mockRestore();
	buildZipSpy = vi.spyOn(zipStore, 'buildZip');
});

describe('downloadAlbum — native (40-D-01 / D-04)', () => {
	beforeEach(() => {
		mocks.native = true;
	});

	it('downloads each song persisted into the album dir, numbered in album order', async () => {
		const progress: [number, number][] = [];
		const res = await downloadAlbum([mk(1), mk(2), mk(3)], META, (n, t) => progress.push([n, t]));
		expect(res).toEqual({ saved: 3, total: 3 });
		expect(mocks.downloadTrack).toHaveBeenCalledTimes(3);
		['1', '2', '3'].forEach((num, i) => {
			expect(mocks.downloadTrack.mock.calls[i][1]).toMatchObject({
				persist: true,
				save: false,
				trackNumber: num,
				albumArtist: 'Artist',
				dir: 'Artist/Album'
			});
		});
		expect(progress).toEqual([
			[1, 3],
			[2, 3],
			[3, 3]
		]);
		expect(mocks.saveBlobToDisk).not.toHaveBeenCalled();
		expect(buildZipSpy).not.toHaveBeenCalled();
	});

	it('MOVES a single held under a different uid (sameSongKey) instead of re-downloading (D-05)', async () => {
		const held = mk(2, { uid: 'kuwo:99', source: 'kuwo', songid: '99' });
		mocks.library.downloads = [held];
		mocks.blob.has.mockImplementation(async (uid: string) => uid === 'kuwo:99');
		const res = await downloadAlbum([mk(1), mk(2), mk(3)], META);
		expect(res.saved).toBe(3);
		expect(mocks.downloadTrack).toHaveBeenCalledTimes(2);
		expect(mocks.downloadTrack.mock.calls.map((c) => (c[0] as Track).uid)).toEqual(['qq:1', 'qq:3']);
		expect(mocks.blob.moveToDir).toHaveBeenCalledWith('kuwo:99', 'Artist/Album');
		expect(mocks.library.downloads).toHaveLength(1);
	});

	it('counts a held single as saved even when the move fails or rejects', async () => {
		mocks.library.downloads = [mk(1)];
		mocks.blob.has.mockImplementation(async () => true);
		mocks.blob.moveToDir.mockImplementation(async () => false);
		expect(await downloadAlbum([mk(1)], META)).toEqual({ saved: 1, total: 1 });
		mocks.blob.moveToDir.mockImplementation(async () => {
			throw new Error('bridge');
		});
		expect(await downloadAlbum([mk(1)], META)).toEqual({ saved: 1, total: 1 });
	});

	it('re-downloads a library entry whose blob is gone', async () => {
		mocks.library.downloads = [mk(1)];
		mocks.blob.has.mockImplementation(async () => false);
		await downloadAlbum([mk(1)], META);
		expect(mocks.downloadTrack).toHaveBeenCalledTimes(1);
		expect(mocks.blob.moveToDir).not.toHaveBeenCalled();
	});
});

describe('downloadAlbum — web zip (40-D-03)', () => {
	it('builds ONE zip of the persisted blobs and saves it ONCE, named after the album', async () => {
		mocks.blob.get.mockImplementation(async (uid: string) => new Blob([`idb-${uid}`]));
		const res = await downloadAlbum([mk(1), mk(2)], META);
		expect(res).toEqual({ saved: 2, total: 2 });
		for (const c of mocks.downloadTrack.mock.calls) {
			expect(c[1]).toMatchObject({ persist: true, save: false });
			expect(c[1]).not.toHaveProperty('dir');
		}
		expect(buildZipSpy).toHaveBeenCalledTimes(1);
		const entries = buildZipSpy.mock.calls[0][0] as zipStore.ZipEntry[];
		expect(entries.map((e) => e.name)).toEqual([
			'Artist - Album/Artist - Song1.m4a',
			'Artist - Album/Artist - Song2.m4a'
		]);
		expect(await entries[0].blob.text()).toBe('idb-qq:1');
		expect(mocks.saveBlobToDisk).toHaveBeenCalledTimes(1);
		expect(mocks.saveBlobToDisk.mock.calls[0][1]).toBe('Artist - Album.zip');
		expect((mocks.saveBlobToDisk.mock.calls[0][0] as Blob).type).toBe('application/zip');
	});

	it('falls back to the onSaved blob when the store has none', async () => {
		await downloadAlbum([mk(1)], META);
		const entries = buildZipSpy.mock.calls[0][0] as zipStore.ZipEntry[];
		expect(await entries[0].blob.text()).toBe('qq:1');
	});

	it('reuses a held single blob for the zip without re-fetching (D-05)', async () => {
		const held = mk(1, { uid: 'netease:7', source: 'netease', songid: '7' });
		mocks.library.downloads = [held];
		mocks.blob.has.mockImplementation(async (uid: string) => uid === 'netease:7');
		mocks.blob.get.mockImplementation(async (uid: string) => (uid === 'netease:7' ? new Blob(['held']) : null));
		const res = await downloadAlbum([mk(1)], META);
		expect(res.saved).toBe(1);
		expect(mocks.downloadTrack).not.toHaveBeenCalled();
		const entries = buildZipSpy.mock.calls[0][0] as zipStore.ZipEntry[];
		expect(entries[0].name).toBe('Artist - Album/Artist - Song1.m4a');
		expect(await entries[0].blob.text()).toBe('held');
	});

	it('suffixes duplicate entry names with (2) before the extension', async () => {
		const res = await downloadAlbum([mk(1), mk(2, { title: 'Song1' })], META);
		expect(res.saved).toBe(2);
		const entries = buildZipSpy.mock.calls[0][0] as zipStore.ZipEntry[];
		expect(entries.map((e) => e.name)).toEqual([
			'Artist - Album/Artist - Song1.m4a',
			'Artist - Album/Artist - Song1 (2).m4a'
		]);
	});

	it('reports 0 saved when the zip cannot be built or saved', async () => {
		buildZipSpy.mockResolvedValueOnce(null);
		expect((await downloadAlbum([mk(1)], META)).saved).toBe(0);
		mocks.saveBlobToDisk.mockImplementation(() => false);
		expect((await downloadAlbum([mk(1)], META)).saved).toBe(0);
	});
});

describe('downloadAlbum — failure isolation (40-D-06)', () => {
	it('skips a failed song, keeps going, and still advances progress', async () => {
		mocks.native = true;
		mocks.downloadTrack.mockImplementation(async (tr: Track) => (tr.uid === 'qq:2' ? 'failed' : 'saved'));
		const progress: number[] = [];
		const res = await downloadAlbum([mk(1), mk(2), mk(3)], META, (n) => progress.push(n));
		expect(res).toEqual({ saved: 2, total: 3 });
		expect(progress).toEqual([1, 2, 3]);
	});

	it('a throwing onProgress does not abort the loop', async () => {
		mocks.native = true;
		const res = await downloadAlbum([mk(1), mk(2)], META, () => {
			throw new Error('ui');
		});
		expect(res).toEqual({ saved: 2, total: 2 });
	});

	it('never rejects when downloadTrack throws', async () => {
		mocks.downloadTrack.mockImplementation(async () => {
			throw new Error('boom');
		});
		await expect(downloadAlbum([mk(1), mk(2)], META)).resolves.toEqual({ saved: 0, total: 2 });
		expect(buildZipSpy).not.toHaveBeenCalled();
	});
});
