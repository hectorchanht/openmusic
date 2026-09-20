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
