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
