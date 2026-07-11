import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// FIX-A: player.playStub is the optimistic resolve-on-tap path. A discovery tile is a
// Last.fm {artist,title} stub (NOT a Track), so it must be resolved via resolveStub
// (searchAll+dedupeBest, ~5-10s) before play. playStub locks the tapped stub into
// pendingTrack + loading SYNCHRONOUSLY, dedupes a same-song double-tap, and supersedes an
// in-flight resolve when a different song is tapped (generation guard). We mock resolveStub
// with DEFERRED promises so the generation-timing test is deterministic, and play() (which
// touches the real <audio>/Media Session) is stubbed so these run headless in node.

// Mock the resolve-on-tap shim so we control settle order + timing.
vi.mock('$lib/services/discovery', () => ({ resolveStub: vi.fn() }));
// Mock the detail resolver so prefetchNext's pre-resolve is observable/controllable in node.
vi.mock('$lib/services/catalog', () => ({ ensureTrackDetails: vi.fn(), searchAll: vi.fn() }));
// Mock the cross-source fallback so the resilience tests drive runFallback's total-failure exit
// (null = all sources exhausted) without real network.
vi.mock('$lib/services/fallback', () => ({ tryFallback: vi.fn(), fallbackOrder: vi.fn(() => []) }));
// PLAY-10: restore()/persist() early-return under !browser. Flip browser ON so the restore
// migration path (persisted repeatMode → 'off'|'one') actually executes in node, and provide a
// minimal in-memory localStorage so persist()/restore() have a backing store to read/write.
vi.mock('$app/environment', () => ({ browser: true }));
// WR-02/CR-02: mock the IDB blob store so the offline-blob read in reresolveCurrent/play can be a
// DEFERRED promise (controls the await window the gen re-check guards). Defaults to a miss.
vi.mock('$lib/services/blob-store', () => ({
	blobStore: { get: vi.fn(async () => null), put: vi.fn(), del: vi.fn() }
}));
// QUEUE-05 (17-02): mock the two up-next generators so a test can OBSERVE the exclude/`have` Set
// passed to them (the removedUids-exclusion assertions) without real network. Both default to []
// — the same "sources dry → adds nothing" outcome the real fns hit headless, so the existing
// end-of-queue / ensureAhead tests keep their behaviour (they already assert "adds nothing").
vi.mock('$lib/services/similar', () => ({ buildSimilarQueue: vi.fn(async () => []) }));
vi.mock('$lib/services/picks', () => ({ buildDiversePicks: vi.fn(async () => []) }));
// COVER-01 (21-03): mock the two cover-cache sync reads (uid layer then name layer) so the
// resolvedCover sync-set read order is observable, and the single-item async resolve helper so the
// tier-chain land + generation guard can be driven with a deferred promise. importOriginal keeps
// every OTHER export (setCachedCover, clearCoverCache, …) real so unrelated suites are untouched.
vi.mock('$lib/services/cover-cache', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/services/cover-cache')>();
	return { ...actual, getCachedCoverByUid: vi.fn(() => null), getCachedCover: vi.fn(() => null) };
});
vi.mock('$lib/services/cover-backfill', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/services/cover-backfill')>();
	return { ...actual, resolveCoverForTrack: vi.fn(async () => null) };
});
// quick-260704-20e: spy on the BOTH-layers evictor so healCover's dead-probe eviction is observable.
// importOriginal keeps writeCoverBoth/bumpCoverVersion (+ the reactive read helpers) real so the
// player store's existing cover-write sites (Site A/Site C) still behave.
vi.mock('$lib/stores/cover-version.svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/stores/cover-version.svelte')>();
	return { ...actual, removeCoverBoth: vi.fn(actual.removeCoverBoth) };
});

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

import { player } from './player.svelte';
import { sleepTimer } from '$lib/stores/sleepTimer.svelte';
import { settings } from './settings.svelte';
import { library } from '$lib/stores/library.svelte';
import { resolveStub } from '$lib/services/discovery';
import { ensureTrackDetails } from '$lib/services/catalog';
import { tryFallback } from '$lib/services/fallback';
import { blobStore } from '$lib/services/blob-store';
import { buildSimilarQueue } from '$lib/services/similar';
import { buildDiversePicks } from '$lib/services/picks';
import { getCachedCoverByUid, getCachedCover } from '$lib/services/cover-cache';
import { resolveCoverForTrack } from '$lib/services/cover-backfill';
import { removeCoverBoth } from '$lib/stores/cover-version.svelte';

const mockResolve = vi.mocked(resolveStub);
const mockEnsure = vi.mocked(ensureTrackDetails);
const mockTryFallback = vi.mocked(tryFallback);
const mockBlobGet = vi.mocked(blobStore.get);
const mockSimilar = vi.mocked(buildSimilarQueue);
const mockPicks = vi.mocked(buildDiversePicks);
const mockUidCover = vi.mocked(getCachedCoverByUid);
const mockNameCover = vi.mocked(getCachedCover);
const mockResolveCover = vi.mocked(resolveCoverForTrack);
const mockRemoveCoverBoth = vi.mocked(removeCoverBoth);

function mk(source: SourceId, songid: string, artist: string, title: string): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title,
		artist,
		album: '',
		cover: null,
		audioUrl: 'https://cdn.example.com/a.mp3',
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1
	};
}

// COVER-01: a module-scope fake MediaMetadata (hoisted to avoid the Svelte nested-class perf
// warning). Each instance exposes `.artwork` like the real one and pushes itself into whichever log
// the active resolvedCover suite points `coverMetadataSink` at, so a test can assert a FRESH object
// was assigned on the async cover land (Pitfall 4).
let coverMetadataSink: Array<{ artwork: unknown[] }> = [];
class FakeMediaMetadata {
	title: string;
	artist: string;
	album: string;
	artwork: unknown[];
	constructor(init: { title: string; artist: string; album: string; artwork: unknown[] }) {
		this.title = init.title;
		this.artist = init.artist;
		this.album = init.album;
		this.artwork = init.artwork;
		coverMetadataSink.push(this);
	}
}

/** A deferred promise so a test can control exactly WHEN a resolve settles. */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// Let queued microtasks (the await in playStub + the void play() handoff) flush.
const flush = () => new Promise((r) => setTimeout(r, 0));

/** An unresolved search stub: detailsLoaded:false + audioUrl:null so the readiness guard does NOT short-circuit. */
function stub(source: SourceId, songid: string, artist: string, title: string): Track {
	return { ...mk(source, songid, artist, title), detailsLoaded: false, audioUrl: null };
}

function installAssetPreloadMocks() {
	const audios: Array<{
		preload: string;
		muted: boolean;
		src: string;
		setAttribute: ReturnType<typeof vi.fn>;
		load: ReturnType<typeof vi.fn>;
	}> = [];
	const images: Array<{ decoding: string; referrerPolicy: string; src: string }> = [];
	const AudioCtor = vi.fn(function () {
		const audio = {
			preload: '',
			muted: false,
			src: '',
			setAttribute: vi.fn(),
			load: vi.fn()
		};
		audios.push(audio);
		return audio;
	});
	const ImageCtor = vi.fn(function () {
		const img = { decoding: '', referrerPolicy: '', src: '' };
		images.push(img);
		return img;
	});
	vi.stubGlobal('Audio', AudioCtor);
	vi.stubGlobal('Image', ImageCtor);
	return { audios, images, AudioCtor, ImageCtor };
}

/** Mirror of Player.FAILURE_CAP (private static = 5) for the loop-guard tests. */
const Player_FAILURE_CAP = 5;
/** Mirror of Player.SYSTEMIC_SKIP_CAP (private static = 5) — the systemic-failure STOP ceiling
 *  (debug-nowbar-frozen-audius-spam). */
const Player_SYSTEMIC_SKIP_CAP = 5;
/** Mirror of Player.STALL_TIMEOUT_MS (private static = 15000) for the stall-watchdog tests. */
const Player_STALL_TIMEOUT_MS = 15000;
/** Mirror of Player.PREFETCH_PLAYBACK_DELAY_MS (private static = 5000) for the delayed-trigger test. */
const Player_PREFETCH_PLAYBACK_DELAY_MS = 5000;

/**
 * Minimal fake <audio> for attach(): records addEventListener handlers so a test can `.fire()`
 * a named event, and stubs the methods/props attach() + the listeners touch. navigator.mediaSession
 * is absent in node, so the `ms` accessor returns null and the Media Session calls early-return.
 */
function makeFakeAudio() {
	const handlers = new Map<string, Array<() => void>>();
	return {
		_handlers: handlers,
		paused: true,
		currentTime: 0,
		duration: NaN,
		readyState: 0,
		src: '',
		setAttribute() {},
		addEventListener(type: string, cb: () => void) {
			const arr = handlers.get(type) ?? [];
			arr.push(cb);
			handlers.set(type, arr);
		},
		play: vi.fn(() => Promise.resolve()),
		pause: vi.fn(),
		fire(type: string) {
			for (const cb of handlers.get(type) ?? []) cb();
		}
	};
}

beforeEach(() => {
	mockResolve.mockReset();
	mockEnsure.mockReset();
	memStore.clear();
	player.queue = [];
	// play() touches the real <audio>/Media Session — stub it so playStub's success handoff
	// is observable (current set) without a DOM. We assert play() is CALLED with the track.
	vi.spyOn(player, 'play').mockImplementation(async (track: Track) => {
		// Mirror the bits of play() the now-bar observes: take ownership of current/loading.
		player.current = track;
		player.loading = false;
	});
	// Reset the optimistic state between tests (private fields reset via a fresh miss path).
	player.current = null;
	player.pendingTrack = null;
	player.loading = false;
	player.error = null;
	const internals = player as unknown as {
		prefetchingUid: string | null;
		prefetchController: AbortController | null;
		preloadedAudio: HTMLAudioElement | null;
		preloadedAudioUid: string | null;
		preloadedAudioUrl: string | null;
		preloadedCover: HTMLImageElement | null;
		preloadedCoverUid: string | null;
		preloadedCoverUrl: string | null;
		growPromise: Promise<void> | null;
		growing: boolean;
		// quick-260615-i9u: unplayableUids is now a SvelteSet — structurally compatible for the
		// .clear()/.add()/.has()/.delete() surface the tests touch.
		unplayableUids: { clear(): void; add(u: string): void; has(u: string): boolean; delete(u: string): boolean };
		retriedDeadUids: Set<string>;
		pendingHistory: Track[] | null;
		// debug-playback-skip-and-autoplay: the strike map (Bug 1) + the autoplay-retry arm (Bug 2)
		// are session/per-src internal state that must not leak across tests.
		unplayableStrikes: Map<string, number>;
		autoplayRetryArmed: boolean;
		// quick-260627-huo: the delayed re-resolve timers + per-uid attempt budget are session-scoped
		// internal state that must not leak across tests (an orphan timer firing in a later test would
		// re-run prefetchNext against a stale queue).
		retryResolveTimers: Map<string, ReturnType<typeof setTimeout>>;
		retryResolveAttempts: Map<string, number>;
	};
	internals.prefetchingUid = null;
	internals.prefetchController?.abort();
	internals.prefetchController = null;
	internals.unplayableUids.clear(); // PLAY-RESILIENCE: session-scoped dead-track set leaks across tests
	internals.retriedDeadUids.clear(); // NEVER-STOP (quick-260630-q03): one-retry record is session-scoped too
	internals.preloadedAudio = null;
	internals.preloadedAudioUid = null;
	internals.preloadedAudioUrl = null;
	internals.preloadedCover = null;
	internals.preloadedCoverUid = null;
	internals.preloadedCoverUrl = null;
	internals.growPromise = null;
	internals.growing = false;
	internals.pendingHistory = null; // quick-260615-i9u: one-shot history carrier must not leak across tests
	internals.unplayableStrikes.clear(); // Bug 1: strike budget is session-scoped — reset between tests
	internals.autoplayRetryArmed = false; // Bug 2: autoplay-retry arm is per-src — reset between tests
	// quick-260627-huo: clear every pending delayed re-resolve timer THEN both maps so no orphan timer
	// (and no carried attempt budget) leaks into the next test.
	for (const timer of internals.retryResolveTimers.values()) clearTimeout(timer);
	internals.retryResolveTimers.clear();
	internals.retryResolveAttempts.clear();
	// debug-nowbar-freeze-reresolve-loop: the raw-audio-error ceiling + rapid-fire brake counters are
	// session-scoped (reset by a real `playing` / play() / recoverFromStop in production). They must not
	// leak across tests now that a ceiling reads them — a stale burst could trip the skip early.
	const burst = player as unknown as { errorBurst: number; reresolveBurst: number; rapidErrorBurst: number; lastAudioErrorAt: number; failoverSkips: number; consecutiveFailures: number };
	burst.errorBurst = 0;
	burst.reresolveBurst = 0;
	burst.rapidErrorBurst = 0;
	burst.lastAudioErrorAt = 0;
	// debug-nowbar-frozen-audius-spam: the cross-track systemic-failure skip counter is session-scoped
	// too (reset by a real `playing` / recoverFromStop). Reset it (and the legacy consecutiveFailures)
	// so a leaked count from a prior storm/ceiling test can't falsely trip the SYSTEMIC STOP.
	burst.failoverSkips = 0;
	burst.consecutiveFailures = 0;
	// bg-lockscreen-stall-noskip: the bounded prebuffer + one-shot stall-retry flag are session-scoped
	// on the singleton — reset so a prebuffered blob / retried flag from a prior test can't leak.
	const bg = player as unknown as { prebufferedUid: string | null; prebufferedBlobUrl: string | null; stallRetried: boolean };
	bg.prebufferedUid = null;
	bg.prebufferedBlobUrl = null;
	bg.stallRetried = false;
});

afterEach(() => {
	vi.restoreAllMocks();
	// IN-02: vi.restoreAllMocks() does NOT undo vi.stubGlobal — without this, a stubbed
	// `navigator` (e.g. the offline suite's { onLine: false }) would persist into later suites in
	// this worker, leaving a truthy-but-mediaSession-less navigator that the `ms` accessor's
	// feature detection would see. Unstub globally after every test as the single safety net…
	vi.unstubAllGlobals();
	// …then re-establish the module-level localStorage stub that unstubAllGlobals also tears down
	// (it is set once at import, not per-test; restore()/persist() tests depend on it).
	vi.stubGlobal('localStorage', localStorageMock);
});

describe('player.playStub — optimistic resolve-on-tap (FIX-A)', () => {
	it('locks the tapped stub into pendingTrack + loading SYNCHRONOUSLY, before resolve', () => {
		const d = deferred<Track | null>();
		mockResolve.mockReturnValue(d.promise);

		// Do NOT await — assert the state set synchronously, before resolveStub settles.
		void player.playStub('周杰伦', '稻香', 'https://img/cover.png');

		expect(player.pendingTrack).toEqual({
			artist: '周杰伦',
			title: '稻香',
			cover: 'https://img/cover.png'
		});
		expect(player.loading).toBe(true);
		expect(player.current).toBeNull(); // not played yet — still resolving
		d.resolve(null); // cleanup
	});

	it('dedupes a same-song double-tap: resolveStub is called ONCE', async () => {
		const d = deferred<Track | null>();
		mockResolve.mockReturnValue(d.promise);

		const p1 = player.playStub('Ed Sheeran', 'Perfect');
		const p2 = player.playStub('Ed Sheeran', 'Perfect'); // same key, still in flight

		expect(mockResolve).toHaveBeenCalledTimes(1);
		await expect(p2).resolves.toBeNull(); // the deduped second tap returns null immediately

		d.resolve(mk('netease', '1', 'Ed Sheeran', 'Perfect'));
		await p1;
		await flush();
	});

	it('a DIFFERENT-song tap supersedes: the stale resolve never plays', async () => {
		const dA = deferred<Track | null>();
		const dB = deferred<Track | null>();
		mockResolve.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);

		const trackA = mk('netease', 'A', 'Artist A', 'Song A');
		const trackB = mk('qq', 'B', 'Artist B', 'Song B');

		const pA = player.playStub('Artist A', 'Song A'); // gen 1
		const pB = player.playStub('Artist B', 'Song B'); // gen 2 — supersedes gen 1

		// The now-bar shows the NEWER song while both resolve.
		expect(player.pendingTrack).toEqual({ artist: 'Artist B', title: 'Song B', cover: null });

		// The STALE (gen 1) resolve settles FIRST → must be discarded (not played).
		dA.resolve(trackA);
		await expect(pA).resolves.toBeNull();
		await flush();
		expect(player.current).toBeNull(); // stale result never played

		// The CURRENT (gen 2) resolve settles → it plays.
		dB.resolve(trackB);
		await expect(pB).resolves.toBe(trackB);
		await flush();
		expect(player.current?.uid).toBe(trackB.uid);
		expect(player.play).toHaveBeenCalledWith(trackB, { fresh: true });
		// The stale track was NEVER handed to play().
		expect(player.play).not.toHaveBeenCalledWith(trackA, expect.anything());
	});

	it('on success: plays the resolved Track + clears pendingTrack', async () => {
		const track = mk('netease', 'hit', '周杰伦', '稻香');
		mockResolve.mockResolvedValue(track);

		const out = await player.playStub('周杰伦', '稻香');
		await flush();

		expect(out).toBe(track);
		expect(player.pendingTrack).toBeNull(); // overlay cleared on handoff
		expect(player.play).toHaveBeenCalledWith(track, { fresh: true });
		expect(player.current?.uid).toBe(track.uid);
	});

	it('on a miss (null): clears pendingTrack, loading false, returns null', async () => {
		mockResolve.mockResolvedValue(null);

		const out = await player.playStub('Nobody', 'Nothing');

		expect(out).toBeNull();
		expect(player.pendingTrack).toBeNull();
		expect(player.loading).toBe(false);
		expect(player.play).not.toHaveBeenCalled();
	});

	it('never throws even when resolveStub rejects (returns null, clears overlay)', async () => {
		mockResolve.mockRejectedValue(new Error('search down'));

		await expect(player.playStub('X', 'Y')).resolves.toBeNull();
		expect(player.pendingTrack).toBeNull();
		expect(player.loading).toBe(false);
	});

	it('after a miss, the SAME song can be tapped again (key cleared, not stuck deduped)', async () => {
		mockResolve.mockResolvedValueOnce(null);
		await player.playStub('Retry', 'Me'); // miss clears pendingKey

		const track = mk('kuwo', '2', 'Retry', 'Me');
		mockResolve.mockResolvedValueOnce(track);
		const out = await player.playStub('Retry', 'Me'); // not deduped — fresh attempt
		await flush();

		expect(out).toBe(track);
		expect(mockResolve).toHaveBeenCalledTimes(2);
	});
});

describe('player.prefetchNext — pre-resolve next track for gapless-ish play', () => {
	// prefetchNext is private + fired from the real play(); drive it directly (bracket access)
	// after seeding current + queue, so timing stays deterministic regardless of play()'s stub.
	const prefetch = () => (player as unknown as { prefetchNext(): Promise<void> })['prefetchNext']();
	const primeNext = () => (player as unknown as { primeNext(): Promise<void> })['primeNext']();
	const ensureAhead = () => (player as unknown as { ensureAhead(): Promise<void> })['ensureAhead']();

	it("pre-resolves the next track's details and warms its cover (no audio byte-warm)", async () => {
		const assets = installAssetPreloadMocks();
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next'); // unresolved — readiness guard does NOT short-circuit
		player.queue = [cur, next];
		player.current = cur;

		const resolved: Track = {
			...next,
			detailsLoaded: true,
			audioUrl: 'https://cdn/next.mp3',
			cover: 'https://img/next.jpg'
		};
		mockEnsure.mockResolvedValue(resolved);

		await prefetch();
		await flush();

		// Called once, with the next stub and an AbortSignal.
		expect(mockEnsure).toHaveBeenCalledTimes(1);
		expect(mockEnsure).toHaveBeenCalledWith(next, expect.any(AbortSignal));
		// Resolved track written back into queue[1] (so a later play() no-ops).
		expect(player.queue[1].detailsLoaded).toBe(true);
		expect(player.queue[1].audioUrl).toBe('https://cdn/next.mp3');
		// No audio byte-warm at all — the zero-fetch blob pre-buffer was removed
		// (debug-nowbar-frozen-audius-spam) and there was never a throwaway <audio preload=auto> either,
		// so no HTMLAudioElement is constructed for warming. Only the cover Image is warmed.
		expect(assets.AudioCtor).not.toHaveBeenCalled();
		expect(assets.ImageCtor).toHaveBeenCalledTimes(1);
		expect(assets.images[0].src).toBe('https://img/next.jpg');
		expect(assets.images[0].decoding).toBe('async');
		expect(assets.images[0].referrerPolicy).toBe('no-referrer');
	});

	it('no-op at end of queue (no next track)', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		player.queue = [cur]; // current is the last entry
		player.current = cur;

		await prefetch();
		await flush();

		expect(mockEnsure).not.toHaveBeenCalled();
	});

	it('warms the cover even when next track is already detailsLoaded (no audio byte-warm)', async () => {
		const assets = installAssetPreloadMocks();
		const cur = mk('netease', '0', 'A', 'Now');
		const next = { ...mk('qq', '1', 'B', 'Next'), cover: 'https://img/already.jpg' };
		player.queue = [cur, next];
		player.current = cur;

		await prefetch();
		await flush();

		expect(mockEnsure).not.toHaveBeenCalled();
		expect(assets.AudioCtor).not.toHaveBeenCalled(); // no audio byte-warm (blob pre-buffer removed)
		expect(assets.ImageCtor).toHaveBeenCalledTimes(1);
		expect(assets.images[0].src).toBe('https://img/already.jpg');
	});

	it('DEPTH-2 WARM: after landing the immediate-next, also pre-resolves the FOLLOWING entry (bg-resolve-gap-stall)', async () => {
		// Freeze 1 prevention: if the landed immediate-next 403s at play-time (region-lock), the never-stop
		// chain SKIPS to the entry after it. warmAfter() pre-resolves that entry so its play() short-circuits
		// ensureTrackDetails — no cold network resolve to hang in a frozen background WebView (the 0:00 freeze).
		installAssetPreloadMocks();
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next'); // immediate-next — landed by the probe walk
		const after = stub('kuwo', '2', 'C', 'After'); // the skip-target if `next` dies at play-time
		player.queue = [cur, next, after];
		player.current = cur;

		// Resolve each stub to a DISTINCT playable url so the two writebacks are distinguishable.
		mockEnsure.mockImplementation(async (t: Track) => ({
			...t,
			detailsLoaded: true,
			audioUrl: `https://cdn/${t.songid}.mp3`
		}));

		await prefetch();
		await flush(); // warmAfter is fire-and-forget from inside the walk

		// Landed immediate-next AND the following entry both resolved (the latter via warmAfter, no probe).
		expect(mockEnsure).toHaveBeenCalledWith(next, expect.any(AbortSignal));
		expect(mockEnsure).toHaveBeenCalledWith(after, expect.any(AbortSignal));
		// Both written back so a later play()/skip short-circuits with NO cold background resolve.
		expect(player.queue[1].detailsLoaded).toBe(true);
		expect(player.queue[1].audioUrl).toBe('https://cdn/1.mp3');
		expect(player.queue[2].detailsLoaded).toBe(true);
		expect(player.queue[2].audioUrl).toBe('https://cdn/2.mp3');
	});

	it('DEPTH-2 WARM is a no-op when the landed track is the queue tail (nothing after it to warm)', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next'); // last entry — no following track
		player.queue = [cur, next];
		player.current = cur;
		mockEnsure.mockResolvedValue({ ...next, detailsLoaded: true, audioUrl: 'https://cdn/1.mp3' });

		await prefetch();
		await flush();

		// Only the landed immediate-next resolved — warmAfter found no following entry (growth = ensureAhead).
		expect(mockEnsure).toHaveBeenCalledTimes(1);
	});

	it('dedupes in-flight: a second prefetchNext for the same next track does not start a second resolve', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next');
		player.queue = [cur, next];
		player.current = cur;

		const d = deferred<Track>();
		mockEnsure.mockReturnValue(d.promise); // never settles until we resolve it

		void prefetch();
		void prefetch(); // same current/queue, still in flight → must NOT start a second resolve

		expect(mockEnsure).toHaveBeenCalledTimes(1);

		d.resolve({ ...next, detailsLoaded: true, audioUrl: 'https://cdn/next.mp3' }); // cleanup
		await flush();
	});

	it('discards a stale resolve when current changes mid-resolve', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next');
		player.queue = [cur, next];
		player.current = cur;

		const d = deferred<Track>();
		mockEnsure.mockReturnValue(d.promise);

		void prefetch(); // captures seedUid = cur.uid

		// Current changes away mid-resolve → the just-prefetched result is now stale.
		player.current = mk('kuwo', '9', 'Z', 'Unrelated');

		const resolved: Track = { ...next, detailsLoaded: true, audioUrl: 'https://cdn/stale.mp3' };
		d.resolve(resolved);
		await flush();

		// queue[1] must NOT be overwritten — the stale resolve was discarded.
		expect(player.queue[1]).toBe(next);
		expect(player.queue[1].audioUrl).toBeNull();
	});

	it('ended → next() auto-advance reaches play() (which fires prefetchNext) — PLAY-09/D-15', () => {
		// The ended listener (repeatMode 'off') calls next(); next() → play(queue[i+1]); play()'s
		// tail fires `void this.prefetchNext()`. play() is stubbed here so we assert the advance
		// hand-off: ended drives next() which calls play() with the next queue entry. That play()
		// in production is the unconditional prefetchNext trigger on the auto-advance path.
		const cur = mk('netease', '0', 'A', 'Now');
		const next = mk('qq', '1', 'B', 'Next');
		player.queue = [cur, next];
		player.current = cur;
		player.repeatMode = 'off';

		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();

		el.fire('ended');

		expect(playSpy).toHaveBeenCalledWith(next);
	});

	it('next() waits for an already in-flight ensureAhead grow before advancing', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const grown = mk('qq', '1', 'B', 'Grown Next');
		player.queue = [cur];
		player.current = cur;

		const d = deferred<Track[]>();
		mockPicks.mockReset().mockReturnValue(d.promise);
		const grow = ensureAhead();

		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();
		player.next();
		await flush();
		expect(playSpy).not.toHaveBeenCalled();

		d.resolve([grown]);
		await grow;
		await flush();

		expect(player.queue.map((t) => t.uid)).toEqual([cur.uid, grown.uid]);
		expect(playSpy).toHaveBeenCalledWith(grown);
	});

	it('primeNext grows an exhausted queue (ensureAhead only — does NOT pre-resolve)', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next');
		player.queue = [cur];
		player.current = cur;
		mockPicks.mockReset().mockResolvedValue([next]);
		mockEnsure.mockResolvedValue({ ...next, detailsLoaded: true, audioUrl: 'https://cdn/next.mp3' });

		await primeNext();
		await flush();

		// RELAX-PREFETCH: primeNext now only tops up the queue — it no longer fires the prefetch
		// resolve on play() entry (that is the timeupdate gate's job ~5s into playback).
		expect(mockPicks).toHaveBeenCalledTimes(1);
		expect(player.queue.map((t) => t.uid)).toEqual([cur.uid, next.uid]);
		expect(mockEnsure).not.toHaveBeenCalled();
		expect(player.queue[1].audioUrl).toBeNull(); // still an unresolved stub — resolved later
	});

	it('quick-260618-fiz Fix 3: ensureAhead seeds the continuation from the CURRENT track via buildSimilarQueue', async () => {
		const cur = mk('netease', '0', 'Adele', 'Hello');
		const similarPick = mk('qq', 'S', 'Someone', 'Like You');
		player.queue = [cur]; // queue.length - i = 1 → within 2 of end → grows
		player.current = cur;
		mockSimilar.mockReset().mockResolvedValue([similarPick]);
		mockPicks.mockReset().mockResolvedValue([mk('kuwo', 'D', 'Diverse', 'Random')]);

		await ensureAhead();
		await flush();

		// buildSimilarQueue was seeded from the CURRENT (last-played) track, not random picks.
		expect(mockSimilar).toHaveBeenCalledTimes(1);
		expect(mockSimilar.mock.calls[0][0]).toBe(cur);
		// the exclude/`have` set unions the queue uids (so the continuation never duplicates queued songs).
		const haveArg = mockSimilar.mock.calls[0][1] as Set<string>;
		expect(haveArg.has(cur.uid)).toBe(true);
		// similar returned picks → buildDiversePicks (the random fallback) is NOT called.
		expect(mockPicks).not.toHaveBeenCalled();
		expect(player.queue.map((t) => t.uid)).toEqual([cur.uid, similarPick.uid]);
	});

	it('quick-260618-fiz Fix 3: ensureAhead falls back to buildDiversePicks only when buildSimilarQueue is dry', async () => {
		const cur = mk('netease', '0', 'Obscure', 'Bootleg');
		const diversePick = mk('kuwo', 'D', 'Diverse', 'Random');
		player.queue = [cur];
		player.current = cur;
		mockSimilar.mockReset().mockResolvedValue([]); // Last.fm + same-artist search both dry
		mockPicks.mockReset().mockResolvedValue([diversePick]);

		await ensureAhead();
		await flush();

		// similar seeded first (and from current), then the diverse fallback fired (never-stop).
		expect(mockSimilar).toHaveBeenCalledTimes(1);
		expect(mockSimilar.mock.calls[0][0]).toBe(cur);
		expect(mockPicks).toHaveBeenCalledTimes(1);
		expect(player.queue.map((t) => t.uid)).toEqual([cur.uid, diversePick.uid]);
	});

	it('a direct prefetchNext pre-resolves the newly added next track + warms its assets', async () => {
		const assets = installAssetPreloadMocks();
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next');
		const resolved: Track = {
			...next,
			detailsLoaded: true,
			audioUrl: 'https://cdn/next.mp3',
			cover: 'https://img/prime.jpg'
		};
		player.queue = [cur, next];
		player.current = cur;
		mockEnsure.mockResolvedValue(resolved);

		await prefetch();
		await flush();

		expect(mockEnsure).toHaveBeenCalledWith(next, expect.any(AbortSignal));
		expect(player.queue[1].audioUrl).toBe('https://cdn/next.mp3');
		expect(assets.images[0].src).toBe('https://img/prime.jpg'); // cover still warmed
		expect(assets.AudioCtor).not.toHaveBeenCalled(); // no audio byte-warm (blob pre-buffer removed)
	});

	it('BOUNDED-prebuffers the immediate-next to local bytes, once, claiming prebufferedUid (bg-lockscreen-stall-noskip)', async () => {
		// The blob pre-buffer is REINTRODUCED but BOUNDED: prefetch pre-resolves AND fetches the next
		// track's bytes into a blob so a backgrounded src-swap plays LOCAL bytes (no network load that can
		// hang). prebufferedUid is claimed so the same uid is fetched at most once (the f7c2580 flood fix).
		const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['audio-bytes']) }));
		vi.stubGlobal('fetch', fetchMock);
		const createObjSpy = vi.fn(() => 'blob:next-bytes');
		vi.stubGlobal('URL', {
			createObjectURL: createObjSpy,
			revokeObjectURL: vi.fn()
		} as unknown as typeof URL);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
		const state = player as unknown as { prebufferedUid: string | null; prebufferedBlobUrl: string | null };
		state.prebufferedUid = null;
		state.prebufferedBlobUrl = null;

		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next');
		const resolvedNext: Track = { ...next, detailsLoaded: true, audioUrl: 'https://cdn/next.mp3' };
		player.queue = [cur, next];
		player.current = cur;
		mockEnsure.mockResolvedValue(resolvedNext);

		await prefetch();
		await flush();

		// Pre-resolved into the queue…
		expect(player.queue[1].audioUrl).toBe('https://cdn/next.mp3');
		// …AND its bytes pre-buffered to a local blob, keyed by uid.
		expect(fetchMock).toHaveBeenCalledWith(
			'https://cdn/next.mp3',
			expect.objectContaining({ referrerPolicy: 'no-referrer' })
		);
		expect(createObjSpy).toHaveBeenCalled();
		expect(state.prebufferedUid).toBe(next.uid);

		// Bounded: a SECOND prewarm for the same uid does NOT re-fetch (dedupe).
		fetchMock.mockClear();
		await prefetch();
		await flush();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	// PLAY-RESILIENCE: bounded FORWARD-RESOLVE-AND-PROBE walk (restored from the pre-76b3e6f design).
	// A reject on the immediate-next is TRANSIENT — the walk skips it (without marking it dead) and
	// advances to the next candidate so a single-source hiccup never leaves the queue with a dead
	// next-up. A no-audioUrl resolve is a DEFINITIVE failure — the candidate is marked unplayable so
	// next() routes past it. Either way the walk lands the first probe-verified playable track.
	const unplayable = () =>
		(player as unknown as { unplayableUids: Set<string> }).unplayableUids;

	it('a REJECTING immediate-next is skipped (not marked dead) and the walk advances to a later candidate', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const bad = stub('qq', '1', 'B', 'Bad'); // immediate-next: resolve rejects (transient proxy failure)
		const good = stub('kuwo', '2', 'C', 'Good'); // later candidate — the walk MUST reach it
		player.queue = [cur, bad, good];
		player.current = cur;

		mockEnsure.mockImplementation(async (t: Track) => {
			if (t.uid === bad.uid) throw new Error('qq upstream 503');
			if (t.uid === good.uid) return { ...good, detailsLoaded: true, audioUrl: 'https://cdn/good.mp3' };
			return t;
		});

		await prefetch();
		await flush();

		// The walk advanced PAST the rejecting immediate-next to the next candidate.
		expect(mockEnsure).toHaveBeenCalledWith(bad, expect.any(AbortSignal));
		expect(mockEnsure).toHaveBeenCalledWith(good, expect.any(AbortSignal));
		// A reject is transient — bad is NOT marked dead (retried on demand) and is left untouched.
		expect(player.queue[1]).toBe(bad);
		expect(player.queue[1].audioUrl).toBeNull();
		expect(unplayable().has(bad.uid)).toBe(false);
		// The later playable candidate landed (pre-resolved + written back into its slot).
		expect(player.queue[2].audioUrl).toBe('https://cdn/good.mp3');
		expect(player.queue[2].detailsLoaded).toBe(true);
	});

	it('an immediate-next that resolves WITHOUT an audioUrl is STRIKED (not yet dead on the first failure) and the walk advances', async () => {
		// Over-aggressive-skip fix: a SINGLE definitive failure (no-url resolve) is now treated as
		// transient — it records a strike but is NOT promoted into unplayableUids until STRIKE_CAP. The
		// walk still advances past it this round (the "next song is always playable" guarantee holds),
		// but a once-failing track is not falsely sidelined for the whole session.
		const cur = mk('netease', '0', 'A', 'Now');
		const bad = stub('qq', '1', 'B', 'NoUrl'); // immediate-next: resolves but unplayable
		const good = stub('kuwo', '2', 'C', 'Good'); // later candidate — the walk MUST reach it
		player.queue = [cur, bad, good];
		player.current = cur;

		mockEnsure.mockImplementation(async (t: Track) => {
			if (t.uid === bad.uid) return { ...bad, detailsLoaded: true, audioUrl: null }; // resolved, no url
			if (t.uid === good.uid) return { ...good, detailsLoaded: true, audioUrl: 'https://cdn/good.mp3' };
			return t;
		});

		await prefetch();
		await flush();

		// Both resolved: bad first (struck, not yet dead), then the walk advanced to good.
		expect(mockEnsure).toHaveBeenCalledWith(bad, expect.any(AbortSignal));
		expect(mockEnsure).toHaveBeenCalledWith(good, expect.any(AbortSignal));
		// bad took ONE strike but is NOT yet in unplayableUids — retryable on demand (the fix).
		expect(player.queue[1]).toBe(bad);
		expect(player.queue[1].audioUrl).toBeNull();
		expect(unplayable().has(bad.uid)).toBe(false);
		// The later playable candidate landed.
		expect(player.queue[2].audioUrl).toBe('https://cdn/good.mp3');
		expect(player.queue[2].detailsLoaded).toBe(true);
	});

	it('writes nothing when current changes mid-resolve (single-candidate stale-guard)', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next');
		player.queue = [cur, next];
		player.current = cur;

		const d = deferred<Track>();
		mockEnsure.mockReturnValue(d.promise); // immediate-next resolve in flight

		void prefetch(); // seedUid = cur.uid

		// Current changes away mid-resolve → the result is now stale and must be discarded.
		player.current = mk('joox', '9', 'Z', 'Unrelated');
		d.resolve({ ...next, detailsLoaded: true, audioUrl: 'https://cdn/next.mp3' });
		await flush();

		// queue[1] untouched — the stale-guard after the await discarded the write.
		expect(mockEnsure).toHaveBeenCalledTimes(1);
		expect(player.queue[1]).toBe(next);
		expect(player.queue[1].audioUrl).toBeNull();
	});

	// RELAX-PREFETCH: the delayed trigger — prefetch is NOT fired on play() entry; it arms off the
	// timeupdate listener once the current src has actually played for ~PREFETCH_PLAYBACK_DELAY_MS,
	// one-shot per loaded src. Drive the REAL timeupdate gate via the attached fake audio element.
	it('does NOT prefetch before ~5s of playback; arms once at the threshold; does not re-fire for the same src', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next');
		player.queue = [cur, next];
		player.current = cur;
		mockEnsure.mockResolvedValue({ ...next, detailsLoaded: true, audioUrl: 'https://cdn/next.mp3' });

		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		// A fresh src loads → re-arm the one-shot gate (mirrors play()'s initial-load arming point).
		(player as unknown as { prefetchArmedForSrc: boolean }).prefetchArmedForSrc = false;

		// Below the threshold: a timeupdate must NOT trigger a prefetch resolve.
		el.currentTime = Player_PREFETCH_PLAYBACK_DELAY_MS / 1000 - 1; // 4s
		el.fire('timeupdate');
		await flush();
		expect(mockEnsure).not.toHaveBeenCalled();

		// Cross the threshold: exactly one prefetch resolve arms.
		el.currentTime = Player_PREFETCH_PLAYBACK_DELAY_MS / 1000; // 5s
		el.fire('timeupdate');
		await flush();
		expect(mockEnsure).toHaveBeenCalledTimes(1);
		expect(mockEnsure).toHaveBeenCalledWith(next, expect.any(AbortSignal));

		// A LATER timeupdate past the threshold (same src) must NOT re-fire — one-shot per src.
		el.currentTime = Player_PREFETCH_PLAYBACK_DELAY_MS / 1000 + 10; // 15s
		el.fire('timeupdate');
		await flush();
		expect(mockEnsure).toHaveBeenCalledTimes(1);
	});
});

// quick-260627-huo (HUO-RETRY): the user reported a genuinely-playable Next-up song being marked
// non-playable (a dimmed ✗ row) because TWO quick transient upstream blips reached STRIKE_CAP. The fix
// replaces "strike → promote to dead" with "strike → schedule a delayed fresh re-resolve → only
// promote to dead after the delayed re-resolves are exhausted". These fake-timer tests prove the
// delayed-retry recovery, the bounded promote-after-exhaustion, and that every armed timer is
// cancellable so nothing leaks across tracks/tests.
describe('player delayed re-resolve — transient next-up failure recovers without permanent skip', () => {
	const prefetch = () => (player as unknown as { prefetchNext(): Promise<void> })['prefetchNext']();
	const unplayable = () => (player as unknown as { unplayableUids: Set<string> }).unplayableUids;
	type RetryInternals = {
		retryResolveTimers: Map<string, ReturnType<typeof setTimeout>>;
		retryResolveAttempts: Map<string, number>;
	};
	const retry = () => player as unknown as RetryInternals;
	// Mirror of Player.RETRY_RESOLVE_MAX / RETRY_RESOLVE_DELAY_MS for driving the fake-timer clock.
	const Player_RETRY_RESOLVE_MAX = 2;
	const Player_RETRY_RESOLVE_DELAY_MS = 4000;

	beforeEach(() => {
		// Drive prefetchNext directly (private; play() is mocked) — no real <audio>, so probePlayable
		// degrades to {ok:true} (the asset Audio stub has no addEventListener). That means a NO-URL
		// resolve is the definitive-failure lever these tests pull (a hard probe error needs an
		// event-capable Audio, which the probePlayable suite already covers).
		mockEnsure.mockReset();
	});

	it('a no-url definitive failure schedules a delayed re-resolve instead of immediately marking dead; after the delay a fresh resolve returns a url and the candidate is NOT in unplayableUids', async () => {
		vi.useFakeTimers();
		try {
			const cur = mk('netease', '0', 'A', 'Now');
			const bad = stub('qq', '1', 'B', 'WasFlaky'); // genuinely playable, just blipping upstream
			const good = stub('kuwo', '2', 'C', 'Good');
			player.queue = [cur, bad, good];
			player.current = cur;

			// FIRST two resolves of `bad` blip (no url) so it reaches STRIKE_CAP; AFTER that a fresh
			// resolve returns a real url — the genuinely-playable song the user complained about.
			let badCalls = 0;
			mockEnsure.mockImplementation(async (t: Track) => {
				if (t.uid === bad.uid) {
					badCalls++;
					return badCalls <= 2
						? { ...bad, detailsLoaded: true, audioUrl: null } // transient blip
						: { ...bad, detailsLoaded: true, audioUrl: 'https://cdn/bad-now.mp3' }; // recovered
				}
				if (t.uid === good.uid) return { ...good, detailsLoaded: true, audioUrl: 'https://cdn/good.mp3' };
				return t;
			});

			// Drive the walk to STRIKE_CAP. Note: with fake timers, flush()'s own setTimeout(0) is a fake
			// timer — advance by 0 to drain the microtask-flush macrotask between/after the awaits.
			await prefetch();
			await vi.advanceTimersByTimeAsync(0);
			await prefetch();
			await vi.advanceTimersByTimeAsync(0);

			// Reached the cap → but NOT promoted to dead: a delayed re-resolve is armed instead (the fix).
			expect(unplayable().has(bad.uid)).toBe(false);
			expect(retry().retryResolveTimers.has(bad.uid)).toBe(true);
			expect(retry().retryResolveAttempts.get(bad.uid)).toBe(1);

			// A few seconds later the delayed re-resolve fires: clears the strike, re-runs the walk, the
			// now-playable song resolves with a url and lands in its slot — NEVER marked dead.
			await vi.advanceTimersByTimeAsync(Player_RETRY_RESOLVE_DELAY_MS);

			expect(unplayable().has(bad.uid)).toBe(false);
			// A fresh re-resolve for bad occurred (the 3rd+ call returns the recovered url).
			expect(badCalls).toBeGreaterThanOrEqual(3);
			expect(player.queue[1].audioUrl).toBe('https://cdn/bad-now.mp3');
			// The timer cleaned up after firing (no orphan).
			expect(retry().retryResolveTimers.has(bad.uid)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('a candidate that stays dead across all RETRY_RESOLVE_MAX delayed attempts is eventually promoted into unplayableUids (bounded — no infinite skip-stall)', async () => {
		vi.useFakeTimers();
		try {
			const cur = mk('netease', '0', 'A', 'Now');
			const bad = stub('qq', '1', 'B', 'TrulyDead'); // never resolves a url, ever
			player.queue = [cur, bad];
			player.current = cur;
			mockEnsure.mockImplementation(async (t: Track) => {
				if (t.uid === bad.uid) return { ...bad, detailsLoaded: true, audioUrl: null };
				return t;
			});

			// Round 0: drive to cap → schedules delayed attempt #1 (not yet dead).
			await prefetch();
			await vi.advanceTimersByTimeAsync(0);
			await prefetch();
			await vi.advanceTimersByTimeAsync(0);
			expect(unplayable().has(bad.uid)).toBe(false);
			expect(retry().retryResolveAttempts.get(bad.uid)).toBe(1);

			// Drive every delayed round. Each fires a re-resolve that re-strikes to cap; while budget
			// remains it re-schedules (with backoff), and on the final round it promotes to dead. Advance
			// generously past the longest backed-off delay (DELAY * MAX) to drain them all.
			await vi.advanceTimersByTimeAsync(Player_RETRY_RESOLVE_DELAY_MS * (Player_RETRY_RESOLVE_MAX + 2));

			// Bounded: budget fully consumed and the genuinely-dead track is finally promoted so
			// nextPlayableIndex routes past it and the ✗ row renders. No timer remains pending.
			expect(retry().retryResolveAttempts.get(bad.uid)).toBe(Player_RETRY_RESOLVE_MAX);
			expect(unplayable().has(bad.uid)).toBe(true);
			expect(retry().retryResolveTimers.has(bad.uid)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('clearQueue cancels pending delayed-retry timers and empties the attempt budget (no leak)', async () => {
		vi.useFakeTimers();
		try {
			const cur = mk('netease', '0', 'A', 'Now');
			const bad = stub('qq', '1', 'B', 'Flaky');
			player.queue = [cur, bad];
			player.current = cur;
			mockEnsure.mockImplementation(async (t: Track) =>
				t.uid === bad.uid ? { ...bad, detailsLoaded: true, audioUrl: null } : t
			);

			await driveToCapFake();
			expect(retry().retryResolveTimers.has(bad.uid)).toBe(true);

			player.clearQueue();

			expect(retry().retryResolveTimers.size).toBe(0);
			expect(retry().retryResolveAttempts.size).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('recoverFromStop cancels pending delayed-retry timers and empties the attempt budget (no leak)', async () => {
		vi.useFakeTimers();
		try {
			const cur = mk('netease', '0', 'A', 'Now');
			const bad = stub('qq', '1', 'B', 'Flaky');
			player.queue = [cur, bad];
			player.current = cur;
			mockEnsure.mockImplementation(async (t: Track) =>
				t.uid === bad.uid ? { ...bad, detailsLoaded: true, audioUrl: null } : t
			);

			await driveToCapFake();
			expect(retry().retryResolveTimers.has(bad.uid)).toBe(true);

			// recoverFromStop is private; drive it via the same bracket-access seam other suites use.
			(player as unknown as { recoverFromStop(): void })['recoverFromStop']();

			expect(retry().retryResolveTimers.size).toBe(0);
			expect(retry().retryResolveAttempts.size).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('retryUnplayable cancels a pending delayed retry for that uid (manual retry supersedes)', async () => {
		vi.useFakeTimers();
		try {
			const cur = mk('netease', '0', 'A', 'Now');
			const bad = stub('qq', '1', 'B', 'Flaky');
			player.queue = [cur, bad];
			player.current = cur;
			mockEnsure.mockImplementation(async (t: Track) =>
				t.uid === bad.uid ? { ...bad, detailsLoaded: true, audioUrl: null } : t
			);

			await driveToCapFake();
			expect(retry().retryResolveTimers.has(bad.uid)).toBe(true);

			player.retryUnplayable(bad);

			expect(retry().retryResolveTimers.has(bad.uid)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	// Local driveToCap that drains microtasks under fake timers (the suite-level driveToCap uses the
	// real-timer flush() which never settles while fake timers are installed).
	async function driveToCapFake() {
		await prefetch();
		await vi.advanceTimersByTimeAsync(0);
		await prefetch();
		await vi.advanceTimersByTimeAsync(0);
	}
});

// quick-260629-nyl Task 2: prefetchNext's two never-stop additions —
//  (2a) a probe TIMEOUT (transient, NOT a hard error) arms a delayed re-resolve via scheduleRetryResolve
//       instead of being skipped-and-forgotten, and the candidate is NOT marked dead (no ✗ row);
//  (2b) when the forward walk lands NO playable candidate (all ahead resolve with no url), prefetchNext
//       eagerly calls ensureAhead so the queue is extended (buildSimilarQueue → buildDiversePicks).
// Driving prefetchNext directly (private; play() is the top-level mock) keeps these unit-isolated.
describe('player.prefetchNext — never-stop (timeout retry + walk-exhaustion grow) [quick-260629-nyl]', () => {
	const prefetch = () => (player as unknown as { prefetchNext(): Promise<void> })['prefetchNext']();
	const unplayable = () => (player as unknown as { unplayableUids: Set<string> }).unplayableUids;
	const probe = () =>
		player as unknown as {
			probePlayable(url: string): Promise<{ ok: boolean; errored: boolean }>;
		};
	type RetryInternals = {
		retryResolveTimers: Map<string, ReturnType<typeof setTimeout>>;
		retryResolveAttempts: Map<string, number>;
	};
	const retry = () => player as unknown as RetryInternals;
	const Player_RETRY_RESOLVE_DELAY_MS = 4000;

	beforeEach(() => {
		mockEnsure.mockReset();
		mockSimilar.mockReset();
		mockPicks.mockReset();
	});

	it('(2a) a probe TIMEOUT on a Next-up candidate arms a delayed re-resolve and does NOT mark it dead', async () => {
		vi.useFakeTimers();
		// Stub probePlayable to a TIMEOUT verdict (ok:false, errored:false) — the transient class.
		const probeSpy = vi
			.spyOn(probe(), 'probePlayable')
			.mockResolvedValue({ ok: false, errored: false });
		try {
			const cur = mk('netease', '0', 'A', 'Now');
			const flaky = stub('qq', '1', 'B', 'TimesOutNowPlayableLater');
			player.queue = [cur, flaky];
			player.current = cur;

			let flakyCalls = 0;
			mockEnsure.mockImplementation(async (t: Track) => {
				if (t.uid === flaky.uid) {
					flakyCalls++;
					// Always resolves a URL — the failure is the (stubbed) probe TIMEOUT, not a no-url miss.
					return { ...flaky, detailsLoaded: true, audioUrl: 'https://cdn/flaky.mp3' };
				}
				return t;
			});

			await prefetch();
			await vi.advanceTimersByTimeAsync(0);

			// Transient timeout → NOT dead, but a delayed retry IS armed (the fix; previously a bare continue).
			expect(unplayable().has(flaky.uid)).toBe(false);
			expect(retry().retryResolveTimers.has(flaky.uid)).toBe(true);
			expect(retry().retryResolveAttempts.get(flaky.uid)).toBe(1);
			const callsBeforeDelay = flakyCalls;

			// After the delay the armed retry re-runs prefetchNext → a fresh resolve for the same uid.
			await vi.advanceTimersByTimeAsync(Player_RETRY_RESOLVE_DELAY_MS);
			expect(flakyCalls).toBeGreaterThan(callsBeforeDelay);
			// Still never promoted to dead across the transient-timeout path.
			expect(unplayable().has(flaky.uid)).toBe(false);
		} finally {
			probeSpy.mockRestore();
			vi.useRealTimers();
		}
	});

	it('(2b) when the forward walk lands NO playable candidate, prefetchNext eagerly extends the queue via ensureAhead', async () => {
		// No fake timers needed — the grow is awaited microtask work. The lone candidate ahead resolves
		// with NO url (definitive-failure path, not a timeout) so the walk lands nothing and falls out.
		// A SHORT tail (queue.length - indexOf(current) <= 2) is required for ensureAhead to actually
		// grow (its own guard) — exactly the consecutive-unplayable-near-the-end stall scenario.
		const cur = mk('netease', '0', 'A', 'Now');
		const d1 = stub('qq', '1', 'B', 'Dead1');
		player.queue = [cur, d1];
		player.current = cur;

		mockEnsure.mockImplementation(async (t: Track) => {
			if (t.uid === d1.uid) return { ...t, detailsLoaded: true, audioUrl: null };
			return t;
		});
		// ensureAhead seeds from buildSimilarQueue first; return a fresh related song so the grow appends.
		const grown = mk('netease', '99', 'A', 'Grown');
		mockSimilar.mockResolvedValue([grown]);
		mockPicks.mockResolvedValue([]);

		const startLen = player.queue.length;
		await prefetch();
		// Let ensureAhead's growPromise (a microtask chain) settle.
		await flush();

		// The exhausted walk eagerly grew the queue: ensureAhead → buildSimilarQueue was invoked and the
		// related song was appended so next()/track-end always has somewhere to advance.
		expect(mockSimilar).toHaveBeenCalled();
		expect(player.queue.length).toBeGreaterThan(startLen);
		expect(player.queue.some((t) => t.uid === grown.uid)).toBe(true);
	});
});

// quick-260627-huo (HUO-PREFETCH / HUO-NONSTOP): the immediate-next song must be pre-resolved +
// probe-verified BEFORE the current track ends — including for SHORT tracks / FAST skips that never
// cross the ~5s timeupdate prefetch gate. The fix fires an EAGER one-shot prefetchNext at play()'s
// src-set (not gated on 5s, NOT gated on the `playing` event — memory: that froze iOS). These tests
// use the REAL play() (restored from the global mock) + a fake <audio> so the src-set path runs.
// debug-song-click-lrc-flood-noplay (single-authority simplification): the EAGER prefetch-probe fire
// on every src-set was REMOVED — prefetch now runs ONLY via the timeupdate playback-elapsed gate (~5s
// into REAL playback). A track that never starts (the failure case) therefore never triggers the
// speculative probe/resolve walk that fed the api storm.
describe('player prefetch — timeupdate-gated single walk (eager on-every-src fire removed)', () => {
	let el: ReturnType<typeof makeFakeAudio>;
	// Spy on the private prefetchNext so we can count walks regardless of what they resolve.
	let prefetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		// Restore the REAL play() (the top-level beforeEach mocks it) so the eager src-set path executes.
		(player.play as unknown as { mockRestore(): void }).mockRestore?.();
		mockEnsure.mockReset();
		player.current = null;
		player.queue = [];
		player.error = null;
		player.loading = false;
		// Online + a minimal Media Session surface (attach wires transport handlers) so play() runs
		// headless without the offline gate or a null-deref.
		vi.stubGlobal('navigator', {
			onLine: true,
			mediaSession: { metadata: null, playbackState: 'none', setPositionState() {}, setActionHandler() {} }
		});
		vi.stubGlobal('MediaMetadata', FakeMediaMetadata);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
		vi.spyOn(library, 'adoptCover').mockImplementation(() => {});
		el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		// Spy on prefetchNext AFTER attach so we count only play()-driven walks. Keep the real impl so
		// prefetchArmedForSrc dedupe + the actual resolve still happen.
		prefetchSpy = vi.spyOn(
			player as unknown as { prefetchNext(): Promise<void> },
			'prefetchNext'
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const armedForSrc = () =>
		(player as unknown as { prefetchArmedForSrc: boolean }).prefetchArmedForSrc;

	it('play() does NOT prefetch at src-set — the eager on-every-src walk was removed (failure case never probes)', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next');
		player.queue = [cur, next];
		// A non-fresh play (no regenerate/weave) isolates the src-set path. play() resolves `cur` itself.
		mockEnsure.mockImplementation(async (t: Track) => {
			if (t.uid === next.uid) return { ...next, detailsLoaded: true, audioUrl: 'https://cdn/next.mp3' };
			return { ...t, detailsLoaded: true };
		});

		// currentTime stays 0 — NO timeupdate fired. With the eager fire removed, prefetch must NOT run:
		// a track that never crosses the ~5s playback gate (incl. one that fails to start) does no walk.
		await player.play(cur, { fresh: false });
		await flush();

		expect(prefetchSpy).not.toHaveBeenCalled();
		expect(armedForSrc()).toBe(false); // still disarmed — the timeupdate gate has not fired
		expect(el.currentTime).toBe(0);
	});

	it('the timeupdate gate fires exactly ONE walk once the src crosses the ~5s elapsed threshold', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next');
		player.queue = [cur, next];
		mockEnsure.mockImplementation(async (t: Track) => {
			if (t.uid === next.uid) return { ...next, detailsLoaded: true, audioUrl: 'https://cdn/next.mp3' };
			return { ...t, detailsLoaded: true };
		});

		await player.play(cur, { fresh: false });
		await flush();
		expect(prefetchSpy).not.toHaveBeenCalled(); // nothing eager

		// Cross the 5s gate and fire timeupdate → the single prefetch walk arms + runs.
		el.currentTime = Player_PREFETCH_PLAYBACK_DELAY_MS / 1000 + 1; // 6s
		el.fire('timeupdate');
		await flush();
		expect(prefetchSpy).toHaveBeenCalledTimes(1);
		expect(armedForSrc()).toBe(true);
		expect(player.queue[1].audioUrl).toBe('https://cdn/next.mp3'); // immediate-next pre-resolved

		// A second timeupdate for the SAME src is a no-op (prefetchArmedForSrc dedupe) — one walk per src.
		el.currentTime += 1;
		el.fire('timeupdate');
		await flush();
		expect(prefetchSpy).toHaveBeenCalledTimes(1);
	});
});

// debug-song-click-lrc-flood-noplay: the SINGLE audio.src AUTHORITY. The "api loop hell" was the SAME
// track's src re-driven in a tight loop — `<audio>` `(cancels)` the prior load before firing `error`,
// so the error-based ceiling never engaged and the flood was unbounded. driveSrc() brakes a rapid
// same-uid re-drive → STOP (sticky Retry), while distinct uids (normal fast-skipping) never trip it.
describe('player single audio.src authority — re-drive brake (debug-song-click-lrc-flood-noplay)', () => {
	const CAP = 4; // mirror Player.SRC_REDRIVE_CAP
	const drive = (uid: string, url: string) =>
		(player as unknown as { driveSrc(u: string, x: string): boolean }).driveSrc(uid, url);

	beforeEach(() => {
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		player.notice = null;
		player.error = null;
		const p = player as unknown as { driveBurst: number; lastDriveUid: string | null };
		p.driveBurst = 0;
		p.lastDriveUid = null;
	});

	it('brakes a rapid SAME-uid re-drive storm → STOP (sticky Retry notice), and returns false', () => {
		let braked = false;
		for (let i = 0; i < CAP + 1; i++) {
			if (!drive('netease:299942', 'https://cdn.example/299942.mp3')) braked = true;
		}
		expect(braked).toBe(true); // the storm was cut off, not left to flood
		expect(player.notice?.kind).toBe('stopped');
		expect(player.notice?.reason).toBe('loop-guard');
	});

	it('distinct uids (normal fast-skipping through songs) never trip the brake', () => {
		let allSet = true;
		for (let i = 0; i < CAP + 3; i++) {
			if (!drive(`netease:${i}`, `https://cdn.example/${i}.mp3`)) allSet = false;
		}
		expect(allSet).toBe(true); // every distinct-track src was attached
		expect(player.notice?.kind).not.toBe('stopped');
	});

	it('a real `playing` resets the brake so a later re-drive of the same track is not falsely stopped', () => {
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		player.current = mk('netease', '299942', '王菲', '原谅自己');
		// Drive up to just under the cap, then a real `playing` (output = not looping) resets the burst.
		for (let i = 0; i < CAP - 1; i++) drive('netease:299942', 'https://cdn.example/299942.mp3');
		el.fire('playing');
		let braked = false;
		for (let i = 0; i < CAP - 1; i++) {
			if (!drive('netease:299942', 'https://cdn.example/299942.mp3')) braked = true;
		}
		expect(braked).toBe(false); // the reset prevented a false STOP after real playback
	});
});

describe('player repeat — 2-state (PLAY-10)', () => {
	// Seed the persisted player-state blob the way persist() writes it: a serialized `current`
	// with a real uid (restore early-returns without one), an empty queue, and the target
	// repeatMode. restore() then resolves the track via the mocked ensureTrackDetails so it
	// doesn't hang on the network — and audio is null in node, so restore returns right after
	// the repeatMode migration assignment we're asserting.
	const STATE_KEY = 'openmusic:player:v1';
	function seedState(repeatMode: 'off' | 'one' | 'all' | undefined) {
		const cur = mk('netease', 'r1', 'Artist', 'Title');
		const payload: Record<string, unknown> = {
			v: 1,
			current: {
				uid: cur.uid,
				source: cur.source,
				songid: cur.songid,
				title: cur.title,
				artist: cur.artist,
				album: cur.album,
				cover: cur.cover,
				quality: cur.quality,
				qualityLabel: cur.qualityLabel,
				keyword: cur.keyword,
				displayIndex: cur.displayIndex
			},
			queue: [],
			currentTime: 0,
			shuffle: false
		};
		if (repeatMode !== undefined) payload.repeatMode = repeatMode;
		localStorage.setItem(STATE_KEY, JSON.stringify(payload));
		// ensureTrackDetails is awaited inside restore(); resolve a complete track so it settles.
		mockEnsure.mockResolvedValue(mk('netease', 'r1', 'Artist', 'Title'));
	}

	beforeEach(() => {
		player.repeatMode = 'off';
	});

	it("cycleRepeat from 'off' yields 'one'", () => {
		player.repeatMode = 'off';
		player.cycleRepeat();
		expect(player.repeatMode).toBe('one');
	});

	it("cycleRepeat from 'one' yields 'off' (never 'all')", () => {
		player.repeatMode = 'one';
		player.cycleRepeat();
		expect(player.repeatMode).toBe('off');
	});

	it("cycleRepeat is a strict 2-state toggle (off→one→off→one)", () => {
		player.repeatMode = 'off';
		player.cycleRepeat();
		expect(player.repeatMode).toBe('one');
		player.cycleRepeat();
		expect(player.repeatMode).toBe('off');
		player.cycleRepeat();
		expect(player.repeatMode).toBe('one');
	});

	it("restore() with persisted repeatMode 'all' migrates to 'off' (D-11)", async () => {
		seedState('all' as 'off');
		await player.restore();
		expect(player.repeatMode).toBe('off');
	});

	it("restore() with persisted repeatMode 'one' stays 'one'", async () => {
		seedState('one');
		await player.restore();
		expect(player.repeatMode).toBe('one');
	});

	it("restore() with missing repeatMode defaults to 'off'", async () => {
		seedState(undefined);
		await player.restore();
		expect(player.repeatMode).toBe('off');
	});

	it('next() at end-of-queue does NOT wrap to queue[0]; it grows via ensureAhead (no repeat-all path)', async () => {
		const a = mk('netease', 'qa', 'A', 'First');
		const b = mk('qq', 'qb', 'B', 'Last');
		player.queue = [a, b];
		player.current = b; // current is the last entry → end of queue
		// Even if a stale 'all' value were somehow present, there is no wrap branch any more.
		(player as unknown as { repeatMode: string }).repeatMode = 'off';

		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();

		player.next();
		await flush();

		// next() must NOT have played queue[0] (the removed repeat-all wrap). The end-of-queue
		// path is solely ensureAhead().then(...); with sources dry/empty it adds nothing and the
		// post-grow advance finds no next track, so play() is never called with queue[0].
		expect(playSpy).not.toHaveBeenCalledWith(a);
	});
});

// quick-260630-q03 changed the never-stop contract: a known-dead up-next is no longer skipped
// outright — it is RETRIED ONCE on advance (a transient probe failure recovers), and only routed
// past / grown once that one retry has been spent. These two tests assert the new behavior.
describe('player.next() — never-stop: retries a dead up-next ONCE, then routes past / grows (PLAY-RESILIENCE)', () => {
	const markDead = (uid: string) =>
		(player as unknown as { unplayableUids: Set<string> }).unplayableUids.add(uid);

	it('retries a known-dead immediate-next ONCE, then routes past it to the next playable entry', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const dead = mk('qq', '1', 'B', 'Dead'); // probe-confirmed unplayable
		const good = mk('kuwo', '2', 'C', 'Good');
		player.queue = [cur, dead, good];
		player.current = cur;
		markDead(dead.uid);

		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();

		player.next(); // never-stop: give the dead immediate-next its ONE retry first
		await flush();
		expect(playSpy).toHaveBeenCalledWith(dead, { fresh: false });

		// The retry failed (re-marked dead) → the next advance now routes PAST it to the playable entry.
		markDead(dead.uid);
		player.next();
		await flush();
		expect(playSpy).toHaveBeenCalledWith(good);
	});

	it('with the whole tail dead it RETRIES the dead track once, then grows via ensureAhead (never silently no-ops)', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const dead = mk('qq', '1', 'B', 'Dead');
		player.queue = [cur, dead];
		player.current = cur;
		markDead(dead.uid);

		const ensureSpy = vi.spyOn(
			player as unknown as { ensureAhead(): Promise<void> },
			'ensureAhead'
		);
		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();

		player.next(); // first: retry the dead track in place (NOT a grow yet)
		await flush();
		expect(playSpy).toHaveBeenCalledWith(dead, { fresh: false });
		expect(ensureSpy).not.toHaveBeenCalled();

		// Retry failed → dead re-marked AND now already-retried → no in-queue candidate remains, so the
		// next advance grows instead of stalling on the dead tail.
		markDead(dead.uid);
		ensureSpy.mockClear();
		player.next();
		await flush();
		expect(ensureSpy).toHaveBeenCalled();
	});
});

describe('player.probePlayable — silent ~1s muted test-play (PLAY-RESILIENCE)', () => {
	const probe = (url: string) =>
		(player as unknown as { probePlayable(u: string): Promise<{ ok: boolean; errored: boolean }> })[
			'probePlayable'
		](url);

	// Event-capable Audio stub (the asset-warming mock has no addEventListener, so the probe degrades
	// to ok there; here we drive canplay/error/timeout explicitly). addEventListener on the prototype
	// satisfies probePlayable's capability gate.
	class ProbeAudio {
		muted = false;
		preload = '';
		src = '';
		static last: ProbeAudio | null = null;
		private listeners: Record<string, Array<() => void>> = {};
		setAttribute() {}
		removeAttribute() {}
		load() {}
		pause() {}
		play() {
			return Promise.resolve();
		}
		addEventListener(ev: string, cb: () => void) {
			(this.listeners[ev] ||= []).push(cb);
			ProbeAudio.last = this;
		}
		removeEventListener(ev: string, cb: () => void) {
			this.listeners[ev] = (this.listeners[ev] ?? []).filter((f) => f !== cb);
		}
		fire(ev: string) {
			(this.listeners[ev] ?? []).forEach((f) => f());
		}
	}

	beforeEach(() => {
		ProbeAudio.last = null;
		vi.stubGlobal('Audio', ProbeAudio);
	});

	it('resolves {ok:true} on canplay', async () => {
		const p = probe('https://cdn/ok.mp3');
		ProbeAudio.last?.fire('canplay');
		await expect(p).resolves.toEqual({ ok: true, errored: false });
		expect(ProbeAudio.last?.muted).toBe(true); // muted test-play — never audible
		expect(ProbeAudio.last?.src).toBe('https://cdn/ok.mp3');
	});

	it('resolves {ok:false, errored:true} on a hard error (caller marks the track dead)', async () => {
		const p = probe('https://cdn/dead.mp3');
		ProbeAudio.last?.fire('error');
		await expect(p).resolves.toEqual({ ok: false, errored: true });
	});

	it('resolves {ok:false, errored:false} on timeout (transient — NOT marked dead)', async () => {
		vi.useFakeTimers();
		try {
			const p = probe('https://cdn/slow.mp3');
			vi.advanceTimersByTime(2000); // past PROBE_TIMEOUT_MS (1500)
			await expect(p).resolves.toEqual({ ok: false, errored: false });
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('player resilience — loop-guard + skip-on-failure (PLAY-07/08)', () => {
	// runFallback is private + driven by the audio `error` path in production; drive it directly
	// (bracket access) with tryFallback mocked to null = "all sources exhausted for this song".
	const runFallback = (failed: Track) =>
		(player as unknown as { runFallback(f: Track): Promise<void> })['runFallback'](failed);
	// Internal counter for asserting the increment/reset behavior (it's a private loop-guard budget).
	const failures = () => (player as unknown as { consecutiveFailures: number })['consecutiveFailures'];
	const setFailures = (n: number) => {
		(player as unknown as { consecutiveFailures: number })['consecutiveFailures'] = n;
	};
	// SYSTEMIC-FAILURE STOP ceiling (debug-nowbar-frozen-audius-spam): the cross-track skip counter.
	const setFailoverSkips = (n: number) => {
		(player as unknown as { failoverSkips: number })['failoverSkips'] = n;
	};

	beforeEach(() => {
		mockTryFallback.mockReset();
		mockTryFallback.mockResolvedValue(null); // every source exhausted → total failure
		setFailures(0);
		setFailoverSkips(0); // persists on the singleton across tests — reset so a leak can't early-trip

		// Reset the skip-burst batch state (private; persists on the singleton across tests).
		const p = player as unknown as {
			skipBurst: number;
			skipBurstTimer: ReturnType<typeof setTimeout> | null;
		};
		if (p.skipBurstTimer) clearTimeout(p.skipBurstTimer);
		p.skipBurst = 0;
		p.skipBurstTimer = null;
		player.notice = null;
		player.repeatMode = 'off';
		player.current = null;
		player.queue = [];
		// online by default so the offline gate (Task 3) does not short-circuit these tests.
		vi.stubGlobal('navigator', { onLine: true });
	});

	it('below the cap: increments the counter, emits a skip notice, and calls next()', async () => {
		const a = mk('netease', 'a', 'A', 'Dead Song');
		const b = mk('qq', 'b', 'B', 'Next Song');
		player.queue = [a, b];
		player.current = a;
		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();

		await runFallback(a);
		await flush();

		expect(failures()).toBe(1);
		expect(player.notice?.kind).toBe('skip');
		expect(player.notice?.count).toBe(1);
		expect(player.notice?.title).toBe('Dead Song');
		// next() auto-skipped to queue[1].
		expect(playSpy).toHaveBeenCalledWith(b);
	});

	it('batches consecutive skips into one notice with a rising count (D-02)', async () => {
		const a = mk('netease', 'a', 'A', 'One');
		const b = mk('qq', 'b', 'B', 'Two');
		player.queue = [a, b];
		player.current = a;

		await runFallback(a);
		await runFallback(b);
		await flush();

		expect(failures()).toBe(2);
		expect(player.notice?.kind).toBe('skip');
		expect(player.notice?.count).toBe(2); // collapsed, not two separate notices
	});

	it('SYSTEMIC STOP: at the skip cap it halts (pause + sticky Retry notice), does NOT advance, and aborts prefetch', async () => {
		// debug-nowbar-frozen-audius-spam: N distinct tracks failing back-to-back is a systemic outage —
		// keep skipping and the never-stop chain spams /api/* (resolve + 8× similar-search per cycle) until
		// the pool saturates and the app freezes. The failoverSkips ceiling STOPS instead of advancing.
		const a = mk('netease', 'a', 'A', 'Dead');
		const b = mk('qq', 'b', 'B', 'Next');
		player.queue = [a, b];
		player.current = a;
		setFailoverSkips(Player_SYSTEMIC_SKIP_CAP - 1); // one more failover trips the ceiling
		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();
		// A live prefetch controller must be aborted by the halt so no further resolves fire.
		const aborted = { value: false };
		(player as unknown as { prefetchController: AbortController | null }).prefetchController = {
			abort: () => {
				aborted.value = true;
			}
		} as unknown as AbortController;

		await runFallback(a);
		await flush();

		expect(player.notice?.kind).toBe('stopped');
		expect(player.notice?.reason).toBe('loop-guard');
		expect(typeof player.notice?.action).toBe('function');
		expect(player.error).toBeTruthy(); // inline now-bar error still set
		expect(playSpy).not.toHaveBeenCalled(); // STOP — no advance into another resolve burst
		expect(aborted.value).toBe(true); // in-flight prefetch cut off — no more /api/* fetches
	});

	it('SYSTEMIC STOP Retry: resets the ceiling, clears the notice, and skips AHEAD (D-05)', async () => {
		const a = mk('netease', 'a', 'A', 'Dead');
		const b = mk('qq', 'b', 'B', 'Next');
		player.queue = [a, b];
		player.current = a;
		setFailoverSkips(Player_SYSTEMIC_SKIP_CAP - 1);
		await runFallback(a);
		await flush();
		expect(player.notice?.kind).toBe('stopped');

		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();
		player.notice?.action?.(); // user taps Retry
		await flush();

		expect(failures()).toBe(0); // consecutive-failure budget reset
		expect(player.notice).toBeNull(); // sticky notice cleared
		expect(playSpy).toHaveBeenCalledWith(b); // skipped AHEAD to the next track, not retry-current
	});

	it('a real `playing` event resets the counter and clears a stopped notice (D-06)', () => {
		setFailures(3);
		player.notice = { kind: 'stopped', reason: 'loop-guard', msg: 'toast.playbackStopped' };
		// Simulate the audio element firing `playing` by invoking the bound listener via a fake element.
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		el.fire('playing');

		expect(failures()).toBe(0);
		expect(player.notice).toBeNull();
	});

	it('CR-01: the `play` event alone does NOT reset the counter (it fires before audio loads)', () => {
		setFailures(3);
		player.notice = { kind: 'stopped', reason: 'loop-guard', msg: 'toast.playbackStopped' };
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		// `play` fires the instant audio.play() is called, before any byte loads — it must NOT be
		// treated as a success. Only `playing` (real output) resets the loop-guard budget.
		el.fire('play');

		expect(failures()).toBe(3); // untouched by `play`
		expect(player.notice?.kind).toBe('stopped'); // sticky notice survives a bare `play`
	});

	// it('CR-01: error-event failures still reach the cap even when each play fires a `play` event', async () => {
	// 	// Regression for the dominant failure mode: a URL resolves but the <audio> errors. Each
	// 	// auto-skip's play() fires `play` instantly; before the fix that reset consecutiveFailures
	// 	// 0↔1 forever and the cap of 5 was unreachable. With the fix, `play` no longer resets, so a
	// 	// run of total failures (tryFallback → null) climbs to the cap and trips the loop-guard.
	// 	const dead = mk('netease', 'dead', 'A', 'Region Locked');
	// 	player.queue = [dead];
	// 	player.current = dead;
	// 	const el = makeFakeAudio();
	// 	player.attach(el as unknown as HTMLAudioElement);

	// 	// Simulate FAILURE_CAP consecutive failures, each preceded by a bare `play` event (the
	// 	// transport flipped to playing) but NO `playing` event (audio never actually started).
	// 	for (let i = 0; i < Player_FAILURE_CAP; i++) {
	// 		el.fire('play'); // transport intent — must not reset the counter
	// 		await runFallback(dead); // tryFallback → null → handleTotalFailure increments
	// 		await flush();
	// 	}

	// 	expect(failures()).toBe(Player_FAILURE_CAP);
	// 	expect(player.notice?.kind).toBe('stopped');
	// 	expect(player.notice?.reason).toBe('loop-guard');
	// });

	// it('CR-03: a resolve-but-unplayable ping-pong (tryFallback keeps succeeding) trips the cap via errorBurst', async () => {
	// 	// The audio `error` listener routes into runFallback; tryFallback keeps "succeeding"
	// 	// (resolving a swap whose URL also 403s), so handleTotalFailure NEVER runs and
	// 	// consecutiveFailures stays 0 — the classic unbounded loop. The errorBurst backstop counts
	// 	// raw error events and trips the loop-guard at the cap regardless. play() is the global
	// 	// mock, so the swap never fires a real `playing` (errorBurst is never reset).
	// 	const a = mk('netease', 'a', 'A', 'Pingpong');
	// 	const swap = mk('qq', 'a2', 'A', 'Pingpong'); // same song, different (also-dead) source
	// 	mockTryFallback.mockResolvedValue(swap); // ALWAYS finds a resolvable-but-unplayable source
	// 	player.queue = [a];
	// 	player.current = a;
	// 	const el = makeFakeAudio();
	// 	player.attach(el as unknown as HTMLAudioElement);
	// 	// lastSeekAt defaults to 0, so Date.now()-lastSeekAt ≫ SEEK_ERROR_WINDOW_MS → the error
	// 	// takes the non-seek cross-source branch (not reresolveCurrent).

	// 	const errorBurst = () => (player as unknown as { errorBurst: number })['errorBurst'];

		// Fire FAILURE_CAP error events outside the seek window. Each increments errorBurst; the
		// Nth (== cap) routes straight into handleTotalFailure (the loop-guard) instead of yet
		// another fallback.
		// for (let i = 0; i < Player_FAILURE_CAP; i++) {
		// 	el.fire('error');
		// 	await flush();
		// }

	// 	expect(player.notice?.kind).toBe('stopped');
	// 	expect(player.notice?.reason).toBe('loop-guard');
	// 	expect(errorBurst()).toBe(0); // reset after tripping the guard

	// 	mockTryFallback.mockResolvedValue(null); // restore the suite default
	// });

	it('repeat-one breaks to off on a failing loop before skipping (D-12)', async () => {
		const a = mk('netease', 'a', 'A', 'Looping Dead');
		const b = mk('qq', 'b', 'B', 'Next');
		player.queue = [a, b];
		player.current = a;
		player.repeatMode = 'one';

		await runFallback(a);
		await flush();

		expect(player.repeatMode).toBe('off'); // never-stop wins over explicit repeat
		expect(player.notice?.kind).toBe('skip');
	});
});

describe('player resilience — stall watchdog (PLAY-07 / D-13/D-14)', () => {
	// armStall/disarmStall are private; drive them directly + observe via a runFallback spy.
	const armStall = () => (player as unknown as { armStall(): void })['armStall']();
	const setPlayed = (v: boolean) => {
		(player as unknown as { hasPlayedSinceSrc: boolean })['hasPlayedSinceSrc'] = v;
	};
	let runFallbackSpy: ReturnType<typeof vi.spyOn>;
	let reresolveSpy: ReturnType<typeof vi.spyOn>;
	let stallEl: ReturnType<typeof makeFakeAudio>;

	beforeEach(() => {
		vi.useFakeTimers();
		player.current = mk('netease', 's', 'A', 'Stalling');
		player.queue = [player.current];
		setPlayed(false);
		// bg-lockscreen-stall-noskip: the stall watchdog now routes through recoverLoadStall (retry the
		// SAME song ONCE via reresolveCurrent, then SKIP on a second stall) instead of straight to
		// runFallback. Attach a NO-BYTES fake audio (readyState 0, paused) so recoverLoadStall reaches
		// the retry branch, and reset the one-shot per-src stall-retry flag so the first stall retries.
		stallEl = makeFakeAudio();
		stallEl.readyState = 0;
		stallEl.paused = true;
		player.attach(stallEl as unknown as HTMLAudioElement);
		(player as unknown as { stallRetried: boolean })['stallRetried'] = false;
		(player as unknown as { deliberatePause: boolean })['deliberatePause'] = false; // recoverLoadStall bails on a user pause
		runFallbackSpy = vi
			.spyOn(player as unknown as { runFallback(f: Track): Promise<void> }, 'runFallback')
			.mockResolvedValue(undefined);
		reresolveSpy = vi
			.spyOn(player as unknown as { reresolveCurrent(): Promise<void> }, 'reresolveCurrent')
			.mockResolvedValue(undefined);
	});

	afterEach(() => {
		(player as unknown as { disarmStall(): void })['disarmStall']();
		vi.useRealTimers();
	});

	it('after src-set with no audio, the stall watchdog RETRIES the same song ONCE (bg-lockscreen-stall-noskip)', () => {
		armStall();
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		// First stall on this src → retry the SAME song once (fresh URL + re-attach), NOT cross-source.
		expect(reresolveSpy).toHaveBeenCalledTimes(1);
		expect(runFallbackSpy).not.toHaveBeenCalled();
	});

	it('a SECOND stall after the one retry SKIPS to the next track — retry-once-then-skip (never stops)', () => {
		const next = mk('qq', 's2', 'B', 'Next');
		player.queue = [player.current as Track, next];
		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear?.();
		armStall();
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS); // 1st stall → retry the same song
		armStall();
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS); // 2nd stall, still no `playing` → SKIP
		expect(reresolveSpy).toHaveBeenCalledTimes(1); // retried exactly once, not again
		expect(playSpy).toHaveBeenCalledWith(next); // advanced to the next track
		expect(runFallbackSpy).not.toHaveBeenCalled();
	});

	it('a timeupdate before the timeout disarms the watchdog (no failover)', () => {
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		armStall();
		// Audio starts producing — the first timeupdate disarms.
		el.fire('timeupdate');
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		expect(runFallbackSpy).not.toHaveBeenCalled();
	});

	it('a playing event before the timeout disarms the watchdog (no failover)', () => {
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		armStall();
		el.fire('playing');
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		expect(runFallbackSpy).not.toHaveBeenCalled();
	});

	it('CR-01: a bare `play` event does NOT disarm the watchdog (it precedes real audio)', () => {
		armStall();
		// `play` is transport intent, not real output — the watchdog must still fire if no audio
		// (`playing`/`timeupdate`) follows within the timeout. It now retries the same song once.
		stallEl.fire('play');
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		expect(reresolveSpy).toHaveBeenCalledTimes(1);
	});

	it('does NOT fail over when hasPlayedSinceSrc is true at fire time (mid-track buffer-dry, D-14)', () => {
		armStall();
		setPlayed(true); // audio already played — a later buffer stall is NOT a load failure
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		expect(runFallbackSpy).not.toHaveBeenCalled();
	});

	it('WR-05: an explicit pause during initial load disarms the watchdog (no auto-failover)', () => {
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		armStall();
		// User taps pause within the 15s initial-load window — opting out of this load. The
		// watchdog must NOT, 15s later, runFallback → play(swap) and start audio over the pause.
		el.fire('pause');
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		expect(runFallbackSpy).not.toHaveBeenCalled();
	});
});

describe('player resilience — offline gate + downloads switch (PLAY-09 / D-07/D-08)', () => {
	const runFallback = (failed: Track) =>
		(player as unknown as { runFallback(f: Track): Promise<void> })['runFallback'](failed);
	const failures = () => (player as unknown as { consecutiveFailures: number })['consecutiveFailures'];
	const setFailures = (n: number) => {
		(player as unknown as { consecutiveFailures: number })['consecutiveFailures'] = n;
	};

	beforeEach(() => {
		mockTryFallback.mockReset();
		mockTryFallback.mockResolvedValue(null);
		setFailures(0);
		player.notice = null;
		player.error = null;
		player.current = null;
		player.queue = [];
		library.downloads = [];
		// Offline for this block.
		vi.stubGlobal('navigator', { onLine: false });
	});

	afterEach(() => {
		library.downloads = [];
		// IN-02: the top-level afterEach unstubs navigator globally — no need to re-stub onLine:true
		// here (which would itself leave a lingering stub).
	});

	it('offline: does NOT call tryFallback and does NOT increment the counter (D-08)', async () => {
		const a = mk('netease', 'a', 'A', 'Song');
		player.queue = [a];
		player.current = a;

		await runFallback(a);
		await flush();

		expect(mockTryFallback).not.toHaveBeenCalled();
		expect(failures()).toBe(0); // offline ≠ failure — the loop-guard budget is untouched
	});

	it('offline WITH downloads: switches up-next to downloads and continues playing (D-07)', async () => {
		const a = mk('netease', 'a', 'A', 'Failed');
		const dl1 = mk('qq', 'd1', 'D1', 'Downloaded One');
		const dl2 = mk('kuwo', 'd2', 'D2', 'Downloaded Two');
		player.queue = [a];
		player.current = a;
		library.downloads = [dl1, dl2];

		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();

		await runFallback(a);
		await flush();

		// First downloaded track is played; the queue now holds the downloads.
		expect(playSpy).toHaveBeenCalledWith(dl1);
		expect(player.queue.some((t) => t.uid === dl1.uid)).toBe(true);
		expect(failures()).toBe(0); // still no counter burn
	});

	it('offline with NO downloads: pauses + sets a sticky offline notice (D-08)', async () => {
		const a = mk('netease', 'a', 'A', 'Failed');
		player.queue = [a];
		player.current = a;
		library.downloads = [];

		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();

		await runFallback(a);
		await flush();

		expect(playSpy).not.toHaveBeenCalled();
		expect(player.notice?.kind).toBe('stopped');
		expect(player.notice?.reason).toBe('offline');
		expect(player.error).toBeTruthy();
		expect(failures()).toBe(0);
	});
});

describe('player.play — generation guard against stale slow resolves (CR-02)', () => {
	// These exercise the REAL play() (the global beforeEach spies it; we restore the original
	// here so the generation re-checks actually run). ensureTrackDetails is mocked with deferred
	// promises so we control settle order: a slow play(A) and a fast play(B), then settle A LAST.
	let el: ReturnType<typeof makeFakeAudio>;

	beforeEach(() => {
		(player.play as unknown as { mockRestore(): void }).mockRestore?.();
		mockEnsure.mockReset();
		player.current = null;
		player.queue = [];
		player.error = null;
		player.loading = false;
		vi.stubGlobal('navigator', { onLine: true });
		el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		// Downloaded-lookup off so play() takes the network/CDN branch (no IDB).
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('a slow play(A) that settles AFTER a fast play(B) is discarded — current + src stay on B', async () => {
		const stubA = stub('netease', 'A', 'Artist A', 'Song A');
		const stubB = stub('qq', 'B', 'Artist B', 'Song B');
		const resolvedA: Track = { ...mk('netease', 'A', 'Artist A', 'Song A'), audioUrl: 'https://cdn/a.mp3' };
		const resolvedB: Track = { ...mk('qq', 'B', 'Artist B', 'Song B'), audioUrl: 'https://cdn/b.mp3' };

		const dA = deferred<Track>();
		const dB = deferred<Track>();
		// First ensureTrackDetails call (A) gets the slow deferred; second (B) the fast one.
		mockEnsure.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);

		void player.play(stubA); // gen → 1, awaits A's slow resolve
		void player.play(stubB); // gen → 2, supersedes A

		// B resolves first and starts playing.
		dB.resolve(resolvedB);
		await flush();
		expect(player.current?.uid).toBe(resolvedB.uid);
		expect(el.src).toBe('https://cdn/b.mp3');

		// A's slow resolve settles LAST — its continuation must bail on the gen re-check and NOT
		// clobber current/src with the stale, earlier-tapped track.
		dA.resolve(resolvedA);
		await flush();
		expect(player.current?.uid).toBe(resolvedB.uid); // still B — A discarded
		expect(el.src).toBe('https://cdn/b.mp3');
	});
});

describe('player.resolvedCover — single-field artwork guarantee (COVER-01 / D-09)', () => {
	// resolvedCover is the ONE field that NowPlaying, Nowbar, and MediaSession all read (D-09). On
	// play() entry it is set SYNCHRONOUSLY from track.cover ?? uid-cache ?? name-cache ?? null; on a
	// total sync miss the Plan-02 single-item resolve helper runs and, generation-guarded, sets it +
	// re-fires MediaSession metadata via a NEW MediaMetadata object (Pitfall 4). A fake MediaSession
	// + MediaMetadata global (absent in node) lets us assert the OS-art repaint.
	let el: ReturnType<typeof makeFakeAudio>;
	// Records every MediaMetadata constructed so a test can assert a FRESH object was assigned.
	let metadataLog: Array<{ artwork: unknown[] }>;
	let fakeMediaSession: {
		metadata: unknown;
		playbackState: string;
		setPositionState: () => void;
		setActionHandler: () => void;
	};

	beforeEach(() => {
		(player.play as unknown as { mockRestore(): void }).mockRestore?.();
		mockEnsure.mockReset();
		mockUidCover.mockReset().mockReturnValue(null);
		mockNameCover.mockReset().mockReturnValue(null);
		mockResolveCover.mockReset().mockResolvedValue(null);
		player.current = null;
		player.queue = [];
		player.error = null;
		player.loading = false;
		(player as unknown as { resolvedCover: string | null }).resolvedCover = null;

		metadataLog = [];
		coverMetadataSink = metadataLog; // point the module-level FakeMediaMetadata at this run's log
		fakeMediaSession = {
			metadata: null,
			playbackState: 'none',
			setPositionState: () => {},
			setActionHandler: () => {} // attach() wires transport handlers — accept + ignore them
		};
		vi.stubGlobal('navigator', { onLine: true, mediaSession: fakeMediaSession });
		vi.stubGlobal('MediaMetadata', FakeMediaMetadata);
		el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
		vi.spyOn(library, 'adoptCover').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const rc = () => (player as unknown as { resolvedCover: string | null }).resolvedCover;

	it('sets resolvedCover === track.cover SYNCHRONOUSLY on play() entry (no await)', () => {
		const t = { ...stub('netease', 'A', 'Artist', 'Song'), cover: 'https://cdn/has-cover.jpg' };
		mockEnsure.mockReturnValue(new Promise(() => {})); // never settles — prove the set is sync
		void player.play(t);
		expect(rc()).toBe('https://cdn/has-cover.jpg');
		// uid/name cache must NOT be consulted when the track already carries a cover.
		expect(mockUidCover).not.toHaveBeenCalled();
	});

	it('falls back to the uid-cache hit when track.cover is null (uid BEFORE name)', () => {
		mockUidCover.mockReturnValue('https://cdn/uid-cached.jpg');
		mockNameCover.mockReturnValue('https://cdn/name-cached.jpg');
		const t = { ...stub('netease', 'B', 'Artist', 'Song'), cover: null };
		mockEnsure.mockReturnValue(new Promise(() => {}));
		void player.play(t);
		expect(rc()).toBe('https://cdn/uid-cached.jpg'); // uid layer wins over name layer (D-13)
	});

	it('falls back to the name-cache hit when track.cover and uid-cache both miss', () => {
		mockUidCover.mockReturnValue(null);
		mockNameCover.mockReturnValue('https://cdn/name-cached.jpg');
		const t = { ...stub('netease', 'C', 'Artist', 'Song'), cover: null };
		mockEnsure.mockReturnValue(new Promise(() => {}));
		void player.play(t);
		expect(rc()).toBe('https://cdn/name-cached.jpg');
	});

	it('is null synchronously on a total miss, then === the async-resolved SOLID URL', async () => {
		const t = { ...stub('netease', 'D', 'Artist', 'Song'), cover: null };
		const resolved: Track = { ...mk('netease', 'D', 'Artist', 'Song'), cover: null, audioUrl: 'https://cdn/d.mp3' };
		mockEnsure.mockResolvedValue(resolved);
		const dCover = deferred<string | null>();
		mockResolveCover.mockReturnValue(dCover.promise);

		void player.play(t);
		expect(rc()).toBeNull(); // synchronous total miss — gradient shows until the chain lands

		await flush();
		expect(mockResolveCover).toHaveBeenCalled(); // the async tier chain fired on the miss
		dCover.resolve('https://cdn/resolved-async.jpg');
		await flush();
		expect(rc()).toBe('https://cdn/resolved-async.jpg');
	});

	it('the async land assigns a FRESH MediaMetadata whose artwork derives from resolvedCover (Pitfall 4)', async () => {
		const t = { ...stub('netease', 'E', 'Artist', 'Song'), cover: null };
		const resolved: Track = { ...mk('netease', 'E', 'Artist', 'Song'), cover: null, audioUrl: 'https://cdn/e.mp3' };
		mockEnsure.mockResolvedValue(resolved);
		mockResolveCover.mockResolvedValue('https://cdn/fresh-art.jpg');

		void player.play(t);
		await flush();
		// The network-path write produced metadata #0 (favicon, cover was null). The async land must
		// produce a NEW MediaMetadata object (#1) — not mutate #0's artwork in place.
		expect(metadataLog.length).toBeGreaterThanOrEqual(2);
		const landed = metadataLog[metadataLog.length - 1] as { artwork: Array<{ src: string }> };
		expect(landed).not.toBe(metadataLog[0]); // a genuinely fresh object
		expect(fakeMediaSession.metadata).toBe(landed); // ms.metadata points at the fresh object
		expect(landed.artwork.some((a) => a.src === 'https://cdn/fresh-art.jpg')).toBe(true);
	});

	it('a superseded play()s async cover land does NOT overwrite the newer track (generation guard)', async () => {
		const tA = { ...stub('netease', 'GA', 'Artist A', 'Song A'), cover: null };
		const tB = { ...stub('qq', 'GB', 'Artist B', 'Song B'), cover: 'https://cdn/b-has-cover.jpg' };
		const resolvedA: Track = { ...mk('netease', 'GA', 'Artist A', 'Song A'), cover: null, audioUrl: 'https://cdn/a.mp3' };
		const resolvedB: Track = { ...mk('qq', 'GB', 'Artist B', 'Song B'), cover: 'https://cdn/b-has-cover.jpg', audioUrl: 'https://cdn/b.mp3' };

		const dEnsureA = deferred<Track>();
		mockEnsure.mockReturnValueOnce(dEnsureA.promise).mockReturnValueOnce(Promise.resolve(resolvedB));
		const dCoverA = deferred<string | null>();
		mockResolveCover.mockReturnValue(dCoverA.promise);

		void player.play(tA); // gen → 1; resolvedCover null sync, fires the async chain under gen 1
		void player.play(tB); // gen → 2; supersedes A, resolvedCover = B's cover synchronously
		dEnsureA.resolve(resolvedA);
		await flush();
		expect(rc()).toBe('https://cdn/b-has-cover.jpg'); // B's cover, not A's pending resolve

		// A's slow cover lands LAST — the gen guard must discard it.
		dCoverA.resolve('https://cdn/a-stale-art.jpg');
		await flush();
		expect(rc()).toBe('https://cdn/b-has-cover.jpg'); // still B — stale A art discarded
	});

	it('switching tracks repoints resolvedCover (no stale cover from the prior track)', async () => {
		const t1 = { ...stub('netease', 'S1', 'Artist', 'Song 1'), cover: 'https://cdn/cover-1.jpg' };
		const t2 = { ...stub('qq', 'S2', 'Artist', 'Song 2'), cover: 'https://cdn/cover-2.jpg' };
		mockEnsure.mockResolvedValueOnce({ ...mk('netease', 'S1', 'Artist', 'Song 1'), cover: 'https://cdn/cover-1.jpg', audioUrl: 'https://cdn/1.mp3' });
		await player.play(t1);
		expect(rc()).toBe('https://cdn/cover-1.jpg');

		mockEnsure.mockResolvedValueOnce({ ...mk('qq', 'S2', 'Artist', 'Song 2'), cover: 'https://cdn/cover-2.jpg', audioUrl: 'https://cdn/2.mp3' });
		await player.play(t2);
		expect(rc()).toBe('https://cdn/cover-2.jpg'); // repointed — no stale cover-1
	});

	it('cover-hero-mediacard-missing (Issue 2): play() writes media metadata title/artist SYNCHRONOUSLY from the stub (before resolve)', () => {
		const t = { ...stub('netease', 'MC', '林家謙', '每當變幻時'), cover: null };
		mockEnsure.mockReturnValue(new Promise(() => {})); // never settles — prove the metadata write is sync
		void player.play(t);
		// The OS media card must already carry the SONG identity during the resolve gap — not the bare
		// app/PWA name (the reported Issue 2). Title/artist come off the stub, independent of any cover.
		const md = fakeMediaSession.metadata as { title: string; artist: string } | null;
		expect(md).not.toBeNull();
		expect(md?.title).toBe('每當變幻時');
		expect(md?.artist).toBe('林家謙');
	});

	it('cover-hero-mediacard-missing (Issue 2): restore() writes media metadata title/artist so a PWA reopen shows the song, not the app name', async () => {
		const cur = mk('netease', 'RC', '林家謙', '每當變幻時');
		localStorage.setItem(
			'openmusic:player:v1',
			JSON.stringify({
				v: 1,
				current: {
					uid: cur.uid,
					source: cur.source,
					songid: cur.songid,
					title: cur.title,
					artist: cur.artist,
					album: cur.album,
					cover: cur.cover,
					quality: cur.quality,
					qualityLabel: cur.qualityLabel,
					keyword: cur.keyword,
					displayIndex: cur.displayIndex
				},
				queue: [],
				currentTime: 0,
				shuffle: false
			})
		);
		mockEnsure.mockResolvedValue({ ...cur, audioUrl: 'https://cdn/rc.mp3', detailsLoaded: true });
		await player.restore();
		// restore() never calls play(), yet the media card must carry title/artist so the resume shows
		// the song instead of falling back to the document/PWA name.
		const md = fakeMediaSession.metadata as { title: string; artist: string } | null;
		expect(md).not.toBeNull();
		expect(md?.title).toBe('每當變幻時');
		expect(md?.artist).toBe('林家謙');
	});

	it('cover-hero-mediacard-missing (Issue 2, media-card): syncMetadata() builds artwork from the SHARED cover cache when resolvedCover is null', () => {
		// The SAME cache asymmetry the hero had: resolveCoverAsync fires ONLY when resolvedCover starts
		// null + is gen-guarded, so a cover that lands in the shared cache via ANOTHER surface (up-next
		// lazyCover, backfill, sibling tile) AFTER that window never reaches resolvedCover. The OS
		// media-card artwork must still pick it up from the cache — reading resolvedCover alone would
		// leave the lock screen on the favicon even though the cache has the real cover.
		const cur = mk('netease', 'MCC', '林家謙', '每當變幻時');
		player.current = cur;
		// resolvedCover was NEVER set (the miss/late-land case), but the shared cover cache HAS the cover
		// (readCoverByUidOrName reads getCachedCoverByUid ?? getCachedCover — both mocked here).
		(player as unknown as { resolvedCover: string | null }).resolvedCover = null;
		mockUidCover.mockReturnValue('https://cdn/cache-landed-art.jpg');
		mockNameCover.mockReturnValue(null);

		(player as unknown as { syncMetadata(): void }).syncMetadata();

		const md = fakeMediaSession.metadata as
			| { title: string; artist: string; artwork: Array<{ src: string }> }
			| null;
		expect(md).not.toBeNull();
		// Title/artist behavior unchanged — always the song identity off the current track.
		expect(md?.title).toBe('每當變幻時');
		expect(md?.artist).toBe('林家謙');
		// The media-card fix: artwork reflects the cached cover even though resolvedCover was null.
		expect(md?.artwork.some((a) => a.src === 'https://cdn/cache-landed-art.jpg')).toBe(true);
	});

	it('cover-hero-mediacard-missing (Issue 2, media-card): resolvedCover still WINS over the cache when both are present', () => {
		// Precedence guard for `this.resolvedCover ?? readCoverByUidOrName(...)`: when resolvedCover is
		// set it must take priority over any cached value (the normal resolved path is unchanged).
		const cur = mk('netease', 'MCP', '林家謙', '每當變幻時');
		player.current = cur;
		(player as unknown as { resolvedCover: string | null }).resolvedCover = 'https://cdn/resolved-wins.jpg';
		mockUidCover.mockReturnValue('https://cdn/cache-should-lose.jpg');

		(player as unknown as { syncMetadata(): void }).syncMetadata();

		const md = fakeMediaSession.metadata as { artwork: Array<{ src: string }> } | null;
		expect(md?.artwork.some((a) => a.src === 'https://cdn/resolved-wins.jpg')).toBe(true);
		expect(md?.artwork.some((a) => a.src === 'https://cdn/cache-should-lose.jpg')).toBe(false);
	});
});

describe('player.healCover — dead current-cover self-heal (quick-260704-20e)', () => {
	// healCover repairs a DEAD (non-null but unloadable) resolvedCover for the CURRENT track — the
	// counterpart to resolveCoverAsync (which fires only when resolvedCover is null). It mirrors
	// lazyCover's per-row heal: probe the displayed cover with new Image(); on error evict both cache
	// layers (removeCoverBoth) + re-resolve via the shared tier chain (resolveCoverForTrack) under the
	// playGen supersedence guard; on load it is a no-op. One-shot per uid+url; never throws.

	// A controllable Image stub: each instance captures its src and exposes settable onload/onerror so
	// a test can flip the probe outcome synchronously (the last-constructed instance is the probe's).
	let images: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null; decoding: string; referrerPolicy: string }>;

	beforeEach(() => {
		(player.play as unknown as { mockRestore(): void }).mockRestore?.();
		mockEnsure.mockReset();
		mockUidCover.mockReset().mockReturnValue(null);
		mockNameCover.mockReset().mockReturnValue(null);
		mockResolveCover.mockReset().mockResolvedValue(null);
		mockRemoveCoverBoth.mockClear();
		player.current = null;
		player.queue = [];
		player.error = null;
		player.loading = false;
		(player as unknown as { resolvedCover: string | null }).resolvedCover = null;
		(player as unknown as { healProbed: Set<string> }).healProbed.clear();

		images = [];
		const ImageCtor = vi.fn(function (this: Record<string, unknown>) {
			const img = { src: '', onload: null, onerror: null, decoding: '', referrerPolicy: '' };
			images.push(img);
			return img;
		});
		vi.stubGlobal('Image', ImageCtor);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const rc = () => (player as unknown as { resolvedCover: string | null }).resolvedCover;
	const setCurrent = (t: Track, cover: string | null) => {
		player.current = t;
		(player as unknown as { resolvedCover: string | null }).resolvedCover = cover;
	};
	/** Fire the most-recently-constructed probe Image's onload/onerror. */
	const fireProbe = (ok: boolean) => {
		const img = images[images.length - 1];
		if (ok) img.onload?.();
		else img.onerror?.();
	};

	it('Test 1 — dead cover self-heals: onerror evicts both layers + re-resolves fresh art', async () => {
		const t = mk('netease', 'H1', 'Artist', 'Song');
		setCurrent(t, 'https://cdn/dead.jpg');
		mockResolveCover.mockResolvedValue('https://cdn/fresh.jpg');

		const p = player.healCover(t.uid);
		await flush(); // probe Image constructed; its onerror is armed
		fireProbe(false); // dead url
		await p;
		await flush();

		expect(mockRemoveCoverBoth).toHaveBeenCalledWith(t.uid, 'Artist', 'Song');
		expect(mockResolveCover).toHaveBeenCalled();
		expect(rc()).toBe('https://cdn/fresh.jpg');
	});

	it('Test 2 — healthy cover kept: onload → zero re-resolve, resolvedCover unchanged', async () => {
		const t = mk('netease', 'H2', 'Artist', 'Song');
		setCurrent(t, 'https://cdn/alive.jpg');

		const p = player.healCover(t.uid);
		await flush();
		fireProbe(true); // loads fine
		await p;
		await flush();

		expect(mockRemoveCoverBoth).not.toHaveBeenCalled();
		expect(mockResolveCover).not.toHaveBeenCalled();
		expect(rc()).toBe('https://cdn/alive.jpg');
	});

	it('Test 3 — generation guard: a superseded heal does NOT clobber the current cover', async () => {
		const tA = mk('netease', 'HA', 'Artist A', 'Song A');
		setCurrent(tA, 'https://cdn/a-dead.jpg');
		const dCoverA = deferred<string | null>();
		mockResolveCover.mockReturnValue(dCoverA.promise);

		const p = player.healCover(tA.uid);
		await flush();
		fireProbe(false); // A's cover is dead → evict + start re-resolve (pending)
		await flush();
		expect(mockResolveCover).toHaveBeenCalled();

		// A newer play() bumps playGen + repoints current to B with its own cover.
		const tB = { ...mk('qq', 'HB', 'Artist B', 'Song B'), cover: 'https://cdn/b.jpg' };
		mockEnsure.mockReturnValue(new Promise(() => {})); // never settles
		void player.play(tB);
		expect(rc()).toBe('https://cdn/b.jpg'); // B's cover set synchronously

		// A's slow re-resolve lands LAST — the gen guard must discard it.
		dCoverA.resolve('https://cdn/a-stale.jpg');
		await p;
		await flush();
		expect(rc()).toBe('https://cdn/b.jpg'); // still B — stale A heal discarded
	});

	it('Test 4 — miss keeps gradient: dead probe → null re-resolve → resolvedCover stays (no throw)', async () => {
		const t = mk('netease', 'H4', 'Artist', 'Song');
		setCurrent(t, 'https://cdn/dead4.jpg');
		mockResolveCover.mockResolvedValue(null); // total miss

		const p = player.healCover(t.uid);
		await flush();
		fireProbe(false);
		await expect(p).resolves.toBeUndefined(); // never throws
		await flush();

		expect(mockResolveCover).toHaveBeenCalled();
		// Never re-commit the dead url; the gradient stands (resolvedCover keeps the DEAD value — the
		// component paints the gradient because effectiveCover's image fails, and no fresh art landed).
		expect(rc()).toBe('https://cdn/dead4.jpg');
	});

	it('Test 5 — one-shot per uid/url: two calls for the same uid+url probe/re-resolve at most once', async () => {
		const t = mk('netease', 'H5', 'Artist', 'Song');
		setCurrent(t, 'https://cdn/dead5.jpg');
		mockResolveCover.mockResolvedValue('https://cdn/fresh5.jpg');

		const p1 = player.healCover(t.uid);
		await flush();
		fireProbe(false);
		await p1;
		await flush();

		const probesAfterFirst = images.length;
		const resolveCallsAfterFirst = mockResolveCover.mock.calls.length;

		// Second call for the SAME uid — but resolvedCover is now the fresh url, a DIFFERENT key, so it
		// probes the fresh url once. Fire that probe as healthy → no re-resolve.
		const p2 = player.healCover(t.uid);
		await flush();
		if (images.length > probesAfterFirst) fireProbe(true);
		await p2;
		await flush();

		// A THIRD call with the SAME (now-fresh) url must short-circuit — no new probe, no new resolve.
		const probesBeforeThird = images.length;
		const p3 = player.healCover(t.uid);
		await p3;
		await flush();
		expect(images.length).toBe(probesBeforeThird); // no new probe for the already-probed uid+url
		// The dead-url re-resolve fired exactly once (the fresh-url probe loaded → never re-resolved).
		expect(mockResolveCover.mock.calls.length).toBe(resolveCallsAfterFirst);
	});

	it('bails when the passed uid no longer matches the current track (track already changed)', async () => {
		const t = mk('netease', 'H6', 'Artist', 'Song');
		setCurrent(t, 'https://cdn/dead6.jpg');
		await player.healCover('netease-STALE-uid'); // mismatched uid → immediate bail
		await flush();
		expect(images.length).toBe(0); // never probed
		expect(mockResolveCover).not.toHaveBeenCalled();
		expect(rc()).toBe('https://cdn/dead6.jpg');
	});

	it('bails when resolvedCover is null (the resolveCoverAsync MISSING path, not a heal target)', async () => {
		const t = mk('netease', 'H7', 'Artist', 'Song');
		setCurrent(t, null);
		await player.healCover(t.uid);
		await flush();
		expect(images.length).toBe(0);
		expect(mockResolveCover).not.toHaveBeenCalled();
		expect(rc()).toBeNull();
	});

	it('bails when resolvedCover is a non-https URL (not a probe target)', async () => {
		const t = mk('netease', 'H8', 'Artist', 'Song');
		setCurrent(t, 'http://cdn/insecure.jpg');
		await player.healCover(t.uid);
		await flush();
		expect(images.length).toBe(0);
		expect(mockResolveCover).not.toHaveBeenCalled();
	});
});

describe('player.reresolveCurrent — gen guard after the blob await (WR-02)', () => {
	// reresolveCurrent re-attaches the SAME track after a stale-URL seek error. It already
	// gen-checks after ensureTrackDetails, but a downloaded track has a SECOND await (blobStore.get)
	// before audio.src is written; a play() landing in that window would otherwise get its fresh src
	// overwritten. Drive reresolveCurrent (private) with a deferred blob read and bump playGen
	// mid-read.
	const reresolve = () =>
		(player as unknown as { reresolveCurrent(): Promise<void> })['reresolveCurrent']();
	let el: ReturnType<typeof makeFakeAudio>;

	beforeEach(() => {
		(player.play as unknown as { mockRestore(): void }).mockRestore?.();
		mockEnsure.mockReset();
		mockBlobGet.mockReset();
		vi.stubGlobal('navigator', { onLine: true });
		el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('a newer play() landing during the IDB blob read discards the stale src write', async () => {
		const cur = mk('netease', 'X', 'Artist', 'Song');
		player.current = cur;
		player.queue = [cur];
		el.src = 'NEW-SRC-FROM-PLAY'; // stand-in for the src a concurrent play() already set

		// Resolve returns a downloaded track so reresolveCurrent enters the blob branch.
		const resolved: Track = { ...cur, audioUrl: 'https://cdn/old-reresolved.mp3' };
		mockEnsure.mockResolvedValue(resolved);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(true);
		const dBlob = deferred<Blob | null>();
		mockBlobGet.mockReturnValue(dBlob.promise);

		const p = reresolve(); // captures myGen = current playGen
		await flush(); // run up to the awaited blobStore.get

		// A newer play() bumps playGen while the blob read is in flight.
		(player as unknown as { playGen: number }).playGen++;

		dBlob.resolve(null);
		await p;
		await flush();

		// reresolveCurrent must have bailed on the post-blob gen re-check — the src a concurrent
		// play() set is NOT clobbered with the stale re-resolved URL.
		expect(el.src).toBe('NEW-SRC-FROM-PLAY');
	});
});

describe('player.queueContext — context-threaded setQueue/playStub (Phase 17 QUEUE-03)', () => {
	// These use the global beforeEach's MOCKED play() — we only assert queueContext + that play
	// is handed the resolved track. setQueue is a synchronous field set, no real <audio> needed.
	it("setQueue(tracks, 'search') sets queueContext to 'search'", () => {
		player.setQueue([mk('netease', '1', 'A', 'S')], 'search');
		expect(player.queueContext).toBe('search');
	});

	it('setQueue(tracks) with no context defaults queueContext to null', () => {
		player.setQueue([mk('netease', '1', 'A', 'S')], 'liked'); // first set a non-null context
		player.setQueue([mk('qq', '2', 'B', 'T')]); // then call with no arg
		expect(player.queueContext).toBeNull();
	});

	it("playStub threads its context arg through the internal setQueue", async () => {
		const track = mk('netease', 'hit', '周杰伦', '稻香');
		mockResolve.mockResolvedValue(track);
		await player.playStub('周杰伦', '稻香', null, 'home-discovery');
		await flush();
		expect(player.queueContext).toBe('home-discovery');
		expect(player.play).toHaveBeenCalledWith(track, { fresh: true });
	});

	it('queueContext is NOT written to the persisted player snapshot', () => {
		player.current = mk('netease', '1', 'A', 'S');
		player.setQueue([mk('netease', '1', 'A', 'S')], 'album');
		const raw = localStorage.getItem('openmusic:player:v1');
		expect(raw).toBeTruthy();
		expect(JSON.parse(raw as string)).not.toHaveProperty('queueContext');
	});

	// Phase 19 (QUEUE-04 / D-04/D-05): a Remix-context regenerate plays the seed first, keeps
	// manual pins, and DISCARDS the prior generated tail — reusing the existing regenerate path
	// (no new queue mechanism). We drive regenerate() directly (mirroring the D-10 regenerate
	// tests below) with a 'remix' setup: seed + a manual-pinned entry + a stale generated tail
	// in the queue, and a mocked buildSimilarQueue returning a FRESH auto tail.
	it("a Remix regenerate preserves a manual-pinned uid and discards the prior generated tail (D-05)", async () => {
		const seed = mk('netease', 'SEED', 'A', 'Seed');
		const pinned = mk('qq', 'PIN', 'B', 'Pinned'); // user-added → survives regen
		const staleAuto = mk('kuwo', 'OLD', 'C', 'OldGenerated'); // prior generated tail → discarded
		const freshAuto = mk('joox', 'NEW', 'D', 'FreshGenerated'); // buildSimilarQueue's new picks

		// Force-generate context (D-06): setQueue records queueContext='remix'.
		player.setQueue([seed], 'remix');
		expect(player.queueContext).toBe('remix');
		expect(settings.effectiveUpnextMode(player.queueContext)).toBe('generated');

		// Queue now holds the seed, a manual pin, and a stale generated track.
		player.current = seed;
		player.queue = [seed, pinned, staleAuto];
		// Pin `pinned` into manualUids (addToQueue does not auto-play since current=seed≠pinned).
		player.addToQueue(pinned);
		const manualUids = (player as unknown as { manualUids: Set<string> }).manualUids;
		expect(manualUids.has(pinned.uid)).toBe(true);
		expect(manualUids.has(staleAuto.uid)).toBe(false); // never manually pinned → eligible to drop

		// buildSimilarQueue yields the fresh auto tail (the staleAuto is NOT in it).
		mockSimilar.mockReset().mockResolvedValue([freshAuto]);

		await (player as unknown as { regenerate(t: Track): Promise<void> }).regenerate(seed);

		// Result = dedupeBest([seed, ...manualEntries, ...auto]): seed first, manual pin kept,
		// prior generated tail (staleAuto) gone, fresh auto appended.
		expect(player.queue.map((t) => t.uid)).toEqual([seed.uid, pinned.uid, freshAuto.uid]);
		expect(player.queue.some((t) => t.uid === staleAuto.uid)).toBe(false);
	});

	it('regenerate keeps the exact current seed anchored when dedupeBest prefers another source', async () => {
		const seed = mk('qq', 'SEED-Q', 'Adele', 'Hello');
		const preferredVariant = mk('netease', 'SEED-N', 'Adele', 'Hello');
		const freshAuto = mk('joox', 'NEW', 'D', 'FreshGenerated');
		player.current = seed;
		player.queue = [seed];
		mockSimilar.mockReset().mockResolvedValue([preferredVariant, freshAuto]);

		await (player as unknown as { regenerate(t: Track): Promise<void> }).regenerate(seed);

		expect(player.queue[0]).toBe(seed);
		expect(player.queue.some((t) => t.uid === preferredVariant.uid)).toBe(false);
		expect(player.queue.map((t) => t.uid)).toEqual([seed.uid, freshAuto.uid]);
	});

	it('quick-260615-i9u: history-aware regenerate preserves the head before+including the seed, replaces only the tail', async () => {
		// A woven history prefix sits BEFORE the seed; regenerate must keep [h0, priorCurrent, seed]
		// intact and only swap the stale generated tail for the fresh auto picks (history not dropped).
		const h0 = mk('netease', 'H0', 'A', 'Played 0');
		const priorCurrent = mk('netease', 'PC', 'A', 'Prior Current');
		const seed = mk('qq', 'SEED', 'B', 'Clicked');
		const staleAuto = mk('kuwo', 'OLD', 'C', 'OldGenerated'); // tail after seed → discarded
		const freshAuto = mk('joox', 'NEW', 'D', 'FreshGenerated');
		player.current = seed;
		player.queue = [h0, priorCurrent, seed, staleAuto];
		mockSimilar.mockReset().mockResolvedValue([freshAuto]);

		await (player as unknown as { regenerate(t: Track): Promise<void> }).regenerate(seed);

		// Head (history + seed) survives in order; only the tail after the seed is regenerated.
		expect(player.queue.map((t) => t.uid)).toEqual([h0.uid, priorCurrent.uid, seed.uid, freshAuto.uid]);
		expect(player.queue.some((t) => t.uid === staleAuto.uid)).toBe(false);
		// The history head uids were handed to buildSimilarQueue's exclude set (no duplication).
		const excludeArg = mockSimilar.mock.calls[0][1] as Set<string>;
		expect(excludeArg.has(h0.uid)).toBe(true);
		expect(excludeArg.has(priorCurrent.uid)).toBe(true);
		expect(excludeArg.has(seed.uid)).toBe(true);
	});
});

describe('quick-260618-fiz Fix 4 — explicit queue entries survive a fresh play; auto/context cleared', () => {
	// Exercise the REAL play() (restore the global spy) with a fake <audio>, mocked resolve. The
	// manual-provenance carrier (pendingManual) is captured at setQueue/setListQueue time and
	// re-woven after the seed by weaveFreshHistory; the prior AUTO/context tail is dropped.
	let el: ReturnType<typeof makeFakeAudio>;
	const resolved = (s: SourceId, id: string): Track => ({
		...mk(s, id, 'Artist', 'Song'),
		audioUrl: `https://cdn/${id}.mp3`
	});

	beforeEach(() => {
		(player.play as unknown as { mockRestore(): void }).mockRestore?.();
		mockEnsure.mockReset();
		mockSimilar.mockReset().mockResolvedValue([]);
		mockPicks.mockReset().mockResolvedValue([]);
		player.current = null;
		player.queue = [];
		player.queueContext = null;
		player.error = null;
		player.loading = false;
		(player as unknown as { manualUids: Set<string> }).manualUids.clear();
		(player as unknown as { pendingManual: Track[] | null }).pendingManual = null;
		(player as unknown as { pendingHistory: Track[] | null }).pendingHistory = null;
		vi.stubGlobal('navigator', { onLine: true });
		el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
		settings.autoExpandOnPlay = false;
		settings.upnextMode = 'generated';
		settings.upnextPerContext = {};
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		(player as unknown as { manualUids: Set<string> }).manualUids.clear();
		(player as unknown as { pendingManual: Track[] | null }).pendingManual = null;
		(player as unknown as { pendingHistory: Track[] | null }).pendingHistory = null;
		settings.upnextMode = 'generated';
		settings.upnextPerContext = {};
	});

	it("'generated' fresh play preserves a manual entry and drops the prior auto picks", async () => {
		// Prior queue: [current, autoPickA, manualX, autoPickB]. The user explicitly pins manualX,
		// then plays a NEW song from a generated list. manualX must survive; autoPickA/B must not.
		const current = mk('netease', 'CUR', 'A', 'Current');
		const autoPickA = mk('qq', 'A', 'B', 'AutoA');
		const manualX = mk('kuwo', 'X', 'C', 'ManualX');
		const autoPickB = mk('joox', 'B', 'D', 'AutoB');
		player.current = current;
		player.queue = [current, autoPickA, manualX, autoPickB];
		player.addToQueue(manualX); // pin manualX into manualUids (already present → dedupe)

		const newSong = resolved('netease', 'NEW');
		mockEnsure.mockResolvedValue(newSong);
		// A 'search' context → global 'generated' default; setListQueue installs the new list.
		player.setListQueue([newSong], 'search');
		await player.play(stub('netease', 'NEW', 'Artist', 'Song'), { fresh: true });
		await flush();

		const uids = player.queue.map((t) => t.uid);
		expect(uids).toContain(manualX.uid); // explicit pin preserved across the fresh rebuild
		expect(uids).toContain(newSong.uid); // the new current is in the queue
		expect(uids).not.toContain(autoPickA.uid); // prior auto/context tail dropped
		expect(uids).not.toContain(autoPickB.uid);
		// manualX sits AFTER the new seed (insert-after-current provenance).
		expect(uids.indexOf(manualX.uid)).toBeGreaterThan(uids.indexOf(newSong.uid));
	});

	it("'same-list' fresh play still drops stale auto/context entries while keeping the manual one", async () => {
		const current = mk('netease', 'CUR', 'A', 'Current');
		const autoPickA = mk('qq', 'A', 'B', 'AutoA');
		const manualX = mk('kuwo', 'X', 'C', 'ManualX');
		player.current = current;
		player.queue = [current, autoPickA, manualX];
		player.addToQueue(manualX);

		settings.upnextPerContext = { liked: 'same-list' };
		const newSong: Track = { ...mk('netease', 'NEW', 'NewArtist', 'NewSong'), audioUrl: 'https://cdn/NEW.mp3' };
		const listMate: Track = { ...mk('qq', 'MATE', 'MateArtist', 'MateSong'), audioUrl: 'https://cdn/MATE.mp3' };
		mockEnsure.mockResolvedValue(newSong);
		// same-list install: [newSong, listMate] becomes the snapshot; manualX must re-weave after seed.
		player.setListQueue([newSong, listMate], 'liked');
		await player.play(stub('netease', 'NEW', 'NewArtist', 'NewSong'), { fresh: true });
		await flush();

		const uids = player.queue.map((t) => t.uid);
		expect(uids).toContain(manualX.uid); // explicit pin survives even in same-list mode
		expect(uids).toContain(newSong.uid);
		expect(uids).toContain(listMate.uid); // the same-list snapshot remainder is kept
		expect(uids).not.toContain(autoPickA.uid); // prior auto/context entry dropped
		expect(uids.indexOf(manualX.uid)).toBeGreaterThan(uids.indexOf(newSong.uid));
	});

	it('a NON-fresh advance never rebuilds the queue (no manual re-weave / no auto drop)', async () => {
		const current = mk('netease', 'CUR', 'A', 'Current');
		const autoPickA = mk('qq', 'A', 'B', 'AutoA');
		const next = resolved('kuwo', 'NXT');
		player.current = current;
		player.queue = [current, autoPickA, next];
		const before = player.queue.map((t) => t.uid);
		mockEnsure.mockResolvedValue(next);

		// Non-fresh play (auto-advance/failover) — no opts.fresh → no weave, queue untouched.
		await player.play(next);
		await flush();
		expect(player.queue.map((t) => t.uid)).toEqual(before);
	});

	it('weaveManualAfterSeed re-inserts a captured manual entry right after the seed (unit)', () => {
		// Drive the carrier path directly: pendingManual holds the explicit entry captured pre-wipe.
		const seed = mk('netease', 'SEED', 'A', 'Seed');
		const manualX = mk('qq', 'X', 'B', 'ManualX');
		const listMate = mk('kuwo', 'M', 'C', 'Mate');
		(player as unknown as { manualUids: Set<string> }).manualUids.add(manualX.uid);
		player.current = seed;
		player.queue = [seed, listMate]; // freshly installed list snapshot (manualX wiped from it)
		(player as unknown as { pendingManual: Track[] | null }).pendingManual = [manualX];

		(player as unknown as { weaveManualAfterSeed(t: Track): void }).weaveManualAfterSeed(seed);

		expect(player.queue.map((t) => t.uid)).toEqual([seed.uid, manualX.uid, listMate.uid]);
		// carrier consumed
		expect((player as unknown as { pendingManual: Track[] | null }).pendingManual).toBeNull();
	});
});

describe('player.setListQueue — current-anchored queue install (album-and-next-song-bug)', () => {
	// Regression coverage for the album queue/next-song bug: the album play paths must install the
	// FULL list as the queue while keeping the now-playing track a MEMBER of it, so up-next is the
	// list remainder and next() can advance. These assert the synchronous queue state (no <audio>).
	beforeEach(() => {
		player.current = null;
		player.queue = [];
		player.queueContext = null;
	});

	it('re-anchors current INTO the list by uid so indexOf(current) is valid (next() can advance)', () => {
		const t1 = mk('netease', '1', 'A', 'Track One');
		const t2 = mk('netease', '2', 'A', 'Track Two');
		const t3 = mk('netease', '3', 'A', 'Track Three');
		player.current = t1; // already playing track 1 (e.g. tapped on the album page)
		player.setListQueue([t1, t2, t3], 'album');
		expect(player.queueContext).toBe('album');
		// current is a member at its real position → up-next IS the album remainder.
		const idx = player.queue.findIndex((t) => t.uid === t1.uid);
		expect(idx).toBe(0);
		expect(player.queue.map((t) => t.uid)).toEqual([t1.uid, t2.uid, t3.uid]);
	});

	it('matches current by same-song key when the list entry is a different SOURCE variant (Bug 2)', () => {
		// playAlbum: `first` (current) came from one resolveStub; the list re-resolved track 0 to a
		// different-source variant of the SAME song. dedupeBest collapses them; setListQueue must keep
		// the EXACT current object in the surviving slot so indexOf(current) stays valid.
		const currentNetease = mk('netease', 'X', 'Adele', 'Hello');
		const variantQQ = mk('qq', 'Y', 'Adele', 'Hello'); // same song, different source → dedup-collapses
		const other = mk('kuwo', 'Z', 'Adele', 'Someone Like You');
		player.current = currentNetease;
		player.setListQueue([variantQQ, other], 'album');
		// The exact current object survives in the queue (so audio keeps playing + next() works).
		expect(player.queue.includes(currentNetease)).toBe(true);
		expect(player.queue.some((t) => t.uid === variantQQ.uid && t !== currentNetease)).toBe(false);
		// next() target exists after current.
		const i = player.queue.findIndex((t) => t.uid === currentNetease.uid);
		expect(player.queue[i + 1]?.uid).toBe(other.uid);
	});

	it('splices current at the front when it is NOT in its own list (stays a member)', () => {
		const current = mk('netease', 'C', 'A', 'Current');
		const a = mk('qq', 'a', 'B', 'Other A');
		const b = mk('kuwo', 'b', 'C', 'Other B');
		player.current = current;
		player.setListQueue([a, b], 'album'); // current's song absent from the list
		expect(player.queue[0].uid).toBe(current.uid);
		expect(player.queue.map((t) => t.uid)).toEqual([current.uid, a.uid, b.uid]);
	});

	it('delegates to setQueue when there is no current track (nothing to anchor)', () => {
		player.current = null;
		const a = mk('netease', '1', 'A', 'S');
		player.setListQueue([a], 'album');
		expect(player.queue.map((t) => t.uid)).toEqual([a.uid]);
		expect(player.queueContext).toBe('album');
	});

	it('quick-260615-i9u: captures a non-empty pre-current head so a later fresh play preserves it', () => {
		// The synchronous setListQueue result is the anchored list (history is woven later by play()).
		// Here we assert the CAPTURE: with a pre-current head [h0, current], setListQueue snapshots
		// pendingHistory=[h0, current] (up to+including the prior current) before installing the list.
		const h0 = mk('netease', 'H0', 'A', 'Played');
		const current = mk('netease', 'C', 'A', 'Current');
		const a = mk('qq', 'a', 'B', 'List A');
		player.current = current;
		player.queue = [h0, current]; // a real pre-current head exists
		player.setListQueue([current, a], 'album');
		// The installed queue is still the anchored list (weave happens in play(), not here).
		expect(player.queue.map((t) => t.uid)).toEqual([current.uid, a.uid]);
		// The pre-wipe head was captured for the next fresh play to re-weave.
		const pending = (player as unknown as { pendingHistory: Track[] | null }).pendingHistory;
		expect(pending?.map((t) => t.uid)).toEqual([h0.uid, current.uid]);
		// cleanup so the carrier doesn't leak into the next test's fresh play.
		(player as unknown as { pendingHistory: Track[] | null }).pendingHistory = null;
	});

	it('bumps queueGen so a racing ensureAhead grow is discarded (up-next stays the list, not generated)', async () => {
		// Reproduces the single-tap "same-list still generated" residual race: a fresh play fires
		// ensureAhead against the optimistic one-track queue; while buildDiversePicks is in flight the
		// album page installs the full album via setListQueue (bumps queueGen). The stale grow must be
		// discarded so generated picks never get appended to the album queue.
		const tapped = mk('netease', '1', 'A', 'Tapped');
		const albumB = mk('netease', '2', 'A', 'Album B');
		const albumC = mk('netease', '3', 'A', 'Album C');
		const generated = mk('joox', 'GEN', 'Z', 'Generated Pick');

		player.current = tapped;
		player.queue = [tapped]; // optimistic one-track queue (playStub state)

		// Make buildDiversePicks resolve AFTER setListQueue lands.
		const d = deferred<Track[]>();
		mockPicks.mockReset().mockReturnValue(d.promise);

		const aheadPromise = (
			player as unknown as { ensureAhead(): Promise<void> }
		).ensureAhead(); // queue.length - i = 1, not > 2 → it grows

		// Album finishes resolving → install the full album.
		player.setListQueue([tapped, albumB, albumC], 'album');

		// Now the stale grow settles — it must be discarded (queueGen advanced).
		d.resolve([generated]);
		await aheadPromise;
		await flush();

		expect(player.queue.map((t) => t.uid)).toEqual([tapped.uid, albumB.uid, albumC.uid]);
		expect(player.queue.some((t) => t.uid === generated.uid)).toBe(false);
	});

	it('list-tap pattern (search/artist/library): tapped lower-ranked variant survives dedupe drop so next() has a target (fail-to-move-to-next-track)', () => {
		// Regression: search/artist/library taps used `setQueue(list); play(t)` — dedupeBest could
		// drop the tapped variant in favor of a higher-ranked same-song source, orphaning `current`
		// (indexOf === -1) so next()/ensureAhead went silently dead at track end. The call sites now
		// use `play(t); setListQueue(list, ctx)`, which must keep the EXACT tapped object a member.
		const tappedQQ = mk('qq', 'Q1', 'Adele', 'Hello');
		const variantNetease = mk('netease', 'N1', 'Adele', 'Hello'); // outranks qq → dedupe winner slot
		const after = mk('kuwo', 'K1', 'Adele', 'Skyfall');
		player.current = tappedQQ; // play(t) sets current synchronously before setListQueue runs
		player.setListQueue([variantNetease, tappedQQ, after], 'search');
		expect(player.queue.includes(tappedQQ)).toBe(true);
		const i = player.queue.findIndex((t) => t.uid === tappedQQ.uid);
		expect(i).toBeGreaterThanOrEqual(0);
		expect(player.queue[i + 1]?.uid).toBe(after.uid); // next() can advance
		expect(player.queueContext).toBe('search');
	});
});

describe('player.play — auto-expand fresh-only guard + per-context branch (Phase 17 QUEUE-01/D-05)', () => {
	// Exercise the REAL play() (restore the global spy) with a fake <audio>, mocked resolve, and
	// spies on the private regenerate/ensureAhead so we observe the branch without real network.
	let el: ReturnType<typeof makeFakeAudio>;
	const resolved = (s: SourceId, id: string): Track => ({
		...mk(s, id, 'Artist', 'Song'),
		audioUrl: `https://cdn/${id}.mp3`
	});

	beforeEach(() => {
		(player.play as unknown as { mockRestore(): void }).mockRestore?.();
		mockEnsure.mockReset();
		player.current = null;
		player.queue = [];
		player.queueContext = null;
		player.expanded = false;
		player.error = null;
		player.loading = false;
		vi.stubGlobal('navigator', { onLine: true });
		el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
		// Restore default settings so each case controls them explicitly.
		settings.autoExpandOnPlay = false;
		settings.upnextMode = 'generated';
		settings.upnextPerContext = {};
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		settings.autoExpandOnPlay = false;
		settings.upnextMode = 'generated';
		settings.upnextPerContext = {};
	});

	it('autoExpandOnPlay=true: a fresh play expands; a non-fresh play does NOT (D-05)', async () => {
		settings.autoExpandOnPlay = true;
		const r = resolved('netease', 'F');
		mockEnsure.mockResolvedValue(r);

		await player.play(stub('netease', 'F', 'Artist', 'Song'), { fresh: true });
		await flush();
		expect(player.expanded).toBe(true);

		// Reset, then a non-fresh play (auto-advance/failover path) must leave expanded unchanged.
		player.expanded = false;
		mockEnsure.mockResolvedValue(resolved('qq', 'N'));
		await player.play(stub('qq', 'N', 'Artist', 'Song')); // no opts.fresh
		await flush();
		expect(player.expanded).toBe(false);
	});

	it("a fresh play in a 'generated' context regenerates (similar-queue path)", async () => {
		const regenSpy = vi
			.spyOn(player as unknown as { regenerate(t: Track): Promise<void> }, 'regenerate')
			.mockResolvedValue(undefined);
		const aheadSpy = vi
			.spyOn(player as unknown as { ensureAhead(): Promise<void> }, 'ensureAhead')
			.mockResolvedValue(undefined);
		player.queueContext = 'search'; // 'search' resolves to global 'generated' default
		mockEnsure.mockResolvedValue(resolved('netease', 'G'));

		await player.play(stub('netease', 'G', 'Artist', 'Song'), { fresh: true });
		await flush();
		expect(regenSpy).toHaveBeenCalledTimes(1);
		expect(aheadSpy).toHaveBeenCalledTimes(1); // after regenerate, prime the next slot
	});

	it("a fresh play in a 'same-list' context does NOT regenerate (snapshot survives)", async () => {
		const regenSpy = vi
			.spyOn(player as unknown as { regenerate(t: Track): Promise<void> }, 'regenerate')
			.mockResolvedValue(undefined);
		const aheadSpy = vi
			.spyOn(player as unknown as { ensureAhead(): Promise<void> }, 'ensureAhead')
			.mockResolvedValue(undefined);
		settings.upnextPerContext = { liked: 'same-list' };
		player.queueContext = 'liked';
		mockEnsure.mockResolvedValue(resolved('netease', 'S'));

		await player.play(stub('netease', 'S', 'Artist', 'Song'), { fresh: true });
		await flush();
		expect(regenSpy).not.toHaveBeenCalled();
		expect(aheadSpy).toHaveBeenCalledTimes(1); // snapshot still grows on exhaust (D-03)
	});
});

describe('player.removeFromQueue / clearQueue / removedUids (Phase 17 QUEUE-05 / D-08..D-10)', () => {
	// These use the global beforeEach's MOCKED play() (synchronous current set). removeFromQueue
	// and clearQueue are synchronous queue mutations; the removedUids exclusion is observed via the
	// mocked buildSimilarQueue / buildDiversePicks exclude-Set argument.
	beforeEach(() => {
		mockSimilar.mockReset().mockResolvedValue([]);
		mockPicks.mockReset().mockResolvedValue([]);
		player.current = null;
		player.queue = [];
		player.queueContext = null;
	});

	it('removeFromQueue(uid) drops the matching entry from the queue', () => {
		const a = mk('netease', '1', 'A', 'S1');
		const b = mk('qq', '2', 'B', 'S2');
		player.queue = [a, b];
		player.removeFromQueue(b.uid);
		expect(player.queue.map((t) => t.uid)).toEqual([a.uid]);
	});

	it('removeFromQueue(uid) deletes it from manual pins (a pinned track can still be swiped away)', () => {
		const a = mk('netease', '1', 'A', 'S1');
		const b = mk('qq', '2', 'B', 'S2');
		player.current = a; // a is playing, so addToQueue(b) does not auto-play b (b ≠ current)
		player.queue = [a, b];
		player.addToQueue(b); // pins b into manualUids (already in queue → dedupe keeps one)
		const manual = (player as unknown as { manualUids: Set<string> }).manualUids;
		expect(manual.has(b.uid)).toBe(true);
		player.removeFromQueue(b.uid);
		expect(manual.has(b.uid)).toBe(false);
	});

	it('removeFromQueue(current.uid) is a NO-OP — never-stop: the playing track survives (CR-01)', () => {
		const cur = mk('netease', 'C', 'A', 'Cur');
		const b = mk('qq', '2', 'B', 'S2');
		player.current = cur;
		player.queue = [cur, b];
		player.removeFromQueue(cur.uid);
		// Queue unchanged — removing the current track would orphan indexOf(current), killing
		// next()/ensureAhead/prefetchNext AND persisting the broken state (CR-01).
		expect(player.queue.map((t) => t.uid)).toEqual([cur.uid, b.uid]);
		// And the uid is NOT session-excluded (the removal never happened).
		expect((player as unknown as { removedUids: Set<string> }).removedUids.has(cur.uid)).toBe(false);
	});

	it('clearQueue() leaves queue = [current] when a current track exists and clears pins', () => {
		const cur = mk('netease', 'C', 'A', 'Cur');
		const a = mk('qq', '1', 'B', 'S1');
		player.current = cur;
		player.queue = [cur, a];
		player.addToQueue(a); // pin a
		player.clearQueue();
		expect(player.queue.map((t) => t.uid)).toEqual([cur.uid]); // only current survives (D-08)
		expect((player as unknown as { manualUids: Set<string> }).manualUids.size).toBe(0);
	});

	it('clearQueue() leaves an empty queue when there is no current track', () => {
		player.current = null;
		player.queue = [mk('netease', '1', 'A', 'S1'), mk('qq', '2', 'B', 'S2')];
		player.clearQueue();
		expect(player.queue).toEqual([]);
	});

	it('clearQueue() does NOT trigger an immediate regenerate/ensureAhead (D-09 — refill near end only)', async () => {
		const regenSpy = vi
			.spyOn(player as unknown as { regenerate(t: Track): Promise<void> }, 'regenerate')
			.mockResolvedValue(undefined);
		const aheadSpy = vi
			.spyOn(player as unknown as { ensureAhead(): Promise<void> }, 'ensureAhead')
			.mockResolvedValue(undefined);
		const cur = mk('netease', 'C', 'A', 'Cur');
		player.current = cur;
		player.queue = [cur, mk('qq', '1', 'B', 'S1'), mk('kuwo', '2', 'C', 'S2')];
		player.clearQueue();
		await flush();
		expect(regenSpy).not.toHaveBeenCalled();
		expect(aheadSpy).not.toHaveBeenCalled();
		expect(player.queue.map((t) => t.uid)).toEqual([cur.uid]); // stays at [current]
	});

	it('a removeFromQueue uid is excluded from regenerate buildSimilarQueue exclude set (D-10)', async () => {
		const seed = mk('netease', 'SEED', 'A', 'Seed');
		const gone = mk('qq', 'GONE', 'B', 'Gone');
		player.queue = [seed, gone];
		player.removeFromQueue(gone.uid);
		await (player as unknown as { regenerate(t: Track): Promise<void> }).regenerate(seed);
		expect(mockSimilar).toHaveBeenCalledTimes(1);
		const excludeArg = mockSimilar.mock.calls[0][1] as Set<string>;
		expect(excludeArg.has(gone.uid)).toBe(true);
	});

	it("an explicit setQueue() mid-regenerate WINS — generated picks don't clobber it (WR-06)", async () => {
		const seed = mk('netease', 'SEED', 'A', 'Seed');
		const albumQueue = [seed, mk('qq', '1', 'B', 'T1'), mk('kuwo', '2', 'C', 'T2')];
		// Hold buildSimilarQueue open so an explicit setQueue can land while it is in flight
		// (the playAlbum race: playStub → regenerate vs resolveAllCached → setQueue(all)).
		let resolveSimilar!: (v: Track[]) => void;
		mockSimilar.mockReturnValue(new Promise<Track[]>((r) => (resolveSimilar = r)));
		player.current = seed;
		player.queue = [seed];
		const regen = (player as unknown as { regenerate(t: Track): Promise<void> }).regenerate(seed);
		player.setQueue(albumQueue, 'album'); // explicit queue installed mid-regenerate
		resolveSimilar([mk('joox', '9', 'D', 'Gen')]); // late generated picks settle AFTER setQueue
		await regen;
		// The user's explicit album queue survives; the stale regenerate result is discarded.
		expect(player.queue.map((t) => t.uid)).toEqual(albumQueue.map((t) => t.uid));
	});

	it('a removeFromQueue uid is excluded from ensureAhead buildDiversePicks `have` set (D-10/QUEUE-02)', async () => {
		const cur = mk('netease', 'C', 'A', 'Cur');
		const gone = mk('qq', 'GONE', 'B', 'Gone');
		player.current = cur;
		player.queue = [cur]; // within 2 of the end → ensureAhead runs
		player.removeFromQueue(gone.uid); // gone is no longer in queue, but must stay excluded
		await (player as unknown as { ensureAhead(): Promise<void> }).ensureAhead();
		expect(mockPicks).toHaveBeenCalledTimes(1);
		const haveArg = mockPicks.mock.calls[0][1] as Set<string>;
		expect(haveArg.has(gone.uid)).toBe(true);
	});

	it('a fresh play resets removedUids — the next regenerate no longer excludes the old uid', async () => {
		// This one drives the REAL play() fresh branch (where removedUids.clear() lives), so restore
		// the globally-spied play(), attach a fake <audio>, and drive a 'generated'-context fresh play.
		(player.play as unknown as { mockRestore?(): void }).mockRestore?.();
		vi.stubGlobal('navigator', { onLine: true });
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
		settings.upnextMode = 'generated';
		settings.upnextPerContext = {};
		player.queueContext = 'search'; // resolves to 'generated' → fresh play calls regenerate

		const gone = mk('qq', 'GONE', 'B', 'Gone');
		player.removeFromQueue(gone.uid); // session A: gone is excluded
		// A fresh play starts a NEW session → removedUids cleared BEFORE regenerate runs.
		mockEnsure.mockResolvedValue({ ...mk('netease', 'F', 'A', 'Song'), audioUrl: 'https://cdn/f.mp3' });
		await player.play(stub('netease', 'F', 'A', 'Song'), { fresh: true });
		await flush();
		// regenerate ran during the fresh play; its exclude set must NOT contain the old uid.
		expect(mockSimilar).toHaveBeenCalled();
		const excludeArg = mockSimilar.mock.calls[0][1] as Set<string>;
		expect(excludeArg.has(gone.uid)).toBe(false); // cleared on fresh play (D-10 session-scoped)
	});

	it('removedUids is NOT written to the persisted player snapshot (session-scoped, not serialized)', () => {
		player.current = mk('netease', 'C', 'A', 'Cur');
		player.removeFromQueue('qq:GONE');
		const raw = localStorage.getItem('openmusic:player:v1');
		expect(raw).toBeTruthy();
		expect(raw as string).not.toContain('removedUids');
		expect(raw as string).not.toContain('GONE');
	});
});

/**
 * Sleep-timer expiry (TIMER-01, Phase-18 blocker proven in code). The hard constraint:
 * the expiry stop is an INTENTIONAL pause and must be invisible to the Phase-16 never-stop
 * failure machinery — it must NEVER call next(), bump playGen, increment the failure
 * counters, or route into runFallback (which would spuriously trip the sticky loop-guard).
 *
 * Drives the real player listeners via the makeFakeAudio().fire() harness. The fake gains a
 * writable `volume` so canFadeVolume()'s write-then-readback honours the probe (the fade path
 * is exercised, not the iOS instant-pause path) unless a test forces it read-only.
 */
function makeSleepAudio() {
	const base = makeFakeAudio();
	return Object.assign(base, { volume: 1, paused: false });
}

describe('sleep timer expiry — Phase-18 blocker (never enters the failure machinery)', () => {
	beforeEach(() => {
		sleepTimer.cancel(); // no leaked live tick / fade interval between tests
		vi.spyOn(player, 'next').mockImplementation(() => {});
		player.repeatMode = 'off';
		player.notice = null;
	});
	afterEach(() => sleepTimer.cancel());

	it('minutes-mode timeupdate at the deadline fades then pauses once, deactivates the timer, and does NOT call next()', () => {
		vi.useFakeTimers();
		try {
			const audio = makeSleepAudio();
			player.attach(audio as unknown as HTMLAudioElement);
			sleepTimer.set('minutes', 5);
			sleepTimer.deadline = Date.now() - 1; // force the absolute deadline into the past

			audio.fire('timeupdate');
			// canFadeVolume true (writable fake volume) → a ~10s fade interval is armed; pause is
			// deferred until the fade completes. Advance past FADE_MS so finishExpiry() runs.
			vi.advanceTimersByTime(10_200);

			expect(audio.pause).toHaveBeenCalledTimes(1);
			expect(sleepTimer.active).toBe(false);
			expect(audio.volume).toBe(1); // pre-fade volume restored (D-02)
			expect(player.next).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('the timeupdate expiry does NOT route into runFallback and emits NO notice (failure-counter proxy)', () => {
		vi.useFakeTimers();
		try {
			mockTryFallback.mockReset();
			const audio = makeSleepAudio();
			player.attach(audio as unknown as HTMLAudioElement);
			sleepTimer.set('minutes', 10);
			sleepTimer.deadline = Date.now() - 1;

			audio.fire('timeupdate');
			vi.advanceTimersByTime(10_200);

			// consecutiveFailures/errorBurst are private — assert the observable proxies instead:
			// an expiry never tries a cross-source fallback and never surfaces a skip/loop notice.
			expect(mockTryFallback).not.toHaveBeenCalled();
			expect(player.notice).toBeNull();
			expect(player.next).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('a non-expired minutes timeupdate runs the existing body (currentTime sync) unchanged', () => {
		const audio = makeSleepAudio();
		player.attach(audio as unknown as HTMLAudioElement);
		sleepTimer.set('minutes', 30); // deadline far in the future — NOT expired
		audio.currentTime = 42;

		audio.fire('timeupdate');

		expect(audio.pause).not.toHaveBeenCalled();
		expect(player.currentTime).toBe(42); // existing timeupdate body ran
		expect(sleepTimer.active).toBe(true);
	});

	it("end-of-track mode beats repeat-one: `ended` pauses (no replay) and does NOT call next() (D-03)", () => {
		const audio = makeSleepAudio();
		audio.currentTime = 99; // non-zero so a suppressed repeat-one rewind is observable
		player.attach(audio as unknown as HTMLAudioElement);
		sleepTimer.set('end-of-track');
		player.repeatMode = 'one'; // would normally rewind+replay — sleep-stop must beat it
		audio.play.mockClear();

		audio.fire('ended');

		// decideEndedAction returned 'sleep-stop' BEFORE the repeat-one branch and BEFORE next():
		expect(player.next).not.toHaveBeenCalled();
		expect(audio.play).not.toHaveBeenCalled(); // repeat-one rewind+replay suppressed
		expect(audio.currentTime).toBe(99); // repeat-one would have set currentTime=0 — it didn't
		expect(sleepTimer.active).toBe(false); // timer cancelled at the boundary (D-09)
	});

	it('end-of-track is INERT when no end-of-track timer is armed: repeat-one still rewinds + replays', () => {
		const audio = makeSleepAudio();
		audio.currentTime = 87;
		player.attach(audio as unknown as HTMLAudioElement);
		// sleepTimer is off (beforeEach cancel) → decideEndedAction('off','one') === 'repeat-rewind'
		player.repeatMode = 'one';

		audio.fire('ended');

		expect(audio.currentTime).toBe(0); // repeat-one rewound
		expect(audio.play).toHaveBeenCalled(); // repeat-one replayed
		expect(player.next).not.toHaveBeenCalled();
	});

	it('D-04: expireSleepTimer() when already paused clears the timer silently and does NOT pause again', () => {
		const audio = makeSleepAudio();
		audio.paused = true; // user already paused manually
		player.attach(audio as unknown as HTMLAudioElement);
		sleepTimer.set('minutes', 5);

		player.expireSleepTimer();

		expect(audio.pause).not.toHaveBeenCalled(); // no second pause (D-04 silent clear)
		expect(sleepTimer.active).toBe(false); // timer cleared
		expect(player.next).not.toHaveBeenCalled();
	});

	it('D-05: a gesture (seek) during an in-flight fade aborts the stop — restores volume + cancels timer', () => {
		vi.useFakeTimers();
		try {
			const audio = makeSleepAudio();
			audio.duration = 200; // finite so seekFraction sets currentTime (not pendingSeekFrac)
			player.attach(audio as unknown as HTMLAudioElement);
			sleepTimer.set('minutes', 5);
			sleepTimer.deadline = Date.now() - 1;

			audio.fire('timeupdate'); // arms the fade interval
			vi.advanceTimersByTime(400); // partway through the fade — volume is now < 1
			expect(audio.volume).toBeLessThan(1);

			// A seek gesture mid-fade aborts (D-05). seekFraction (NOT next, which is spied) runs
			// the REAL abortFade() at its top.
			player.seekFraction(0.5);

			expect(audio.volume).toBe(1); // pre-fade volume restored
			expect(sleepTimer.active).toBe(false); // timer cancelled — user is awake
			// Advancing past the original FADE_MS must NOT pause: the fade interval was cleared.
			vi.advanceTimersByTime(10_000);
			expect(audio.pause).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('CR-01: the timeupdate firehose (many fires across the fade) does NOT restart the fade, re-probe, or degrade the restored volume', () => {
		vi.useFakeTimers();
		try {
			// Wrap `volume` in a getter/setter so we can OBSERVE every write. canFadeVolume's probe
			// slams volume to 0 then restores; if expireSleepTimer re-entered each timeupdate it would
			// re-run that probe (a 0-write) mid-fade. We record the writes to prove it runs once.
			// `volume` already exists on makeSleepAudio()'s type, so redefining it is type-safe.
			const audio = makeSleepAudio();
			let _vol = 1;
			const volumeWrites: number[] = [];
			Object.defineProperty(audio, 'volume', {
				get: () => _vol,
				set: (v: number) => {
					_vol = v;
					volumeWrites.push(v);
				},
				configurable: true
			});
			player.attach(audio as unknown as HTMLAudioElement);
			sleepTimer.set('minutes', 5);
			sleepTimer.deadline = Date.now() - 1; // deadline in the past for the whole fade window

			// Fire timeupdate repeatedly across the fade, advancing fake timers between fires so the
			// fade interval ticks AND the listener keeps seeing an expired minutes timer (production
			// fires ~4×/sec). The re-entry guard must keep the fade single-flight.
			for (let i = 0; i < 25; i++) {
				audio.fire('timeupdate');
				vi.advanceTimersByTime(400);
			}
			// Drain any remaining fade so finishExpiry() runs.
			vi.advanceTimersByTime(10_200);

			// Paused exactly once — re-entry would have armed multiple fades → multiple finishExpiry.
			expect(audio.pause).toHaveBeenCalledTimes(1);
			// Restored to the ORIGINAL 1.0, not a degraded mid-fade snapshot (preFadeVolume read once).
			expect(audio.volume).toBe(1);
			expect(sleepTimer.active).toBe(false);
			expect(player.next).not.toHaveBeenCalled();
			// canFadeVolume's probe writes 0 once (at fade start); the fade ramp also lands on 0 at
			// the end — so a healthy single fade has at most 2 zero-writes. The re-entry bug re-ran
			// the probe on EVERY timeupdate (≥25 here), so a small bound proves the guard held.
			expect(volumeWrites.filter((v) => v === 0).length).toBeLessThanOrEqual(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('WR-02: a natural `ended` in repeat-one DURING a minutes fade finishes the expiry — no loop, volume restored, timer cancelled', () => {
		vi.useFakeTimers();
		try {
			const audio = makeSleepAudio();
			audio.currentTime = 73; // non-zero so a suppressed repeat-one rewind (→0) is observable
			player.attach(audio as unknown as HTMLAudioElement);
			player.repeatMode = 'one';
			sleepTimer.set('minutes', 5);
			sleepTimer.deadline = Date.now() - 1;

			audio.fire('timeupdate'); // arms the fade interval (fade in flight, audio still playing)
			vi.advanceTimersByTime(400); // partway through — volume now < 1
			expect(audio.volume).toBeLessThan(1);
			audio.play.mockClear();

			// Track reaches its natural end mid-fade. decideEndedAction('minutes','one') is
			// 'repeat-rewind', but the fade-in-flight guard must finish the expiry instead of looping.
			audio.fire('ended');

			expect(audio.play).not.toHaveBeenCalled(); // did NOT loop/replay
			expect(audio.currentTime).toBe(73); // repeat-one would have set currentTime=0 — it didn't
			expect(audio.pause).toHaveBeenCalledTimes(1); // finishExpiry paused once
			expect(audio.volume).toBe(1); // pre-fade volume restored (not a degraded value)
			expect(sleepTimer.active).toBe(false); // timer cancelled
			expect(player.next).not.toHaveBeenCalled();
			// The fade is disarmed: advancing past the original FADE_MS does not pause again.
			vi.advanceTimersByTime(10_200);
			expect(audio.pause).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

/**
 * GLN-6: Android background persistence. attach() registers visibilitychange/pagehide/freeze
 * listeners that flush the EXACT current position to localStorage IMMEDIATELY (bypassing the 2s
 * persistThrottled window), so a process eviction / tab freeze never persists a stale (pre-roll)
 * currentTime → the "restores to 0" bug. The DESKTOP-verifiable invariant — an immediate
 * localStorage write of the exact currentTime on hide — is what these tests prove; the real
 * Android resume-from-saved-position is device-dependent and verified separately on hardware.
 *
 * In the node vitest project document/window are normally undefined, so we install minimal
 * event-registry stubs so attach() registers the listeners and a test can dispatch them.
 */
describe('player.flushPersist — immediate position flush on hide/freeze/pagehide (GLN-6)', () => {
	const STATE_KEY = 'openmusic:player:v1';
	type Reg = {
		_h: Map<string, Array<(e?: unknown) => void>>;
		addEventListener(t: string, cb: (e?: unknown) => void): void;
		fire(t: string, e?: unknown): void;
	};
	function makeRegistry(extra: Record<string, unknown> = {}): Reg {
		const h = new Map<string, Array<(e?: unknown) => void>>();
		return {
			...extra,
			_h: h,
			addEventListener(t: string, cb: (e?: unknown) => void) {
				const arr = h.get(t) ?? [];
				arr.push(cb);
				h.set(t, arr);
			},
			fire(t: string, e?: unknown) {
				for (const cb of h.get(t) ?? []) cb(e);
			}
		} as Reg;
	}

	const flushPersist = () => (player as unknown as { flushPersist(): void })['flushPersist']();
	const persistTimer = () =>
		(player as unknown as { persistTimer: ReturnType<typeof setTimeout> | null })['persistTimer'];

	beforeEach(() => {
		memStore.clear();
		player.queue = [];
		player.current = mk('netease', 'bg', 'Artist', 'Background Song');
		player.currentTime = 0;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.stubGlobal('localStorage', localStorageMock); // re-establish the module-level stub
	});

	it('flushPersist() writes the EXACT element currentTime immediately (syncs from the element first)', () => {
		const el = makeFakeAudio();
		el.currentTime = 30.5; // element is ahead of the throttled player.currentTime (still 0)
		player.attach(el as unknown as HTMLAudioElement);

		flushPersist();

		const raw = localStorage.getItem(STATE_KEY);
		expect(raw).toBeTruthy();
		const saved = JSON.parse(raw as string);
		expect(saved.currentTime).toBe(30.5); // synced from the live element, not the stale 0
		expect(saved.current.uid).toBe(player.current?.uid);
	});

	it('flushPersist() cancels a pending throttled write so it cannot later clobber with a staler value', () => {
		const el = makeFakeAudio();
		el.currentTime = 12;
		player.attach(el as unknown as HTMLAudioElement);
		// Arm the throttled timer (mirrors a recent timeupdate), then flush.
		(player as unknown as { persistThrottled(): void })['persistThrottled']();
		expect(persistTimer()).not.toBeNull();

		flushPersist();

		expect(persistTimer()).toBeNull(); // throttled write cancelled
		expect(JSON.parse(localStorage.getItem(STATE_KEY) as string).currentTime).toBe(12);
	});

	it('a visibilitychange to hidden flushes the exact position immediately (attach-registered listener)', () => {
		const doc = makeRegistry({ hidden: false });
		const win = makeRegistry();
		vi.stubGlobal('document', doc);
		vi.stubGlobal('window', win);

		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		el.currentTime = 47.25; // user is 47s in when the tab is backgrounded
		(doc as unknown as { hidden: boolean }).hidden = true;

		doc.fire('visibilitychange');

		const saved = JSON.parse(localStorage.getItem(STATE_KEY) as string);
		expect(saved.currentTime).toBe(47.25); // immediate, exact — not the last 2s-throttled value
	});

	it('a visibilitychange while still VISIBLE does NOT flush (only hidden flushes)', () => {
		const doc = makeRegistry({ hidden: false });
		const win = makeRegistry();
		vi.stubGlobal('document', doc);
		vi.stubGlobal('window', win);

		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		el.currentTime = 5;
		// document.hidden stays false (tab still visible) → no flush.
		doc.fire('visibilitychange');

		expect(localStorage.getItem(STATE_KEY)).toBeNull();
	});

	it('a pagehide event flushes the exact position immediately', () => {
		const doc = makeRegistry({ hidden: false });
		const win = makeRegistry();
		vi.stubGlobal('document', doc);
		vi.stubGlobal('window', win);

		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		el.currentTime = 88;

		win.fire('pagehide');

		expect(JSON.parse(localStorage.getItem(STATE_KEY) as string).currentTime).toBe(88);
	});

	it('a freeze event flushes the exact position immediately (Page Lifecycle API)', () => {
		const doc = makeRegistry({ hidden: true });
		const win = makeRegistry();
		vi.stubGlobal('document', doc);
		vi.stubGlobal('window', win);

		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		el.currentTime = 61;

		doc.fire('freeze');

		expect(JSON.parse(localStorage.getItem(STATE_KEY) as string).currentTime).toBe(61);
	});

	it('a pageshow(persisted) re-syncs currentTime + playing from the element without autoplaying', () => {
		const doc = makeRegistry({ hidden: false });
		const win = makeRegistry();
		vi.stubGlobal('document', doc);
		vi.stubGlobal('window', win);

		const el = makeFakeAudio();
		el.paused = false; // element is actually playing after a bfcache restore
		player.attach(el as unknown as HTMLAudioElement);
		el.currentTime = 19;
		player.currentTime = 0; // stale UI state from before the freeze
		player.playing = false;

		win.fire('pageshow', { persisted: true });

		expect(player.currentTime).toBe(19); // re-synced from the live element
		expect(player.playing).toBe(true); // reflects el.paused === false
		expect(el.play).not.toHaveBeenCalled(); // never autoplays
	});

	it('a pageshow that is NOT persisted (normal load) does not re-sync', () => {
		const doc = makeRegistry({ hidden: false });
		const win = makeRegistry();
		vi.stubGlobal('document', doc);
		vi.stubGlobal('window', win);

		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		el.currentTime = 99;
		player.currentTime = 3;

		win.fire('pageshow', { persisted: false });

		expect(player.currentTime).toBe(3); // untouched — full restore() handles a normal load
	});
});

describe('player.play — history-preserving fresh-play queue model (quick-260615-i9u Feature B)', () => {
	// Exercise the REAL play() (restore the global spy) with a fake <audio> + mocked resolve. The
	// captured history is woven in front of the clicked song so prior playback stays in the queue
	// and prev() can revisit it. effectiveUpnextMode→generated with mockSimilar→[] keeps the tail
	// empty so the woven prefix + seed is the whole queue and the assertions are exact.
	let el: ReturnType<typeof makeFakeAudio>;
	const resolved = (s: SourceId, id: string): Track => ({
		...mk(s, id, 'Artist', `Song ${id}`),
		audioUrl: `https://cdn/${id}.mp3`
	});
	// pendingHistory is captured by setQueue/setListQueue. In these tests we set the prior queue +
	// current directly, then capture explicitly via setQueue([seed]) right before the fresh play —
	// mirroring the real call-site order (setQueue → play({fresh:true})).
	const pendingHistoryRef = () =>
		player as unknown as { pendingHistory: Track[] | null };

	beforeEach(() => {
		(player.play as unknown as { mockRestore(): void }).mockRestore?.();
		mockEnsure.mockReset();
		mockSimilar.mockReset().mockResolvedValue([]); // generated tail empty → exact queue assertions
		player.current = null;
		player.queue = [];
		player.queueContext = null;
		player.expanded = false;
		player.error = null;
		player.loading = false;
		pendingHistoryRef().pendingHistory = null;
		// quick-260618-ink: clear manual provenance so a manual uid added by one test (view-slice
		// manual case) does not leak into the exact-shape assertions of the others.
		(player as unknown as { manualUids: Set<string> }).manualUids.clear();
		(player as unknown as { pendingManual: Track[] | null }).pendingManual = null;
		vi.stubGlobal('navigator', { onLine: true });
		el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
		settings.autoExpandOnPlay = false;
		settings.upnextMode = 'generated'; // null/search context → 'generated'
		settings.upnextPerContext = {};
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		settings.upnextMode = 'generated';
		settings.upnextPerContext = {};
	});

	/** Seed a prior queue + current, then capture history exactly as a real fresh-play call site does
	 *  (setQueue installs the [clicked] snapshot AND captures the pre-wipe prefix). */
	function seedPriorAndCapture(prior: Track[], current: Track, clicked: Track) {
		player.queue = prior;
		player.current = current;
		// setQueue captures the pre-wipe history (up to+including current) into pendingHistory.
		player.setQueue([clicked], 'search');
	}

	it('a fresh play preserves capped history + prior current, inserts clicked song after it', async () => {
		const h0 = resolved('netease', 'H0');
		const h1 = resolved('netease', 'H1');
		const pc = resolved('netease', 'PC');
		const oldA = resolved('netease', 'OLDA');
		const X = resolved('qq', 'X');
		seedPriorAndCapture([h0, h1, pc, oldA], pc, X);
		mockEnsure.mockResolvedValue(X);

		await player.play(X, { fresh: true });
		await flush();

		// History (h0,h1) + prior current (pc) kept; X inserted right after pc as the new current.
		expect(player.queue.map((t) => t.uid)).toEqual([h0.uid, h1.uid, pc.uid, X.uid]);
		expect(player.current?.uid).toBe(X.uid);
		expect(player.queue.findIndex((t) => t.uid === X.uid)).toBe(3);
	});

	// quick-260618-ink: the LIST is rendered as player.queue.slice(currentIndex); the store keeps
	// history BEFORE current (for prev()/carousel) so this view-slice is what the user actually sees.
	it('quick-260618-ink: store keeps history before current; view-slice from current yields [current, ...tail]', async () => {
		const h0 = resolved('netease', 'H0');
		const h1 = resolved('netease', 'H1');
		const pc = resolved('netease', 'PC');
		const X = resolved('qq', 'X');
		seedPriorAndCapture([h0, h1, pc], pc, X);
		mockEnsure.mockResolvedValue(X);

		await player.play(X, { fresh: true });
		await flush();

		// STORE shape UNCHANGED: history (h0,h1) + prior current (pc) still BEFORE new current X —
		// proves prev()/cover-carousel inputs survive (they read the unsliced queue).
		expect(player.queue.map((t) => t.uid)).toEqual([h0.uid, h1.uid, pc.uid, X.uid]);

		// VIEW-SLICE contract the component uses: slice from current index forward → [current, ...tail].
		const ci = player.queue.findIndex((t) => t.uid === player.current?.uid);
		expect(player.queue.slice(ci).map((t) => t.uid)).toEqual([X.uid]); // tail empty (mockSimilar→[])
		expect(player.queue.slice(ci)[0].uid).toBe(player.current?.uid); // first visible row IS current
	});

	it('quick-260618-ink: a manual entry survives in the view-slice immediately after current', async () => {
		const h0 = resolved('netease', 'H0');
		const pc = resolved('netease', 'PC');
		const M = resolved('kuwo', 'M'); // manually-queued track
		const X = resolved('qq', 'X');
		// Register M's manual provenance the way the 260618-fiz Fix 4 tests do, then seed it into the
		// prior queue so setQueue's captureManual() carries it across the fresh-play wipe.
		(player as unknown as { manualUids: Set<string> }).manualUids.add(M.uid);
		seedPriorAndCapture([h0, pc, M], pc, X);
		mockEnsure.mockResolvedValue(X);

		await player.play(X, { fresh: true });
		await flush();

		// View-slice from current: M (manual) appears right after the new current X.
		const ci = player.queue.findIndex((t) => t.uid === player.current?.uid);
		expect(player.queue.slice(ci).map((t) => t.uid)).toEqual([X.uid, M.uid]);
		// And the store still keeps history before current (shape unchanged).
		expect(player.queue.map((t) => t.uid)).toEqual([h0.uid, pc.uid, X.uid, M.uid]);
	});

	it('prev() after a fresh click revisits the prior current', async () => {
		const h0 = resolved('netease', 'H0');
		const pc = resolved('netease', 'PC');
		const X = resolved('qq', 'X');
		seedPriorAndCapture([h0, pc], pc, X);
		mockEnsure.mockResolvedValue(X);
		await player.play(X, { fresh: true });
		await flush();
		// queue == [h0, pc, X], current == X at index 2.
		expect(player.queue.map((t) => t.uid)).toEqual([h0.uid, pc.uid, X.uid]);

		// prev() back-walks into history → plays queue[1] === pc. Guard the >3s restart: currentTime=0.
		el.currentTime = 0;
		const playSpy = vi.spyOn(player, 'play');
		player.prev();
		expect(playSpy.mock.calls[0][0].uid).toBe(pc.uid);
	});

	it('history is capped to HISTORY_CAP (oldest dropped)', async () => {
		const CAP = 50;
		const head: Track[] = [];
		for (let n = 0; n < 60; n++) head.push(resolved('netease', `E${n}`));
		const pc = head[head.length - 1]; // last head entry is the prior current
		const X = resolved('qq', 'X');
		seedPriorAndCapture(head, pc, X);
		mockEnsure.mockResolvedValue(X);

		await player.play(X, { fresh: true });
		await flush();

		// 60 pre-current entries (incl. pc) capped to the LAST 50 → oldest 10 (E0..E9) dropped.
		const kept = player.queue.slice(0, player.queue.findIndex((t) => t.uid === X.uid));
		expect(kept.length).toBe(CAP);
		expect(kept[0].uid).toBe(head[60 - CAP].uid); // queue[0] === E10
		expect(player.queue[CAP].uid).toBe(X.uid); // seed at the cap boundary
	});

	it('re-click of an already-played song moves it to new-current (no duplicate)', async () => {
		const h0 = resolved('netease', 'H0');
		const pc = resolved('netease', 'PC');
		const old = resolved('netease', 'OLD');
		// Re-click h0 (already in history). It must MOVE to the new-current slot, not duplicate.
		seedPriorAndCapture([h0, pc, old], pc, h0);
		mockEnsure.mockResolvedValue(h0);

		await player.play(h0, { fresh: true });
		await flush();

		// h0 appears exactly once, as the new current immediately after the prior current pc.
		expect(player.queue.filter((t) => t.uid === h0.uid).length).toBe(1);
		expect(player.current?.uid).toBe(h0.uid);
		expect(player.queue.map((t) => t.uid)).toEqual([pc.uid, h0.uid]);
	});

	it('same-list fresh play keeps history and the list remainder as the tail', async () => {
		// effectiveUpnextMode→same-list: setListQueue installs [X, a, b] + captures pendingHistory=[h0,pc];
		// play({fresh}) weaves history → [h0, pc, X, a, b] (pc ahead of X; a,b the list remainder).
		settings.upnextPerContext = { album: 'same-list' };
		const h0 = resolved('netease', 'H0');
		const pc = resolved('netease', 'PC');
		const X = resolved('qq', 'X');
		const a = resolved('kuwo', 'A');
		const b = resolved('joox', 'B');
		player.queue = [h0, pc];
		player.current = pc;
		player.queueContext = 'album';
		mockEnsure.mockResolvedValue(X);
		// Real call-site order for the album/same-list path: play(X,{fresh}) THEN setListQueue.
		// setListQueue captures pendingHistory=[h0,pc] (pre-current slice incl. pc) and installs the list.
		player.setListQueue([X, a, b], 'album');
		await player.play(X, { fresh: true });
		await flush();

		expect(player.queue.map((t) => t.uid)).toEqual([h0.uid, pc.uid, X.uid, a.uid, b.uid]);
		expect(player.current?.uid).toBe(X.uid);
	});
});

describe('player reactive unplayableUids — isUnplayable + retryUnplayable (quick-260615-i9u Feature A)', () => {
	// Store-level coverage (no DOM): the SvelteSet swap is the reactive mechanism; the component
	// reads it via isUnplayable() per-row so the Up-Next list repaints on mark/unmark. The reactive
	// REPAINT itself is a Svelte-template concern, not unit-testable here — we cover the public API.
	const deadSet = () =>
		(player as unknown as { unplayableUids: { add(u: string): void; delete(u: string): boolean } })
			.unplayableUids;

	it('isUnplayable reflects the reactive set', () => {
		const t = mk('netease', 'D', 'A', 'Dead');
		expect(player.isUnplayable(t.uid)).toBe(false);
		deadSet().add(t.uid);
		expect(player.isUnplayable(t.uid)).toBe(true);
		deadSet().delete(t.uid);
		expect(player.isUnplayable(t.uid)).toBe(false);
	});

	it('retryUnplayable clears the uid and replays that exact track (non-fresh)', () => {
		const t = mk('netease', 'D', 'A', 'Dead');
		deadSet().add(t.uid);
		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();
		player.retryUnplayable(t);
		expect(player.isUnplayable(t.uid)).toBe(false);
		expect(playSpy).toHaveBeenCalledWith(t, { fresh: false });
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// debug-playback-skip-and-autoplay (Bug 1): strike-counter before permanent mark.
// prefetchNext no longer marks a uid PERMANENTLY dead on the FIRST definitive failure (no-url
// resolve OR a hard probe `error`). Each definitive failure takes ONE strike; only at STRIKE_CAP
// (=2) is the uid promoted into the reactive unplayableUids set. A first failure behaves like a
// probe timeout (skip this walk, NOT marked dead, retry on demand) — killing the "skipped but plays
// fine on re-click" false-permanent-skip. A real `playing` clears the strike.
// ─────────────────────────────────────────────────────────────────────────────
describe('player.prefetchNext — strike counter before permanent unplayable mark (Bug 1)', () => {
	const prefetch = () => (player as unknown as { prefetchNext(): Promise<void> })['prefetchNext']();
	const strikes = () =>
		(player as unknown as { unplayableStrikes: Map<string, number> }).unplayableStrikes;
	const dead = () =>
		(player as unknown as {
			unplayableUids: { add(u: string): void; has(u: string): boolean; delete(u: string): boolean };
		}).unplayableUids;

	it('a SINGLE no-url resolve does NOT mark the track dead (strike 1 only)', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const bad = stub('qq', '1', 'B', 'NoUrl');
		player.queue = [cur, bad];
		player.current = cur;
		mockEnsure.mockImplementation(async (t: Track) =>
			t.uid === bad.uid ? { ...bad, detailsLoaded: true, audioUrl: null } : t
		);

		await prefetch();
		await flush();

		// First definitive failure → struck once, NOT promoted to dead (retryable on demand).
		expect(strikes().get(bad.uid)).toBe(1);
		expect(dead().has(bad.uid)).toBe(false);
	});

	it('a SECOND no-url resolve reaches STRIKE_CAP but is NOT yet dead — it ARMS a delayed re-resolve instead (quick-260627-huo)', async () => {
		// REWORKED for quick-260627-huo: pre-huo this asserted "strike 2 → immediately dead". The user
		// reported a genuinely-playable Next-up song being permanently sidelined because two quick
		// transient blips reached STRIKE_CAP. The fix replaces "strike 2 → dead" with "strike 2 → undo
		// the premature promotion + schedule a delayed fresh re-resolve" (death is deferred until the
		// bounded delayed re-resolves are exhausted — proven in the delayed-re-resolve suite). So the
		// CORRECT new behavior at strike 2 is: the strike IS recorded (accounting unchanged), the uid is
		// NOT in unplayableUids yet, and a delayed-retry timer is now pending. Assertion strengthened,
		// not weakened, to the new contract.
		vi.useFakeTimers();
		try {
			const cur = mk('netease', '0', 'A', 'Now');
			const bad = stub('qq', '1', 'B', 'NoUrl');
			player.queue = [cur, bad];
			player.current = cur;
			mockEnsure.mockImplementation(async (t: Track) =>
				t.uid === bad.uid ? { ...bad, detailsLoaded: true, audioUrl: null } : t
			);

			// First walk: one strike, still alive.
			await prefetch();
			await vi.advanceTimersByTimeAsync(0);
			expect(dead().has(bad.uid)).toBe(false);

			// Re-arm the in-flight guard so the second walk runs (mirror the per-src re-arm in play()).
			(player as unknown as { prefetchingUid: string | null }).prefetchingUid = null;

			// Second walk: second strike → reaches STRIKE_CAP. The strike IS recorded, but the uid is NOT
			// promoted to dead — a bounded delayed re-resolve is armed instead (the fix).
			await prefetch();
			await vi.advanceTimersByTimeAsync(0);
			expect(strikes().get(bad.uid)).toBe(2);
			expect(dead().has(bad.uid)).toBe(false);
			const timers = (player as unknown as {
				retryResolveTimers: Map<string, ReturnType<typeof setTimeout>>;
			}).retryResolveTimers;
			expect(timers.has(bad.uid)).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('a real `playing` event clears the current track strike (a recovered track resets clean)', () => {
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		const t = mk('netease', '0', 'A', 'Now');
		player.current = t;
		// Seed a sub-cap strike (as a prior transient prefetch failure would).
		strikes().set(t.uid, 1);
		expect(strikes().get(t.uid)).toBe(1);

		// The track actually produces audio — the success path drops its strike.
		el.fire('playing');
		expect(strikes().has(t.uid)).toBe(false);
	});

	it('clearQueue and retryUnplayable both clear the strike budget (lockstep with unplayableUids)', () => {
		const t = mk('netease', '0', 'A', 'Now');
		// clearQueue clears all strikes.
		player.current = t;
		strikes().set(t.uid, 1);
		player.clearQueue();
		expect(strikes().has(t.uid)).toBe(false);

		// retryUnplayable clears the per-uid strike too.
		strikes().set(t.uid, 1);
		dead().add(t.uid);
		player.retryUnplayable(t);
		expect(strikes().has(t.uid)).toBe(false);
		expect(dead().has(t.uid)).toBe(false);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// debug-playback-skip-and-autoplay (Bug 2): auto-advance autoplay-rejection → single re-play, and
// the stall watchdog must NOT cross-source-swap a loaded-but-autoplay-paused track. On a non-fresh
// advance, the async ensureTrackDetails resolve discards user activation, so audio.play() rejects on
// mobile and the next playable track sits current-but-paused. The fix arms a SINGLE event-driven
// re-play (gen-guarded, only when readyState >= HAVE_CURRENT_DATA), and gates runFallback in the
// watchdog behind a genuine no-bytes stall.
// ─────────────────────────────────────────────────────────────────────────────
describe('player resilience — autoplay-rejection retry + readyState-gated watchdog (Bug 2)', () => {
	const HAVE_CURRENT_DATA = 2;
	const armStall = () => (player as unknown as { armStall(): void })['armStall']();
	const setPlayed = (v: boolean) => {
		(player as unknown as { hasPlayedSinceSrc: boolean })['hasPlayedSinceSrc'] = v;
	};
	const setArmed = (v: boolean) => {
		(player as unknown as { autoplayRetryArmed: boolean })['autoplayRetryArmed'] = v;
	};
	let runFallbackSpy: ReturnType<typeof vi.spyOn>;
	let reresolveSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.useFakeTimers();
		player.current = mk('netease', 's', 'A', 'AutoplayPaused');
		player.queue = [player.current];
		setPlayed(false);
		setArmed(false);
		(player as unknown as { stallRetried: boolean })['stallRetried'] = false;
		runFallbackSpy = vi
			.spyOn(player as unknown as { runFallback(f: Track): Promise<void> }, 'runFallback')
			.mockResolvedValue(undefined);
		reresolveSpy = vi
			.spyOn(player as unknown as { reresolveCurrent(): Promise<void> }, 'reresolveCurrent')
			.mockResolvedValue(undefined);
	});

	afterEach(() => {
		(player as unknown as { disarmStall(): void })['disarmStall']();
		vi.useRealTimers();
	});

	it('watchdog: a loaded-but-paused element (readyState >= 2, autoplay-rejected) re-plays ONCE and does NOT runFallback', () => {
		const el = makeFakeAudio();
		el.paused = true;
		(el as unknown as { readyState: number }).readyState = HAVE_CURRENT_DATA; // bytes present
		el.src = 'https://cdn/loaded.mp3';
		player.attach(el as unknown as HTMLAudioElement);
		setArmed(true); // a non-fresh advance recorded the autoplay rejection

		armStall();
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);

		// Loaded + paused = autoplay-policy pause → single re-play, NO cross-source swap.
		expect(el.play).toHaveBeenCalledTimes(1);
		expect(runFallbackSpy).not.toHaveBeenCalled();
	});

	it('watchdog: a genuine no-bytes stall (readyState < 2) RETRIES the same song once (bg-lockscreen-stall-noskip)', () => {
		const el = makeFakeAudio();
		el.paused = true;
		(el as unknown as { readyState: number }).readyState = 0; // HAVE_NOTHING — no bytes
		el.src = 'https://cdn/dead.mp3';
		player.attach(el as unknown as HTMLAudioElement);
		setArmed(true);

		armStall();
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);

		// No bytes → a real load stall → retry the SAME song once (a second stall then skips). This
		// replaced the straight-to-runFallback behavior so the user's retry-once-then-skip spec holds.
		expect(reresolveSpy).toHaveBeenCalledTimes(1);
		expect(runFallbackSpy).not.toHaveBeenCalled();
		expect(el.play).not.toHaveBeenCalled();
	});

	it('canplay seam: an armed retry fires a single play() once bytes arrive (gen-guarded, one-shot)', () => {
		const el = makeFakeAudio();
		el.paused = true;
		(el as unknown as { readyState: number }).readyState = 0; // not loaded at play()-time
		el.src = 'https://cdn/loading.mp3';
		player.attach(el as unknown as HTMLAudioElement);
		setArmed(true);

		// Bytes not present yet — canplay before readyState is a no-op (still waiting).
		el.fire('canplay');
		expect(el.play).not.toHaveBeenCalled();

		// Bytes arrive: canplay re-attempts the single play() exactly once.
		(el as unknown as { readyState: number }).readyState = HAVE_CURRENT_DATA;
		el.fire('canplay');
		expect(el.play).toHaveBeenCalledTimes(1);

		// One-shot: a later canplay does NOT re-fire (arm was consumed).
		el.fire('canplay');
		expect(el.play).toHaveBeenCalledTimes(1);
	});

	it('a `pause` event clears the autoplay-retry arm so the watchdog never fights a genuine pause', () => {
		const el = makeFakeAudio();
		el.paused = true;
		(el as unknown as { readyState: number }).readyState = HAVE_CURRENT_DATA;
		el.src = 'https://cdn/loaded.mp3';
		player.attach(el as unknown as HTMLAudioElement);
		setArmed(true);

		// User pauses (or the swallowed rejection surfaced a pause) → arm cleared.
		el.fire('pause');

		armStall();
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		// Arm gone → maybeRetryAutoplay no-ops; loaded+paused still blocks runFallback (right remedy:
		// leave paused, user/Media-Session play resumes). No re-play, no swap.
		expect(el.play).not.toHaveBeenCalled();
		expect(runFallbackSpy).not.toHaveBeenCalled();
	});
});

describe('player.upNextAnchorUid — Up-Next list anchor (quick-260618-lsw)', () => {
	// The anchor is the uid the Up-Next LIST slices from. It is set ONLY on a fresh play / new-list
	// install and is LEFT PUT by next()/prev()/auto-advance — so the just-played song stays in the
	// list while the now-playing highlight moves down. The global beforeEach stubs player.play (which
	// never writes the anchor), so the next()/prev() tests below exercise the NON-fresh path correctly
	// (anchor must stay unchanged). Test 2 restores the REAL play() so the fresh-branch anchor write
	// actually runs.
	beforeEach(() => {
		player.upNextAnchorUid = null;
		player.queue = [];
		player.current = null;
	});

	it('Test 1 — auto-advance (next()) keeps the anchor; the played song stays in the slice (LSW-01)', async () => {
		const a = mk('netease', 'la1', 'A', 'First');
		const b = mk('qq', 'la2', 'B', 'Second');
		const c = mk('kuwo', 'la3', 'C', 'Third');
		player.queue = [a, b, c];
		player.upNextAnchorUid = a.uid; // simulate a fresh play landed on `a`
		player.current = a;
		mockEnsure.mockResolvedValue(b);

		player.next(); // auto-advance / skip → non-fresh play(b)
		await flush();

		expect(player.current?.uid).toBe(b.uid); // highlight moved
		expect(player.upNextAnchorUid).toBe(a.uid); // anchor UNCHANGED
		// The view would slice the queue from the anchor's live index — the played song `a` is still in it.
		const slice = player.queue.slice(
			player.queue.findIndex((t) => t.uid === player.upNextAnchorUid)
		);
		expect(slice.some((t) => t.uid === a.uid)).toBe(true);
	});

	it('Test 2 — a fresh play resets the anchor to the new clicked song (LSW-02)', async () => {
		const a = mk('netease', 'lb1', 'A', 'First');
		const b = mk('qq', 'lb2', 'B', 'Second');
		const c = mk('kuwo', 'lb3', 'C', 'Clicked');
		player.queue = [a, b];
		player.upNextAnchorUid = a.uid;
		player.current = a;
		mockEnsure.mockResolvedValue(c);

		// The surrounding beforeEach stubs play(); restore the REAL method so the fresh-branch
		// anchor write executes.
		(player.play as unknown as ReturnType<typeof vi.fn>).mockRestore();

		await player.play(c, { fresh: true });
		await flush();

		expect(player.upNextAnchorUid).toBe(c.uid); // the clicked song is the anchor → first row
		// And the anchor IS the slice start: its live index equals indexOf(c) in the woven queue.
		const anchorIdx = player.queue.findIndex((t) => t.uid === player.upNextAnchorUid);
		const cIdx = player.queue.findIndex((t) => t.uid === c.uid);
		expect(anchorIdx).toBe(cIdx);
	});

	it('Test 3 — anchor survives reorder/removal; a missing anchor clamps to ci (LSW-03)', () => {
		const a = mk('netease', 'lc1', 'A', 'First');
		const b = mk('qq', 'lc2', 'B', 'Second');
		const c = mk('kuwo', 'lc3', 'C', 'Third');
		const d = mk('joox', 'lc4', 'D', 'Fourth');
		player.queue = [a, b, c, d];
		player.upNextAnchorUid = b.uid;
		player.current = b;

		// Move `b` (index 1) to the back — the by-uid lookup tracks the move.
		player.reorderQueue(1, 3);
		expect(player.queue.findIndex((t) => t.uid === player.upNextAnchorUid)).toBe(
			player.queue.findIndex((t) => t.uid === b.uid)
		);
		expect(player.queue.find((t) => t.uid === player.upNextAnchorUid)?.uid).toBe(b.uid);

		// Remove a non-current, non-anchor track — anchor still resolves to `b`.
		player.removeFromQueue(d.uid);
		expect(player.queue.findIndex((t) => t.uid === player.upNextAnchorUid)).toBe(
			player.queue.findIndex((t) => t.uid === b.uid)
		);

		// Missing-anchor clamp: replicate the NowPlaying derivation inline. When the anchor uid is gone
		// from the queue, upNextStart falls back to the live current index `ci` (never a blank list).
		player.upNextAnchorUid = 'nonexistent-uid';
		const anchorIdx = player.upNextAnchorUid
			? player.queue.findIndex((t) => t.uid === player.upNextAnchorUid)
			: -1;
		const ci = player.queue.findIndex((t) => t.uid === player.current?.uid);
		const upNextStart = anchorIdx >= 0 ? anchorIdx : ci >= 0 ? ci : 0;
		expect(anchorIdx).toBe(-1);
		expect(upNextStart).toBe(ci); // clamped to the live current index
	});

	it('Test 4 — prev() leaves the anchor unchanged (guard)', async () => {
		const a = mk('netease', 'ld1', 'A', 'First');
		const b = mk('qq', 'ld2', 'B', 'Second');
		player.queue = [a, b];
		player.upNextAnchorUid = b.uid;
		player.current = b;
		mockEnsure.mockResolvedValue(a);

		player.prev(); // non-fresh play(a) — only the highlight moves up
		await flush();

		expect(player.current?.uid).toBe(a.uid);
		expect(player.upNextAnchorUid).toBe(b.uid); // anchor put
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// debug-midplay-stall-background: RESPECT EXTERNAL PAUSE (the external-pause self-heal was REMOVED).
// The old design re-issued audio.play() from the `pause` listener for any non-deliberate pause. Because
// a successful re-play fires `playing`, which reset the per-src budget, the cap never engaged and the
// player fought an external audio-focus holder ~2×/sec forever (log Pattern A — the voice-note
// interference). Per the user's target spec the player now RESPECTS any pause: a non-deliberate pause
// (Android audio-focus loss / background throttle / headphone unplug) is left paused, and a
// background-stalled track is recovered ONLY on foreground return (resumeIfStalled). These tests lock in
// "never force-play against a pause".
// ─────────────────────────────────────────────────────────────────────────────
describe('player — respects external pause (no self-heal fight, debug-midplay-stall-background)', () => {
	const DEBOUNCE_MS = 400; // a generous window; nothing should ever schedule a re-play now
	type Internals = {
		hasPlayedSinceSrc: boolean;
		deliberatePause: boolean;
		resumeTimer: ReturnType<typeof setTimeout> | null;
		audio: HTMLAudioElement | null;
		playGen: number;
		disarmResume(): void;
		pauseAudio(): void;
	};
	const internals = () => player as unknown as Internals;
	const setPlayed = (v: boolean) => (internals().hasPlayedSinceSrc = v);

	beforeEach(() => {
		vi.useFakeTimers();
		player.current = mk('netease', 'eh', 'A', 'ExternalHeal');
		player.queue = [player.current];
		setPlayed(false);
		internals().deliberatePause = false;
		internals().disarmResume();
	});

	afterEach(() => {
		internals().disarmResume();
		vi.useRealTimers();
	});

	/** Attach a fake audio in the "played ~1s, mid-track" state (the exact reported signature). */
	function attachMidPlayback() {
		const el = makeFakeAudio();
		el.paused = true; // the external pause already flipped paused true
		el.src = 'https://cdn/playing.mp3';
		el.currentTime = 1; // ~1s in
		el.duration = 200; // plenty of time remaining
		(el as unknown as { ended: boolean }).ended = false;
		player.attach(el as unknown as HTMLAudioElement);
		setPlayed(true); // a real `playing` already fired for this src
		return el;
	}

	it('does NOT re-play an EXTERNAL (non-deliberate) pause on a played, mid-track element — the pause is respected', () => {
		const el = attachMidPlayback();

		el.fire('pause'); // external — no deliberatePause flag set
		// No scheduled resume, no re-play — not now, not after any debounce window.
		expect(internals().resumeTimer).toBeNull();
		vi.advanceTimersByTime(DEBOUNCE_MS * 5);
		expect(el.play).not.toHaveBeenCalled(); // never fought the OS / external focus holder
	});

	it('does NOT re-play repeated external pauses (no unbounded fight loop against audio focus)', () => {
		const el = attachMidPlayback();
		for (let i = 0; i < 5; i++) {
			el.paused = true;
			el.fire('pause');
			vi.advanceTimersByTime(DEBOUNCE_MS);
		}
		expect(el.play).not.toHaveBeenCalled(); // Pattern A can no longer happen — zero forced resumes
	});

	it('consumes the deliberate-pause flag on a deliberate pause (user toggle) without re-playing', () => {
		const el = attachMidPlayback();
		el.paused = false; // currently playing — toggle() will pause it

		player.toggle(); // user tap → pauseAudio() sets deliberatePause, then audio.pause()
		expect(el.pause).toHaveBeenCalledTimes(1);
		el.paused = true;
		el.fire('pause'); // the resulting pause event — deliberate flag consumed, no re-play
		expect(internals().deliberatePause).toBe(false); // consumed
		vi.advanceTimersByTime(DEBOUNCE_MS);
		expect(el.play).not.toHaveBeenCalled();
	});

	it('a MediaSession pause action is respected — no re-play (routes through pauseAudio)', () => {
		const el = attachMidPlayback();
		el.paused = false; // currently playing
		internals().pauseAudio(); // the MediaSession 'pause' handler routes through pauseAudio()
		expect(el.pause).toHaveBeenCalledTimes(1);
		el.paused = true;
		el.fire('pause');
		vi.advanceTimersByTime(DEBOUNCE_MS);
		expect(el.play).not.toHaveBeenCalled();
	});

	it('a headphone-unplug pause is respected — never resumed to the phone speaker', () => {
		const el = attachMidPlayback();
		el.paused = true;
		el.fire('pause'); // the browser "becoming noisy" pause on unplug — must stay paused
		vi.advanceTimersByTime(DEBOUNCE_MS);
		expect(el.play).not.toHaveBeenCalled();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// quick-260630-q03: NEVER-STOP on a dead up-next tail. When the next up-next tracks are all in
// unplayableUids, advancing must NOT stop. The advance retries each dead track ONCE (in queue order)
// before skipping it; an all-dead-and-retried tail grows more up-next and continues. A dead track is
// retried at most once per session (retriedDeadUids) so the retry can never become an infinite loop.
// ─────────────────────────────────────────────────────────────────────────────
describe('player resilience — never-stop on a dead up-next tail (quick-260630-q03)', () => {
	type Internals = {
		unplayableUids: { add(u: string): void; has(u: string): boolean; delete(u: string): boolean; clear(): void };
		retriedDeadUids: Set<string>;
	};
	const internals = () => player as unknown as Internals;
	const playCalls = () => vi.mocked(player.play).mock.calls;

	it('retries the next dead tracks ONE-BY-ONE in queue order, then lands the first playable one', () => {
		const cur = mk('netease', 'q3a0', 'A', 'Cur');
		const d1 = mk('qq', 'q3a1', 'B', 'Dead1');
		const d2 = mk('kuwo', 'q3a2', 'C', 'Dead2');
		const d3 = mk('joox', 'q3a3', 'D', 'Dead3');
		const good = mk('netease', 'q3a4', 'E', 'Good');
		player.queue = [cur, d1, d2, d3, good];
		player.current = cur;
		internals().unplayableUids.add(d1.uid);
		internals().unplayableUids.add(d2.uid);
		internals().unplayableUids.add(d3.uid);
		vi.mocked(player.play).mockClear();

		player.next(); // → retry d1 (the play stub sets current=d1)
		player.next(); // current=d1 → retry d2
		player.next(); // current=d2 → retry d3
		player.next(); // current=d3 → advance to the playable `good`

		const calls = playCalls();
		expect(calls.map((c) => c[0])).toEqual([d1, d2, d3, good]);
		// the three dead retries are NON-fresh re-plays; the playable one is a plain advance (no opts).
		expect(calls[0][1]).toEqual({ fresh: false });
		expect(calls[1][1]).toEqual({ fresh: false });
		expect(calls[2][1]).toEqual({ fresh: false });
		expect(calls[3][1]).toBeUndefined();
	});

	it('retries a dead track AT MOST once — a dead-and-already-retried track is skipped, never re-retried', () => {
		const cur = mk('netease', 'q3b0', 'A', 'Cur');
		const d1 = mk('qq', 'q3b1', 'B', 'DeadRetried');
		const good = mk('kuwo', 'q3b2', 'C', 'Good');
		player.queue = [cur, d1, good];
		player.current = cur;
		internals().unplayableUids.add(d1.uid);
		internals().retriedDeadUids.add(d1.uid); // already had its one retry this session
		vi.mocked(player.play).mockClear();

		player.next();

		// d1 is routed past (no second retry); the advance lands the playable `good` directly.
		expect(playCalls().map((c) => c[0])).toEqual([good]);
	});

	it('an all-dead-and-retried tail GROWS more up-next and continues instead of stopping', async () => {
		const cur = mk('netease', 'q3c0', 'A', 'Cur');
		const d1 = mk('qq', 'q3c1', 'B', 'DeadRetried');
		const grown = mk('kuwo', 'q3c2', 'C', 'Grown');
		player.queue = [cur, d1];
		player.current = cur;
		internals().unplayableUids.add(d1.uid);
		internals().retriedDeadUids.add(d1.uid); // tail dead AND already retried → nextAdvanceIndex == -1
		mockSimilar.mockReset().mockResolvedValue([grown]); // ensureAhead appends a fresh related track
		vi.mocked(player.play).mockClear();

		player.next(); // -1 in-queue → ensureAhead grows → advance into `grown`
		await flush();
		await flush();

		expect(mockSimilar).toHaveBeenCalled(); // it grew rather than silently stopping
		expect(playCalls().map((c) => c[0])).toContainEqual(grown);
	});

	it('the retry runs on current-song-end (the `ended` listener advances via next())', () => {
		const cur = mk('netease', 'q3d0', 'A', 'Cur');
		const d1 = mk('qq', 'q3d1', 'B', 'Dead1');
		const good = mk('kuwo', 'q3d2', 'C', 'Good');
		player.queue = [cur, d1, good];
		player.current = cur;
		player.repeatMode = 'off';
		internals().unplayableUids.add(d1.uid);
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		vi.mocked(player.play).mockClear();

		el.fire('ended'); // track ends → ended listener → next() → retry the dead next track

		expect(playCalls()[0][0]).toBe(d1);
		expect(playCalls()[0][1]).toEqual({ fresh: false });
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// debug-reresolve-loop-stops-playback → simplified in debug-midplay-stall-background: the
// audio.error → hasPlayedSinceSrc → reresolveCurrent() path (post-playback stall recovery) is now capped
// at ONE in-place same-src re-resolve. A single re-resolve recovers a genuinely transient mid-track
// buffer/CDN blip without restarting the song; a SECOND error before any `playing` means the URL is
// persistently dead (e.g. a netease region-lock byte-stream 403 — log Pattern B), so the error path
// STOPS re-resolving and falls through to the cross-source fallback + advance (SKIP). This replaces the
// old cap of 3, which wasted re-resolves on a dead URL and helped drive the mid-play stall storm.
// ─────────────────────────────────────────────────────────────────────────────
describe('player resilience — single post-playback re-resolve then skip (debug-midplay-stall-background)', () => {
	const RERESOLVE_CAP = 1;
	type Internals = {
		hasPlayedSinceSrc: boolean;
		reresolveBurst: number;
		lastSeekAt: number;
		reresolveCurrent(): Promise<void>;
		runFallback(t: Track): Promise<void>;
	};
	const internals = () => player as unknown as Internals;

	function attachPlayedErroring() {
		const el = makeFakeAudio();
		el.src = 'https://cdn/dead.mp3';
		el.currentTime = 5; // mid-track (not near end / not 0)
		(el as unknown as { ended: boolean }).ended = false;
		player.current = mk('netease', 'rr0', 'A', 'PostPlayErr');
		player.queue = [player.current];
		player.attach(el as unknown as HTMLAudioElement);
		internals().hasPlayedSinceSrc = true; // already produced audio
		internals().lastSeekAt = 0; // far in the past → NOT the seek-window reresolve path
		internals().reresolveBurst = 0;
		return el;
	}

	it('caps same-src re-resolve, then falls through to cross-source fallback (no infinite audio.error loop)', () => {
		const el = attachPlayedErroring();
		const reresolveSpy = vi
			.spyOn(internals(), 'reresolveCurrent')
			.mockResolvedValue(undefined);
		const fallbackSpy = vi.spyOn(internals(), 'runFallback').mockResolvedValue(undefined);

		// A persistently-dead URL: every error re-triggers the post-playback branch.
		for (let i = 0; i < RERESOLVE_CAP + 3; i++) el.fire('error');

		expect(reresolveSpy).toHaveBeenCalledTimes(RERESOLVE_CAP); // bounded — NOT once per error
		expect(fallbackSpy).toHaveBeenCalled(); // fell through to advance instead of looping forever
	});

	it('a real `playing` between errors refunds the budget (a transient mid-track stall still recovers in place)', () => {
		const el = attachPlayedErroring();
		const reresolveSpy = vi
			.spyOn(internals(), 'reresolveCurrent')
			.mockResolvedValue(undefined);
		const fallbackSpy = vi.spyOn(internals(), 'runFallback').mockResolvedValue(undefined);

		// Each error recovers with a real `playing` → reresolveBurst resets, never reaching the cap.
		for (let i = 0; i < RERESOLVE_CAP + 3; i++) {
			el.fire('error');
			el.fire('playing');
		}

		expect(fallbackSpy).not.toHaveBeenCalled(); // never fell through — each transient recovered
		expect(reresolveSpy.mock.calls.length).toBeGreaterThan(RERESOLVE_CAP); // re-resolved every time
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// debug-bg-no-pill-split-play-stop (Option B): when a track that ALREADY produced audio
// (hasPlayedSinceSrc) errors while the tab is HIDDEN, the single in-place re-resolve fails again in
// the background, and the OLD behavior handed off to runFallback → play(swap) — a fire-and-forget
// audio.play() that never re-reaches `playing` in a hidden WebView, so the element sat paused
// ("split-second then stop, resumes only on foreground"). i7e removed the only foreground resume, so
// nothing recovered it. Option B instead SKIPS to the next track (via the existing next() advance/skip
// path) when the re-resolve cap is hit while hidden — the action log shows subsequent tracks play
// cleanly in the background. This is scoped to document.hidden + hasPlayedSinceSrc, so a FOREGROUND
// error still gets the richer cross-source runFallback recovery, and an external audio-focus loss
// (voice note) — which fires `pause`, not `audio.error` — never triggers a skip or a resume (i7e's
// "do not fight the OS" mandate stays intact).
// ─────────────────────────────────────────────────────────────────────────────
describe('player resilience — background stream-error SKIPS to next (debug-bg-no-pill-split-play-stop)', () => {
	type Internals = {
		hasPlayedSinceSrc: boolean;
		reresolveBurst: number;
		lastSeekAt: number;
		deliberatePause: boolean;
		reresolveCurrent(): Promise<void>;
		runFallback(t: Track): Promise<void>;
		strikeUnplayable(uid: string): boolean;
	};
	const internals = () => player as unknown as Internals;
	const playCalls = () => vi.mocked(player.play).mock.calls;

	/** Stub a global `document` with a settable `hidden` + a no-op addEventListener so attach()'s
	 *  visibilitychange registration doesn't throw under the node test env. */
	function stubDocument(hidden: boolean) {
		vi.stubGlobal('document', { hidden, addEventListener() {} });
	}

	/** Attach a played-then-erroring element for a CURRENT track with a playable NEXT in the queue. */
	function attachPlayedErroringWithNext() {
		const cur = mk('kuwo', 'bgcur', 'A', 'BgCurrent'); // e.g. the logged kuwo:86595321
		const next = mk('kuwo', 'bgnext', 'B', 'BgNext'); // subsequent track plays cleanly in bg
		const el = makeFakeAudio();
		el.src = 'https://cdn/dead-in-bg.mp3';
		el.currentTime = 3; // mid-track — a brief play happened (the audible split-second)
		(el as unknown as { ended: boolean }).ended = false;
		player.queue = [cur, next];
		player.current = cur;
		player.attach(el as unknown as HTMLAudioElement);
		internals().hasPlayedSinceSrc = true; // a real `playing` fired → this IS the post-playback path
		internals().lastSeekAt = 0; // far past → NOT the seek-window reresolve path
		internals().reresolveBurst = 0;
		internals().deliberatePause = false;
		return { el, cur, next };
	}

	it('while HIDDEN, an already-played stream error SKIPS forward on the FIRST error (no hang-prone in-place reresolve, no runFallback)', () => {
		// bg-resolve-gap-stall (Freeze 2): in a frozen background WebView the in-place reresolveCurrent()
		// re-attaches src + awaits `playing`/`error` events that never fire → 0:00 hang until foreground.
		// So a hidden + already-played error now skips straight forward on the FIRST error (subsumes the
		// old post-cap bg-error-skip — one hang-prone in-place attempt is no longer given while hidden).
		stubDocument(true); // tab is backgrounded
		const { el, next } = attachPlayedErroringWithNext();
		const reresolveSpy = vi.spyOn(internals(), 'reresolveCurrent').mockResolvedValue(undefined);
		const fallbackSpy = vi.spyOn(internals(), 'runFallback').mockResolvedValue(undefined);
		vi.mocked(player.play).mockClear();

		el.fire('error'); // hidden + hasPlayedSinceSrc → skip straight forward, no in-place recovery

		expect(reresolveSpy).not.toHaveBeenCalled(); // in-place reresolve would HANG in a frozen bg WebView
		expect(fallbackSpy).not.toHaveBeenCalled(); // did NOT hand off to the stalling cross-source fallback
		// next() advanced to the playable next track (via advanceTo → play). The errored src is left.
		expect(playCalls().map((c) => c[0])).toContainEqual(next);
	});

	it('while HIDDEN, a bg-error-skip STRIKES the errored track so a region-locked batch is not re-churned (bg-resolve-gap-stall round 2)', () => {
		// The log showed the same 5-track region-locked batch bg-error-skipping AGAIN a minute later
		// (bg-error-skip never marked them). Striking the errored track routes prefetch/next past it once
		// it reaches STRIKE_CAP, so a whole dead batch stops being replayed every queue pass.
		stubDocument(true);
		const { el, cur } = attachPlayedErroringWithNext();
		const strikeSpy = vi.spyOn(internals(), 'strikeUnplayable');
		vi.mocked(player.play).mockClear();

		el.fire('error'); // hidden + already-played → bg-error-skip, and now a strike toward routing past

		expect(strikeSpy).toHaveBeenCalledWith(cur.uid);
	});

	it('a FOREGROUND stream-error still uses cross-source runFallback (no premature skip when visible)', () => {
		stubDocument(false); // tab is in the foreground
		const { el } = attachPlayedErroringWithNext();
		const reresolveSpy = vi.spyOn(internals(), 'reresolveCurrent').mockResolvedValue(undefined);
		const fallbackSpy = vi.spyOn(internals(), 'runFallback').mockResolvedValue(undefined);
		vi.mocked(player.play).mockClear();

		el.fire('error'); // one in-place re-resolve
		el.fire('error'); // cap hit → VISIBLE → cross-source fallback (unchanged behavior)

		expect(reresolveSpy).toHaveBeenCalledTimes(1);
		expect(fallbackSpy).toHaveBeenCalled(); // foreground path is preserved — richer recovery
	});

	it('an external (non-deliberate) PAUSE while hidden does NOT skip or resume — no audio.error, no advance', () => {
		stubDocument(true);
		const { el } = attachPlayedErroringWithNext();
		const fallbackSpy = vi.spyOn(internals(), 'runFallback').mockResolvedValue(undefined);
		vi.mocked(player.play).mockClear();

		el.paused = true;
		el.fire('pause'); // an OS audio-focus loss (voice note) — NOT an audio.error

		// The background-error skip is keyed on `audio.error`, so a bare pause triggers neither a skip
		// nor a resume — i7e's "respect external pauses, do not fight the OS" mandate is intact.
		expect(fallbackSpy).not.toHaveBeenCalled();
		expect(playCalls()).toHaveLength(0); // no advance to next, no re-play of current
		expect(el.play).not.toHaveBeenCalled();
	});

	it('traces the logged kuwo:86595321 case: hidden error-after-play advances instead of stalling', () => {
		stubDocument(true);
		// Mirror the log: advance landed kuwo:86595321, resolve.ok, then audio.error hasPlayed:true.
		const cur = mk('kuwo', '86595321', 'A', 'Logged'); // the exact failing uid
		const next = mk('kuwo', '82700827', 'B', 'LoggedNext'); // the track that DID play after
		const el = makeFakeAudio();
		el.src = 'https://cdn/kuwo-86595321.mp3';
		el.currentTime = 3;
		(el as unknown as { ended: boolean }).ended = false;
		player.queue = [cur, next];
		player.current = cur;
		player.attach(el as unknown as HTMLAudioElement);
		internals().hasPlayedSinceSrc = true;
		internals().lastSeekAt = 0;
		internals().reresolveBurst = 0;
		vi.spyOn(internals(), 'reresolveCurrent').mockResolvedValue(undefined);
		const fallbackSpy = vi.spyOn(internals(), 'runFallback').mockResolvedValue(undefined);
		vi.mocked(player.play).mockClear();

		el.fire('error');
		el.fire('error');

		expect(fallbackSpy).not.toHaveBeenCalled();
		expect(playCalls().map((c) => c[0])).toContainEqual(next); // advances, no bg stall
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// background-autoadvance-stall follow-up: play() must reset hasPlayedSinceSrc AT ENTRY, not later at
// src-set (after the async resolve). Otherwise, during the resolve gap `current` is the new track while
// the flag still holds the OLD track's `true`, so a dead new track that errors is misrouted into the
// already-played recovery (reresolveCurrent) instead of the cross-source fallback that advances past it.
// ─────────────────────────────────────────────────────────────────────────────
describe('player resilience — play() resets hasPlayedSinceSrc at entry (background-autoadvance-stall)', () => {
	type Internals = {
		hasPlayedSinceSrc: boolean;
		lastSeekAt: number;
		reresolveBurst: number;
		reresolveCurrent(): Promise<void>;
		runFallback(t: Track): Promise<void>;
	};
	const internals = () => player as unknown as Internals;

	it('resets hasPlayedSinceSrc synchronously at entry, BEFORE the async resolve settles', () => {
		(player.play as unknown as { mockRestore(): void }).mockRestore(); // exercise the REAL play()
		internals().hasPlayedSinceSrc = true; // the previous track had produced audio
		const d = deferred<Track>();
		mockEnsure.mockReturnValue(d.promise); // resolve never settles — inspect the sync entry only

		void player.play(mk('netease', 'entry0', 'A', 'NewTrack')); // do NOT await

		expect(internals().hasPlayedSinceSrc).toBe(false); // reset at entry, not after the resolve gap
	});

	it('a NEVER-played new track that errors routes to cross-source fallback, NOT reresolve', () => {
		const cur = mk('netease', 'np0', 'A', 'DeadOnLoad');
		player.queue = [cur];
		player.current = cur;
		const el = makeFakeAudio();
		el.src = 'https://cdn/dead.mp3';
		el.currentTime = 0;
		(el as unknown as { ended: boolean }).ended = false;
		player.attach(el as unknown as HTMLAudioElement);
		internals().hasPlayedSinceSrc = false; // fresh advance — never produced audio (post-fix invariant)
		internals().lastSeekAt = 0; // not the seek-window path
		const reresolveSpy = vi.spyOn(internals(), 'reresolveCurrent').mockResolvedValue(undefined);
		const fallbackSpy = vi.spyOn(internals(), 'runFallback').mockResolvedValue(undefined);

		el.fire('error');

		expect(reresolveSpy).not.toHaveBeenCalled(); // not the already-played path
		expect(fallbackSpy).toHaveBeenCalled(); // dead-on-load → try other sources → advance
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// debug-nowbar-freeze-reresolve-loop: a synchronous audio.error storm (a re-attached src that errors
// again instantly) pegged the main thread and froze the whole app (nowbar stuck on the loading line,
// no tap registered). The genuinely-uncapped path in HEAD was the seek-error branch: it called
// reresolveCurrent() on EVERY error inside the 1.5s seek window with no cap/counter/guard (a repro hit
// 2000+ synchronous src-sets). The fix adds, at the TOP of the error listener, a rapid-fire brake
// (errors < RAPID_ERROR_WINDOW_MS apart with no `playing` cannot be distinct failures → stop re-driving
// recovery) plus an absolute errorBurst >= FAILURE_CAP ceiling. BOTH bounds SKIP (strike + advance),
// NEVER the ef2c751-disabled tripLoopGuard() STOP (the false-positive that stranded the player with a
// sticky "playback stopped" notice on a transient blip).
// ─────────────────────────────────────────────────────────────────────────────
describe('player resilience — synchronous audio.error storm is bounded (debug-nowbar-freeze-reresolve-loop)', () => {
	type Internals = {
		hasPlayedSinceSrc: boolean;
		reresolveBurst: number;
		errorBurst: number;
		rapidErrorBurst: number;
		lastSeekAt: number;
		lastAudioErrorAt: number;
		reresolveCurrent(): Promise<void>;
		runFallback(t: Track): Promise<void>;
		strikeUnplayable(uid: string): boolean;
	};
	const internals = () => player as unknown as Internals;

	/** A fake <audio> whose src-setter fires an `error` on the next microtask (up to `maxFires`), so a
	 *  re-attach that errors instantly is modelled faithfully. Counts src assignments. */
	function makeSelfErroringAudio(maxFires: number) {
		const handlers = new Map<string, Array<() => void>>();
		let srcSets = 0;
		let _src = '';
		const el = {
			paused: true,
			currentTime: 0,
			duration: NaN,
			readyState: 0,
			get src() {
				return _src;
			},
			set src(v: string) {
				_src = v;
				srcSets++;
				if (srcSets <= maxFires) {
					queueMicrotask(() => {
						for (const cb of handlers.get('error') ?? []) cb();
					});
				}
			},
			setAttribute() {},
			removeAttribute() {},
			load() {},
			addEventListener(type: string, cb: () => void) {
				const arr = handlers.get(type) ?? [];
				arr.push(cb);
				handlers.set(type, arr);
			},
			play: vi.fn(() => Promise.resolve()),
			pause: vi.fn(),
			fire(type: string) {
				for (const cb of handlers.get(type) ?? []) cb();
			}
		};
		return { el, srcSets: () => srcSets };
	}

	it('the seek-error reresolveCurrent loop is bounded — no unbounded synchronous re-attach (main-thread peg)', async () => {
		// REAL reresolveCurrent (not spied): ensureTrackDetails resolves instantly to a still-dead URL, so
		// each re-attach fires another error inside the seek window. Before the fix this looped forever
		// (repro: 2000+); the rapid-fire brake must cut it off after a handful of turns.
		mockEnsure.mockImplementation(async (t: Track) => ({
			...t,
			detailsLoaded: true,
			audioUrl: 'https://cdn.example.com/dead.mp3'
		}));
		mockTryFallback.mockResolvedValue(null);
		const { el, srcSets } = makeSelfErroringAudio(1000);
		const track = mk('netease', 'storm', 'A', 'Region Locked');
		player.queue = [track];
		player.current = track;
		player.attach(el as unknown as HTMLAudioElement);
		internals().lastSeekAt = Date.now(); // recent seek → the uncapped reresolveCurrent branch

		el.src = track.audioUrl as string; // kick the loop
		for (let i = 0; i < 200; i++) await new Promise((r) => setTimeout(r, 0));

		// Bounded to a small handful (RAPID_ERROR_CAP-sized bursts), not the fake's 1000-fire ceiling.
		expect(srcSets()).toBeLessThan(12);
	});

	it('the ceiling SKIPS (strike + advance), never the ef2c751 STOP (no sticky "playback stopped")', () => {
		// Foreground, already-played, persistently dead. Spy recovery so nothing runs async; fire a burst
		// of synchronous errors. The rapid-fire brake trips and the handler strikes the track + advances —
		// it must NOT set this.error='toast.playbackStopped' or a 'stopped' notice (that was the disabled
		// tripLoopGuard's false-positive).
		vi.stubGlobal('document', { hidden: false, addEventListener() {} });
		vi.stubGlobal('navigator', { onLine: true });
		const el = makeFakeAudio();
		const cur = mk('netease', 'ceil', 'A', 'Dead');
		const next = mk('qq', 'ceilnext', 'B', 'Next');
		player.queue = [cur, next];
		player.current = cur;
		player.error = null;
		player.notice = null;
		player.attach(el as unknown as HTMLAudioElement);
		internals().hasPlayedSinceSrc = true;
		internals().lastSeekAt = 0; // not the seek path — exercise the hasPlayed + ceiling path
		const strikeSpy = vi.spyOn(internals(), 'strikeUnplayable');
		vi.spyOn(internals(), 'reresolveCurrent').mockResolvedValue(undefined);
		vi.spyOn(internals(), 'runFallback').mockResolvedValue(undefined);

		for (let i = 0; i < Player_FAILURE_CAP + 2; i++) el.fire('error');

		expect(strikeSpy).toHaveBeenCalledWith(cur.uid); // SKIP: struck the dead track…
		expect(player.error).not.toBe('toast.playbackStopped'); // …and did NOT hard-STOP
		// Cast: TS flow-narrows player.notice to null (it can't see fire() mutate it) — read past it.
		expect((player.notice as { kind?: string } | null)?.kind).not.toBe('stopped'); // no sticky Retry notice
	});

	it('a real `playing` between errors refunds the brake — a genuine transient stall is never falsely skipped', () => {
		vi.stubGlobal('document', { hidden: false, addEventListener() {} });
		const el = makeFakeAudio();
		const track = mk('netease', 'transient', 'A', 'Buffers');
		player.queue = [track];
		player.current = track;
		player.attach(el as unknown as HTMLAudioElement);
		internals().hasPlayedSinceSrc = true;
		internals().lastSeekAt = 0;
		const strikeSpy = vi.spyOn(internals(), 'strikeUnplayable');
		const reresolveSpy = vi.spyOn(internals(), 'reresolveCurrent').mockResolvedValue(undefined);

		// Each error recovers with real output → both the reresolve budget AND the rapid brake reset.
		for (let i = 0; i < Player_FAILURE_CAP + 3; i++) {
			el.fire('error');
			el.fire('playing');
		}

		expect(strikeSpy).not.toHaveBeenCalled(); // never hit the ceiling — every stall recovered
		expect(reresolveSpy.mock.calls.length).toBeGreaterThan(1); // re-resolved in place each time
	});
});

// 26-06 (gap-1 BLOCKER / RESOLVE-02): the click-to-play network resolve used to run with NO signal +
// NO timeout — a stalled upstream (qijieya/qq flake) sat in `loading` up to apiFetch's ~25s timeout
// with no cross-source fallback and no skip (the UAT hang: a fresh qq tap logged `play` then NOTHING
// for 23s). The resolve-phase watchdog bounds that await: on RESOLVE_WATCHDOG_MS elapse the in-flight
// resolve is aborted and the SAME song is routed into the existing kuwo-first cross-source walk
// (runFallback → tryFallback → handleTotalFailure auto-skip). These use the REAL play() (restored from
// the top-level mock) + a fake <audio> + fake timers so the watchdog fire path runs headless.
describe('player resolve-phase watchdog — stalled/null initial resolve fails fast into fallback (26-06 gap-1)', () => {
	// Mirror of Player.RESOLVE_WATCHDOG_MS (private static = 6000) for driving the fake-timer clock.
	const Player_RESOLVE_WATCHDOG_MS = 6000;
	let el: ReturnType<typeof makeFakeAudio>;
	let playSpy: ReturnType<typeof vi.spyOn>;
	let nextSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		// Restore the REAL play() (the top-level beforeEach mocks it) so the resolve-watchdog path runs.
		(player.play as unknown as { mockRestore(): void }).mockRestore?.();
		mockEnsure.mockReset();
		mockTryFallback.mockReset();
		player.current = null;
		player.queue = [];
		player.error = null;
		player.loading = false;
		// Online + a minimal Media Session surface (attach wires transport handlers) so play() runs
		// headless without the offline gate or a null-deref (runFallback's offline gate needs onLine:true).
		vi.stubGlobal('navigator', {
			onLine: true,
			mediaSession: { metadata: null, playbackState: 'none', setPositionState() {}, setActionHandler() {} }
		});
		vi.stubGlobal('MediaMetadata', FakeMediaMetadata);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
		vi.spyOn(library, 'adoptCover').mockImplementation(() => {});
		el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		// Call-through spies (vi.spyOn keeps the real impl) so we observe the fromFallback re-entry +
		// the auto-skip next() while the REAL logic still executes.
		playSpy = vi.spyOn(player, 'play');
		nextSpy = vi.spyOn(player, 'next');
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('a stalled initial resolve (never settles) is aborted at the watchdog and routes the SAME song into the cross-source walk; a playable swap re-enters play(fromFallback)', async () => {
		vi.useFakeTimers();
		try {
			const tapped = stub('qq', '003taMev', '有人', 'That Should Be Me'); // detailsLoaded:false, audioUrl:null
			const swap = mk('kuwo', 'k9', '有人', 'That Should Be Me'); // playable equivalent from another source
			player.queue = [tapped];
			const never = deferred<Track>(); // the tapped source's resolve NEVER settles (the stall)
			mockEnsure.mockImplementation((t: Track) =>
				t.uid === tapped.uid
					? never.promise
					: Promise.resolve({ ...t, detailsLoaded: true, audioUrl: 'https://cdn/swap.mp3' })
			);
			mockTryFallback.mockResolvedValue({ ...swap, detailsLoaded: true, audioUrl: 'https://cdn/swap.mp3' });

			const p = player.play(tapped);
			p.catch(() => {}); // never rejects with the watchdog, but be defensive against the RED (no-watchdog) hang
			await vi.advanceTimersByTimeAsync(0); // play() runs to the resolve await; the stall is in flight
			expect(mockTryFallback).not.toHaveBeenCalled(); // still resolving — the watchdog has NOT fired yet

			// Fire the resolve watchdog → abort the stall + route into runFallback → tryFallback → swap.
			await vi.advanceTimersByTimeAsync(Player_RESOLVE_WATCHDOG_MS);
			await vi.advanceTimersByTimeAsync(0);

			expect(mockTryFallback).toHaveBeenCalledTimes(1);
			// The cross-source walk was asked for the SAME song (name+artist), not a different track.
			const failedArg = mockTryFallback.mock.calls[0][0] as Track;
			expect(failedArg.artist).toBe('有人');
			expect(failedArg.title).toBe('That Should Be Me');
			// The playable swap re-entered play() as a fallback continuation.
			expect(playSpy).toHaveBeenCalledWith(
				expect.objectContaining({ uid: swap.uid }),
				{ fromFallback: true }
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it('a stalled resolve whose cross-source walk exhausts every source auto-skips to the next queue item (never hangs); loading ends false', async () => {
		vi.useFakeTimers();
		try {
			const tapped = stub('qq', '1', 'A', 'Dead Everywhere');
			const nextTrack = mk('kuwo', '2', 'B', 'Plays Fine');
			player.queue = [tapped, nextTrack];
			const never = deferred<Track>();
			mockEnsure.mockImplementation((t: Track) =>
				t.uid === tapped.uid
					? never.promise
					: Promise.resolve({ ...t, detailsLoaded: true, audioUrl: 'https://cdn/next.mp3' })
			);
			mockTryFallback.mockResolvedValue(null); // every source exhausted for the tapped song

			const p = player.play(tapped);
			p.catch(() => {});
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(Player_RESOLVE_WATCHDOG_MS);
			await vi.advanceTimersByTimeAsync(0);

			expect(mockTryFallback).toHaveBeenCalledTimes(1);
			expect(nextSpy).toHaveBeenCalled(); // handleTotalFailure → next() auto-skip
			expect(playSpy).toHaveBeenCalledWith(nextTrack); // advanced to the next playable queue item
			expect(player.loading).toBe(false); // NEVER left permanently loading
		} finally {
			vi.useRealTimers();
		}
	});

	it('a NULL initial resolve (audioUrl:null before the watchdog) routes into the SAME cross-source walk', async () => {
		vi.useFakeTimers();
		try {
			const tapped = stub('qq', '9', 'C', 'No Url Here');
			player.queue = [tapped];
			// Null ONLY the tapped uid (a benign URL for any other track) so a stray play() leaked from a
			// prior suite's un-awaited async chain does not itself fan out and inflate the count — the
			// isolation pattern tests 1 & 2 use. The intent here is "the TAPPED song's null resolve fans out".
			mockEnsure.mockImplementation((t: Track) =>
				t.uid === tapped.uid
					? Promise.resolve({ ...t, detailsLoaded: true, audioUrl: null })
					: Promise.resolve({ ...t, detailsLoaded: true, audioUrl: 'https://cdn/other.mp3' })
			);
			mockTryFallback.mockResolvedValue(null);

			const p = player.play(tapped);
			p.catch(() => {});
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(0);

			// A null resolve fails fast BEFORE the watchdog and still fans out cross-source (unified path).
			expect(mockTryFallback).toHaveBeenCalledTimes(1);
			expect(player.loading).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('a newer play() during the watchdog window supersedes: the stale resolve is discarded (no double fallback)', async () => {
		vi.useFakeTimers();
		try {
			const first = stub('qq', 'f1', 'A', 'First Tap');
			const second = mk('kuwo', 's1', 'B', 'Second Tap'); // a fresh tap, resolves fine
			player.queue = [first, second];
			const never = deferred<Track>();
			mockEnsure.mockImplementation((t: Track) =>
				t.uid === first.uid
					? never.promise
					: Promise.resolve({ ...t, detailsLoaded: true, audioUrl: 'https://cdn/second.mp3' })
			);
			mockTryFallback.mockResolvedValue(null);

			const p1 = player.play(first);
			p1.catch(() => {});
			await vi.advanceTimersByTimeAsync(0);
			// User taps a DIFFERENT song before the first resolve's watchdog fires → bumps playGen.
			const p2 = player.play(second);
			p2.catch(() => {});
			await vi.advanceTimersByTimeAsync(0);
			// Now fire the FIRST tap's stale watchdog — the myGen gen-guard must discard it.
			await vi.advanceTimersByTimeAsync(Player_RESOLVE_WATCHDOG_MS);
			await vi.advanceTimersByTimeAsync(0);

			// The stale first-tap resolve never fanned out (superseded), and `current` is the second song.
			expect(mockTryFallback).not.toHaveBeenCalled();
			expect(player.current?.uid).toBe(second.uid);
		} finally {
			vi.useRealTimers();
		}
	});

	it('the HAPPY path (fast truthy audioUrl before the watchdog) proceeds single-source with NO cross-source fan-out', async () => {
		vi.useFakeTimers();
		try {
			const tapped = stub('kuwo', '7', 'D', 'Resolves Fast');
			player.queue = [tapped];
			mockEnsure.mockImplementation((t: Track) =>
				Promise.resolve({ ...t, detailsLoaded: true, audioUrl: 'https://cdn/fast.mp3' })
			);
			mockTryFallback.mockResolvedValue(null);

			const p = player.play(tapped);
			await vi.advanceTimersByTimeAsync(0);
			await p;

			expect(mockTryFallback).not.toHaveBeenCalled(); // 0 cross-source calls on the happy path
			expect(player.current?.audioUrl).toBe('https://cdn/fast.mp3');
			expect(player.loading).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});

// 26-06 Task 2 (regression proof): characterize the two budget/UX invariants the watchdog must hold —
// the happy path issues ZERO cross-source fan-out (the ~3-call budget), and a stalled resolve never
// leaves the player permanently loading. Reuses the same real-play + fake-audio + fake-timer harness.
describe('player resolve-phase watchdog — regression: no happy-path fan-out; a stall never hangs (26-06)', () => {
	const Player_RESOLVE_WATCHDOG_MS = 6000;
	let el: ReturnType<typeof makeFakeAudio>;

	beforeEach(() => {
		(player.play as unknown as { mockRestore(): void }).mockRestore?.();
		mockEnsure.mockReset();
		mockTryFallback.mockReset();
		player.current = null;
		player.queue = [];
		player.error = null;
		player.loading = false;
		vi.stubGlobal('navigator', {
			onLine: true,
			mediaSession: { metadata: null, playbackState: 'none', setPositionState() {}, setActionHandler() {} }
		});
		vi.stubGlobal('MediaMetadata', FakeMediaMetadata);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
		vi.spyOn(library, 'adoptCover').mockImplementation(() => {});
		el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('happy path: a healthy resolve performs ZERO tryFallback (cross-source) calls — single-source budget holds', async () => {
		vi.useFakeTimers();
		try {
			const tapped = stub('kuwo', '100', 'A', 'Budget Song');
			player.queue = [tapped];
			mockEnsure.mockImplementation((t: Track) =>
				Promise.resolve({ ...t, detailsLoaded: true, audioUrl: 'https://cdn/ok.mp3' })
			);
			mockTryFallback.mockResolvedValue(null);

			const p = player.play(tapped);
			await vi.advanceTimersByTimeAsync(0);
			await p;

			expect(mockTryFallback).toHaveBeenCalledTimes(0);
			expect(el.src).toBe('https://cdn/ok.mp3'); // the single source's URL was attached, no fan-out
		} finally {
			vi.useRealTimers();
		}
	});

	it('a stalled resolve does NOT leave player.loading true forever: after the watchdog + total failure settle, loading is false', async () => {
		vi.useFakeTimers();
		try {
			const tapped = stub('qq', '200', 'B', 'Stalls');
			player.queue = [tapped];
			const never = deferred<Track>();
			mockEnsure.mockImplementation((t: Track) =>
				t.uid === tapped.uid
					? never.promise
					: Promise.resolve({ ...t, detailsLoaded: true, audioUrl: 'https://cdn/x.mp3' })
			);
			mockTryFallback.mockResolvedValue(null); // total failure

			const p = player.play(tapped);
			p.catch(() => {});
			await vi.advanceTimersByTimeAsync(0);
			expect(player.loading).toBe(true); // still resolving — loading held
			await vi.advanceTimersByTimeAsync(Player_RESOLVE_WATCHDOG_MS);
			await vi.advanceTimersByTimeAsync(0);

			expect(player.loading).toBe(false); // watchdog → fallback → total failure → NOT stuck loading
		} finally {
			vi.useRealTimers();
		}
	});
});
