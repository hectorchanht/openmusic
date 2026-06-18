import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Poison-resistant caching contract for translate.ts (WR / debug:dashboard-liked-not-translated).
// During the /api/translate echo-mode bug the endpoint returned ORIGINALS as a "success" and the
// client persisted them as final translations → liked/library names stuck Simplified forever.
// These tests pin the fix: (a) only fully-translated batches are persisted; (b) the cache key
// carries a version segment so pre-version (poisoned) entries are abandoned + purged.
//
// Runs under the node project: flip `browser` ON (so persist() runs) and back it with a minimal
// in-memory localStorage, mirroring stores/player.svelte.test.ts.
vi.mock('$app/environment', () => ({ browser: true }));

const fetchMock = vi.fn();
vi.mock('./api-base', () => ({ apiFetch: (...a: unknown[]) => fetchMock(...a) }));

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

function jsonRes(body: unknown) {
	return { json: async () => body } as Response;
}
const lsKeys = () => Array.from(memStore.keys());

beforeEach(() => {
	fetchMock.mockReset();
	memStore.clear();
	vi.resetModules();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.stubGlobal('localStorage', localStorageMock);
});

describe('translateLinesEx — fallback signal + poison-resistant cache', () => {
	it('persists a fully-translated batch (all flags true)', async () => {
		const { translateLinesEx } = await import('./translate');
		fetchMock.mockResolvedValue(jsonRes({ translated: ['杜國華', '周杰倫'], flags: [true, true] }));
		const r = await translateLinesEx(['杜国华', '周杰伦'], 'zh-Hant');
		expect(r.out).toEqual(['杜國華', '周杰倫']);
		expect(r.complete).toBe(true);
		expect(lsKeys().filter((k) => k.startsWith('openmusic:lyrics-tr:v2:')).length).toBe(1);
	});

	it('does NOT persist when any non-blank line fell back (echo / failure)', async () => {
		const { translateLinesEx } = await import('./translate');
		fetchMock.mockResolvedValue(jsonRes({ translated: ['杜国华', '周杰倫'], flags: [false, true] }));
		const r = await translateLinesEx(['杜国华', '周杰伦'], 'zh-Hant');
		expect(r.complete).toBe(false);
		expect(lsKeys().filter((k) => k.startsWith('openmusic:lyrics-tr:')).length).toBe(0);
	});

	it('treats blank lines as not blocking persistence', async () => {
		const { translateLinesEx } = await import('./translate');
		fetchMock.mockResolvedValue(jsonRes({ translated: ['', '歌詞', ''], flags: [false, true, false] }));
		const r = await translateLinesEx(['', '歌词', ''], 'zh-Hant');
		expect(r.complete).toBe(true);
		expect(lsKeys().filter((k) => k.startsWith('openmusic:lyrics-tr:v2:')).length).toBe(1);
	});

	it('infers per-line flags when the server omits them (output differs from input)', async () => {
		const { translateLinesEx } = await import('./translate');
		fetchMock.mockResolvedValue(jsonRes({ translated: ['杜國華', '邓紫棋'] })); // no flags
		const r = await translateLinesEx(['杜国华', '邓紫棋'], 'zh-Hant');
		expect(r.flags).toEqual([true, false]); // line 1 unchanged → fallback
		expect(r.complete).toBe(false);
	});

	it('serves a versioned cache hit without re-requesting', async () => {
		const { translateLinesEx } = await import('./translate');
		fetchMock.mockResolvedValue(jsonRes({ translated: ['簡體'], flags: [true] }));
		await translateLinesEx(['简体'], 'zh-Hant');
		const calls = fetchMock.mock.calls.length;
		const again = await translateLinesEx(['简体'], 'zh-Hant');
		expect(again.out).toEqual(['簡體']);
		expect(fetchMock.mock.calls.length).toBe(calls); // no new request
	});

	it('purges pre-version (poisoned) lyrics keys on first call', async () => {
		memStore.set('openmusic:lyrics-tr:zh-Hant:abc123', JSON.stringify(['杜国华']));
		const { translateLinesEx } = await import('./translate');
		fetchMock.mockResolvedValue(jsonRes({ translated: ['簡體'], flags: [true] }));
		await translateLinesEx(['简体'], 'zh-Hant');
		expect(memStore.get('openmusic:lyrics-tr:zh-Hant:abc123')).toBeUndefined();
	});

	it('translateLines wrapper preserves the string[] contract', async () => {
		const { translateLines } = await import('./translate');
		fetchMock.mockResolvedValue(jsonRes({ translated: ['a', 'b'], flags: [true, true] }));
		const out = await translateLines(['x', 'y'], 'zh-Hant');
		expect(out).toEqual(['a', 'b']);
	});

	it('off / empty are identity pass-throughs', async () => {
		const { translateLinesEx } = await import('./translate');
		expect((await translateLinesEx(['x'], 'off')).out).toEqual(['x']);
		expect((await translateLinesEx([], 'zh-Hant')).out).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

// REGRESSION (WR / debug:lyric-tr-not-shown-hide-paren): a flaky upstream made /api/translate
// return the ORIGINALS as a fake HTTP-200 success (flags=false). translateLines() returned those
// originals with length === lines.length, so NowPlaying's showTr stayed TRUE and the lyrics block
// silently rendered untranslated originals ("translation shown nowhere"), recurring every render
// (incomplete batches are never cached). These tests pin the resilience fix: an incomplete soft-fail
// (or a thrown transport failure) is retried with backoff so a transient blip self-heals, and the
// BEST result across attempts is returned so a partial recovery still surfaces. Fake timers keep the
// backoff instant for the suite.
describe('translateLinesEx — transient-failure resilience (retry + best-result)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	// Drive a translateLinesEx() call to completion while flushing the retry backoff timers.
	async function runWithRetries<T>(p: Promise<T>): Promise<T> {
		let settled = false;
		const wrapped = p.then((v) => {
			settled = true;
			return v;
		});
		// Each await yields to the microtask queue (resolving the in-flight fetch/json) before we
		// advance the fake backoff timer; loop until the call resolves.
		while (!settled) {
			await Promise.resolve();
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(2000);
		}
		return wrapped;
	}

	it('retries an INCOMPLETE soft-fail (echoed originals) and recovers on a later attempt', async () => {
		const { translateLinesEx } = await import('./translate');
		// Attempt 1: transient soft-fail — server echoed the originals (all flags false).
		// Attempt 2: upstream recovered — genuine translation.
		fetchMock
			.mockResolvedValueOnce(jsonRes({ translated: ['さくら', '舞い散る'], flags: [false, false] }))
			.mockResolvedValueOnce(jsonRes({ translated: ['櫻花', '飛舞飄散'], flags: [true, true] }));
		const r = await runWithRetries(translateLinesEx(['さくら', '舞い散る'], 'zh-Hant'));
		expect(fetchMock.mock.calls.length).toBe(2); // retried after the soft-fail
		expect(r.out).toEqual(['櫻花', '飛舞飄散']); // recovered translation surfaces
		expect(r.complete).toBe(true);
		// A recovered, complete batch is cached so the next session is instant.
		expect(lsKeys().filter((k) => k.startsWith('openmusic:lyrics-tr:v2:')).length).toBe(1);
	});

	it('retries a THROWN transport failure and recovers', async () => {
		const { translateLinesEx } = await import('./translate');
		fetchMock
			.mockRejectedValueOnce(new Error('ETIMEDOUT'))
			.mockResolvedValueOnce(jsonRes({ translated: ['櫻花'], flags: [true] }));
		const r = await runWithRetries(translateLinesEx(['さくら'], 'zh-Hant'));
		expect(fetchMock.mock.calls.length).toBe(2);
		expect(r.out).toEqual(['櫻花']);
		expect(r.complete).toBe(true);
	});

	it('returns the BEST partial result across attempts when none is fully complete', async () => {
		const { translateLinesEx } = await import('./translate');
		// Attempt 1: line 1 translated, line 2 echoed. Attempt 2: line 1 echoed, line 2 translated.
		// Neither attempt is complete, but the best-per-attempt should keep the most translated lines.
		fetchMock
			.mockResolvedValueOnce(jsonRes({ translated: ['櫻花', 'まだ'], flags: [true, false] }))
			.mockResolvedValueOnce(jsonRes({ translated: ['さくら', 'まだ'], flags: [false, false] }))
			.mockResolvedValueOnce(jsonRes({ translated: ['さくら', 'まだ'], flags: [false, false] }));
		const r = await runWithRetries(translateLinesEx(['さくら', 'まだ'], 'zh-Hant'));
		// Best attempt (1 line translated) is retained even though later attempts regressed.
		expect(r.flags.filter(Boolean).length).toBe(1);
		expect(r.out[0]).toBe('櫻花');
		expect(r.complete).toBe(false);
		// An incomplete batch is NEVER cached (no poison).
		expect(lsKeys().filter((k) => k.startsWith('openmusic:lyrics-tr:')).length).toBe(0);
	});

	it('gives up after the bounded retries and returns the (incomplete) best, never blanking length', async () => {
		const { translateLinesEx } = await import('./translate');
		fetchMock.mockResolvedValue(jsonRes({ translated: ['さくら', '舞い散る'], flags: [false, false] }));
		const r = await runWithRetries(translateLinesEx(['さくら', '舞い散る'], 'zh-Hant'));
		// 1 initial + 2 retries = 3 attempts, then settles with the originals (length preserved so the
		// UI never breaks alignment) but complete=false (so it stays retryable / uncached).
		expect(fetchMock.mock.calls.length).toBe(3);
		expect(r.out.length).toBe(2);
		expect(r.complete).toBe(false);
	});
});
