import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// file-tag-sync.ts is the ONE serializer in front of every single-file tag rewrite
// (quick-260919-3j1). Four triggers can each start a wasm tag pass that peaks at ~6x the file size;
// two at once over a 27 MB FLAC on a phone is an OOM. What these tests pin is therefore not the
// happy path but the ORDERING: the second retagOne must not have STARTED while the first is still
// pending, and one rejection must not poison the chain for the rest of the session.

const mocks = vi.hoisted(() => ({ retagOne: vi.fn() }));
vi.mock('./retag', () => ({ retagOne: mocks.retagOne }));

import { syncFileTags } from './file-tag-sync';
import type { RetagEntry } from './retag';

const entry = (n: number): RetagEntry => ({
	uid: `netease-${n}`,
	title: `T${n}`,
	artist: `A${n}`,
	album: '',
	cover: null
});

/** An externally-settled promise, so a test controls exactly when the first pass finishes. */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	mocks.retagOne.mockReset().mockResolvedValue('tagged');
});

describe('file-tag-sync — two calls in one tick never run two wasm passes at once', () => {
	it('the SECOND retagOne has not started while the first is still pending', async () => {
		const first = deferred<string>();
		mocks.retagOne.mockImplementationOnce(() => first.promise);

		const a = syncFileTags(entry(1));
		const b = syncFileTags(entry(2));
		await flush();

		// One pass in flight, the second still queued behind it.
		expect(mocks.retagOne).toHaveBeenCalledTimes(1);
		expect(mocks.retagOne.mock.calls[0][0]).toEqual(entry(1));

		first.resolve('tagged');
		await expect(a).resolves.toBe('tagged');
		await flush();

		expect(mocks.retagOne).toHaveBeenCalledTimes(2);
		expect(mocks.retagOne.mock.calls[1][0]).toEqual(entry(2));
		await expect(b).resolves.toBe('tagged');
	});

	it('each call resolves with its OWN result, in call order', async () => {
		mocks.retagOne
			.mockResolvedValueOnce('tagged')
			.mockResolvedValueOnce('skipped-size')
			.mockResolvedValueOnce('missing');

		const results = await Promise.all([
			syncFileTags(entry(1)),
			syncFileTags(entry(2)),
			syncFileTags(entry(3))
		]);

		expect(results).toEqual(['tagged', 'skipped-size', 'missing']);
		expect(mocks.retagOne.mock.calls.map((c) => (c[0] as RetagEntry).uid)).toEqual([
			'netease-1',
			'netease-2',
			'netease-3'
		]);
	});

	it('runs strictly one at a time even under a burst', async () => {
		let live = 0;
		let peak = 0;
		mocks.retagOne.mockImplementation(async () => {
			live++;
			peak = Math.max(peak, live);
			await flush();
			live--;
			return 'tagged';
		});

		await Promise.all([1, 2, 3, 4, 5].map((n) => syncFileTags(entry(n))));

		expect(peak).toBe(1);
		expect(mocks.retagOne).toHaveBeenCalledTimes(5);
	});
});

describe('file-tag-sync — a rejection cannot poison the chain', () => {
	it("a retagOne that REJECTS resolves as 'error' (it is contractually never-throws, but the chain must not assume it)", async () => {
		mocks.retagOne.mockRejectedValueOnce(new Error('wasm exploded'));
		await expect(syncFileTags(entry(1))).resolves.toBe('error');
	});

	it('the NEXT call after a rejection still runs and still resolves', async () => {
		mocks.retagOne.mockRejectedValueOnce(new Error('wasm exploded')).mockResolvedValue('tagged');

		const a = syncFileTags(entry(1));
		const b = syncFileTags(entry(2));

		await expect(a).resolves.toBe('error');
		await expect(b).resolves.toBe('tagged');
		expect(mocks.retagOne).toHaveBeenCalledTimes(2);
	});

	it('a rejection mid-burst leaves every LATER call intact and in order', async () => {
		mocks.retagOne
			.mockResolvedValueOnce('tagged')
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValueOnce('tagged');

		await expect(
			Promise.all([syncFileTags(entry(1)), syncFileTags(entry(2)), syncFileTags(entry(3))])
		).resolves.toEqual(['tagged', 'error', 'tagged']);
	});
});

describe('file-tag-sync — module shape / purity', () => {
	const src = readFileSync(fileURLToPath(new URL('./file-tag-sync.ts', import.meta.url)), 'utf-8');
	const code = src
		.split('\n')
		.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
		.join('\n');

	it('imports no runes store and no localization (it stays node-testable, like retag.ts)', () => {
		expect(code).not.toMatch(/\$lib\/stores/);
		expect(code).not.toMatch(/\$lib\/i18n/);
		expect(code).not.toMatch(/\$state|\$derived|\$effect/);
	});

	it('routes through retagOne — the ONE tag-write path (verify-before-write + device refusal)', () => {
		expect(code).toMatch(/retagOne\(/);
		// No second write path: nothing here reaches the codec or the store directly.
		expect(code).not.toMatch(/tagAudioBlob|blobStore/);
	});

	it('has no default export', () => {
		expect(src).not.toMatch(/export default/);
	});
});
