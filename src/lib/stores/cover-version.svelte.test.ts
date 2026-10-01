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

// Phase 40 D-11b: a YT Music thumbnail is per-uid art — written to the uid layer only, never the
// shared {artist,title} name layer that bridges every source's copy of the song.
describe('writeCoverBoth YTM uid-only gate (Phase 40 D-11b)', () => {
	beforeEach(() => {
		memStore.clear();
		vi.stubGlobal('localStorage', localStorageMock);
		vi.stubGlobal('requestAnimationFrame', undefined);
	});

	it('a YTM-host url writes the uid layer only and still bumps the version', async () => {
		const { writeCoverBoth, coverVersion } = await import('./cover-version.svelte');
		const { getCachedCoverByUid, getCachedCover } = await import('$lib/services/cover-cache');
		writeCoverBoth('qq:1', 'A', 'T', 'https://i.ytimg.com/x.jpg');
		expect(getCachedCoverByUid('qq:1')).toBe('https://i.ytimg.com/x.jpg');
		expect(getCachedCover('A', 'T')).toBeNull();
		expect(coverVersion()).toBe(1);
	});

	it('a Deezer url writes both layers (unchanged)', async () => {
		const { writeCoverBoth } = await import('./cover-version.svelte');
		const { getCachedCoverByUid, getCachedCover } = await import('$lib/services/cover-cache');
		writeCoverBoth('qq:1', 'A', 'T', 'https://e-cdns-images.dzcdn.net/x.jpg');
		expect(getCachedCoverByUid('qq:1')).toBe('https://e-cdns-images.dzcdn.net/x.jpg');
		expect(getCachedCover('A', 'T')).toBe('https://e-cdns-images.dzcdn.net/x.jpg');
	});
});

// Phase 40 D-14 / D-19: the crowd-shared cover pick. Precedence pin > crowd uid > crowd name, and the
// crowd rung outranks the auto-resolved uid/name layers in readCoverByUidOrName.
describe('crowd layer (Phase 40 D-14 / D-19)', () => {
	const PIN = 'https://y.gtimg.cn/pin.jpg';
	const CU = 'https://y.gtimg.cn/cu.jpg';
	const CN = 'https://y.gtimg.cn/cn.jpg';
	const AUTO = 'https://e-cdns-images.dzcdn.net/auto.jpg';

	beforeEach(() => {
		memStore.clear();
		vi.stubGlobal('localStorage', localStorageMock);
		vi.stubGlobal('requestAnimationFrame', undefined);
	});

	it('readChosenCover: pin > crowd uid > crowd name > null', async () => {
		const { readChosenCover } = await import('./cover-version.svelte');
		const cc = await import('$lib/services/cover-cache');
		expect(readChosenCover('qq:1', 'A', 'T')).toBeNull();
		cc.setCrowdCoverByName('A', 'T', CN);
		expect(readChosenCover('qq:1', 'A', 'T')).toBe(CN);
		cc.setCrowdCoverByUid('qq:1', CU);
		expect(readChosenCover('qq:1', 'A', 'T')).toBe(CU);
		cc.setPinnedCover('qq:1', PIN);
		expect(readChosenCover('qq:1', 'A', 'T')).toBe(PIN);
	});

	it('readCoverByUidOrName: the crowd pick outranks the auto layers; unchanged without one', async () => {
		const { readCoverByUidOrName } = await import('./cover-version.svelte');
		const cc = await import('$lib/services/cover-cache');
		cc.setCachedCoverByUid('qq:1', AUTO);
		cc.setCachedCover('A', 'T', AUTO);
		expect(readCoverByUidOrName('qq:1', 'A', 'T')).toBe(AUTO);
		cc.setCrowdCoverByName('A', 'T', CN);
		expect(readCoverByUidOrName('qq:1', 'A', 'T')).toBe(CN);
	});

	it('writeCrowdCover writes only the crowd family and bumps', async () => {
		const { writeCrowdCover, coverVersion } = await import('./cover-version.svelte');
		const cc = await import('$lib/services/cover-cache');
		writeCrowdCover('qq:1', 'A', 'T', { u: CU, n: CN });
		expect(cc.getCrowdCoverByUid('qq:1')).toBe(CU);
		expect(cc.getCrowdCoverByName('A', 'T')).toBe(CN);
		expect(cc.getCachedCoverByUid('qq:1')).toBeNull();
		expect(cc.getCachedCover('A', 'T')).toBeNull();
		expect(cc.getPinnedCover('qq:1')).toBeNull();
		expect(coverVersion()).toBe(1);
	});

	it('writeCrowdCover skips a null u and ignores a non-https value', async () => {
		const { writeCrowdCover, coverVersion } = await import('./cover-version.svelte');
		const cc = await import('$lib/services/cover-cache');
		writeCrowdCover('qq:1', 'A', 'T', { u: null, n: CN });
		expect(cc.getCrowdCoverByUid('qq:1')).toBeNull();
		expect(cc.getCrowdCoverByName('A', 'T')).toBe(CN);
		expect(coverVersion()).toBe(1);
		writeCrowdCover('qq:2', 'B', 'U', { u: 'http://x/a.jpg', n: 'http://x/b.jpg' });
		expect(cc.getCrowdCover('qq:2', 'B', 'U')).toBeNull();
		expect(coverVersion()).toBe(1); // nothing written → no bump
	});

	it('removeCrowdCover evicts both crowd entries and bumps', async () => {
		const { writeCrowdCover, removeCrowdCover, coverVersion } = await import('./cover-version.svelte');
		const cc = await import('$lib/services/cover-cache');
		writeCrowdCover('qq:1', 'A', 'T', { u: CU, n: CN });
		removeCrowdCover('qq:1', 'A', 'T');
		expect(cc.getCrowdCover('qq:1', 'A', 'T')).toBeNull();
		expect(coverVersion()).toBe(2);
	});

	it('D-19: the module has no network path (no apiFetch / cover-pick-shared import)', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync(new URL('./cover-version.svelte.ts', import.meta.url), 'utf8');
		expect(src).not.toMatch(/apiFetch|cover-pick-shared/);
	});
});
