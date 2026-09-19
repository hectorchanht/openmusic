// deviceImport store (34-07) — rules persistence, the paged bridge walk, plan application and the
// notice channel. The pure brain (services/device-import.ts) is tested exhaustively in its own file;
// what is under test HERE is the wiring: permission mapping, paging, the generation guard,
// re-entrancy, and that the plan reaches library/blobStore in the right order.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store is browser-guarded (localStorage) — flip browser ON and back it with an in-memory
// Storage, the same shape library.svelte.test.ts uses.
vi.mock('$app/environment', () => ({ browser: true }));

const { requestReadAudio, scanAudio, linkPublicUri, logAction } = vi.hoisted(() => ({
	requestReadAudio: vi.fn(),
	scanAudio: vi.fn(),
	linkPublicUri: vi.fn(),
	logAction: vi.fn()
}));

vi.mock('$lib/services/media-store', () => ({
	MediaStoreSaver: {
		requestReadAudio: () => requestReadAudio(),
		scanAudio: (opts: unknown) => scanAudio(opts),
		saveToMusic: vi.fn(),
		deleteFromMusic: vi.fn()
	}
}));
// blobStore is mocked for linkPublicUri (the only method this store calls) — library.svelte also
// imports it (removeDownload's del), so the factory stays complete.
vi.mock('$lib/services/blob-store', () => ({
	blobStore: {
		get: vi.fn(),
		has: vi.fn(),
		del: vi.fn(async () => {}),
		put: vi.fn(),
		linkPublicUri: (uid: string, uri: string) => linkPublicUri(uid, uri)
	}
}));
vi.mock('$lib/stores/actionLog.svelte', () => ({ logAction: (ev: string, d?: unknown) => logAction(ev, d) }));

import { deviceImport, importNotice } from './device-import.svelte';
import { library } from '$lib/stores/library.svelte';
import { DEFAULT_IMPORT_RULES, IMPORT_RULES_KEY } from '$lib/services/device-filename';
import { emptySummary, SCAN_PAGE_SIZE } from '$lib/services/device-import';
import { deviceUid, type ScanRow } from '$lib/services/device-track';
import { excludeUid, unexcludeUid } from '$lib/services/import-exclusions';
import type { Track } from '$lib/sources/types';

const memStore = new Map<string, string>();
const localStorageMock: Storage = {
	get length() {
		return memStore.size;
	},
	clear: () => memStore.clear(),
	getItem: (k: string) => (memStore.has(k) ? (memStore.get(k) as string) : null),
	key: (i: number) => Array.from(memStore.keys())[i] ?? null,
	removeItem: (k: string) => void memStore.delete(k),
	setItem: (k: string, v: string) => void memStore.set(k, String(v))
};
vi.stubGlobal('localStorage', localStorageMock);

const row = (over: Partial<ScanRow> = {}): ScanRow => ({
	id: '1',
	uri: 'content://media/external/audio/media/1',
	displayName: 'Adele - Hello.mp3',
	relativePath: 'Music/',
	title: '',
	artist: '',
	album: '',
	durationMs: 300000,
	mimeType: 'audio/mpeg',
	size: 5_000_000,
	track: 0,
	year: 0,
	...over
});

const real = (over: Partial<Track> = {}): Track =>
	({
		uid: 'kuwo:7',
		source: 'kuwo',
		id: '7',
		title: 'Hello',
		artist: 'Adele',
		album: '',
		cover: null,
		audioUrl: null,
		detailsLoaded: false,
		...over
	}) as Track;

// A device entry as it sits in library.downloads — `source` is the documented placeholder (34-01).
const dev = (id: string): Track => real({ uid: deviceUid(id), title: `Song ${id}`, artist: 'Someone' });

/** Reset every PUBLIC field. `loaded`/`importGen` are private plain fields by design and are not
 *  reset — the idempotency test below depends on `loaded` surviving, which is the point of it. */
function resetStore() {
	deviceImport.rules = { ...DEFAULT_IMPORT_RULES, presets: [...DEFAULT_IMPORT_RULES.presets], extensions: [...DEFAULT_IMPORT_RULES.extensions], skipRules: [] };
	deviceImport.phase = 'idle';
	deviceImport.done = 0;
	deviceImport.total = 0;
	deviceImport.summary = null;
	deviceImport.permission = null;
	deviceImport.patternError = null;
	deviceImport.notice = null;
}

beforeEach(() => {
	vi.clearAllMocks();
	memStore.clear();
	library.downloads = [];
	library.clearUnavailable();
	resetStore();
	requestReadAudio.mockResolvedValue({ state: 'granted' });
	scanAudio.mockResolvedValue({ rows: [], total: 0 });
});

describe('rules persistence (D-12)', () => {
	// FIRST load() in this file — `loaded` is a plain private field, so only this call reads storage.
	it('load() hydrates rules from openmusic:import-rules:v1, defaulting per field', () => {
		memStore.set(IMPORT_RULES_KEY, '{"minSeconds":45}');
		deviceImport.load();
		expect(deviceImport.rules.minSeconds).toBe(45);
		expect(deviceImport.rules.presets).toEqual(DEFAULT_IMPORT_RULES.presets);
		expect(deviceImport.rules.extensions).toEqual(DEFAULT_IMPORT_RULES.extensions);
	});

	it('load() is idempotent — a second call never re-reads storage', () => {
		memStore.set(IMPORT_RULES_KEY, '{"minSeconds":90}');
		deviceImport.rules = { ...DEFAULT_IMPORT_RULES, minSeconds: 5 };
		deviceImport.load();
		expect(deviceImport.rules.minSeconds).toBe(5);
	});

	it('setRules merges the patch and persists it', () => {
		deviceImport.setRules({ minSeconds: 60 });
		expect(deviceImport.rules.minSeconds).toBe(60);
		expect(JSON.parse(memStore.get(IMPORT_RULES_KEY) as string).minSeconds).toBe(60);
		// merge, not replace
		expect(deviceImport.rules.presets).toEqual(DEFAULT_IMPORT_RULES.presets);
	});

	it('setCustomPattern rejects a broken regex NON-destructively (UI-SPEC contract 6)', () => {
		deviceImport.rules = { ...deviceImport.rules, customPattern: '^(?<artist>.+?) - (?<title>.+)$' };
		const ok = deviceImport.setCustomPattern('(?<title>[');
		expect(ok).toBe(false);
		expect(deviceImport.patternError).toBe('invalid');
		// the last WORKING pattern stays in force
		expect(deviceImport.rules.customPattern).toBe('^(?<artist>.+?) - (?<title>.+)$');
	});

	it('setCustomPattern accepts, clears the error and persists a valid pattern', () => {
		deviceImport.patternError = 'too-slow';
		const ok = deviceImport.setCustomPattern('^(?<artist>.+?) - (?<title>.+)$');
		expect(ok).toBe(true);
		expect(deviceImport.patternError).toBe(null);
		expect(JSON.parse(memStore.get(IMPORT_RULES_KEY) as string).customPattern).toBe('^(?<artist>.+?) - (?<title>.+)$');
	});

	it("setCustomPattern('') clears the pattern and any standing error", () => {
		deviceImport.rules = { ...deviceImport.rules, customPattern: '^(?<title>.+)$' };
		deviceImport.patternError = 'no-groups';
		expect(deviceImport.setCustomPattern('  ')).toBe(true);
		expect(deviceImport.rules.customPattern).toBe('');
		expect(deviceImport.patternError).toBe(null);
	});
});

describe('runImport — permission gate (D-14)', () => {
	it("'denied' parks the button without scanning", async () => {
		requestReadAudio.mockResolvedValue({ state: 'denied' });
		await deviceImport.runImport();
		expect(deviceImport.permission).toBe('denied');
		expect(deviceImport.phase).toBe('idle');
		expect(deviceImport.summary).toBe(null);
		expect(scanAudio).not.toHaveBeenCalled();
	});

	it("'denied-permanently' is kept distinct (the UI points at App info instead of re-asking)", async () => {
		requestReadAudio.mockResolvedValue({ state: 'denied-permanently' });
		await deviceImport.runImport();
		expect(deviceImport.permission).toBe('denied-permanently');
		expect(scanAudio).not.toHaveBeenCalled();
	});

	it("'unsupported' is a failure, not a permission state", async () => {
		requestReadAudio.mockResolvedValue({ state: 'unsupported' });
		await deviceImport.runImport();
		expect(deviceImport.notice).toEqual({ key: 'toast.importFailed' });
		expect(deviceImport.permission).toBe(null);
		expect(deviceImport.phase).toBe('idle');
		expect(scanAudio).not.toHaveBeenCalled();
	});

	it('a rejecting bridge is mapped to the SOFT denied state', async () => {
		requestReadAudio.mockRejectedValue(new Error('boom'));
		await deviceImport.runImport();
		expect(deviceImport.permission).toBe('denied');
		expect(scanAudio).not.toHaveBeenCalled();
	});
});

describe('runImport — the paged walk', () => {
	it('pages until offset >= total and applies one syncDevice plan', async () => {
		scanAudio
			.mockResolvedValueOnce({ rows: [row({ id: '1' }), row({ id: '2', uri: 'content://media/external/audio/media/2', displayName: 'Daft Punk - Da Funk.mp3' })], total: 3 })
			.mockResolvedValueOnce({ rows: [row({ id: '3', uri: 'content://media/external/audio/media/3', displayName: 'Radiohead - Creep.mp3' })], total: 3 });
		const setDownloads = vi.spyOn(library, 'setDownloads');

		await deviceImport.runImport();

		expect(scanAudio).toHaveBeenNthCalledWith(1, { offset: 0, limit: SCAN_PAGE_SIZE });
		expect(scanAudio).toHaveBeenNthCalledWith(2, { offset: 2, limit: SCAN_PAGE_SIZE });
		expect(deviceImport.done).toBe(3);
		expect(deviceImport.total).toBe(3);
		expect(deviceImport.phase).toBe('done');
		expect(setDownloads).toHaveBeenCalledTimes(1);
		expect(setDownloads.mock.calls[0][0]).toHaveLength(3);
		expect(deviceImport.summary?.added).toBe(3);
		expect(deviceImport.summary?.complete).toBe(true);
		expect(deviceImport.notice).toEqual({ key: 'toast.importDone', params: { count: 3 } });
		expect(deviceImport.permission).toBe(null);
	});

	it('a rejecting page KEEPS what was already read and never drops (D-08)', async () => {
		library.downloads = [dev('9')];
		scanAudio
			.mockResolvedValueOnce({ rows: [row({ id: '1' }), row({ id: '2', uri: 'content://media/external/audio/media/2', displayName: 'Daft Punk - Da Funk.mp3' })], total: 3 })
			.mockRejectedValueOnce(new Error('MediaStore query failed'));
		const setDownloads = vi.spyOn(library, 'setDownloads');
		const clearUnavailable = vi.spyOn(library, 'clearUnavailable');

		await deviceImport.runImport();

		expect(deviceImport.summary?.complete).toBe(false);
		expect(deviceImport.summary?.added).toBe(2);
		expect(deviceImport.summary?.removed).toBe(0);
		expect(deviceImport.notice).toEqual({ key: 'toast.importFailed' });
		expect(deviceImport.phase).toBe('done');
		expect(setDownloads).toHaveBeenCalledTimes(1);
		// the unseen device entry survives a failed walk
		expect(setDownloads.mock.calls[0][0].map((t) => t.uid)).toContain(deviceUid('9'));
		expect(clearUnavailable).not.toHaveBeenCalled();
	});

	it('cancel() bails after the in-flight page, keeps partial results and drops nothing', async () => {
		library.downloads = [dev('9')];
		let releasePage2: (v: { rows: ScanRow[]; total: number }) => void = () => {};
		const page2 = new Promise<{ rows: ScanRow[]; total: number }>((res) => (releasePage2 = res));
		scanAudio
			.mockResolvedValueOnce({ rows: [row({ id: '1' })], total: 3 })
			.mockReturnValueOnce(page2);
		const setDownloads = vi.spyOn(library, 'setDownloads');

		const run = deviceImport.runImport();
		// let page 1 resolve and page 2 be issued
		await vi.waitFor(() => expect(scanAudio).toHaveBeenCalledTimes(2));
		deviceImport.cancel();
		releasePage2({ rows: [row({ id: '2', uri: 'content://media/external/audio/media/2' })], total: 3 });
		await run;

		expect(deviceImport.summary?.complete).toBe(false);
		expect(deviceImport.summary?.added).toBe(1);
		expect(deviceImport.summary?.removed).toBe(0);
		expect(setDownloads).toHaveBeenCalledTimes(1);
		const next = setDownloads.mock.calls[0][0].map((t) => t.uid);
		expect(next).toContain(deviceUid('1'));
		expect(next).not.toContain(deviceUid('2'));
		expect(next).toContain(deviceUid('9'));
	});

	it('a second tap while a run is in flight is a no-op', async () => {
		scanAudio.mockResolvedValue({ rows: [row({ id: '1' })], total: 1 });
		const a = deviceImport.runImport();
		const b = deviceImport.runImport();
		await Promise.all([a, b]);
		expect(requestReadAudio).toHaveBeenCalledTimes(1);
		expect(scanAudio).toHaveBeenCalledTimes(1);
	});
});

describe('runImport — applying the plan', () => {
	it('relinks a Music/OpenMusic/ row onto its stored entry', async () => {
		library.downloads = [real()];
		scanAudio.mockResolvedValue({
			rows: [row({ id: '5', uri: 'content://media/external/audio/media/5', relativePath: 'Music/OpenMusic/', displayName: 'Adele - Hello.mp3' })],
			total: 1
		});

		await deviceImport.runImport();

		expect(linkPublicUri).toHaveBeenCalledTimes(1);
		expect(linkPublicUri).toHaveBeenCalledWith('kuwo:7', 'content://media/external/audio/media/5');
		expect(deviceImport.summary?.relinked).toBe(1);
	});

	it('a COMPLETE run clears every unavailable mark (every listed file was just confirmed)', async () => {
		scanAudio.mockResolvedValue({ rows: [row({ id: '1' })], total: 1 });
		const clearUnavailable = vi.spyOn(library, 'clearUnavailable');
		await deviceImport.runImport();
		expect(clearUnavailable).toHaveBeenCalledWith();
	});
});

// quick-260919-30x — THE WIRING TEST FOR "don't import again". The brain's own suite proves that a
// marked uid is skipped; what is proved HERE is the thing that makes the feature real rather than
// decorative: the store reads the marks AT CALL TIME and passes them in, so a full scan does not
// put a marked file straight back.
describe('runImport — the user\u2019s "don\u2019t import again" marks (quick-260919-30x)', () => {
	it('does not re-import a file the user marked, and reports it as its own skip', async () => {
		scanAudio.mockResolvedValue({
			rows: [row({ id: '1' }), row({ id: '2', displayName: 'Daft Punk - Da Funk.mp3' })],
			total: 2
		});
		excludeUid(deviceUid('1'), 'Adele - Hello');

		await deviceImport.runImport();

		expect(library.downloads.map((t) => t.uid)).not.toContain(deviceUid('1'));
		expect(library.downloads.map((t) => t.uid)).toContain(deviceUid('2'));
		expect(deviceImport.summary?.skippedExcluded).toBe(1);
		expect(deviceImport.summary?.added).toBe(1);
	});

	it('marks are read at CALL time — one made after the page mounted still counts', async () => {
		scanAudio.mockResolvedValue({ rows: [row({ id: '1' })], total: 1 });
		// first run: nothing marked, the file comes in
		await deviceImport.runImport();
		expect(library.downloads.map((t) => t.uid)).toContain(deviceUid('1'));

		// the user marks it from the track menu, then scans again
		excludeUid(deviceUid('1'), 'Adele - Hello');
		await deviceImport.runImport();
		expect(library.downloads.map((t) => t.uid)).not.toContain(deviceUid('1'));
		expect(deviceImport.summary?.skippedExcluded).toBe(1);
	});

	it('"Allow again" brings the file back on the NEXT scan (D-4)', async () => {
		scanAudio.mockResolvedValue({ rows: [row({ id: '1' })], total: 1 });
		excludeUid(deviceUid('1'), 'Adele - Hello');
		await deviceImport.runImport();
		expect(library.downloads.map((t) => t.uid)).not.toContain(deviceUid('1'));

		unexcludeUid(deviceUid('1'));
		await deviceImport.runImport();
		expect(library.downloads.map((t) => t.uid)).toContain(deviceUid('1'));
		expect(deviceImport.summary?.added).toBe(1);
	});
});

describe('importNotice — the single-slot completion channel', () => {
	const s = (over: Partial<ReturnType<typeof emptySummary>> = {}) => ({ ...emptySummary(DEFAULT_IMPORT_RULES), ...over });

	it('a failed walk outranks everything else', () => {
		expect(importNotice(s({ added: 4, patternFellBack: true }), true)).toEqual({ key: 'toast.importFailed' });
	});

	it('a demoted custom pattern outranks the count (UI-SPEC: it surfaces as a toast)', () => {
		expect(importNotice(s({ added: 4, patternFellBack: true }), false)).toEqual({ key: 'toast.patternFellBack' });
	});

	it('otherwise the completion count', () => {
		expect(importNotice(s({ added: 4 }), false)).toEqual({ key: 'toast.importDone', params: { count: 4 } });
	});
});
