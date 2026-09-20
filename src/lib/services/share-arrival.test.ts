import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Track } from '$lib/sources/types';

// The orchestration half of share-arrival calls the runes player store and the two never-throw
// resolvers, so all three are mocked at module top (vitest hoists these above the imports below).
// The pure describes are unaffected — they never touch any of the three.
//
// The player mock is a MUTABLE plain object, not a class: each test sets current/playing/loading to
// stage a cold, warm or already-seated device. It mirrors only the four members arriveTrack /
// arriveShared read — `spliceAndPlay` returning false is the store's "already current" signal, and
// `armTrack` resolving null is its "no playable src" signal (38-D-10).
vi.mock('$lib/stores/player.svelte', () => ({
	player: {
		current: null as Track | null,
		playing: false,
		loading: false,
		spliceAndPlay: vi.fn(() => true),
		// quick-260920-oja: the CTA's "start the already-armed element" call (38-D-19).
		toggle: vi.fn(),
		armTrack: vi.fn(async (t: Track) => ({ ...t, audioUrl: 'https://cdn/x.mp3', detailsLoaded: true }))
	}
}));
// ensureTrackDetails mirrors catalog's miss semantics: it NEVER throws for a miss, it returns the
// input track untouched and unstamped (catalog.ts:362) — which is what the D-10 branch reads.
vi.mock('$lib/services/catalog', () => ({ ensureTrackDetails: vi.fn() }));
// resolveStub likewise never throws; null is its miss (discovery.ts:88).
vi.mock('$lib/services/discovery', () => ({ resolveStub: vi.fn() }));

import { ensureTrackDetails } from '$lib/services/catalog';
import { resolveStub } from '$lib/services/discovery';
import { player } from '$lib/stores/player.svelte';
import {
	APP_LINK_HOST,
	arrivalMode,
	arriveShared,
	arriveTrack,
	deepLinkPath,
	replayShared,
	stubFromUidParam
} from './share-arrival';

// share-arrival is the single source of truth for the three PURE decisions a share arrival makes:
// is this device already listening (cold vs warm), does the `?u=` carrier decode to a usable song
// identity, and is an incoming deep-link URL one of ours. Two of the three are security gates
// (T-38-01, T-38-02), so the hostile-input cases below are the point of this file, not an extra.
//
// The three describes below need NO mock — they are pure. The store-facing orchestration
// (`arriveTrack` / `arriveShared`) gets its own describe at the bottom, against the mocked player.

describe('arrivalMode — cold vs warm (D-01 / D-27)', () => {
	it('a seated-but-silent player is COLD — the shared song takes the seat (D-01)', () => {
		// restore() never calls play(), so this is the state almost every share link lands in.
		expect(arrivalMode({ playing: false, loading: false })).toBe('cold');
	});

	it('real audio output is WARM', () => {
		expect(arrivalMode({ playing: true, loading: false })).toBe('warm');
	});

	it('an in-flight resolve is WARM — arming over it would kill the track the user started (D-27)', () => {
		expect(arrivalMode({ playing: false, loading: true })).toBe('warm');
	});

	it('both flags set is WARM', () => {
		expect(arrivalMode({ playing: true, loading: true })).toBe('warm');
	});
});

describe('stubFromUidParam — the `?u=` carrier gate (T-38-01)', () => {
	it('builds the exact stubToTrack field set, with the path names as title/artist', () => {
		expect(stubFromUidParam('kuwo123', 'Adele', 'Hello')).toEqual({
			uid: 'kuwo:123',
			source: 'kuwo',
			songid: '123',
			title: 'Hello',
			artist: 'Adele',
			album: '',
			cover: null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: null,
			qualityLabel: null,
			keyword: 'Hello',
			displayIndex: 1
		});
	});

	it('decodes the sources added by 38-D-30', () => {
		expect(stubFromUidParam('audius42', 'A', 'B')?.source).toBe('audius');
	});

	it('an unknown source, junk or a missing value yields null and never throws', () => {
		// The closed-enum allowlist IS the gate: no match → null → the caller falls back to the
		// name resolve (D-10), and no untrusted string ever reaches SOURCES[source].resolve.
		expect(stubFromUidParam('kugou123', 'A', 'B')).toBeNull();
		expect(stubFromUidParam('evil123', 'A', 'B')).toBeNull();
		expect(stubFromUidParam('', 'A', 'B')).toBeNull();
		expect(stubFromUidParam(null, 'A', 'B')).toBeNull();
		expect(stubFromUidParam(undefined, 'A', 'B')).toBeNull();
	});
});

describe('deepLinkPath — the in-app host gate (T-38-02)', () => {
	it('returns pathname + search for one of our own https links', () => {
		expect(deepLinkPath(`https://${APP_LINK_HOST}/song/Adele/Hello?u=kuwo123`)).toBe(
			'/song/Adele/Hello?u=kuwo123'
		);
	});

	it('compares the host case-insensitively', () => {
		expect(deepLinkPath('https://OPENMUSIC.LOL/album/A/B')).toBe('/album/A/B');
	});

	it('drops the fragment — the router never needs it', () => {
		expect(deepLinkPath(`https://${APP_LINK_HOST}/song/x#frag`)).toBe('/song/x');
	});

	it('rejects a look-alike host — the match is EXACT, never a suffix test', () => {
		expect(deepLinkPath('https://evil-openmusic.lol/song/a/b')).toBeNull();
		expect(deepLinkPath('https://openmusic.lol.evil.com/song/a/b')).toBeNull();
	});

	it('rejects an unclaimed host and a non-https scheme (D-23)', () => {
		expect(deepLinkPath('https://openmusic.pages.dev/song/a/b')).toBeNull();
		expect(deepLinkPath(`http://${APP_LINK_HOST}/song/a/b`)).toBeNull();
		expect(deepLinkPath('javascript:alert(1)')).toBeNull();
	});

	it('returns null for an unparseable or missing value rather than throwing', () => {
		expect(deepLinkPath('not a url')).toBeNull();
		expect(deepLinkPath('')).toBeNull();
		expect(deepLinkPath(null)).toBeNull();
		expect(deepLinkPath(undefined)).toBeNull();
	});
});

describe('arriveShared / arriveTrack — orchestration (38-D-02/D-03/D-07/D-10/D-27)', () => {
	const armTrack = vi.mocked(player.armTrack);
	const spliceAndPlay = vi.mocked(player.spliceAndPlay);
	const ensure = vi.mocked(ensureTrackDetails);
	const byName = vi.mocked(resolveStub);

	// The carrier `kuwo123` decodes to this exact stub — built through the real pure function so the
	// field set the mocks receive is the one production hands the store, not a hand-rolled look-alike.
	const stub = (): Track => stubFromUidParam('kuwo123', 'Adele', 'Hello')!;
	const other = (): Track => stubFromUidParam('netease999', 'Adele', 'Hello')!;

	beforeEach(() => {
		vi.clearAllMocks();
		// Defaults = the happy path; each test overrides only the leg it is about.
		armTrack.mockImplementation(async (t: Track) => ({ ...t, audioUrl: 'https://cdn/x.mp3' }));
		spliceAndPlay.mockReturnValue(true);
		ensure.mockImplementation(async (t: Track) => t); // a MISS by default (no audioUrl added)
		byName.mockResolvedValue(null);
		player.current = null;
		player.playing = false;
		player.loading = false;
	});

	describe('arriveTrack — the cold/warm dispatcher', () => {
		it('D-03: the shared song is already current → noop, and nothing is re-seated or re-resolved', async () => {
			const t = stub();
			player.current = t;
			expect(await arriveTrack(t)).toBe('noop');
			expect(spliceAndPlay).not.toHaveBeenCalled();
			expect(armTrack).not.toHaveBeenCalled();
		});

		it('warm (playing) → spliceAndPlay, never armTrack (D-07)', async () => {
			player.playing = true;
			const t = stub();
			expect(await arriveTrack(t)).toBe('played');
			expect(spliceAndPlay).toHaveBeenCalledTimes(1);
			expect(spliceAndPlay).toHaveBeenCalledWith(t);
			expect(armTrack).not.toHaveBeenCalled();
		});

		it('D-27: an in-flight resolve counts as WARM even though playing is false', async () => {
			player.loading = true;
			expect(await arriveTrack(stub())).toBe('played');
			expect(spliceAndPlay).toHaveBeenCalledTimes(1);
			expect(armTrack).not.toHaveBeenCalled();
		});

		it('cold → armTrack, never spliceAndPlay/playNext (D-05/D-06/D-29)', async () => {
			const t = stub();
			expect(await arriveTrack(t)).toBe('armed');
			expect(armTrack).toHaveBeenCalledTimes(1);
			expect(armTrack).toHaveBeenCalledWith(t);
			expect(spliceAndPlay).not.toHaveBeenCalled();
		});

		it('cold + no playable src → notfound (the only outcome that earns the unplayable message)', async () => {
			armTrack.mockResolvedValue(null);
			expect(await arriveTrack(stub())).toBe('notfound');
		});
	});

	describe('arriveShared — the `?u=` carrier fast path', () => {
		it('cold + a valid carrier arms the decoded song directly — no search fan-out (D-08/D-13)', async () => {
			expect(await arriveShared({ artist: 'Adele', title: 'Hello', u: 'kuwo123' })).toBe('armed');
			expect(armTrack).toHaveBeenCalledTimes(1);
			expect(armTrack.mock.calls[0][0].uid).toBe('kuwo:123');
			expect(byName).not.toHaveBeenCalled();
		});

		it('warm + a valid carrier resolves the stub and splices it in (D-07)', async () => {
			player.playing = true;
			ensure.mockImplementation(async (t: Track) => ({ ...t, audioUrl: 'https://cdn/a.mp3' }));
			expect(await arriveShared({ artist: 'Adele', title: 'Hello', u: 'kuwo123' })).toBe('played');
			expect(ensure.mock.calls[0][0].uid).toBe('kuwo:123');
			expect(spliceAndPlay.mock.calls[0][0].audioUrl).toBe('https://cdn/a.mp3');
			expect(byName).not.toHaveBeenCalled();
		});

		it('D-03: the carrier names the seated song → noop with ZERO network calls', async () => {
			player.current = stub();
			expect(await arriveShared({ artist: 'Adele', title: 'Hello', u: 'kuwo123' })).toBe('noop');
			expect(ensure).not.toHaveBeenCalled();
			expect(armTrack).not.toHaveBeenCalled();
			expect(byName).not.toHaveBeenCalled();
		});
	});

	describe('arriveShared — D-10 fall-through: the carrier is a fast path, never the only path', () => {
		it('D-10 cold: a dead carrier falls through to the name resolve and arms THAT track', async () => {
			armTrack.mockResolvedValueOnce(null); // carrier resolved to nothing playable
			const found = other();
			byName.mockResolvedValue(found);
			expect(await arriveShared({ artist: 'Adele', title: 'Hello', u: 'kuwo123' })).toBe('armed');
			expect(byName).toHaveBeenCalledWith('Adele', 'Hello');
			expect(armTrack).toHaveBeenCalledTimes(2);
			expect(armTrack.mock.calls[1][0]).toBe(found);
		});

		it('D-10 warm: ensureTrackDetails returning the stub untouched is the miss signal', async () => {
			player.playing = true;
			const found = other();
			byName.mockResolvedValue(found);
			expect(await arriveShared({ artist: 'Adele', title: 'Hello', u: 'kuwo123' })).toBe('played');
			expect(byName).toHaveBeenCalledWith('Adele', 'Hello');
			expect(spliceAndPlay).toHaveBeenCalledTimes(1);
			expect(spliceAndPlay).toHaveBeenCalledWith(found);
		});

		it('T-38-01: an unknown source is no carrier at all — it never reaches a resolve dispatch', async () => {
			expect(await arriveShared({ artist: 'Adele', title: 'Hello', u: 'kugou1' })).toBe('notfound');
			expect(ensure).not.toHaveBeenCalled();
			expect(armTrack).not.toHaveBeenCalled();
			expect(byName).toHaveBeenCalledWith('Adele', 'Hello');
		});

		it('D-15: a legacy carrier-free link gets the same mount-time treatment', async () => {
			const found = other();
			byName.mockResolvedValue(found);
			expect(await arriveShared({ artist: 'Adele', title: 'Hello' })).toBe('armed');
			expect(armTrack).toHaveBeenCalledWith(found);
		});

		it('neither the carrier nor the name resolve found a song → notfound', async () => {
			armTrack.mockResolvedValueOnce(null);
			expect(await arriveShared({ artist: 'Adele', title: 'Hello', u: 'kuwo123' })).toBe('notfound');
			expect(byName).toHaveBeenCalledTimes(1);
		});

		it('T-38-04: the page navigated away mid-resolve → noop, the search fan-out is never spent', async () => {
			armTrack.mockResolvedValueOnce(null);
			expect(
				await arriveShared({ artist: 'Adele', title: 'Hello', u: 'kuwo123' }, AbortSignal.abort())
			).toBe('noop');
			expect(byName).not.toHaveBeenCalled();
		});
	});
});

// ---------------------------------------------------------------------------------------------
// quick-260920-oja — the CTA tap, which is NOT the arrival
// ---------------------------------------------------------------------------------------------
// Reported: "play on openmusic works the first time, but clicking it again later wont play song".
// The page memoised the mount arrival and a later tap replayed that cached outcome into a bare
// `toggle()`, which starts whatever is current NOW — so with another song playing the tap did
// nothing at all, and with another song paused it started THAT one. The four cases below are the
// whole contract: still-seated taps behave exactly as 38-D-19 always did, and a not-seated tap
// re-seats the shared song through spliceAndPlay (never a hand-rolled queue mutation).
describe('replayShared — the CTA tap (quick-260920-oja)', () => {
	const armTrack = vi.mocked(player.armTrack);
	const spliceAndPlay = vi.mocked(player.spliceAndPlay);
	const toggle = vi.mocked(player.toggle);
	const ensure = vi.mocked(ensureTrackDetails);
	const byName = vi.mocked(resolveStub);

	const shared = (): Track => stubFromUidParam('kuwo123', 'Adele', 'Hello')!;
	const somethingElse = (): Track => stubFromUidParam('netease999', 'Nirvana', 'Lithium')!;
	const link = { artist: 'Adele', title: 'Hello', u: 'kuwo123' };

	beforeEach(() => {
		vi.clearAllMocks();
		spliceAndPlay.mockReturnValue(true);
		// The carrier resolves to a playable src by default — each test overrides only its own leg.
		ensure.mockImplementation(async (t: Track) => ({ ...t, audioUrl: 'https://cdn/a.mp3' }));
		byName.mockResolvedValue(null);
		player.current = null;
		player.playing = false;
		player.loading = false;
	});

	it('(a) the shared song is still seated and PAUSED → start the armed element (38-D-19)', async () => {
		const t = shared();
		player.current = t;
		expect(await replayShared(link, t.uid)).toBe('played');
		expect(toggle).toHaveBeenCalledTimes(1);
		// Nothing is re-seated and nothing is re-resolved: the element is already armed.
		expect(spliceAndPlay).not.toHaveBeenCalled();
		expect(armTrack).not.toHaveBeenCalled();
		expect(ensure).not.toHaveBeenCalled();
		expect(byName).not.toHaveBeenCalled();
	});

	it('(b) the shared song is still seated and PLAYING → nothing at all, the tap never pauses it', async () => {
		const t = shared();
		player.current = t;
		player.playing = true;
		expect(await replayShared(link, t.uid)).toBe('played');
		expect(toggle).not.toHaveBeenCalled();
		expect(spliceAndPlay).not.toHaveBeenCalled();
	});

	it('(c) a DIFFERENT song is current and playing → the shared song is re-seated and played', async () => {
		// THE REPORTED BUG. The old body stopped at `if (!player.playing) player.toggle()`, so this
		// tap was a silent no-op; the shared song never came back.
		player.current = somethingElse();
		player.playing = true;
		expect(await replayShared(link, shared().uid)).toBe('played');
		expect(spliceAndPlay).toHaveBeenCalledTimes(1);
		expect(spliceAndPlay.mock.calls[0][0].uid).toBe('kuwo:123');
		expect(spliceAndPlay.mock.calls[0][0].audioUrl).toBe('https://cdn/a.mp3');
		// A re-seat is a play, not a transport toggle — toggling here would pause the other song.
		expect(toggle).not.toHaveBeenCalled();
	});

	it('(c2) a different song is current and PAUSED → still the shared song, not the paused one', async () => {
		// The other half of the report: the old bare toggle() started whatever happened to be seated.
		player.current = somethingElse();
		expect(await replayShared(link, shared().uid)).toBe('played');
		expect(spliceAndPlay.mock.calls[0][0].uid).toBe('kuwo:123');
		expect(toggle).not.toHaveBeenCalled();
	});

	it('(d) re-seating goes through spliceAndPlay, which de-dupes — a queued song MOVES, never doubles', async () => {
		// The MOVE itself is spliceAfterCurrent's de-dupe-then-splice (pinned by
		// player.svelte.test.ts). What is pinned HERE is that this function reaches for that one
		// primitive and mutates no queue of its own — the failure mode a hand-rolled insert would be.
		const queue = [somethingElse(), shared()];
		(player as unknown as { queue: Track[] }).queue = queue;
		player.current = queue[0];
		player.playing = true;
		expect(await replayShared(link, shared().uid)).toBe('played');
		expect(spliceAndPlay).toHaveBeenCalledTimes(1);
		expect((player as unknown as { queue: Track[] }).queue).toBe(queue); // untouched by the service
	});

	it('the carrier names the song that is current again → start it, zero network', async () => {
		// seatedUid is stale (a D-10 fall-through seated something else), but the listener navigated
		// back to the shared song. Re-seating a seated song would restart it.
		player.current = shared();
		expect(await replayShared(link, 'kuwo:someone-else')).toBe('played');
		expect(toggle).toHaveBeenCalledTimes(1);
		expect(ensure).not.toHaveBeenCalled();
	});

	it('a dead carrier falls through to the name resolve and plays THAT (D-10)', async () => {
		player.current = somethingElse();
		ensure.mockImplementation(async (t: Track) => t); // miss: returned untouched, no audioUrl
		// A THIRD uid on purpose: the name resolve found the song on another source, and it is
		// neither the dead carrier nor what the listener is currently playing.
		const found = stubFromUidParam('qq777', 'Adele', 'Hello')!;
		byName.mockResolvedValue(found);
		expect(await replayShared(link, null)).toBe('played');
		expect(byName).toHaveBeenCalledWith('Adele', 'Hello');
		expect(spliceAndPlay).toHaveBeenCalledWith(found);
	});

	it('nothing resolves → notfound, so the tap stays the retry affordance', async () => {
		ensure.mockImplementation(async (t: Track) => t);
		expect(await replayShared(link, null)).toBe('notfound');
		expect(spliceAndPlay).not.toHaveBeenCalled();
		expect(toggle).not.toHaveBeenCalled();
	});

	it('T-38-04: unmounted mid-resolve → noop, the search fan-out is never spent', async () => {
		ensure.mockImplementation(async (t: Track) => t);
		expect(await replayShared(link, null, AbortSignal.abort())).toBe('noop');
		expect(byName).not.toHaveBeenCalled();
	});

	it('T-38-01: an unknown source is no carrier — it never reaches a resolve dispatch', async () => {
		player.current = somethingElse();
		const found = somethingElse();
		byName.mockResolvedValue(found);
		expect(await replayShared({ artist: 'Adele', title: 'Hello', u: 'kugou1' }, null)).toBe(
			'played'
		);
		expect(ensure).not.toHaveBeenCalled();
		expect(byName).toHaveBeenCalledWith('Adele', 'Hello');
	});
});
