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

const mocks = vi.hoisted(() => ({
	get: vi.fn(async (_uid: string): Promise<Blob | null> => new Blob(['audio'])),
	put: vi.fn(async (_uid: string, _blob: Blob, _filename?: string) => true),
	tagAudioBlob: vi.fn(
		async (blob: Blob, _f: unknown, _a?: unknown): Promise<TagOutcomeLike> => ({ blob, result: 'tagged', format: 'm4a' })
	),
	readAudioTags: vi.fn(async (_b: Uint8Array): Promise<Record<string, unknown> | null> => ({ title: 'T', format: 'm4a' })),
	resolveArtworkDataUrl: vi.fn(async (_q: unknown): Promise<string | null> => 'data:image/png;base64,AA')
}));

vi.mock('$lib/services/blob-store', () => ({ blobStore: { get: mocks.get, put: mocks.put } }));
vi.mock('./blob-store', () => ({ blobStore: { get: mocks.get, put: mocks.put } }));
// quick-260919-0mw: spread the REAL module so `albumTag` (a pure string helper retag now calls) is
// present — only the two codec entry points are stubbed.
vi.mock('./audio-tags', async (orig) => ({
	...(await orig<typeof import('./audio-tags')>()),
	tagAudioBlob: mocks.tagAudioBlob,
	readAudioTags: mocks.readAudioTags
}));
vi.mock('./media-artwork', () => ({ resolveArtworkDataUrl: mocks.resolveArtworkDataUrl }));

import * as retagModule from './retag';
import { retagDownloads, type RetagEntry } from './retag';

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

	it('exports exactly retagDownloads at runtime, with no default export', () => {
		expect(Object.keys(retagModule)).toEqual(['retagDownloads']);
		expect(src).not.toMatch(/export default/);
	});
});
