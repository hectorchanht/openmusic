import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// retag.ts is the opt-in retro-tagging batch (36-D-17/D-18/D-19). It rewrites files the user
// ALREADY has, so the contract these tests pin is mostly about what it REFUSES to write:
//   - one entry failing leaves every other entry tagged and the batch running (D-19);
//   - tagged bytes that do not parse back are never put (RESEARCH Pitfall 10);
//   - a non-'tagged' codec outcome leaves the file byte-identical;
//   - the report adds up, so the UI's "Tagged N of M, skipped K" line is TRUE.
// Every dependency is mocked (no wasm, no IDB, no network) — the real codec has its own 29 tests.

type TagOutcomeLike = { blob: Blob; result: string; format?: string };

const mocks = vi.hoisted(() => {
	// quick-260919-3j1: the per-uid sticky-name index retagOne now reads (as the filename FALLBACK)
	// and writes (only when the CALLER supplied a name). An in-memory Map stands in for localStorage.
	const names = new Map<string, string>();
	return {
		get: vi.fn(async (_uid: string): Promise<Blob | null> => new Blob(['audio'])),
		put: vi.fn(async (_uid: string, _blob: Blob, _filename?: string) => true),
		tagAudioBlob: vi.fn(
			async (blob: Blob, _f: unknown, _a?: unknown): Promise<TagOutcomeLike> => ({ blob, result: 'tagged', format: 'm4a' })
		),
		readAudioTags: vi.fn(async (_b: Uint8Array): Promise<Record<string, unknown> | null> => ({ title: 'T', format: 'm4a' })),
		resolveArtworkDataUrl: vi.fn(async (_q: unknown): Promise<string | null> => 'data:image/png;base64,AA'),
		forgetLocalEnrichment: vi.fn((_uid: string) => {}),
		names,
		getStoredName: vi.fn((uid: string): string | null => names.get(uid) ?? null),
		setStoredName: vi.fn((uid: string, base: string): void => void names.set(uid, base)),
		// quick-260919-ejm: the device write sink. `put` and this are MUTUALLY EXCLUSIVE — which of
		// the two a uid reaches is the entire contract these tests exist to pin.
		overwriteDeviceFile: vi.fn(
			async (_uid: string, _blob: Blob, _meta?: unknown): Promise<'ok' | 'unsupported' | 'failed'> => 'ok'
		)
	};
});

// Both specifiers, same shape — retag.ts imports './blob-store' but other modules in the graph use
// the alias. Inlined in each factory rather than shared via a const: vi.mock is hoisted above every
// top-level binding, so a shared object would be read before it is initialised.
vi.mock('$lib/services/blob-store', () => ({
	blobStore: {
		get: mocks.get,
		put: mocks.put,
		getStoredName: mocks.getStoredName,
		overwriteDeviceFile: mocks.overwriteDeviceFile
	},
	getStoredName: mocks.getStoredName,
	setStoredName: mocks.setStoredName,
	overwriteDeviceFile: mocks.overwriteDeviceFile
}));
vi.mock('./blob-store', () => ({
	blobStore: {
		get: mocks.get,
		put: mocks.put,
		getStoredName: mocks.getStoredName,
		overwriteDeviceFile: mocks.overwriteDeviceFile
	},
	getStoredName: mocks.getStoredName,
	setStoredName: mocks.setStoredName,
	overwriteDeviceFile: mocks.overwriteDeviceFile
}));
// quick-260919-0mw: spread the REAL module so `albumTag` (a pure string helper retag now calls) is
// present — only the two codec entry points are stubbed.
vi.mock('./audio-tags', async (orig) => ({
	...(await orig<typeof import('./audio-tags')>()),
	tagAudioBlob: mocks.tagAudioBlob,
	readAudioTags: mocks.readAudioTags
}));
vi.mock('./media-artwork', () => ({ resolveArtworkDataUrl: mocks.resolveArtworkDataUrl }));
// quick-260919-1eh: stubbed rather than spread — the real module pulls the wasm codec in, and the
// only thing retag asks of it is the one-line per-uid memo eviction.
vi.mock('$lib/services/local-tags', () => ({ forgetLocalEnrichment: mocks.forgetLocalEnrichment }));
vi.mock('./local-tags', () => ({ forgetLocalEnrichment: mocks.forgetLocalEnrichment }));

import * as retagModule from './retag';
import { retagDownloads, retagOne, type RetagEntry } from './retag';

function entry(n: number, over: Partial<RetagEntry> = {}): RetagEntry {
	return { uid: `netease-${n}`, title: `T${n}`, artist: `A${n}`, album: `Al${n}`, cover: null, ...over };
}

beforeEach(() => {
	mocks.get.mockReset().mockImplementation(async () => new Blob(['audio']));
	mocks.put.mockReset().mockResolvedValue(true);
	mocks.tagAudioBlob
		.mockReset()
		.mockImplementation(async (blob: Blob) => ({ blob, result: 'tagged', format: 'm4a' }));
	// default: the read-back agrees with whatever title was written
	mocks.readAudioTags.mockReset().mockImplementation(async () => ({
		title: (mocks.tagAudioBlob.mock.calls.at(-1)?.[1] as { title?: string } | undefined)?.title,
		format: 'm4a'
	}));
	mocks.resolveArtworkDataUrl.mockReset().mockResolvedValue('data:image/png;base64,AA');
	mocks.forgetLocalEnrichment.mockReset();
	mocks.names.clear();
	mocks.getStoredName.mockClear();
	mocks.setStoredName.mockClear();
	mocks.overwriteDeviceFile.mockReset().mockResolvedValue('ok');
});

describe('retag — per-file isolation (36-D-19)', () => {
	it('keeps going when the middle entry throws: 2 tagged, 1 error, put never called for it', async () => {
		mocks.tagAudioBlob.mockImplementation(async (blob: Blob, f: unknown) => {
			if ((f as { title: string }).title === 'T2') throw new Error('wasm exploded');
			return { blob, result: 'tagged', format: 'm4a' };
		});
		const progress: Array<[number, number]> = [];
		const report = await retagDownloads([entry(1), entry(2), entry(3)], (d, t) => progress.push([d, t]));

		expect(report).toEqual({ total: 3, tagged: 2, skipped: { error: 1 } });
		expect(mocks.put).toHaveBeenCalledTimes(2);
		expect(mocks.put.mock.calls.map((c) => c[0])).toEqual(['netease-1', 'netease-3']);
		expect(progress).toEqual([
			[1, 3],
			[2, 3],
			[3, 3]
		]);
	});

	it('a blobStore.get rejection is that entry alone — the batch still resolves', async () => {
		mocks.get.mockImplementation(async (uid: string) => {
			if (uid === 'netease-2') throw new Error('IDB died');
			return new Blob(['audio']);
		});
		await expect(retagDownloads([entry(1), entry(2)])).resolves.toEqual({
			total: 2,
			tagged: 1,
			skipped: { error: 1 }
		});
	});

	it('a throwing onProgress callback cannot abort the batch', async () => {
		const report = await retagDownloads([entry(1), entry(2)], () => {
			throw new Error('UI blew up');
		});
		expect(report.tagged).toBe(2);
	});
});

describe('retag — never writes what it should not (36-D-18 scope + Pitfall 10)', () => {
	it('missing offline copy → "missing", the codec is never even invoked', async () => {
		mocks.get.mockResolvedValue(null);
		const report = await retagDownloads([entry(1)]);
		expect(report).toEqual({ total: 1, tagged: 0, skipped: { missing: 1 } });
		expect(mocks.tagAudioBlob).not.toHaveBeenCalled();
		expect(mocks.put).not.toHaveBeenCalled();
	});

	it('read-back returns a DIFFERENT title → "verify-failed" and NO put (the file stays as it was)', async () => {
		mocks.readAudioTags.mockResolvedValue({ title: 'something else', format: 'm4a' });
		const report = await retagDownloads([entry(1)]);
		expect(report).toEqual({ total: 1, tagged: 0, skipped: { 'verify-failed': 1 } });
		expect(mocks.put).not.toHaveBeenCalled();
	});

	it('read-back returns null (bytes do not parse) → "verify-failed" and NO put', async () => {
		mocks.readAudioTags.mockResolvedValue(null);
		const report = await retagDownloads([entry(1)]);
		expect(report).toEqual({ total: 1, tagged: 0, skipped: { 'verify-failed': 1 } });
		expect(mocks.put).not.toHaveBeenCalled();
	});

	it('verifies BEFORE it writes — readAudioTags precedes put in call order', async () => {
		await retagDownloads([entry(1)]);
		expect(mocks.readAudioTags.mock.invocationCallOrder[0]).toBeLessThan(mocks.put.mock.invocationCallOrder[0]);
	});

	it('a non-"tagged" codec outcome ("skipped-size") records the bucket and leaves the file alone', async () => {
		mocks.tagAudioBlob.mockImplementation(async (blob: Blob) => ({ blob, result: 'skipped-size' }));
		const report = await retagDownloads([entry(1)]);
		expect(report).toEqual({ total: 1, tagged: 0, skipped: { 'skipped-size': 1 } });
		expect(mocks.put).not.toHaveBeenCalled();
		expect(mocks.readAudioTags).not.toHaveBeenCalled();
	});

	it('"unknown-container" passes straight through as its own bucket', async () => {
		mocks.tagAudioBlob.mockImplementation(async (blob: Blob) => ({ blob, result: 'unknown-container' }));
		const report = await retagDownloads([entry(1)]);
		expect(report.skipped).toEqual({ 'unknown-container': 1 });
	});

	it('put returning false → "put-failed" (reported, not silently counted as tagged)', async () => {
		mocks.put.mockResolvedValue(false);
		const report = await retagDownloads([entry(1)]);
		expect(report).toEqual({ total: 1, tagged: 0, skipped: { 'put-failed': 1 } });
	});

	it('empty / invalid input is a zero report, no work attempted', async () => {
		expect(await retagDownloads([])).toEqual({ total: 0, tagged: 0, skipped: {} });
		expect(await retagDownloads(null as unknown as RetagEntry[])).toEqual({ total: 0, tagged: 0, skipped: {} });
		expect(mocks.get).not.toHaveBeenCalled();
	});
});

describe('retag — what it hands the codec and the store', () => {
	it('no trackNumber (36-D-11), albumArtist = artist (36-D-12), empty album omitted (36-D-10)', async () => {
		await retagDownloads([entry(1, { album: '' })]);
		const fields = mocks.tagAudioBlob.mock.calls[0][1] as Record<string, unknown>;
		expect(fields).toEqual({ title: 'T1', artist: 'A1', album: undefined, albumArtist: 'A1' });
		expect(fields.trackNumber).toBeUndefined();
	});

	it('the put filename uses the SNIFFED container extension, not a URL guess', async () => {
		mocks.tagAudioBlob.mockImplementation(async (blob: Blob) => ({ blob, result: 'tagged', format: 'flac' }));
		await retagDownloads([entry(1)]);
		expect(mocks.put.mock.calls[0][2]).toBe('A1 - T1.flac');
	});

	it('resolves artwork through the ONE shared resolver (36-D-13) and passes it to the codec', async () => {
		await retagDownloads([entry(1, { cover: 'https://cdn/x.jpg' })]);
		expect(mocks.resolveArtworkDataUrl).toHaveBeenCalledWith({ cover: 'https://cdn/x.jpg', title: 'T1', artist: 'A1' });
		expect(mocks.tagAudioBlob.mock.calls[0][2]).toBe('data:image/png;base64,AA');
	});

	it('puts under the SAME uid it read (never invents a key)', async () => {
		await retagDownloads([entry(7)]);
		expect(mocks.put.mock.calls[0][0]).toBe('netease-7');
	});
});

// quick-260919-2jo — the bulk-retag ENTRY builds its RetagEntry list in a .svelte route whose
// helper is not exported, so assert the composition at the source. This is the one check that
// fails if the album regresses back to the raw catalog string while title/artist stay converted.
describe('retag — the Settings → Downloads entry routes the album through the script lock', () => {
	it('builds its RetagEntry album from names.zhLock, not the raw d.album', () => {
		const page = readFileSync('src/routes/(app)/settings/downloads/+page.svelte', 'utf-8');
		expect(page).toMatch(/album: names\.zhLock\(d\.album\)/);
		expect(page).not.toMatch(/^\s*album: d\.album,/m);
	});
});

describe('retag — module shape / purity', () => {
	const src = readFileSync(fileURLToPath(new URL('./retag.ts', import.meta.url)), 'utf-8');
	const code = src
		.split('\n')
		.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
		.join('\n');

	it('imports no runes store and no localization', () => {
		expect(code).not.toMatch(/\$lib\/stores/);
		expect(code).not.toMatch(/\$lib\/i18n/);
	});

	it('is sequential — no parallel fan-out over the user files', () => {
		expect(code).not.toMatch(/allSettled/);
		expect(code).toMatch(/for \(const/);
	});

	it('never touches display ordering as identity', () => {
		expect(code).not.toMatch(/displayIndex/);
	});

	it('exports exactly the batch loop + its per-item step at runtime, with no default export', () => {
		// quick-260919-1eh: retagOne is public now — it is the metadata editor's ENTIRE save path.
		expect(Object.keys(retagModule).sort()).toEqual(['retagDownloads', 'retagOne']);
		expect(src).not.toMatch(/export default/);
	});
});

// quick-260919-1eh — retagOne is now BOTH the batch loop's per-item step and the metadata editor's
// entire save. Three new obligations: lyrics thread through, `device:` files are refused before any
// blobStore call, and a successful rewrite evicts the local-tags memo keyed by that uid.
describe('retag — the single-file save path (quick-260919-1eh)', () => {
	it('lyrics set → passed through to the codec verbatim', async () => {
		const lrc = '[00:12.34]line one';
		expect(await retagOne(entry(1, { lyrics: lrc }))).toBe('tagged');
		const fields = mocks.tagAudioBlob.mock.calls[0][1] as Record<string, unknown>;
		expect(fields.lyrics).toBe(lrc);
	});

	it('lyrics absent → the fields object carries NO lyrics key (omission preserves the file\'s own)', async () => {
		await retagOne(entry(1));
		const fields = mocks.tagAudioBlob.mock.calls[0][1] as Record<string, unknown>;
		expect(fields.lyrics).toBeUndefined();
	});

	it('an empty-string lyrics is omission, not a clear (D-4)', async () => {
		await retagOne(entry(1, { lyrics: '' }));
		const fields = mocks.tagAudioBlob.mock.calls[0][1] as Record<string, unknown>;
		expect(fields.lyrics).toBeUndefined();
	});

	// ── quick-260919-30x: the OPTIONAL typed filename (D-6/D-7, T-30x-01) ───────────────────────
	it('a typed base name is used, with the SNIFFED container appended (D-6)', async () => {
		expect(await retagOne(entry(1, { filename: 'My Song' }))).toBe('tagged');
		expect(mocks.put.mock.calls[0][2]).toBe('My Song.m4a');
	});

	it('a typed extension is NOT honoured — it is just more base name (D-6)', async () => {
		// Stops a user typing `note.txt` into a MediaStore AUDIO entry.
		expect(await retagOne(entry(1, { filename: 'note.txt' }))).toBe('tagged');
		expect(mocks.put.mock.calls[0][2]).toBe('note.txt.m4a');
	});

	it('a traversal attempt reaches put with no separator left in it (T-30x-01)', async () => {
		expect(await retagOne(entry(1, { filename: 'evil/../../x' }))).toBe('tagged');
		const name = mocks.put.mock.calls[0][2] as string;
		expect(name).not.toContain('/');
		expect(name).not.toContain('\\');
		expect(name.endsWith('.m4a')).toBe(true);
	});

	it('absent / blank / whitespace-only / all-dots falls back to today\u2019s derived name (D-7)', async () => {
		for (const filename of [undefined, '', '   ', '\t\n ', '.', '..', '...']) {
			mocks.put.mockClear();
			expect(await retagOne(entry(1, { filename }))).toBe('tagged');
			expect(mocks.put.mock.calls[0][2]).toBe('A1 - T1.m4a');
		}
	});

	it('a name that SANITIZES to nothing usable still falls back rather than writing junk', async () => {
		mocks.put.mockClear();
		expect(await retagOne(entry(1, { filename: '   ...   ' }))).toBe('tagged');
		expect(mocks.put.mock.calls[0][2]).toBe('A1 - T1.m4a');
	});

	it('an over-long typed name is truncated BEFORE the extension is appended', async () => {
		expect(await retagOne(entry(1, { filename: 'z'.repeat(400) }))).toBe('tagged');
		expect(mocks.put.mock.calls[0][2]).toBe('z'.repeat(120) + '.m4a');
	});

	// quick-260919-ejm REPLACES the two 1eh refusal cases that stood here ('a device: uid is still
	// refused with a filename set' and 'a device: uid is refused BEFORE any blobStore call'). The
	// refusal was lifted deliberately, on the user's explicit authorisation, so those two assertions
	// are now false by design — they are replaced by their new-contract equivalents in the
	// 'device fork' describe below, which pin the thing that actually still matters: a device uid
	// reaches overwriteDeviceFile and NEVER blobStore.put.

	it('the Settings sweep now INCLUDES an imported file: a mixed list still adds up', async () => {
		const report = await retagDownloads([entry(1), entry(2, { uid: 'device:4711' }), entry(3)]);
		expect(report).toEqual({ total: 3, tagged: 3, skipped: {} });
		expect(report.tagged + Object.values(report.skipped).reduce((a, b) => a + b, 0)).toBe(report.total);
		// The imported entry went to the in-place write, the app's own two went to put.
		expect(mocks.put.mock.calls.map((c) => c[0])).toEqual(['netease-1', 'netease-3']);
		expect(mocks.overwriteDeviceFile.mock.calls.map((c) => c[0])).toEqual(['device:4711']);
	});

	it('a successful rewrite evicts the local-tags memo for exactly that uid', async () => {
		await retagOne(entry(7));
		expect(mocks.forgetLocalEnrichment).toHaveBeenCalledWith('netease-7');
	});

	// ── quick-260919-3j1 (D-6, T-3j1-01): the typed name becomes STICKY ──────────────────────────
	// The enabling fix for the three new rewrite triggers this task adds: a cover pin, a lyric pin and
	// the player's automatic lyric embed all pass NO filename, and without this each would rename a
	// file the user deliberately named in the editor.
	it('records the sanitized base when the CALLER supplied a filename', async () => {
		expect(await retagOne(entry(1, { filename: 'My Song' }))).toBe('tagged');
		expect(mocks.setStoredName).toHaveBeenCalledWith('netease-1', 'My Song');
	});

	it('a caller with NO filename reuses the recorded base, NOT the derived title+artist name', async () => {
		await retagOne(entry(1, { filename: 'My Song' }));
		mocks.put.mockClear();
		// A later rewrite that knows nothing about the name (a cover pin): same file name, new ext.
		mocks.tagAudioBlob.mockImplementation(async (blob: Blob) => ({ blob, result: 'tagged', format: 'flac' }));
		expect(await retagOne(entry(1, { title: 'T1' }))).toBe('tagged');
		expect(mocks.put.mock.calls[0][2]).toBe('My Song.flac');
	});

	it('with NO recorded base and no filename it is byte-identical to today', async () => {
		expect(await retagOne(entry(1))).toBe('tagged');
		expect(mocks.put.mock.calls[0][2]).toBe('A1 - T1.m4a');
		expect(mocks.setStoredName).not.toHaveBeenCalled();
	});

	it('a DERIVED name is never recorded, so a later title edit still renames the file (D-6)', async () => {
		await retagOne(entry(1));
		expect(mocks.setStoredName).not.toHaveBeenCalled();
		mocks.put.mockClear();
		expect(await retagOne(entry(1, { title: 'Renamed' }))).toBe('tagged');
		expect(mocks.put.mock.calls[0][2]).toBe('A1 - Renamed.m4a');
	});

	it('a caller-supplied filename still OUTRANKS the recorded base', async () => {
		mocks.names.set('netease-1', 'Old Name');
		mocks.put.mockClear();
		expect(await retagOne(entry(1, { filename: 'Newer Name' }))).toBe('tagged');
		expect(mocks.put.mock.calls[0][2]).toBe('Newer Name.m4a');
	});

	it('T-3j1-01: a recorded base is RE-SANITIZED on read — `../evil` never reaches put', async () => {
		mocks.names.set('netease-1', '../../evil');
		mocks.put.mockClear();
		const name = (await retagOne(entry(1)), mocks.put.mock.calls[0][2] as string);
		expect(name).not.toContain('/');
		expect(name).not.toContain('\\');
		expect(name.endsWith('.m4a')).toBe(true);
	});

	it('T-3j1-01: a recorded base of only dots falls back to the derived name', async () => {
		mocks.names.set('netease-1', '...');
		mocks.put.mockClear();
		await retagOne(entry(1));
		expect(mocks.put.mock.calls[0][2]).toBe('A1 - T1.m4a');
	});

	it('nothing is recorded on a non-"tagged" outcome (T-3j1-02)', async () => {
		mocks.put.mockResolvedValue(false);
		expect(await retagOne(entry(1, { filename: 'My Song' }))).toBe('put-failed');
		expect(mocks.setStoredName).not.toHaveBeenCalled();

		mocks.put.mockResolvedValue(true);
		mocks.readAudioTags.mockResolvedValue(null);
		expect(await retagOne(entry(2, { filename: 'My Song' }))).toBe('verify-failed');
		expect(mocks.setStoredName).not.toHaveBeenCalled();

		// quick-260919-ejm: a device uid now SUCCEEDS, and still records no name — D-7 says the
		// in-place write cannot rename, so the sticky-name index is neither read nor written for one.
		mocks.readAudioTags.mockImplementation(async () => ({ title: 'T3', format: 'm4a' }));
		expect(await retagOne(entry(3, { uid: 'device:1', filename: 'My Song' }))).toBe('tagged');
		expect(mocks.setStoredName).not.toHaveBeenCalled();
	});

	it('a FAILED rewrite leaves the memo alone (the bytes on disk did not change)', async () => {
		mocks.put.mockResolvedValue(false);
		expect(await retagOne(entry(7))).toBe('put-failed');
		expect(mocks.forgetLocalEnrichment).not.toHaveBeenCalled();

		mocks.forgetLocalEnrichment.mockReset();
		mocks.readAudioTags.mockResolvedValue(null);
		expect(await retagOne(entry(8))).toBe('verify-failed');
		expect(mocks.forgetLocalEnrichment).not.toHaveBeenCalled();
	});
});

// --- quick-260919-ejm: the DEVICE FORK -------------------------------------------------------
//
// The 1eh guard (`if (isDeviceUid(entry.uid)) return 'device-skipped'`) is gone. The user
// authorised rewriting their own imported files in place, and the refusal that stood here is
// replaced by a FORK AT THE WRITE STEP: same codec pass, same verify-before-write, different sink.
//
// What these tests pin is the thing the refusal was really protecting — `blobStore.put` has no
// device short-circuit, so a device uid reaching it would write an orphan app-private copy plus a
// SECOND public copy of a song the user already owns. That hazard is still real; it is now avoided
// by ROUTING (the fork never calls put) rather than by refusing to run at all.
describe('retag — the device fork (quick-260919-ejm)', () => {
	const dev = (over: Partial<RetagEntry> = {}) => entry(1, { uid: 'device:4711', ...over });

	it('runs the FULL codec pass for a device uid — get, tag and the verify round-trip all happen', async () => {
		expect(await retagOne(dev())).toBe('tagged');
		expect(mocks.get).toHaveBeenCalledWith('device:4711');
		expect(mocks.tagAudioBlob).toHaveBeenCalledTimes(1);
		expect(mocks.readAudioTags).toHaveBeenCalledTimes(1);
	});

	// THE inverse of the 1eh bug, asserted directly.
	it('NEVER calls blobStore.put for a device uid — it writes through overwriteDeviceFile instead', async () => {
		await retagOne(dev());
		expect(mocks.put).not.toHaveBeenCalled();
		expect(mocks.overwriteDeviceFile).toHaveBeenCalledTimes(1);
	});

	it('hands over the TAGGED blob and the ORIGINAL blob size as expectedBytes (the row precondition)', async () => {
		const original = new Blob([new Uint8Array(4711)]);
		const tagged = new Blob([new Uint8Array(4800)]);
		mocks.get.mockResolvedValueOnce(original);
		mocks.tagAudioBlob.mockResolvedValueOnce({ blob: tagged, result: 'tagged', format: 'm4a' });
		mocks.readAudioTags.mockResolvedValueOnce({ title: 'T1', format: 'm4a' });
		await retagOne(dev({ album: 'Al1' }));
		const [uid, blob, meta] = mocks.overwriteDeviceFile.mock.calls[0];
		expect(uid).toBe('device:4711');
		expect(blob).toBe(tagged);
		expect(meta).toEqual({ title: 'T1', artist: 'A1', album: 'Al1', expectedBytes: 4711 });
	});

	it("'ok' is 'tagged', and it evicts the local-tags memo for that uid", async () => {
		expect(await retagOne(dev())).toBe('tagged');
		expect(mocks.forgetLocalEnrichment).toHaveBeenCalledWith('device:4711');
	});

	// The bucket keeps a meaning rather than being deleted: on web and on API below 29 there is no
	// MediaStore row to write into, and "skipped" is the honest word for that.
	it("'unsupported' is still 'device-skipped' — the bucket now means the PLATFORM cannot, not that we refuse", async () => {
		mocks.overwriteDeviceFile.mockResolvedValueOnce('unsupported');
		expect(await retagOne(dev())).toBe('device-skipped');
		expect(mocks.forgetLocalEnrichment).not.toHaveBeenCalled();
	});

	it("'failed' is 'put-failed', and the memo is left alone (the bytes on disk may not have changed)", async () => {
		mocks.overwriteDeviceFile.mockResolvedValueOnce('failed');
		expect(await retagOne(dev())).toBe('put-failed');
		expect(mocks.forgetLocalEnrichment).not.toHaveBeenCalled();
	});

	// D-7: the in-place write cannot rename, so a filename must not be threaded anywhere.
	it('IGNORES entry.filename for a device uid — the sticky-name index is neither read nor written', async () => {
		expect(await retagOne(dev({ filename: 'Rename me' }))).toBe('tagged');
		expect(mocks.getStoredName).not.toHaveBeenCalled();
		expect(mocks.setStoredName).not.toHaveBeenCalled();
		// and nothing name-shaped reached the write
		expect(JSON.stringify(mocks.overwriteDeviceFile.mock.calls[0][2])).not.toContain('Rename me');
	});

	it('a RECORDED name for a device uid is not consulted either', async () => {
		mocks.names.set('device:4711', 'Typed earlier');
		expect(await retagOne(dev())).toBe('tagged');
		expect(mocks.getStoredName).not.toHaveBeenCalled();
	});

	// Ladder rung 1: the 40 MB ceiling must still decline BEFORE anything is opened for write.
	it('rung 1: a skipped-size codec outcome returns before overwriteDeviceFile is reached', async () => {
		mocks.tagAudioBlob.mockResolvedValueOnce({ blob: new Blob(['x']), result: 'skipped-size', format: 'flac' });
		expect(await retagOne(dev())).toBe('skipped-size');
		expect(mocks.overwriteDeviceFile).not.toHaveBeenCalled();
	});

	it('rung 1: unknown-container and no-fields decline the same way', async () => {
		mocks.tagAudioBlob.mockResolvedValueOnce({ blob: new Blob(['x']), result: 'unknown-container' });
		expect(await retagOne(dev())).toBe('unknown-container');
		mocks.tagAudioBlob.mockResolvedValueOnce({ blob: new Blob(['x']), result: 'no-fields' });
		expect(await retagOne(dev())).toBe('no-fields');
		expect(mocks.overwriteDeviceFile).not.toHaveBeenCalled();
	});

	// Ladder rung 2: unparseable bytes never reach a file descriptor.
	it('rung 2: verify-before-write still gates the device path', async () => {
		mocks.readAudioTags.mockResolvedValueOnce(null);
		expect(await retagOne(dev())).toBe('verify-failed');
		expect(mocks.overwriteDeviceFile).not.toHaveBeenCalled();

		mocks.readAudioTags.mockResolvedValueOnce({ title: 'something else', format: 'm4a' });
		expect(await retagOne(dev())).toBe('verify-failed');
		expect(mocks.overwriteDeviceFile).not.toHaveBeenCalled();
	});

	it('a missing file is still `missing` — nothing is written for a song the app cannot read', async () => {
		mocks.get.mockResolvedValueOnce(null);
		expect(await retagOne(dev())).toBe('missing');
		expect(mocks.overwriteDeviceFile).not.toHaveBeenCalled();
	});

	// The other half of the exclusion: the app-download path must be byte-identical.
	it('an APP-DOWNLOAD uid is unchanged — put with the derived name, overwriteDeviceFile never called', async () => {
		expect(await retagOne(entry(1))).toBe('tagged');
		expect(mocks.put).toHaveBeenCalledTimes(1);
		expect(mocks.put.mock.calls[0][2]).toBe('A1 - T1.m4a');
		expect(mocks.overwriteDeviceFile).not.toHaveBeenCalled();
	});

	it('an app-download uid still honours the sticky typed name', async () => {
		mocks.names.set('netease-1', 'Typed earlier');
		expect(await retagOne(entry(1))).toBe('tagged');
		expect(mocks.put.mock.calls[0][2]).toBe('Typed earlier.m4a');
		expect(mocks.overwriteDeviceFile).not.toHaveBeenCalled();
	});
});
