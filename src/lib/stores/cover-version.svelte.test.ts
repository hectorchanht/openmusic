import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// quick-260704-45c (optimization backlog #5): bumpCoverVersion() coalesces a burst of
// cover-land signal bumps within one animation frame into a SINGLE _v.n increment, with a
// synchronous fallback where requestAnimationFrame is undefined (node/vitest + SSR).
//
// Test idiom mirrors online.svelte.test.ts: vi.resetModules() + `await import()` per test so
// the module-scoped `_v` counter and `bumpScheduled` flag start fresh, and vi.stubGlobal swaps
// the requestAnimationFrame global BEFORE the dynamic import so the `typeof` guard sees it.

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// minimal in-memory localStorage so the cover-cache setters (writeCoverBoth/removeCoverBoth)
// have a backing store; they already guard in try/catch, but stubbing keeps them silent.
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

describe('bumpCoverVersion coalescing (quick-260704-45c)', () => {
	it('Test A — rAF present: N bumps in one frame collapse to ONE increment', async () => {
		let cb: (() => void) | undefined;
		const raf = vi.fn((fn: () => void) => {
			cb = fn;
			return 1;
		});
		vi.stubGlobal('requestAnimationFrame', raf);

		const { bumpCoverVersion, coverVersion } = await import('./cover-version.svelte');

		expect(coverVersion()).toBe(0);

		// A burst of 5 bumps within a single frame.
		for (let i = 0; i < 5; i++) bumpCoverVersion();

		// Exactly one rAF scheduled; the counter has NOT advanced yet.
		expect(raf).toHaveBeenCalledTimes(1);
		expect(coverVersion()).toBe(0);

		// Running the captured frame callback applies exactly ONE increment (not 5).
		cb!();
		expect(coverVersion()).toBe(1);

		// A second burst after the frame ran schedules a fresh rAF.
		bumpCoverVersion();
		bumpCoverVersion();
		expect(raf).toHaveBeenCalledTimes(2);
		expect(coverVersion()).toBe(1);
		cb!();
		expect(coverVersion()).toBe(2);
	});

	it('Test B — rAF undefined (node/SSR): each bump increments synchronously, never throws', async () => {
		vi.stubGlobal('requestAnimationFrame', undefined);

		const { bumpCoverVersion, coverVersion } = await import('./cover-version.svelte');

		expect(() => {
			bumpCoverVersion();
			bumpCoverVersion();
			bumpCoverVersion();
		}).not.toThrow();

		expect(coverVersion()).toBe(3);
	});

	it('Test C — writeCoverBoth / removeCoverBoth still advance coverVersion (via the coalesced path)', async () => {
		vi.stubGlobal('requestAnimationFrame', undefined); // sync path so the bump is observable
		vi.stubGlobal('localStorage', localStorageMock);
		memStore.clear();

		const { writeCoverBoth, removeCoverBoth, coverVersion } = await import(
			'./cover-version.svelte'
		);

		expect(coverVersion()).toBe(0);

		writeCoverBoth('netease-123', 'Artist', 'Title', 'https://cover.example/a.jpg');
		expect(coverVersion()).toBe(1);

		removeCoverBoth('netease-123', 'Artist', 'Title');
		expect(coverVersion()).toBe(2);
	});
});
