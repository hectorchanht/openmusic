import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// quick-260704-45c (optimization backlog #5): bumpCoverVersion() coalesces a burst of
// cover-land signal bumps within one animation frame into a SINGLE _v.n increment, with a
// synchronous fallback where requestAnimationFrame is undefined (node/vitest + SSR).
//
// DETERMINISM (flake fix, mirroring stores/names.test.ts's import-phase doctrine): this
// file used to vi.resetModules() + `await import()` INSIDE every test body, so the
// module-scoped `_v` counter and `bumpScheduled` latch started fresh per test. A re-import's
// real duration is wall-clock luck, so under CPU contention a body could exhaust the
// 5000ms testTimeout mid-import; Vitest then abandons the body, but its late-resolving
// import kept executing as a ZOMBIE against the next test's fixtures — worst case here,
// the module under test itself reads `typeof requestAnimationFrame` at CALL time, so a
// zombie body could leave its rAF stub installed into the next test's window (a sync-path
// test suddenly coalescing through a dead frame callback, or vice versa). All setup now
// lives in the one phase with no timeout — this file's import phase: the GEN block below
// pre-makes one module generation per test, cover-version.svelte AND cover-cache imported
// together in the SAME generation (the wrapper's writes must land in the cache instance
// the test reads back — a later generation's cache is a different store). Tests whose
// assertions are version NUMBERS consume their generation at _v.n === 0 in file order;
// the pure cache-state tests (Deezer / name-first) share one generation and isolate via
// memStore.clear() + distinct keys, since their assertions never read the counter.
// Per-test isolation otherwise comes from the fixtures each test already owned
// (memStore.clear(), its own rAF stub). No test body or hook performs a module import,
// so no verdict in this file reads real elapsed time, ever.
//
// The rAF design point the brief asked to verify, verified against
// cover-version.svelte.ts: bumpCoverVersion reads `typeof requestAnimationFrame` AT
// CALL TIME (never at module load), so a pre-made generation is fully compatible with
// per-test stubbing — each test installs its own rAF (or its undefined) before calling,
// and the generation's bumps consult the CURRENT global. The stub is installed at the
// START of each rAF-sensitive body (not in a hook) precisely so an abandoned body can
// never be the thing that installs it late into a successor.

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

// ── Module generations, created ONCE in this file's import phase ─────────────────────────
// The import phase is the one place Vitest imposes NO timeout (testTimeout governs bodies,
// hookTimeout governs hooks), so every expensive setup step lives here: each generation is
// a fresh module registry (vi.resetModules + import) with cover-version.svelte and
// cover-cache imported as a PAIR — the generation skew the names fix warned about is
// literal here, because the wrapper module binds the cache instance from its own
// generation at import time.
type CoverVersionModule = typeof import('./cover-version.svelte');
type CoverCacheModule = typeof import('$lib/services/cover-cache');
interface Generation {
	cv: CoverVersionModule;
	cc: CoverCacheModule;
}

async function freshGeneration(): Promise<Generation> {
	vi.resetModules();
	const cv = await import('./cover-version.svelte');
	const cc = await import('$lib/services/cover-cache');
	return { cv, cc };
}

const GEN = {
	// Coalescing describe — one generation per test (Test A owns the rAF path; B and C
	// assert absolute version numbers, so each needs its own _v.n === 0).
	testA: await freshGeneration(),
	testB: await freshGeneration(),
	testC: await freshGeneration(),
	// Both-layers describe — the YTM and empty-uid tests each assert coverVersion() === 1,
	// so each owns a generation; the Deezer test asserts no number and shares `layers`
	// with the crowd describe's name-first test (also number-free, distinct keys).
	ytm: await freshGeneration(),
	emptyUid: await freshGeneration(),
	layers: await freshGeneration(),
	// Crowd describe — every test asserts absolute version numbers (four of them also
	// SEQUENCES of numbers), so one generation per test.
	crowdPrecedence: await freshGeneration(),
	crowdOutranks: await freshGeneration(),
	crowdWrite: await freshGeneration(),
	crowdSkipNull: await freshGeneration(),
	crowdRemove: await freshGeneration()
};

beforeEach(() => {
	// No module setup here (see the DETERMINISM note) — the fixture resets the original
	// file's hooks performed stay: each describe's own beforeEach clears memStore and
	// installs its globals; this one only guarantees the localStorage stub survives a
	// test that replaced it.
	vi.stubGlobal('localStorage', localStorageMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	// unstubAllGlobals also drops the localStorage stub installed above; the next test's
	// beforeEach re-installs it before any body runs.
});

describe('bumpCoverVersion coalescing (quick-260704-45c)', () => {
	it('Test A — rAF present: N bumps in one frame collapse to ONE increment', async () => {
		let cb: (() => void) | undefined;
		const raf = vi.fn((fn: () => void) => {
			cb = fn;
			return 1;
		});
		vi.stubGlobal('requestAnimationFrame', raf);

		const { bumpCoverVersion, coverVersion } = GEN.testA.cv;

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

		const { bumpCoverVersion, coverVersion } = GEN.testB.cv;

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

		const { writeCoverBoth, removeCoverBoth, coverVersion } = GEN.testC.cv;

		expect(coverVersion()).toBe(0);

		writeCoverBoth('netease-123', 'Artist', 'Title', 'https://cover.example/a.jpg');
		expect(coverVersion()).toBe(1);

		removeCoverBoth('netease-123', 'Artist', 'Title');
		expect(coverVersion()).toBe(2);
	});
});

// quick-261008-cov1: the Phase 40 D-11b YT Music uid-only carve-out is retired — a shown cover
// (YTM thumbnail included) writes BOTH layers so every source's copy shows the same art.
describe('writeCoverBoth writes both layers for every cover (D-11b retired)', () => {
	beforeEach(() => {
		memStore.clear();
		vi.stubGlobal('localStorage', localStorageMock);
		vi.stubGlobal('requestAnimationFrame', undefined);
	});

	it('a YTM-host url writes the uid layer AND the shared name layer, and bumps the version', async () => {
		const { writeCoverBoth, coverVersion } = GEN.ytm.cv;
		const { getCachedCoverByUid, getCachedCover } = GEN.ytm.cc;
		writeCoverBoth('qq:1', 'A', 'T', 'https://i.ytimg.com/x.jpg');
		expect(getCachedCoverByUid('qq:1')).toBe('https://i.ytimg.com/x.jpg');
		expect(getCachedCover('A', 'T')).toBe('https://i.ytimg.com/x.jpg');
		expect(coverVersion()).toBe(1);
	});

	it('a Deezer url writes both layers (unchanged)', async () => {
		const { writeCoverBoth } = GEN.layers.cv;
		const { getCachedCoverByUid, getCachedCover } = GEN.layers.cc;
		writeCoverBoth('qq:1', 'A', 'T', 'https://e-cdns-images.dzcdn.net/x.jpg');
		expect(getCachedCoverByUid('qq:1')).toBe('https://e-cdns-images.dzcdn.net/x.jpg');
		expect(getCachedCover('A', 'T')).toBe('https://e-cdns-images.dzcdn.net/x.jpg');
	});

	// quick-261008-audit: an empty stub uid must NOT write the shared 'uid:' slot (the
	// charts-tags-same-cover guard) — the name layer still writes, and the version still bumps.
	it('an empty uid writes the name layer only, never the shared uid slot', async () => {
		const { writeCoverBoth, coverVersion } = GEN.emptyUid.cv;
		const { getCachedCoverByUid, getCachedCover } = GEN.emptyUid.cc;
		writeCoverBoth('', 'A', 'T', 'https://e-cdns-images.dzcdn.net/x.jpg');
		expect(getCachedCoverByUid('')).toBeNull();
		expect(getCachedCover('A', 'T')).toBe('https://e-cdns-images.dzcdn.net/x.jpg');
		expect(coverVersion()).toBe(1);
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
		const { readChosenCover } = GEN.crowdPrecedence.cv;
		const cc = GEN.crowdPrecedence.cc;
		expect(readChosenCover('qq:1', 'A', 'T')).toBeNull();
		cc.setCrowdCoverByName('A', 'T', CN);
		expect(readChosenCover('qq:1', 'A', 'T')).toBe(CN);
		cc.setCrowdCoverByUid('qq:1', CU);
		expect(readChosenCover('qq:1', 'A', 'T')).toBe(CU);
		cc.setPinnedCover('qq:1', PIN);
		expect(readChosenCover('qq:1', 'A', 'T')).toBe(PIN);
	});

	it('readCoverByUidOrName: the crowd pick outranks the auto layers; unchanged without one', async () => {
		const { readCoverByUidOrName } = GEN.crowdOutranks.cv;
		const cc = GEN.crowdOutranks.cc;
		cc.setCachedCoverByUid('qq:1', AUTO);
		cc.setCachedCover('A', 'T', AUTO);
		expect(readCoverByUidOrName('qq:1', 'A', 'T')).toBe(AUTO);
		cc.setCrowdCoverByName('A', 'T', CN);
		expect(readCoverByUidOrName('qq:1', 'A', 'T')).toBe(CN);
	});

	// quick-261020-latest: the name layer holds the latest write for the song, so it outranks a
	// stale per-uid entry — the same song shows the same (latest) cover on every surface.
	it('readCoverByUidOrName: name-first — the latest write wins over a stale uid entry', async () => {
		const { readCoverByUidOrName } = GEN.layers.cv;
		const cc = GEN.layers.cc;
		cc.setCachedCoverByUid('qq:1', 'https://cdn.example/stale-uid.jpg');
		cc.setCachedCover('A', 'T', 'https://cdn.example/latest-name.jpg');
		expect(readCoverByUidOrName('qq:1', 'A', 'T')).toBe('https://cdn.example/latest-name.jpg');
		// uid layer survives as the fallback when the name layer misses
		expect(readCoverByUidOrName('qq:1', 'A', 'Other')).toBe('https://cdn.example/stale-uid.jpg');
	});

	it('writeCrowdCover writes only the crowd family and bumps', async () => {
		const { writeCrowdCover, coverVersion } = GEN.crowdWrite.cv;
		const cc = GEN.crowdWrite.cc;
		writeCrowdCover('qq:1', 'A', 'T', { u: CU, n: CN });
		expect(cc.getCrowdCoverByUid('qq:1')).toBe(CU);
		expect(cc.getCrowdCoverByName('A', 'T')).toBe(CN);
		expect(cc.getCachedCoverByUid('qq:1')).toBeNull();
		expect(cc.getCachedCover('A', 'T')).toBeNull();
		expect(cc.getPinnedCover('qq:1')).toBeNull();
		expect(coverVersion()).toBe(1);
	});

	it('writeCrowdCover skips a null u and ignores a non-https value', async () => {
		const { writeCrowdCover, coverVersion } = GEN.crowdSkipNull.cv;
		const cc = GEN.crowdSkipNull.cc;
		writeCrowdCover('qq:1', 'A', 'T', { u: null, n: CN });
		expect(cc.getCrowdCoverByUid('qq:1')).toBeNull();
		expect(cc.getCrowdCoverByName('A', 'T')).toBe(CN);
		expect(coverVersion()).toBe(1);
		writeCrowdCover('qq:2', 'B', 'U', { u: 'http://x/a.jpg', n: 'http://x/b.jpg' });
		expect(cc.getCrowdCover('qq:2', 'B', 'U')).toBeNull();
		expect(coverVersion()).toBe(1); // nothing written → no bump
	});

	it('removeCrowdCover evicts both crowd entries and bumps', async () => {
		const { writeCrowdCover, removeCrowdCover, coverVersion } = GEN.crowdRemove.cv;
		const cc = GEN.crowdRemove.cc;
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
