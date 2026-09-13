import { describe, it, expect, vi } from 'vitest';
import { readBlobWithProgress } from './download-progress';

// quick-260913-omi. The Download row's percentage is only worth showing if it reflects real bytes,
// so these pin the two things that make it honest: (1) with a Content-Length the fractions track
// actual received bytes, monotonically, one callback per whole percent; (2) WITHOUT one the helper
// reports nothing at all and degrades to resp.blob() — the indeterminate spinner — rather than
// inventing a bar for a transfer whose size it does not know.

/** A minimal Response stand-in: a chunked ReadableStream plus the two headers the helper reads. */
function fakeResponse(
	chunks: Uint8Array[],
	headers: Record<string, string>,
	opts?: { noBody?: boolean }
): Response {
	let i = 0;
	const body = {
		getReader() {
			return {
				read: async () =>
					i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }
			};
		}
	};
	return {
		headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
		body: opts?.noBody ? null : body,
		blob: async () => new Blob(chunks.map((c) => c as BlobPart), { type: headers['content-type'] ?? '' })
	} as unknown as Response;
}

const chunk = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

describe('readBlobWithProgress — determinate transfer (Content-Length present)', () => {
	it('reports fractions that track received bytes and ends at 1', async () => {
		const onProgress = vi.fn();
		const resp = fakeResponse([chunk(25), chunk(25), chunk(50)], {
			'content-length': '100',
			'content-type': 'audio/mpeg'
		});
		await readBlobWithProgress(resp, onProgress);
		expect(onProgress.mock.calls.map(([f]) => f)).toEqual([0.25, 0.5, 1]);
	});

	it('returns a Blob with all the bytes and the response content type', async () => {
		const resp = fakeResponse([chunk(8), chunk(4)], {
			'content-length': '12',
			'content-type': 'audio/flac'
		});
		const blob = await readBlobWithProgress(resp, () => {});
		expect(blob.size).toBe(12);
		expect(blob.type).toBe('audio/flac');
	});

	it('emits at most one callback per whole percent (a 40MB file must not spam the store)', async () => {
		const onProgress = vi.fn();
		// 1000 chunks of 1 byte over a 1000-byte total: one callback per DISTINCT whole percent, so
		// 101 (0% on the first byte, then 1..100) — not 1000. The 0% call is wanted: it paints an
		// empty bar the instant the first bytes land, instead of leaving the row blank until 1%.
		const resp = fakeResponse(Array.from({ length: 1000 }, () => chunk(1)), {
			'content-length': '1000'
		});
		await readBlobWithProgress(resp, onProgress);
		expect(onProgress).toHaveBeenCalledTimes(101);
		expect(new Set(onProgress.mock.calls.map(([f]) => f)).size).toBe(101);
	});

	it('progress never goes backwards', async () => {
		const onProgress = vi.fn();
		const resp = fakeResponse([chunk(10), chunk(30), chunk(1), chunk(59)], {
			'content-length': '100'
		});
		await readBlobWithProgress(resp, onProgress);
		const seen = onProgress.mock.calls.map(([f]) => f as number);
		expect(seen).toEqual([...seen].sort((a, b) => a - b));
	});

	it('clamps at 1 when the body outruns an under-reported Content-Length', async () => {
		const onProgress = vi.fn();
		const resp = fakeResponse([chunk(100), chunk(100)], { 'content-length': '100' });
		const blob = await readBlobWithProgress(resp, onProgress);
		const seen = onProgress.mock.calls.map(([f]) => f as number);
		expect(Math.max(...seen)).toBe(1);
		// All the bytes still land — the clamp is cosmetic, it must not truncate the file.
		expect(blob.size).toBe(200);
	});

	it('skips an empty chunk without emitting a duplicate percent', async () => {
		const onProgress = vi.fn();
		const resp = fakeResponse([chunk(50), chunk(0), chunk(50)], { 'content-length': '100' });
		await readBlobWithProgress(resp, onProgress);
		expect(onProgress.mock.calls.map(([f]) => f)).toEqual([0.5, 1]);
	});
});

describe('readBlobWithProgress — indeterminate transfer (falls back, reports nothing)', () => {
	it('falls back to resp.blob() when Content-Length is absent', async () => {
		const onProgress = vi.fn();
		const resp = fakeResponse([chunk(64)], { 'content-type': 'audio/mpeg' });
		const blob = await readBlobWithProgress(resp, onProgress);
		expect(onProgress).not.toHaveBeenCalled();
		expect(blob.size).toBe(64);
	});

	it('falls back when Content-Length is zero or unparseable', async () => {
		for (const len of ['0', 'chunked', '']) {
			const onProgress = vi.fn();
			const resp = fakeResponse([chunk(10)], { 'content-length': len });
			await readBlobWithProgress(resp, onProgress);
			expect(onProgress, `content-length: ${JSON.stringify(len)}`).not.toHaveBeenCalled();
		}
	});

	it('falls back when the response has no readable body', async () => {
		const onProgress = vi.fn();
		const resp = fakeResponse([chunk(10)], { 'content-length': '10' }, { noBody: true });
		const blob = await readBlobWithProgress(resp, onProgress);
		expect(onProgress).not.toHaveBeenCalled();
		expect(blob.size).toBe(10);
	});
});
