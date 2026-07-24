import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// blob-store.ts (999.1-03, D-10) is the platform-switched offline-blob backend. On web
// (Capacitor.isNativePlatform() === false) it keeps the EXISTING IndexedDB store byte-for-byte
// (SSR-guarded never-throws). On native it routes put/get/del to capacitor-blob-writer +
// @capacitor/filesystem (app-private Directory.Data — public Music/ bridge lands in plan 06),
// preserving the SAME put/get/del signatures and the SAME never-throws posture (resolve
// false/null/void, never reject). These tests pin: (1) native put/get/del hit the FS backend,
// (2) every native error path returns the sentinel, and (3) the web branch (browser false in
// the node test env → openDb null → put false) is reached when isNativePlatform() is false —
// all node-runnable via vi.mock (NO real browser / IDB / device).

// --- platform switch: controlled per-test via the isNativePlatform mock ---
const isNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
	Capacitor: {
		isNativePlatform: () => isNativePlatform(),
		// WR-03: native get() resolves the file URI and streams it via convertFileSrc + fetch.
		convertFileSrc: (uri: string) => `http://localhost/_capacitor_file_${uri}`
	}
}));

// --- native write backend (capacitor-blob-writer default export) ---
const writeBlob = vi.fn((_opts: { path: string; blob: Blob; directory: string; recursive: boolean }) =>
	Promise.resolve('file:///data/downloads/x')
);
vi.mock('capacitor-blob-writer', () => ({ default: (opts: unknown) => writeBlob(opts as never) }));

// --- native read/delete backend (@capacitor/filesystem) ---
// WR-02/WR-03: nativePut/nativeGet now resolve the on-disk URI via getUri (no base64 bytes over
// the bridge). getUri returns the app-private file:// URI for the uid's path.
const getUri = vi.fn((_opts: { path: string; directory: string }) =>
	Promise.resolve({ uri: 'file:///data/user/0/com.openmusic.app/files/downloads/x' })
);
const deleteFile = vi.fn((_opts: { path: string; directory: string }) => Promise.resolve());
vi.mock('@capacitor/filesystem', () => ({
	Filesystem: {
		getUri: (opts: unknown) => getUri(opts as never),
		deleteFile: (opts: unknown) => deleteFile(opts as never)
	},
	Directory: { Data: 'DATA', External: 'EXTERNAL' }
}));

// --- public Music/ MediaStore bridge (999.1-06, D-11) ---
// nativePut also routes the file into public Music/ via saveToMusic({ fileName, sourcePath }) and
// records the returned content URI; nativeDel removes that entry via deleteFromMusic({ uri }).
// WR-02: the file PATH crosses the bridge (the Kotlin side streams the file), NOT blob bytes.
const saveToMusic = vi.fn((_opts: { fileName: string; sourcePath: string }) =>
	Promise.resolve({ uri: 'content://media/external/audio/media/42' })
);
const deleteFromMusic = vi.fn((_opts: { uri: string }) => Promise.resolve());
vi.mock('./media-store', () => ({
	MediaStoreSaver: {
		saveToMusic: (opts: unknown) => saveToMusic(opts as never),
		deleteFromMusic: (opts: unknown) => deleteFromMusic(opts as never)
	}
}));

// --- localStorage shim (uid -> content URI index lives here on native) ---
function installLocalStorageShim() {
	const map = new Map<string, string>();
	const ls = {
		getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
		setItem: (k: string, v: string) => void map.set(k, String(v)),
		removeItem: (k: string) => void map.delete(k),
		clear: () => map.clear(),
		key: (i: number) => Array.from(map.keys())[i] ?? null,
		get length() {
			return map.size;
		}
	};
	vi.stubGlobal('localStorage', ls);
	return map;
}

import { blobStore, put, get, del } from './blob-store';

beforeEach(() => {
	isNativePlatform.mockReturnValue(false);
	writeBlob.mockReset().mockResolvedValue('file:///data/downloads/x');
	getUri
		.mockReset()
		.mockResolvedValue({ uri: 'file:///data/user/0/com.openmusic.app/files/downloads/x' });
	deleteFile.mockReset().mockResolvedValue(undefined);
	saveToMusic.mockReset().mockResolvedValue({ uri: 'content://media/external/audio/media/42' });
	deleteFromMusic.mockReset().mockResolvedValue(undefined);
	installLocalStorageShim();
});

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe('blob-store — namespace export shape (consumers must keep compiling)', () => {
	it('exports blobStore = { put, get, del } with the three functions intact', () => {
		expect(typeof blobStore.put).toBe('function');
		expect(typeof blobStore.get).toBe('function');
		expect(typeof blobStore.del).toBe('function');
		expect(blobStore.put).toBe(put);
		expect(blobStore.get).toBe(get);
		expect(blobStore.del).toBe(del);
	});
});

describe('blob-store — web branch (isNativePlatform false)', () => {
	it('put falls through to the IDB path (browser false in node → openDb null → false), NEVER the native backend', async () => {
		isNativePlatform.mockReturnValue(false);
		const ok = await put('netease-1', new Blob(['a']));
		// In the node test env `browser` is false so openDb resolves null and put returns false.
		expect(ok).toBe(false);
		// Critically, the native write backend was NOT touched on the web branch.
		expect(writeBlob).not.toHaveBeenCalled();
	});

	it('get falls through to the IDB path (returns null), not the native backend', async () => {
		isNativePlatform.mockReturnValue(false);
		const v = await get('netease-1');
		expect(v).toBeNull();
		expect(getUri).not.toHaveBeenCalled();
	});

	it('del falls through to the IDB path (resolves void), not the native backend', async () => {
		isNativePlatform.mockReturnValue(false);
		await expect(del('netease-1')).resolves.toBeUndefined();
		expect(deleteFile).not.toHaveBeenCalled();
	});
});

describe('blob-store — native branch put (isNativePlatform true)', () => {
	beforeEach(() => isNativePlatform.mockReturnValue(true));

	it('put writes the app-private offline copy via capacitor-blob-writer and resolves true on success', async () => {
		const blob = new Blob(['audio-bytes']);
		const ok = await put('netease-123', blob);
		expect(ok).toBe(true);
		expect(writeBlob).toHaveBeenCalledTimes(1);
		const opts = writeBlob.mock.calls[0][0] as { path: string; blob: Blob; directory: string; recursive: boolean };
		expect(opts.blob).toBe(blob);
		expect(opts.path).toContain('netease-123');
		expect(opts.recursive).toBe(true);
		// app-private dir (Directory.Data) — kept as the offline-read source for get()
		expect(opts.directory).toBe('DATA');
	});

	// --- 999.1-06 (D-11): native put ALSO routes the file into public Music/ via the bridge ---
	// WR-02: the file PATH (resolved via getUri) crosses the bridge, NOT blob bytes/base64.
	it('put routes the file into public Music/ via MediaStoreSaver.saveToMusic with a sourcePath (no base64)', async () => {
		const ok = await put('netease-123', new Blob(['audio-bytes']));
		expect(ok).toBe(true);
		expect(getUri).toHaveBeenCalledTimes(1);
		expect(saveToMusic).toHaveBeenCalledTimes(1);
		const opts = saveToMusic.mock.calls[0][0] as { fileName: string; sourcePath: string };
		expect(opts.fileName).toContain('netease-123');
		// the on-disk file path is passed (no base64 round-trip over the bridge)
		expect(typeof opts.sourcePath).toBe('string');
		expect(opts.sourcePath).toContain('downloads');
		expect(opts).not.toHaveProperty('base64');
		// the returned content URI is recorded so get/del can resolve it later
		expect(localStorage.getItem('openmusic-blob-uri:netease-123')).toBe(
			'content://media/external/audio/media/42'
		);
	});

	// --- DL-FILE-01 (D-06): the PUBLIC MediaStore filename becomes the human `{artist} - {song}.{ext}`
	// name when the caller threads one through put()'s optional 3rd arg (only TrackMenu does today). ---
	it('put threads a human filename to saveToMusic (native public write) when supplied — DL-FILE-01', async () => {
		const ok = await put('netease-123', new Blob(['audio-bytes']), 'Artist - Song.mp3');
		expect(ok).toBe(true);
		expect(saveToMusic).toHaveBeenCalledTimes(1);
		const opts = saveToMusic.mock.calls[0][0] as { fileName: string; sourcePath: string };
		// the PUBLIC file is named with the human filename, NOT the `<uid>.mp3` fallback
		expect(opts.fileName).toBe('Artist - Song.mp3');
		expect(opts.fileName).not.toContain('netease-123');
		// the app-private copy is still uid-keyed (D-04 — filename only affects the public write)
		const wopts = writeBlob.mock.calls[0][0] as { path: string };
		expect(wopts.path).toContain('netease-123');
	});

	it('put falls back to nativeFileName(uid) = `<uid>.mp3` when NO filename is supplied (album/legacy path)', async () => {
		const ok = await put('netease-123', new Blob(['audio-bytes']));
		expect(ok).toBe(true);
		expect(saveToMusic).toHaveBeenCalledTimes(1);
		const opts = saveToMusic.mock.calls[0][0] as { fileName: string };
		// legacy path unchanged: the public filename is the sanitized uid with a .mp3 extension
		expect(opts.fileName).toBe('netease-123.mp3');
	});

	// WR-01: a public-Music copy failure must NOT fail put() — the app-private offline copy landed.
	it('put STILL resolves true when saveToMusic rejects (public copy is best-effort — WR-01)', async () => {
		saveToMusic.mockRejectedValue(new Error('MediaStore insert returned null'));
		const ok = await put('netease-1', new Blob(['a']));
		expect(ok).toBe(true);
		// the app-private offline copy (the get() read source) still landed
		expect(writeBlob).toHaveBeenCalledTimes(1);
		// no stale URI recorded since the public copy failed
		expect(localStorage.getItem('openmusic-blob-uri:netease-1')).toBeNull();
	});

	it('put returns false on empty uid without touching the backend', async () => {
		const ok = await put('', new Blob(['a']));
		expect(ok).toBe(false);
		expect(writeBlob).not.toHaveBeenCalled();
		expect(saveToMusic).not.toHaveBeenCalled();
	});

	it('put resolves false (never rejects) when the write backend throws', async () => {
		writeBlob.mockRejectedValue(new Error('disk full'));
		await expect(put('netease-1', new Blob(['a']))).resolves.toBe(false);
	});
});

describe('blob-store — native branch get (isNativePlatform true)', () => {
	beforeEach(() => isNativePlatform.mockReturnValue(true));

	// WR-03: native get() resolves the file URI then streams it via convertFileSrc + fetch (no
	// whole-file base64 decode on every offline play).
	it('get streams the file via convertFileSrc + fetch and returns a Blob on a hit', async () => {
		const fetchMock = vi.fn(
			async (_url: RequestInfo | URL) => new Response('audio-bytes', { status: 200 })
		);
		vi.stubGlobal('fetch', fetchMock);
		const v = await get('netease-123');
		expect(getUri).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		// the fetched URL is the convertFileSrc-wrapped file URI (no base64 anywhere)
		expect(String(fetchMock.mock.calls[0][0])).toContain('_capacitor_file_');
		expect(v).toBeInstanceOf(Blob);
		expect(await (v as Blob).text()).toBe('audio-bytes');
	});

	it('get returns null on empty uid without touching the backend', async () => {
		const v = await get('');
		expect(v).toBeNull();
		expect(getUri).not.toHaveBeenCalled();
	});

	it('get resolves null (never rejects) on a miss / read error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('File does not exist');
			})
		);
		await expect(get('netease-missing')).resolves.toBeNull();
	});

	it('get resolves null (never rejects) when the streamed response is not ok', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
		await expect(get('netease-404')).resolves.toBeNull();
	});
});

describe('blob-store — native branch del (isNativePlatform true)', () => {
	beforeEach(() => isNativePlatform.mockReturnValue(true));

	it('del deletes the app-private copy and resolves void', async () => {
		await expect(del('netease-123')).resolves.toBeUndefined();
		expect(deleteFile).toHaveBeenCalledTimes(1);
		const opts = deleteFile.mock.calls[0][0] as { path: string };
		expect(opts.path).toContain('netease-123');
	});

	// --- 999.1-06 (D-11): del removes the public-Music MediaStore entry the app created ---
	it('del removes the recorded public-Music entry via MediaStoreSaver.deleteFromMusic and clears the index', async () => {
		// Simulate a prior put having recorded the content URI.
		await put('netease-123', new Blob(['audio-bytes']));
		deleteFromMusic.mockClear();
		await expect(del('netease-123')).resolves.toBeUndefined();
		expect(deleteFromMusic).toHaveBeenCalledTimes(1);
		const opts = deleteFromMusic.mock.calls[0][0] as { uri: string };
		expect(opts.uri).toBe('content://media/external/audio/media/42');
		// the index entry is cleared so no stale URI lingers
		expect(localStorage.getItem('openmusic-blob-uri:netease-123')).toBeNull();
	});

	it('del resolves void (never rejects) when deleteFromMusic throws', async () => {
		await put('netease-123', new Blob(['audio-bytes']));
		deleteFromMusic.mockRejectedValue(new Error('content uri gone'));
		await expect(del('netease-123')).resolves.toBeUndefined();
	});

	it('del resolves void on empty uid without touching the backend', async () => {
		await expect(del('')).resolves.toBeUndefined();
		expect(deleteFile).not.toHaveBeenCalled();
		expect(deleteFromMusic).not.toHaveBeenCalled();
	});

	it('del resolves void (never rejects) when the file is absent / delete throws', async () => {
		deleteFile.mockRejectedValue(new Error('File does not exist'));
		await expect(del('netease-absent')).resolves.toBeUndefined();
	});
});
