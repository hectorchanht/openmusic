import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// No-latch / no-storm / no-poison contract for the names store (WR / debug:translation-regression).
// The attempt-latch regression: the store incremented the per-(lang,name) retry counter at QUEUE
// time and cleared `pending` at flush START (before the ~200-800ms API round-trip resolved). A
// re-render during that in-flight window re-queued the name (cache miss) and burned a SECOND
// attempt — so attempts>=MAX_ATTEMPTS(2) latched the name to its ORIGINAL for the session even
// though the API would translate it (artist names + bio "stopped translating"). These tests pin
// the fix: an in-flight name is not re-queued / burns no extra attempt; an attempt is counted ONLY
// on a genuine-identity result in the flush handler; a transport failure burns no attempt; a later
// genuine success after an earlier miss still sticks.
//
// Runs under the node project (the sveltekit Vite plugin transforms `$state` runes). browser ON +
// a minimal in-memory localStorage, mirroring translate.test.ts / player.svelte.test.ts.
vi.mock('$app/environment', () => ({ browser: true }));

// translateLinesEx is the single API the store calls. We control its resolution per test.
const translateMock = vi.fn();
vi.mock('$lib/services/translate', () => ({
	translateLinesEx: (...a: unknown[]) => translateMock(...a)
}));

// Decision layer: always request translation (the store's resolve() gates on this; we exercise
// the queue/flush/attempt machinery, not detection).
vi.mock('$lib/i18n/detect', () => ({ shouldTranslate: () => true }));

// Fixed per-part target so dnArtist/dnBio both resolve to the same lang. quick-260712-et3: the
// target is a NON-offline language ('ja', which goes through the API queue) on purpose — the
// zh-Hant path now short-circuits to the synchronous offline s2t converter (no queue), so
// routing these async queue/flush/attempt-machinery assertions through zh-Hant would either
// skip the machinery entirely or race the lazy dict load. The zh-Hant no-flash sync path is
// covered in services/zh-convert.test.ts. effectiveTarget echoes its argument.
vi.mock('$lib/stores/settings.svelte', () => ({
	settings: {
		artistLang: 'ja',
		titleLang: 'ja',
		lastfmLang: 'ja',
		bioLang: 'ja',
		artistSkip: [],
		titleSkip: [],
		lastfmSkip: []
	},
	effectiveTarget: (t: string) => t
}));

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

// Resolve the deferred translateLinesEx, then let the .then/.finally microtasks settle.
async function flush() {
	await vi.runAllTimersAsync(); // fire the 160ms schedule timer
	await Promise.resolve();
	await Promise.resolve();
}

beforeEach(() => {
	translateMock.mockReset();
	memStore.clear();
	vi.resetModules();
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.stubGlobal('localStorage', localStorageMock);
});

describe('names store — no-latch / no-storm / no-poison', () => {
	it('caches a genuinely-translated name and serves it without re-requesting', async () => {
		translateMock.mockResolvedValue({ out: ['周杰倫'], flags: [true] });
		const { names } = await import('./names.svelte');
		expect(names.dnArtist('周杰伦')).toBe('周杰伦'); // immediate original; queues
		await flush();
		expect(names.dnArtist('周杰伦')).toBe('周杰倫'); // cache hit
		const calls = translateMock.mock.calls.length;
		names.dnArtist('周杰伦');
		expect(translateMock.mock.calls.length).toBe(calls); // no re-request
	});

	it('does NOT re-queue or burn an attempt for a name still in flight', async () => {
		// Deferred response: the name is in flight across several re-renders.
		let resolveFn!: (v: { out: string[]; flags: boolean[] }) => void;
		translateMock.mockReturnValue(new Promise((r) => (resolveFn = r)));
		const { names } = await import('./names.svelte');
		names.dnArtist('周杰伦'); // queue
		await vi.advanceTimersByTimeAsync(160); // flush starts; request now in flight
		// Re-renders during the round-trip must NOT issue a second batch.
		names.dnArtist('周杰伦');
		names.dnArtist('周杰伦');
		await vi.advanceTimersByTimeAsync(500);
		expect(translateMock.mock.calls.length).toBe(1); // single in-flight request
		resolveFn({ out: ['周杰倫'], flags: [true] });
		await Promise.resolve();
		await Promise.resolve();
		expect(names.dnArtist('周杰伦')).toBe('周杰倫'); // lands; cached
	});

	it('a transport failure burns NO attempt — the name retries on the next view', async () => {
		translateMock.mockRejectedValueOnce(new Error('network'));
		const { names } = await import('./names.svelte');
		names.dnArtist('周杰伦');
		await flush(); // first attempt: rejected, no attempt counted
		translateMock.mockResolvedValue({ out: ['周杰倫'], flags: [true] });
		names.dnArtist('周杰伦'); // must re-queue (not latched by the failure)
		await flush();
		expect(names.dnArtist('周杰伦')).toBe('周杰倫');
		expect(translateMock.mock.calls.length).toBe(2); // failure then success — both ran
	});

	it('caps re-requests for a genuinely-identical name and then renders the original', async () => {
		// Already-Traditional / simp==trad name: server returns it unchanged, flag false.
		translateMock.mockResolvedValue({ out: ['五月天'], flags: [false] });
		const { names } = await import('./names.svelte');
		// Each view re-queues (cache miss) until MAX_ATTEMPTS(2) genuine-identity results accrue.
		for (let i = 0; i < 6; i++) {
			names.dnArtist('五月天');
			await flush();
		}
		expect(names.dnArtist('五月天')).toBe('五月天'); // renders original (correct — it IS in target)
		expect(translateMock.mock.calls.length).toBe(2); // capped at MAX_ATTEMPTS — no storm
	});

	it('a later genuine success after an earlier miss still sticks (no permanent latch)', async () => {
		// First view: server hasn't translated yet (identity-ish miss, flag false).
		translateMock.mockResolvedValueOnce({ out: ['周杰伦'], flags: [false] });
		const { names } = await import('./names.svelte');
		names.dnArtist('周杰伦');
		await flush(); // one attempt counted (genuine-identity-shaped miss)
		// Second view: server now genuinely translates.
		translateMock.mockResolvedValue({ out: ['周杰倫'], flags: [true] });
		names.dnArtist('周杰伦'); // attempts==1 < MAX, so it re-queues
		await flush();
		expect(names.dnArtist('周杰伦')).toBe('周杰倫'); // success sticks
	});
});
