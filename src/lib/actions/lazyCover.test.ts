import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// lazyCover (Phase 21, COVER-02) resolves a track-row cover ONLY on first scroll-into-view. These
// tests pin the six behaviors: fire-once (unobserve-after-first + done flag), in-flight de-dupe for
// the same uid, destroy-disconnects, good-cover-skip (Image onload), broken-cover-repair (onerror →
// cache→chain), and the SSR guard (Image undefined → no throw). The node vitest project has no
// jsdom, so IntersectionObserver + Image are stubbed on globalThis and the cache + resolve helper
// are vi.mock'd — mirroring the discovery/cover-backfill spy style (no live DOM, no network).

// --- mock the cache + the shared single-item resolve helper -------------------------------------
const getCachedCoverByUid = vi.fn<(uid: string) => string | null>();
const getCachedCover = vi.fn<(artist: string, title: string) => string | null>();
// quick-260704-4fr: the freshness reader gating the warm-fresh probe skip. Defaulted to null in
// beforeEach so every PRE-EXISTING test keeps the current probe path (null age -> probe self-heal).
const coverAgeByUidOrName =
	vi.fn<(uid: string, artist: string, title: string) => number | null>();
const resolveCoverForTrack = vi.fn<(track: Track) => Promise<string | null>>();
// quick-260630-ey2: the self-heal evictor — a dead cache-HIT calls this before the re-resolve chain.
const removeCoverBoth = vi.fn<(uid: string, artist: string, title: string) => void>();

vi.mock('$lib/services/cover-cache', () => ({
	getCachedCoverByUid: (uid: string) => getCachedCoverByUid(uid),
	getCachedCover: (artist: string, title: string) => getCachedCover(artist, title),
	coverAgeByUidOrName: (uid: string, artist: string, title: string) =>
		coverAgeByUidOrName(uid, artist, title)
}));
vi.mock('$lib/services/cover-backfill', () => ({
	resolveCoverForTrack: (track: Track) => resolveCoverForTrack(track)
}));
vi.mock('$lib/stores/cover-version.svelte', () => ({
	removeCoverBoth: (uid: string, artist: string, title: string) =>
		removeCoverBoth(uid, artist, title)
}));

// --- controllable IntersectionObserver stub -----------------------------------------------------
type IOCb = (entries: Array<{ isIntersecting: boolean }>) => void;
class MockIO {
	static instances: MockIO[] = [];
	cb: IOCb;
	observed: unknown[] = [];
	unobserved: unknown[] = [];
	disconnected = false;
	constructor(cb: IOCb) {
		this.cb = cb;
		MockIO.instances.push(this);
	}
	observe(node: unknown) {
		this.observed.push(node);
	}
	unobserve(node: unknown) {
		this.unobserved.push(node);
	}
	disconnect() {
		this.disconnected = true;
	}
	/** Test helper: fire an intersection. */
	trigger(isIntersecting = true) {
		this.cb([{ isIntersecting }]);
	}
}

// --- controllable Image stub (onload / onerror driven by the test) ------------------------------
let imageBehavior: 'load' | 'error' = 'load';
const imageInstances: MockImage[] = [];
class MockImage {
	decoding = '';
	referrerPolicy = '';
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	private _src = '';
	constructor() {
		imageInstances.push(this);
	}
	set src(v: string) {
		this._src = v;
		// Fire async to mirror the browser (and so onload/onerror are wired before firing).
		queueMicrotask(() => {
			if (imageBehavior === 'load') this.onload?.();
			else this.onerror?.();
		});
	}
	get src() {
		return this._src;
	}
}

function mkTrack(extra: Partial<Track> = {}): Track {
	const source: SourceId = 'netease';
	return {
		uid: makeUid(source, '12345'),
		source,
		songid: '12345',
		title: 'Dao Xiang',
		artist: 'Jay Chou',
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1,
		...extra
	};
}

/** A flush helper for the microtask-driven Image + the async resolve chain. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const origIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
const origImage = (globalThis as { Image?: unknown }).Image;

beforeEach(() => {
	MockIO.instances = [];
	imageInstances.length = 0;
	imageBehavior = 'load';
	getCachedCoverByUid.mockReturnValue(null);
	getCachedCover.mockReturnValue(null);
	// Default the freshness reader to null so the 13 pre-existing tests keep the current probe path
	// (a null age is NOT confirmed-fresh → the existing self-heal probe runs unchanged).
	coverAgeByUidOrName.mockReturnValue(null);
	resolveCoverForTrack.mockResolvedValue('https://resolved.example/c.jpg');
	(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
		MockIO as unknown as typeof IntersectionObserver;
	(globalThis as { Image?: unknown }).Image = MockImage as unknown as typeof Image;
});

afterEach(() => {
	vi.clearAllMocks();
	(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = origIO;
	(globalThis as { Image?: unknown }).Image = origImage;
});

// Import AFTER the globals/mocks are in place (the action reads IntersectionObserver at mount).
async function mount(param: { track: Track; onResolved: (uid: string, url: string) => void }) {
	const { lazyCover } = await import('./lazyCover');
	const node = {} as HTMLElement;
	const handle = lazyCover(node, param);
	return { node, handle, io: MockIO.instances[MockIO.instances.length - 1] };
}

describe('lazyCover — IntersectionObserver + Image probe + cache-first resolve (COVER-02)', () => {
	it('fires the resolve once on first intersection, unobserves, and does NOT fire again', async () => {
		const onResolved = vi.fn();
		const track = mkTrack();
		const { node, io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(1);
		expect(io.unobserved).toContain(node); // unobserved after first intersection

		// A second intersection must NOT re-run the resolve (one-shot done flag).
		io.trigger(true);
		await flush();
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(1);
		expect(onResolved).toHaveBeenCalledWith(track.uid, 'https://resolved.example/c.jpg');
	});

	it('de-dupes concurrent resolves for the same uid (chain runs once)', async () => {
		const onResolved = vi.fn();
		const track = mkTrack();
		// A slow resolve so both observers fire while the first is still in flight.
		let release!: (v: string | null) => void;
		resolveCoverForTrack.mockImplementation(
			() => new Promise<string | null>((res) => (release = res))
		);

		const a = await mount({ track, onResolved });
		const b = await mount({ track: mkTrack(), onResolved }); // same uid

		a.io.trigger(true);
		b.io.trigger(true);
		await flush();
		// Both intersected, but the in-flight Set keyed by uid lets only one chain run.
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(1);
		release('https://resolved.example/c.jpg');
		await flush();
	});

	it('destroy() disconnects the observer (no further callbacks)', async () => {
		const onResolved = vi.fn();
		const { handle, io } = await mount({ track: mkTrack(), onResolved });
		expect(handle && typeof handle.destroy === 'function').toBe(true);
		handle!.destroy!();
		expect(io.disconnected).toBe(true);
	});

	it('keeps an existing SOLID cover that loads OK (Image onload) — no cache / chain', async () => {
		imageBehavior = 'load';
		const onResolved = vi.fn();
		const track = mkTrack({ cover: 'https://good.example/cover.jpg' });
		const { io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		// Cache is read first (and misses here), then the existing cover is probed and loads OK,
		// so the network chain is SKIPPED and the existing cover is kept.
		expect(getCachedCoverByUid).toHaveBeenCalledWith(track.uid);
		expect(resolveCoverForTrack).not.toHaveBeenCalled();
		expect(onResolved).toHaveBeenCalledWith(track.uid, 'https://good.example/cover.jpg');
	});

	it('repairs a broken cover (Image onerror) by routing to the cache→chain resolve', async () => {
		imageBehavior = 'error';
		const onResolved = vi.fn();
		const track = mkTrack({ cover: 'https://broken.example/404.jpg' });
		const { io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(1);
		expect(onResolved).toHaveBeenCalledWith(track.uid, 'https://resolved.example/c.jpg');
	});

	it('reads the cache uid-first and skips the network on a cache hit', async () => {
		getCachedCoverByUid.mockReturnValue('https://cache.example/by-uid.jpg');
		const onResolved = vi.fn();
		const track = mkTrack({ cover: 'https://good.example/cover.jpg' });
		const { io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		expect(getCachedCoverByUid).toHaveBeenCalledWith(track.uid);
		expect(resolveCoverForTrack).not.toHaveBeenCalled(); // cache hit → no network
		expect(onResolved).toHaveBeenCalledWith(track.uid, 'https://cache.example/by-uid.jpg');
		expect(removeCoverBoth).not.toHaveBeenCalled(); // good probe → no eviction
	});

	// quick-260630-ey2: a SOLID cache HIT is now PROBED. A good probe keeps the zero-network fast
	// path; a dead probe evicts BOTH layers (removeCoverBoth + bump) and falls through to the chain so
	// the stale dead-CDN cover self-heals instead of being painted from localStorage forever.
	it('cache-hit GOOD (probe loads): keeps the fast path — no evict, no chain', async () => {
		imageBehavior = 'load';
		getCachedCoverByUid.mockReturnValue('https://cache.example/by-uid.jpg');
		const onResolved = vi.fn();
		const track = mkTrack();
		const { io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		// Good probe → fast path preserved: the cached url is kept, nothing evicted, no re-resolve.
		expect(onResolved).toHaveBeenCalledWith(track.uid, 'https://cache.example/by-uid.jpg');
		expect(removeCoverBoth).not.toHaveBeenCalled();
		expect(resolveCoverForTrack).not.toHaveBeenCalled();
	});

	it('cache-hit DEAD (probe errors): evicts via removeCoverBoth then re-resolves a fresh cover', async () => {
		imageBehavior = 'error';
		getCachedCoverByUid.mockReturnValue('https://cache.example/dead.jpg');
		const onResolved = vi.fn();
		const track = mkTrack();
		const { io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		// Dead cache → evict BOTH layers (with the real uid), then the chain re-resolves + onResolved
		// fires with the FRESH url (not the dead cached one).
		expect(removeCoverBoth).toHaveBeenCalledWith(track.uid, track.artist, track.title);
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(1);
		expect(onResolved).toHaveBeenCalledWith(track.uid, 'https://resolved.example/c.jpg');
	});

	// quick-260704-4fr (backlog #8): a WARM+FRESH cache HIT (coverAgeByUidOrName < FRESH_MS) is painted
	// IMMEDIATELY with ZERO new Image() probe — the self-heal probe is skipped only when the entry's
	// write-time confirms it is fresh. A null / >= FRESH_MS age keeps the existing probe self-heal.
	it('cache-hit FRESH (age < FRESH_MS): skips the probe entirely — no Image, no evict, no chain', async () => {
		getCachedCoverByUid.mockReturnValue('https://cache.example/by-uid.jpg');
		coverAgeByUidOrName.mockReturnValue(1000); // 1s old — well within the 24h FRESH_MS window
		const onResolved = vi.fn();
		const track = mkTrack();
		const { io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		// Confirmed-fresh fast path: the cached url is painted with NO probe (zero Image constructed),
		// nothing evicted, and the re-resolve chain never runs.
		expect(onResolved).toHaveBeenCalledWith(track.uid, 'https://cache.example/by-uid.jpg');
		expect(imageInstances.length).toBe(0); // NO new Image() — the probe was skipped
		expect(removeCoverBoth).not.toHaveBeenCalled();
		expect(resolveCoverForTrack).not.toHaveBeenCalled();
	});

	it('cache-hit STALE-but-valid (age >= FRESH_MS): the probe self-heal STILL runs', async () => {
		imageBehavior = 'load';
		getCachedCoverByUid.mockReturnValue('https://cache.example/by-uid.jpg');
		// 48h old — a valid-but-older entry (past the 24h FRESH_MS window but under the 14d cache TTL):
		// NOT confirmed-fresh, so the existing probe self-heal must still run.
		coverAgeByUidOrName.mockReturnValue(48 * 60 * 60 * 1000);
		const onResolved = vi.fn();
		const track = mkTrack();
		const { io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		// The probe RAN (at least one Image constructed) and — loading OK — kept the cached url.
		expect(imageInstances.length).toBeGreaterThanOrEqual(1);
		expect(onResolved).toHaveBeenCalledWith(track.uid, 'https://cache.example/by-uid.jpg');
		expect(removeCoverBoth).not.toHaveBeenCalled(); // good probe → no eviction
		expect(resolveCoverForTrack).not.toHaveBeenCalled();
	});

	it('empty-uid cache-hit DEAD: removeCoverBoth called with the empty uid, then re-resolves', async () => {
		imageBehavior = 'error';
		// Empty uid → the name layer is the only one read; a SOLID-but-dead name-layer value.
		getCachedCoverByUid.mockReturnValue('https://poison.example/uid-slot.jpg');
		getCachedCover.mockReturnValue('https://cache.example/by-name-dead.jpg');
		const onResolved = vi.fn();
		const track = mkTrack({ uid: '', artist: 'Foo Fighters', title: 'Everlong' });
		const { io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		// Empty uid never reads the uid layer; the dead name-layer HIT triggers eviction. removeCoverBoth
		// is called WITH the empty uid (the source guard makes the uid-slot eviction a no-op — we assert
		// the call args carry '', NOT that it touches the shared uid slot).
		expect(getCachedCoverByUid).not.toHaveBeenCalled();
		expect(getCachedCover).toHaveBeenCalledWith('Foo Fighters', 'Everlong');
		expect(removeCoverBoth).toHaveBeenCalledWith('', 'Foo Fighters', 'Everlong');
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(1);
		expect(onResolved).toHaveBeenCalledWith('', 'https://resolved.example/c.jpg');
	});

	// charts-tags-same-cover regression: discovery stub rows (charts/tags, charts/countries) carry
	// uid ''. The shared uid cache layer is keyed by `'uid:' + uid`, so an empty uid would collapse
	// every distinct row onto the single `'uid:'` slot and the first resolved cover would read back
	// for ALL rows. An empty uid must therefore NEVER read the uid layer — only the {artist,title}
	// name layer — and must NOT de-dupe by the empty uid (which would let only the first stub resolve).
	it('an empty-uid stub does NOT read the uid cache layer (charts-tags-same-cover)', async () => {
		// A poisoned uid slot must be IGNORED for an empty uid: if the uid layer were consulted it
		// would surface this wrong cover; instead the name-layer miss → the per-song chain runs.
		getCachedCoverByUid.mockReturnValue('https://poison.example/first-row.jpg');
		getCachedCover.mockReturnValue(null);
		const onResolved = vi.fn();
		const track = mkTrack({ uid: '', artist: 'Foo Fighters', title: 'Everlong' });
		const { io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		// The empty uid never queries the uid layer; the name layer is consulted instead.
		expect(getCachedCoverByUid).not.toHaveBeenCalled();
		expect(getCachedCover).toHaveBeenCalledWith('Foo Fighters', 'Everlong');
		// Name-layer miss → the per-song chain resolves this row's OWN cover (not the poison slot).
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(1);
		expect(onResolved).toHaveBeenCalledWith('', 'https://resolved.example/c.jpg');
	});

	it('empty-uid stub rows de-dupe per {artist,title}, not by the empty uid (distinct rows each resolve)', async () => {
		const onResolved = vi.fn();
		// A slow resolve so both rows fire while the first is still in flight.
		const releases: Array<(v: string | null) => void> = [];
		resolveCoverForTrack.mockImplementation(
			() => new Promise<string | null>((res) => releases.push(res))
		);

		// Two DISTINCT songs, both with the empty stub uid. They must BOTH run the chain — keying the
		// in-flight Set by the empty uid would skip the second (the original same-cover bug).
		const songA = mkTrack({ uid: '', artist: 'Paramore', title: 'Still Into You' });
		const songB = mkTrack({ uid: '', artist: 'Coldplay', title: 'Sparks' });
		const a = await mount({ track: songA, onResolved });
		const b = await mount({ track: songB, onResolved });

		a.io.trigger(true);
		b.io.trigger(true);
		await flush();
		// Distinct {artist,title} → distinct in-flight keys → both chains run.
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(2);
		releases.forEach((r) => r('https://resolved.example/c.jpg'));
		await flush();
	});

	it('SSR guard: with IntersectionObserver undefined the action does not throw', async () => {
		(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
		const onResolved = vi.fn();
		const { lazyCover } = await import('./lazyCover');
		expect(() => lazyCover({} as HTMLElement, { track: mkTrack(), onResolved })).not.toThrow();
	});

	it('SSR guard: with Image undefined a broken/empty cover still routes to the chain (no throw)', async () => {
		(globalThis as { Image?: unknown }).Image = undefined;
		const onResolved = vi.fn();
		const track = mkTrack({ cover: 'https://x.example/c.jpg' });
		const { io } = await mount({ track, onResolved });
		io.trigger(true);
		await flush();
		// Image undefined → probe returns false → repair path runs the chain.
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(1);
	});
});

// inFlightKey — the empty-uid stub de-dupe key. Pins the anti-collision invariant the prior literal
// NUL-byte separator provided, now via JSON.stringify([artist,title]) (which is ALSO git-text-safe:
// the key must contain no control characters, or the source file registers as binary to git).
describe('inFlightKey', () => {
	it('a real uid keys by the uid itself (never the name form)', async () => {
		const { inFlightKey } = await import('./lazyCover');
		const t = mkTrack({ uid: 'netease:999', artist: 'Jay Chou', title: 'Dao Xiang' });
		expect(inFlightKey(t)).toBe('netease:999');
	});

	it('two empty-uid stubs with the same artist but different titles get DISTINCT keys', async () => {
		const { inFlightKey } = await import('./lazyCover');
		const a = inFlightKey(mkTrack({ uid: '', artist: 'A', title: 'X' }));
		const b = inFlightKey(mkTrack({ uid: '', artist: 'A', title: 'Y' }));
		expect(a).not.toBe(b);
	});

	it('does not alias when a boundary shifts between artist and title (["a","bc"] vs ["ab","c"])', async () => {
		const { inFlightKey } = await import('./lazyCover');
		const a = inFlightKey(mkTrack({ uid: '', artist: 'a', title: 'bc' }));
		const b = inFlightKey(mkTrack({ uid: '', artist: 'ab', title: 'c' }));
		expect(a).not.toBe(b);
	});

	it('the key contains no NUL / control characters (git-text-safe regression guard)', async () => {
		const { inFlightKey } = await import('./lazyCover');
		const key = inFlightKey(mkTrack({ uid: '', artist: 'Jay Chou', title: 'Dao Xiang' }));
		// eslint-disable-next-line no-control-regex
		expect(/[\x00-\x1f]/.test(key)).toBe(false);
	});
});
