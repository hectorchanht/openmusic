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

// 31-D-13 adds a size/type gate at the single read boundary (get/nativeGet): a value that is not a
// Blob, or is smaller than MIN_BLOB_BYTES (8192), resolves null — indistinguishable from a miss, so
// every player read site falls through to a network re-stream instead of attaching bytes that can
// only fire `audio.error`. `browser` is mocked TRUE below so the IDB branch is reachable in node
// (openDb still short-circuits to null wherever `indexedDB` is absent, which is every describe
// except the fake-IDB one at the bottom of this file).
vi.mock('$app/environment', () => ({ browser: true }));

// --- platform switch: controlled per-test via the isNativePlatform mock ---
const isNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
	Capacitor: {
		isNativePlatform: () => isNativePlatform(),
		// WR-03: native get() resolves the file URI and streams it via convertFileSrc + fetch.
		// 34-D-05: a content:// URI (an imported device file, or a relinked public Music/ copy) maps
		// to the local server's _capacitor_content_ prefix instead — same shape Capacitor emits.
		convertFileSrc: (uri: string) =>
			uri.startsWith('content://')
				? `http://localhost/_capacitor_content_/${uri.slice('content://'.length)}`
				: `http://localhost/_capacitor_file_${uri}`
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
// quick-260913-jq4: nativeHas asks for the SIZE only (stat), never the bytes.
const stat = vi.fn((_opts: { path: string; directory: string }) => Promise.resolve({ size: 200000 }));
vi.mock('@capacitor/filesystem', () => ({
	Filesystem: {
		getUri: (opts: unknown) => getUri(opts as never),
		deleteFile: (opts: unknown) => deleteFile(opts as never),
		stat: (opts: unknown) => stat(opts as never)
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
const scanAudio = vi.fn();
const requestReadAudio = vi.fn();
vi.mock('./media-store', () => ({
	MediaStoreSaver: {
		saveToMusic: (opts: unknown) => saveToMusic(opts as never),
		deleteFromMusic: (opts: unknown) => deleteFromMusic(opts as never),
		// Phase 34 scan bridge — unused by blob-store, declared so the factory stays complete.
		scanAudio: (opts: unknown) => scanAudio(opts as never),
		requestReadAudio: () => requestReadAudio()
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

// 34-D-05: the device read/probe paths go through fetch(convertFileSrc(contentUri)). A default
// "readable file" response is installed in beforeEach; tests that need a failure re-stub it.
const fetchMock = vi.fn();
function okAudioResponse() {
	return {
		ok: true,
		blob: () => Promise.resolve(new Blob([new Uint8Array(200000)])),
		body: { cancel: vi.fn() }
	};
}

import { blobStore, put, get, has, del, linkPublicUri, getStoredName, setStoredName } from './blob-store';

beforeEach(() => {
	isNativePlatform.mockReturnValue(false);
	scanAudio.mockReset();
	requestReadAudio.mockReset();
	fetchMock.mockReset().mockImplementation(() => Promise.resolve(okAudioResponse()));
	vi.stubGlobal('fetch', fetchMock);
	writeBlob.mockReset().mockResolvedValue('file:///data/downloads/x');
	getUri
		.mockReset()
		.mockResolvedValue({ uri: 'file:///data/user/0/com.openmusic.app/files/downloads/x' });
	deleteFile.mockReset().mockResolvedValue(undefined);
	stat.mockReset().mockResolvedValue({ size: 200000 });
	saveToMusic.mockReset().mockResolvedValue({ uri: 'content://media/external/audio/media/42' });
	deleteFromMusic.mockReset().mockResolvedValue(undefined);
	installLocalStorageShim();
});

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe('blob-store — namespace export shape (consumers must keep compiling)', () => {
	it('exports blobStore = { put, get, has, del } with the four functions intact', () => {
		expect(typeof blobStore.put).toBe('function');
		expect(typeof blobStore.get).toBe('function');
		expect(typeof blobStore.has).toBe('function');
		expect(typeof blobStore.del).toBe('function');
		expect(blobStore.put).toBe(put);
		expect(blobStore.get).toBe(get);
		expect(blobStore.has).toBe(has);
		expect(blobStore.del).toBe(del);
	});
});

describe('blob-store — web branch (isNativePlatform false)', () => {
	it('put falls through to the IDB path (no indexedDB in node → openDb null → false), NEVER the native backend', async () => {
		isNativePlatform.mockReturnValue(false);
		const ok = await put('netease-1', new Blob(['a']));
		// In the node test env `indexedDB` is undefined so openDb resolves null and put returns false.
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

	// quick-260913-jq4
	it('has falls through to the IDB path (no indexedDB → false), not the native backend', async () => {
		isNativePlatform.mockReturnValue(false);
		await expect(has('netease-1')).resolves.toBe(false);
		expect(stat).not.toHaveBeenCalled();
	});

	it('has rejects an empty uid without touching any backend', async () => {
		isNativePlatform.mockReturnValue(false);
		await expect(has('')).resolves.toBe(false);
		expect(stat).not.toHaveBeenCalled();
	});
});

// quick-260913-jq4 — `has` is what the download button's Check state reads, so its "absent" answer
// has to be trustworthy on BOTH platforms: the reference list already lies (addDownload runs before
// the fetch, and an <a download> click reports success even when the user cancels the save dialog),
// which is the whole reason this probe exists.
describe('blob-store — native branch has (isNativePlatform true)', () => {
	beforeEach(() => isNativePlatform.mockReturnValue(true));

	it('stats the app-private path and reports present for a real-sized file', async () => {
		stat.mockResolvedValueOnce({ size: 200000 });
		await expect(has('netease-1')).resolves.toBe(true);
		expect(stat).toHaveBeenCalledWith(
			expect.objectContaining({ path: expect.stringContaining('netease-1'), directory: 'DATA' })
		);
	});

	it('reports ABSENT for a file under MIN_BLOB_BYTES (same 31-D-13 floor as get)', async () => {
		stat.mockResolvedValueOnce({ size: 8191 });
		await expect(has('netease-tiny')).resolves.toBe(false);
	});

	it('reports present exactly at MIN_BLOB_BYTES', async () => {
		stat.mockResolvedValueOnce({ size: 8192 });
		await expect(has('netease-edge')).resolves.toBe(true);
	});

	it('reports absent (never throws) when stat rejects — the not-found path', async () => {
		stat.mockRejectedValueOnce(new Error('File does not exist'));
		await expect(has('netease-gone')).resolves.toBe(false);
	});

	it('reports absent when stat returns no usable size', async () => {
		stat.mockResolvedValueOnce({ size: undefined as unknown as number });
		await expect(has('netease-weird')).resolves.toBe(false);
	});

	it('never reads the bytes (no getUri / no fetch) — the point of the probe', async () => {
		stat.mockResolvedValueOnce({ size: 200000 });
		await has('netease-1');
		expect(getUri).not.toHaveBeenCalled();
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

	// --- 36-D-19: a re-put for the same uid must REPLACE the public copy, not add a second one ---
	// Retag re-puts every downloaded uid, so without this the user's Music/OpenMusic/ folder would
	// double in size and show every song twice (the second as `… (1).m4a`).
	it('put deletes the PREVIOUSLY recorded public URI before saving the new one (36-D-19)', async () => {
		localStorage.setItem('openmusic-blob-uri:netease-123', 'content://media/external/audio/media/7');
		const ok = await put('netease-123', new Blob(['audio-bytes']));
		expect(ok).toBe(true);
		expect(deleteFromMusic).toHaveBeenCalledTimes(1);
		expect(deleteFromMusic.mock.calls[0][0]).toEqual({ uri: 'content://media/external/audio/media/7' });
		// ORDER is the whole point — deleting AFTER the save would remove the file we just wrote.
		expect(deleteFromMusic.mock.invocationCallOrder[0]).toBeLessThan(saveToMusic.mock.invocationCallOrder[0]);
		// the index now points at the NEW entry
		expect(localStorage.getItem('openmusic-blob-uri:netease-123')).toBe('content://media/external/audio/media/42');
	});

	it('put does NOT call deleteFromMusic on a first put (no recorded uri)', async () => {
		const ok = await put('netease-123', new Blob(['audio-bytes']));
		expect(ok).toBe(true);
		expect(deleteFromMusic).not.toHaveBeenCalled();
		expect(saveToMusic).toHaveBeenCalledTimes(1);
	});

	it('put still saves (and resolves true) when deleteFromMusic rejects — best-effort, WR-01 posture', async () => {
		localStorage.setItem('openmusic-blob-uri:netease-123', 'content://media/external/audio/media/7');
		deleteFromMusic.mockRejectedValue(new Error('no such entry'));
		const ok = await put('netease-123', new Blob(['audio-bytes']));
		expect(ok).toBe(true);
		expect(saveToMusic).toHaveBeenCalledTimes(1);
		expect(localStorage.getItem('openmusic-blob-uri:netease-123')).toBe('content://media/external/audio/media/42');
	});
});

describe('blob-store — native branch get (isNativePlatform true)', () => {
	beforeEach(() => isNativePlatform.mockReturnValue(true));

	// WR-03: native get() resolves the file URI then streams it via convertFileSrc + fetch (no
	// whole-file base64 decode on every offline play).
	it('get streams the file via convertFileSrc + fetch and returns a Blob on a hit', async () => {
		// 31-D-13: the payload must clear MIN_BLOB_BYTES — a plausibly-sized file is the hit case.
		const audioBytes = 'a'.repeat(9000);
		const fetchMock = vi.fn(
			async (_url: RequestInfo | URL) => new Response(audioBytes, { status: 200 })
		);
		vi.stubGlobal('fetch', fetchMock);
		const v = await get('netease-123');
		expect(getUri).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		// the fetched URL is the convertFileSrc-wrapped file URI (no base64 anywhere)
		expect(String(fetchMock.mock.calls[0][0])).toContain('_capacitor_file_');
		expect(v).toBeInstanceOf(Blob);
		expect(await (v as Blob).text()).toBe(audioBytes);
	});

	// --- 31-D-13: the native read path applies the SAME size floor as the IDB path ---
	it('get resolves null for a truncated/empty on-disk copy (31-D-13 size floor)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
		await expect(get('netease-empty')).resolves.toBeNull();
		vi.stubGlobal('fetch', vi.fn(async () => new Response('a'.repeat(8191), { status: 200 })));
		await expect(get('netease-truncated')).resolves.toBeNull();
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

// --- Phase 34: imported device files through the SHARED seam ---------------------------------
// D-05 says the in-place read belongs INSIDE blobStore's native branch so all five player call
// sites get it for free. Pitfall 1 says the same seam must refuse to delete, because an imported
// file is the USER'S, not the app's.
describe('blob-store — device: uids (34-D-05 / D-06 / Pitfall 1)', () => {
	beforeEach(() => isNativePlatform.mockReturnValue(true));

	// THE data-loss guard. Removing an imported song must never reach contentResolver.delete().
	it('del on a device: uid NEVER calls deleteFromMusic, even with a content URI in the index', async () => {
		localStorage.setItem(
			'openmusic-blob-uri:device:42',
			'content://media/external/audio/media/42'
		);
		await expect(del('device:42')).resolves.toBeUndefined();
		expect(deleteFromMusic).not.toHaveBeenCalled();
		expect(deleteFile).not.toHaveBeenCalled();
		// the stray index entry is cleared so no later refactor can find a device URI to delete
		expect(localStorage.getItem('openmusic-blob-uri:device:42')).toBeNull();
	});

	it('del on a REAL uid still removes the public entry (the guard is narrow, not a blanket off-switch)', async () => {
		await put('netease-123', new Blob(['audio-bytes']));
		deleteFromMusic.mockClear();
		await del('netease-123');
		expect(deleteFromMusic).toHaveBeenCalledTimes(1);
	});

	it('get reads the file IN PLACE through convertFileSrc + fetch (D-04: no copy is made)', async () => {
		const v = await get('device:42');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0][0])).toBe(
			'http://localhost/_capacitor_content_/media/external/audio/media/42'
		);
		expect(v).toBeInstanceOf(Blob);
		expect((v as Blob).size).toBe(200000);
		// no app-private lookup: a device file has no app-private copy to look for
		expect(getUri).not.toHaveBeenCalled();
	});

	it('get resolves null (never rejects) when the file is gone or unreadable', async () => {
		fetchMock.mockRejectedValueOnce(new Error('ENOENT'));
		await expect(get('device:42')).resolves.toBeNull();
		fetchMock.mockResolvedValueOnce({ ok: false });
		await expect(get('device:42')).resolves.toBeNull();
	});

	it('get applies the same 31-D-13 size floor to a device file', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			blob: () => Promise.resolve(new Blob([new Uint8Array(100)]))
		});
		await expect(get('device:42')).resolves.toBeNull();
	});

	it('D-06: a missing device file is a READ-ONLY miss — nothing is deleted, nothing is evicted', async () => {
		localStorage.setItem('openmusic:probe', 'untouched');
		fetchMock.mockRejectedValue(new Error('ENOENT'));
		await expect(get('device:42')).resolves.toBeNull();
		expect(deleteFromMusic).not.toHaveBeenCalled();
		expect(deleteFile).not.toHaveBeenCalled();
		expect(localStorage.getItem('openmusic:probe')).toBe('untouched');
	});

	it('has agrees with get (RESEARCH bite #4 — a badge that disagrees is the jq4 bug)', async () => {
		await expect(has('device:42')).resolves.toBe(true);
		expect(stat).not.toHaveBeenCalled();
		fetchMock.mockRejectedValueOnce(new Error('ENOENT'));
		await expect(has('device:42')).resolves.toBe(false);
		fetchMock.mockResolvedValueOnce({ ok: false });
		await expect(has('device:42')).resolves.toBe(false);
	});

	it('has cancels the probe stream instead of draining the file', async () => {
		const cancel = vi.fn();
		fetchMock.mockResolvedValueOnce({ ok: true, body: { cancel } });
		await expect(has('device:42')).resolves.toBe(true);
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it('a malformed device uid never reaches the network', async () => {
		await expect(get('device:../etc/passwd')).resolves.toBeNull();
		await expect(has('device:')).resolves.toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('web: a device uid no-ops cleanly (it can only exist on native)', async () => {
		isNativePlatform.mockReturnValue(false);
		await expect(get('device:42')).resolves.toBeNull();
		await expect(del('device:42')).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(deleteFromMusic).not.toHaveBeenCalled();
	});
});

// --- 34-D-09: a real-source download whose app-private copy is gone plays from its public copy ---
describe('blob-store — stored public-URI fallback (34-D-09)', () => {
	beforeEach(() => isNativePlatform.mockReturnValue(true));

	it('get falls back to the recorded public URI when the app-private copy is gone', async () => {
		localStorage.setItem('openmusic-blob-uri:kuwo:7', 'content://media/external/audio/media/9');
		getUri.mockRejectedValueOnce(new Error('File does not exist'));
		const v = await get('kuwo:7');
		expect(v).toBeInstanceOf(Blob);
		expect(String(fetchMock.mock.calls[0][0])).toBe(
			'http://localhost/_capacitor_content_/media/external/audio/media/9'
		);
	});

	it('get still resolves null when there is no recorded public URI (existing behaviour)', async () => {
		getUri.mockRejectedValueOnce(new Error('File does not exist'));
		await expect(get('kuwo:7')).resolves.toBeNull();
	});

	it('has falls back to probing the recorded public URI when stat rejects', async () => {
		localStorage.setItem('openmusic-blob-uri:kuwo:7', 'content://media/external/audio/media/9');
		stat.mockRejectedValueOnce(new Error('File does not exist'));
		await expect(has('kuwo:7')).resolves.toBe(true);
	});

	it('linkPublicUri records a real-source uid and REFUSES a device uid', () => {
		linkPublicUri('kuwo:7', 'content://media/external/audio/media/9');
		expect(localStorage.getItem('openmusic-blob-uri:kuwo:7')).toBe(
			'content://media/external/audio/media/9'
		);
		// Pitfall 1: a device URI in this index is exactly what would feed deleteFromMusic later.
		linkPublicUri('device:42', 'content://media/external/audio/media/42');
		expect(localStorage.getItem('openmusic-blob-uri:device:42')).toBeNull();
		linkPublicUri('', 'content://x');
		linkPublicUri('kuwo:8', '');
		expect(localStorage.getItem('openmusic-blob-uri:kuwo:8')).toBeNull();
	});

	it('is exported on the blobStore namespace', () => {
		expect(blobStore.linkPublicUri).toBe(linkPublicUri);
	});
});

// --- quick-260919-3j1 (D-6, T-3j1-01/02): the per-uid sticky FILE NAME index -------------------
// The enabling fix for this task's three new rewrite triggers. Without it a cover pin would silently
// rename a file the user deliberately named in the metadata editor hours earlier.
describe('blob-store — the sticky user-typed file name (quick-260919-3j1)', () => {
	it('is null when nothing was stored', () => {
		expect(getStoredName('netease:1')).toBeNull();
	});

	it('round-trips a base name', () => {
		setStoredName('netease:1', 'My Song');
		expect(getStoredName('netease:1')).toBe('My Song');
	});

	it('is per uid — one song\'s name never leaks onto another', () => {
		setStoredName('netease:1', 'One');
		setStoredName('kuwo:2', 'Two');
		expect(getStoredName('netease:1')).toBe('One');
		expect(getStoredName('kuwo:2')).toBe('Two');
	});

	it('an empty uid or an empty base is a no-op (T-3j1-02)', () => {
		setStoredName('', 'Nope');
		setStoredName('netease:9', '');
		expect(getStoredName('')).toBeNull();
		expect(getStoredName('netease:9')).toBeNull();
		expect(localStorage.length).toBe(0);
	});

	it('caps the stored base at MAX_FILENAME_BASE (T-3j1-02)', () => {
		setStoredName('netease:1', 'z'.repeat(400));
		expect(getStoredName('netease:1')).toBe('z'.repeat(120));
	});

	it('never throws on unavailable / corrupt localStorage', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('SecurityError');
			},
			setItem: () => {
				throw new Error('QuotaExceededError');
			},
			removeItem: () => {
				throw new Error('nope');
			}
		});
		expect(() => setStoredName('netease:1', 'x')).not.toThrow();
		expect(getStoredName('netease:1')).toBeNull();
	});

	it('del clears the stored name on the WEB branch', async () => {
		isNativePlatform.mockReturnValue(false);
		setStoredName('netease:1', 'My Song');
		await del('netease:1');
		expect(getStoredName('netease:1')).toBeNull();
	});

	it('del clears the stored name on the NATIVE branch', async () => {
		isNativePlatform.mockReturnValue(true);
		setStoredName('netease:1', 'My Song');
		await del('netease:1');
		expect(getStoredName('netease:1')).toBeNull();
	});

	// The clear sits ABOVE the platform fork precisely so nativeDel's device-uid early return cannot
	// skip it — an entry that outlives its file could name the next thing stored under that uid.
	it('del clears the stored name for a device: uid too, without touching the user\'s file', async () => {
		isNativePlatform.mockReturnValue(true);
		setStoredName('device:42', 'Their Song');
		await del('device:42');
		expect(getStoredName('device:42')).toBeNull();
		expect(deleteFile).not.toHaveBeenCalled();
		expect(deleteFromMusic).not.toHaveBeenCalled();
	});

	it('is exported on the blobStore namespace', () => {
		expect(blobStore.getStoredName).toBe(getStoredName);
	});
});

// --- 31-D-13: the WEB (IndexedDB) read path, the primary platform ------------------------------
// Kept LAST in the file: openDb() memoizes its open promise for the module lifetime, so the fake db
// installed here would otherwise leak backwards into the "no indexedDB → null/false" expectations
// above. A minimal in-memory indexedDB shim is enough — get() only needs
// `open → transaction → objectStore → get`.
describe('blob-store — web IDB read gate (31-D-13)', () => {
	const records = new Map<string, unknown>();

	function installFakeIdb() {
		const store = {
			get(uid: string) {
				const req: { result?: unknown; onsuccess?: () => void; onerror?: () => void } = {};
				queueMicrotask(() => {
					req.result = records.get(uid);
					req.onsuccess?.();
				});
				return req;
			},
			// quick-260913-jq4: `has` reads the KEY, never the value — the shim mirrors that so the
			// test would catch a `has` that quietly went back to pulling the whole blob.
			getKey(uid: string) {
				const req: { result?: unknown; onsuccess?: () => void; onerror?: () => void } = {};
				queueMicrotask(() => {
					req.result = records.has(uid) ? uid : undefined;
					req.onsuccess?.();
				});
				return req;
			}
		};
		const db = {
			objectStoreNames: { contains: () => true },
			transaction: () => ({ objectStore: () => store })
		};
		vi.stubGlobal('indexedDB', {
			open() {
				const req: { result?: unknown; onsuccess?: () => void } = {};
				queueMicrotask(() => {
					req.result = db;
					req.onsuccess?.();
				});
				return req;
			}
		});
	}

	beforeEach(() => {
		isNativePlatform.mockReturnValue(false);
		records.clear();
		installFakeIdb();
	});

	/** A Blob of exactly `n` bytes. */
	const bytes = (n: number) => new Blob([new Uint8Array(n)]);

	it('resolves null for a 0-byte blob (the corrupt-download signature)', async () => {
		records.set('netease-zero', bytes(0));
		await expect(get('netease-zero')).resolves.toBeNull();
	});

	it('resolves null for a blob under MIN_BLOB_BYTES (8192)', async () => {
		records.set('netease-tiny', bytes(8191));
		await expect(get('netease-tiny')).resolves.toBeNull();
	});

	it('resolves the blob unchanged at or above MIN_BLOB_BYTES', async () => {
		const good = bytes(8192);
		records.set('netease-ok', good);
		await expect(get('netease-ok')).resolves.toBe(good);
		const big = bytes(200000);
		records.set('netease-big', big);
		await expect(get('netease-big')).resolves.toBe(big);
	});

	it('resolves null for a non-Blob stored value (pre-existing behavior, must not regress)', async () => {
		records.set('netease-junk', 'not-a-blob');
		await expect(get('netease-junk')).resolves.toBeNull();
	});

	it('resolves null for a miss (undefined record)', async () => {
		await expect(get('netease-absent')).resolves.toBeNull();
	});

	// quick-260913-jq4
	it('has reports present for a stored record and absent for a miss', async () => {
		records.set('netease-ok', bytes(200000));
		await expect(has('netease-ok')).resolves.toBe(true);
		await expect(has('netease-absent')).resolves.toBe(false);
	});
});
