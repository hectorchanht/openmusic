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

const mockResolve = vi.mocked(resolveStub);
const mockEnsure = vi.mocked(ensureTrackDetails);
const mockTryFallback = vi.mocked(tryFallback);
const mockBlobGet = vi.mocked(blobStore.get);
const mockSimilar = vi.mocked(buildSimilarQueue);
const mockPicks = vi.mocked(buildDiversePicks);
const mockUidCover = vi.mocked(getCachedCoverByUid);
const mockNameCover = vi.mocked(getCachedCover);
const mockResolveCover = vi.mocked(resolveCoverForTrack);

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
	};
	internals.prefetchingUid = null;
	internals.prefetchController?.abort();
	internals.prefetchController = null;
	internals.preloadedAudio = null;
	internals.preloadedAudioUid = null;
	internals.preloadedAudioUrl = null;
	internals.preloadedCover = null;
	internals.preloadedCoverUid = null;
	internals.preloadedCoverUrl = null;
	internals.growPromise = null;
	internals.growing = false;
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

	it("pre-resolves the next track's details and warms resolved audio + cover", async () => {
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
		expect(assets.AudioCtor).toHaveBeenCalledTimes(1);
		expect(assets.audios[0].preload).toBe('auto');
		expect(assets.audios[0].muted).toBe(true);
		expect(assets.audios[0].src).toBe('https://cdn/next.mp3');
		expect(assets.audios[0].setAttribute).toHaveBeenCalledWith('referrerpolicy', 'no-referrer');
		expect(assets.audios[0].load).toHaveBeenCalledTimes(1);
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

	it('warms audio + cover even when next track is already detailsLoaded', async () => {
		const assets = installAssetPreloadMocks();
		const cur = mk('netease', '0', 'A', 'Now');
		const next = { ...mk('qq', '1', 'B', 'Next'), cover: 'https://img/already.jpg' };
		player.queue = [cur, next];
		player.current = cur;

		await prefetch();
		await flush();

		expect(mockEnsure).not.toHaveBeenCalled();
		expect(assets.AudioCtor).toHaveBeenCalledTimes(1);
		expect(assets.audios[0].src).toBe(next.audioUrl);
		expect(assets.audios[0].load).toHaveBeenCalledTimes(1);
		expect(assets.ImageCtor).toHaveBeenCalledTimes(1);
		expect(assets.images[0].src).toBe('https://img/already.jpg');
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
		expect(assets.audios[0].src).toBe('https://cdn/next.mp3');
		expect(assets.images[0].src).toBe('https://img/prime.jpg');
	});

	// RELAX-PREFETCH: SINGLE-SONG lookahead — prefetch resolves ONLY the immediate-next. A reject
	// or a no-audioUrl immediate-next is abandoned for THIS invocation (the next play() resolves it
	// on-demand); it NEVER advances to a later candidate. This keeps proxy resolves low-rate so
	// endless playback never reads as a bot burst.
	it('a REJECTING immediate-next is abandoned this invocation — does NOT advance to a later candidate', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const bad = stub('qq', '1', 'B', 'Bad'); // immediate-next: resolve rejects (transient proxy failure)
		const good = stub('kuwo', '2', 'C', 'Good'); // a LATER candidate — must NOT be reached
		player.queue = [cur, bad, good];
		player.current = cur;

		mockEnsure.mockImplementation(async (t: Track) => {
			if (t.uid === bad.uid) throw new Error('qq upstream 503');
			if (t.uid === good.uid) return { ...good, detailsLoaded: true, audioUrl: 'https://cdn/good.mp3' };
			return t;
		});

		await prefetch();
		await flush();

		// ONLY the immediate-next was attempted; the later candidate was never resolved.
		expect(mockEnsure).toHaveBeenCalledTimes(1);
		expect(mockEnsure).toHaveBeenCalledWith(bad, expect.any(AbortSignal));
		expect(mockEnsure).not.toHaveBeenCalledWith(good, expect.any(AbortSignal));
		// Neither slot written back — bad rejected, good was never touched.
		expect(player.queue[1]).toBe(bad);
		expect(player.queue[1].audioUrl).toBeNull();
		expect(player.queue[2]).toBe(good);
		expect(player.queue[2].audioUrl).toBeNull();
	});

	it('an immediate-next that resolves WITHOUT an audioUrl is abandoned — does NOT advance', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const bad = stub('qq', '1', 'B', 'NoUrl'); // immediate-next: resolves but unplayable
		const good = stub('kuwo', '2', 'C', 'Good'); // later candidate — must NOT be reached
		player.queue = [cur, bad, good];
		player.current = cur;

		mockEnsure.mockImplementation(async (t: Track) => {
			if (t.uid === bad.uid) return { ...bad, detailsLoaded: true, audioUrl: null }; // resolved, no url
			if (t.uid === good.uid) return { ...good, detailsLoaded: true, audioUrl: 'https://cdn/good.mp3' };
			return t;
		});

		await prefetch();
		await flush();

		// Only the immediate-next resolved; good (index 2) was never reached.
		expect(mockEnsure).toHaveBeenCalledTimes(1);
		expect(mockEnsure).toHaveBeenCalledWith(bad, expect.any(AbortSignal));
		expect(mockEnsure).not.toHaveBeenCalledWith(good, expect.any(AbortSignal));
		// Neither slot written back — bad unplayable (never persisted), good untouched.
		expect(player.queue[1]).toBe(bad);
		expect(player.queue[1].audioUrl).toBeNull();
		expect(player.queue[2]).toBe(good);
		expect(player.queue[2].audioUrl).toBeNull();
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

	beforeEach(() => {
		mockTryFallback.mockReset();
		mockTryFallback.mockResolvedValue(null); // every source exhausted → total failure
		setFailures(0);
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

	// it('at the cap: pauses, sets a sticky stopped notice with a Retry action, does NOT call next()', async () => {
	// 	const a = mk('netease', 'a', 'A', 'Dead');
	// 	const b = mk('qq', 'b', 'B', 'Next');
	// 	player.queue = [a, b];
	// 	player.current = a;
	// 	setFailures(Player_FAILURE_CAP - 1); // one more failure trips the guard
	// 	const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
	// 	playSpy.mockClear();

	// 	await runFallback(a);
	// 	await flush();

	// 	expect(failures()).toBe(Player_FAILURE_CAP);
	// 	expect(player.notice?.kind).toBe('stopped');
	// 	expect(player.notice?.reason).toBe('loop-guard');
	// 	expect(typeof player.notice?.action).toBe('function');
	// 	expect(player.error).toBeTruthy(); // inline now-bar error still set
	// 	// Loop-guard stops auto-advance.
	// 	expect(playSpy).not.toHaveBeenCalled();
	// });

	// it('the Retry action resets the counter, clears the notice, and skips ahead (D-05)', async () => {
	// 	const a = mk('netease', 'a', 'A', 'Dead');
	// 	const b = mk('qq', 'b', 'B', 'Next');
	// 	player.queue = [a, b];
	// 	player.current = a;
	// 	setFailures(Player_FAILURE_CAP - 1);
	// 	await runFallback(a);
	// 	await flush();
	// 	expect(player.notice?.kind).toBe('stopped');

	// 	const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
	// 	playSpy.mockClear();
	// 	player.notice?.action?.(); // user taps Retry
	// 	await flush();

	// 	expect(failures()).toBe(0); // counter reset
	// 	expect(player.notice).toBeNull(); // sticky notice cleared
	// 	expect(playSpy).toHaveBeenCalledWith(b); // skipped AHEAD to the next track, not retry-current
	// });

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

	beforeEach(() => {
		vi.useFakeTimers();
		player.current = mk('netease', 's', 'A', 'Stalling');
		player.queue = [player.current];
		setPlayed(false);
		// Spy runFallback so the watchdog firing is observable without real network.
		runFallbackSpy = vi
			.spyOn(player as unknown as { runFallback(f: Track): Promise<void> }, 'runFallback')
			.mockResolvedValue(undefined);
	});

	afterEach(() => {
		(player as unknown as { disarmStall(): void })['disarmStall']();
		vi.useRealTimers();
	});

	it('after src-set with no audio, advancing STALL_TIMEOUT_MS routes into runFallback (D-13)', () => {
		armStall();
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		expect(runFallbackSpy).toHaveBeenCalledTimes(1);
		expect(runFallbackSpy).toHaveBeenCalledWith(player.current);
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
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		armStall();
		// `play` is transport intent, not real output — the watchdog must still fire if no audio
		// (`playing`/`timeupdate`) follows within the timeout.
		el.fire('play');
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		expect(runFallbackSpy).toHaveBeenCalledTimes(1);
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
