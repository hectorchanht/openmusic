import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	searchAll,
	ensureTrackDetails,
	resolveNameStub,
	__clearSearchCache,
	SEARCH_STAGGER_MS,
	type PartialSearchResult
} from './catalog';
import { sleep } from '$lib/proxy/http';
import { SOURCES } from '$lib/sources/registry';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';
import type { ResolveEntry } from '$lib/proxy/resolve-cache';

// 31-D-08: ensureTrackDetails now reads the edge resolve cache before resolving. Mocked here for
// the WHOLE file and defaulted to a MISS (null), so every pre-existing suite keeps asserting the
// unchanged resolve path — the cache is advisory, so a miss must be byte-identical to before.
// 32-D-10a: registerServedResolve is mocked too — the hit branch must register the qq-RESOLVED url
// so reportDeadUrl -> POST bust stays the repair path for a wrong/permanent mid.
const { readResolveCache, registerServedResolve } = vi.hoisted(() => ({
	readResolveCache: vi.fn(async (): Promise<ResolveEntry | null> => null),
	registerServedResolve: vi.fn()
}));
vi.mock('$lib/services/resolve-cache-client', () => ({
	readResolveCache,
	registerServedResolve,
	reportDeadUrl: vi.fn()
}));

// 32-D-10 / research Open Question #2: the mid-less branch logs ONCE so its real frequency becomes
// Activity-log data instead of a guess. Mocked to keep this pure-service test store-free.
const { logAction } = vi.hoisted(() => ({ logAction: vi.fn() }));
vi.mock('$lib/stores/actionLog.svelte', () => ({ logAction }));

// These fan-out tests assert against exactly the original four sources
// (netease/qq/kuwo/joox) — their settle set, interleave order, and stagger index
// windows all assume that registry. `getEnabledAdapters` is OPT-OUT (a source absent
// from prefs falls through to its enabledByDefault), so any later-added source would
// silently join the fan-out and break these tests (extra settle entries; stagger
// timers at indices the tests never advance → fake-timer hangs). Pin the fan-out to
// the four by explicitly DISABLING every other registered source, derived from SOURCES
// so future additions stay disabled here without another edit.
const TESTED_SOURCES: SourceId[] = ['netease', 'qq', 'kuwo', 'joox'];
const ALL: Partial<Record<SourceId, boolean>> = Object.fromEntries(
	(Object.keys(SOURCES) as SourceId[]).map((id) => [id, TESTED_SOURCES.includes(id)])
) as Partial<Record<SourceId, boolean>>;

function mk(source: SourceId, songid: string, displayIndex = 1, extra: Partial<Track> = {}): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title: `${source}-${songid}`,
		artist: 'a',
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex,
		...extra
	};
}

afterEach(() => {
	// Clear the D-04 TTL cache so the fan-out spy tests never observe a stale
	// cached SearchResult from a prior case (they all reuse the keyword 'x', page 1).
	__clearSearchCache();
	vi.restoreAllMocks();
	// 31-D-08: back to a cache MISS for the next case (restoreAllMocks does not reset a vi.fn).
	readResolveCache.mockReset();
	readResolveCache.mockResolvedValue(null);
	registerServedResolve.mockReset();
	logAction.mockReset();
});

describe('searchAll (DATA-03 fan-out)', () => {
	it('allSettled — one rejecting source leaves the other three intact', async () => {
		vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1')]);
		vi.spyOn(SOURCES.qq, 'search').mockRejectedValue(new Error('qq upstream 500'));
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([mk('kuwo', 'k1')]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([mk('joox', 'j1')]);

		const { perSource, interleaved } = await searchAll('x', 1, ALL);

		const qq = perSource.find((p) => p.source === 'qq');
		expect(qq?.status).toBe('error');
		expect(qq?.error).toContain('qq upstream 500');
		expect(qq?.tracks).toEqual([]);

		// the other three survived
		const okSources = perSource.filter((p) => p.status === 'ok').map((p) => p.source);
		expect(okSources).toEqual(expect.arrayContaining(['netease', 'kuwo', 'joox']));
		const uids = interleaved.map((t) => t.uid);
		expect(uids).toContain('netease:n1');
		expect(uids).toContain('kuwo:k1');
		expect(uids).toContain('joox:j1');
		expect(uids).not.toContain('qq:'); // dead source contributes nothing
	});

	it('27-04 isolation — a THROWING ytmusic search leaves every other source intact (YT-RESILIENCE-01)', async () => {
		// Enable the four mainstream sources + ytmusic; ytmusic throws contract-drift, the rest return
		// tracks. Promise.allSettled must record ytmusic as a typed per-source error without poisoning
		// the aggregate — a YTMusic failure NEVER breaks search.
		const withYt: Partial<Record<SourceId, boolean>> = Object.fromEntries(
			(Object.keys(SOURCES) as SourceId[]).map((id) => [
				id,
				['netease', 'qq', 'kuwo', 'joox', 'ytmusic'].includes(id)
			])
		) as Partial<Record<SourceId, boolean>>;

		vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1')]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([mk('qq', 'q1')]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([mk('kuwo', 'k1')]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([mk('joox', 'j1')]);
		vi.spyOn(SOURCES.ytmusic, 'search').mockRejectedValue(
			new Error('ytmusic: contract-drift (expected search shelf)')
		);

		const { perSource, interleaved } = await searchAll('ytiso', 1, withYt);

		// ytmusic recorded as a typed per-source error (no exception escaped searchAll).
		const yt = perSource.find((p) => p.source === 'ytmusic');
		expect(yt?.status).toBe('error');
		expect(yt?.error).toContain('contract-drift');
		expect(yt?.tracks).toEqual([]);
		// the four mainstream sources survived intact.
		const okSources = perSource
			.filter((p) => p.status === 'ok')
			.map((p) => p.source)
			.sort();
		expect(okSources).toEqual(['joox', 'kuwo', 'netease', 'qq']);
		const uids = interleaved.map((t) => t.uid);
		expect(uids).toEqual(expect.arrayContaining(['kuwo:k1', 'qq:q1', 'netease:n1', 'joox:j1']));
		expect(uids.some((u) => u.startsWith('ytmusic:'))).toBe(false); // dead source contributes nothing
	});

	it('dedupes by colon uid — duplicate uid yields one entry', async () => {
		vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([
			mk('netease', 'dup'),
			mk('netease', 'dup'), // same uid → should collapse to one
			mk('netease', 'other')
		]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([]);

		const { interleaved } = await searchAll('x', 1, ALL);
		const dupCount = interleaved.filter((t) => t.uid === 'netease:dup').length;
		expect(dupCount).toBe(1);
		expect(interleaved.map((t) => t.uid)).toEqual(['netease:dup', 'netease:other']);
	});

	it('interleaves round-robin in registry order (qq→netease→kuwo→joox)', async () => {
		vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1'), mk('netease', 'n2')]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([mk('qq', 'q1')]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([mk('kuwo', 'k1')]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([mk('joox', 'j1')]);

		// interleave inherits the registry order. debug/upnext-diverse-fallback-kuwo-dead
		// (2026-08-31) demoted kuwo from the Phase-26 first seat to #3 (dead upstream: expired
		// TLS cert → 526 on every call), so the floor is now qq→netease→kuwo→joox.
		const { interleaved } = await searchAll('x', 1, ALL);
		expect(interleaved.map((t) => t.uid)).toEqual([
			'qq:q1',
			'netease:n1',
			'kuwo:k1',
			'joox:j1',
			'netease:n2'
		]);
	});
});

describe('searchAll (D-04 TTL cache)', () => {
	it('does NOT re-fan-out on a second call with the same (keyword, page, sources)', async () => {
		const n = vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1')]);
		const q = vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([mk('qq', 'q1')]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([]);

		const first = await searchAll('cachekw', 1, ALL);
		const second = await searchAll('cachekw', 1, ALL);

		// adapters fanned out exactly once — the second call is a cache HIT
		expect(n).toHaveBeenCalledOnce();
		expect(q).toHaveBeenCalledOnce();
		// same resolved shape (registry order → qq before netease)
		expect(second.interleaved.map((t) => t.uid)).toEqual(first.interleaved.map((t) => t.uid));
		expect(second.interleaved.map((t) => t.uid)).toEqual(['qq:q1', 'netease:n1']);
	});

	it('keys the cache by PAGE — page 1 and page 2 are distinct entries', async () => {
		const n = vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1')]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([]);

		await searchAll('pagekw', 1, ALL);
		await searchAll('pagekw', 2, ALL);

		// page 1 and page 2 are separate cache keys → two distinct fan-outs
		expect(n).toHaveBeenCalledTimes(2);
		expect(n.mock.calls[0][1]).toBe(1);
		expect(n.mock.calls[1][1]).toBe(2);
	});

	it('normalizes the cache key (trim + lowercase) so "Jay" and " jay " share an entry', async () => {
		const n = vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1')]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([]);

		await searchAll('Jay', 1, ALL);
		await searchAll('  jay  ', 1, ALL);

		// same normalized key → only one fan-out
		expect(n).toHaveBeenCalledOnce();
	});
});

describe('searchAll (D-06 progressive onPartial)', () => {
	// Deferred-promise recipe — control settle order/timing deterministically.
	const defer = () => {
		let resolve!: (v: Track[]) => void;
		const promise = new Promise<Track[]>((r) => {
			resolve = r;
		});
		return { promise, resolve };
	};

	it('emits monotonically-growing deduped sets as staggered sources settle (final pending===0)', async () => {
		const n = defer();
		const q = defer();
		vi.spyOn(SOURCES.netease, 'search').mockReturnValue(n.promise);
		vi.spyOn(SOURCES.qq, 'search').mockReturnValue(q.promise);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([]);

		const partials: PartialSearchResult[] = [];
		const done = searchAll('stream', 1, ALL, undefined, (pt) => partials.push(pt));

		// kuwo + joox resolve immediately (empty); netease then qq land later.
		n.resolve([mk('netease', 'n1')]);
		await Promise.resolve();
		q.resolve([mk('qq', 'q1')]);
		const final = await done;

		// at least one partial was emitted, and the interleaved set never shrank
		expect(partials.length).toBeGreaterThan(0);
		for (let i = 1; i < partials.length; i++) {
			expect(partials[i].interleaved.length).toBeGreaterThanOrEqual(
				partials[i - 1].interleaved.length
			);
		}
		// the LAST emit is the final state: pending 0, both uids present
		const last = partials.at(-1)!;
		expect(last.pending).toBe(0);
		const lastUids = last.interleaved.map((t) => t.uid);
		expect(lastUids).toContain('netease:n1');
		expect(lastUids).toContain('qq:q1');
		// returned final value matches the streamed final set
		const finalUids = final.interleaved.map((t) => t.uid);
		expect(finalUids).toEqual(expect.arrayContaining(['netease:n1', 'qq:q1']));
	});

	it('suppresses onPartial after the signal is aborted mid-stream', async () => {
		const n = defer();
		const q = defer();
		vi.spyOn(SOURCES.netease, 'search').mockReturnValue(n.promise);
		vi.spyOn(SOURCES.qq, 'search').mockReturnValue(q.promise);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([]);

		const ac = new AbortController();
		const partials: PartialSearchResult[] = [];
		const done = searchAll('abort', 1, ALL, ac.signal, (pt) => partials.push(pt));

		// first source lands (emits), then we abort, then the second lands.
		n.resolve([mk('netease', 'n1')]);
		await Promise.resolve();
		const countBeforeAbort = partials.length;

		ac.abort();
		q.resolve([mk('qq', 'q1')]);
		await done;

		// no onPartial fired AFTER the abort
		expect(partials.length).toBe(countBeforeAbort);
	});

	it('omitting onPartial leaves the final SearchResult shape unchanged', async () => {
		vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1')]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([mk('qq', 'q1')]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([mk('kuwo', 'k1')]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([mk('joox', 'j1')]);

		const { perSource, interleaved } = await searchAll('noop', 1, ALL);

		expect(perSource.map((p) => p.source).sort()).toEqual(['joox', 'kuwo', 'netease', 'qq']);
		// interleave stays registry-ordered (qq-first since the 2026-08-31 kuwo demotion)
		// regardless of settle order
		expect(interleaved.map((t) => t.uid)).toEqual([
			'qq:q1',
			'netease:n1',
			'kuwo:k1',
			'joox:j1'
		]);
	});

	it('fires onPartial ONCE with pending:0 on a cache HIT', async () => {
		vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1')]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([]);

		// warm the cache (cold fetch)
		await searchAll('hitkw', 1, ALL);

		// second call is a HIT — onPartial must fire exactly once, pending 0, full set
		const partials: PartialSearchResult[] = [];
		await searchAll('hitkw', 1, ALL, undefined, (pt) => partials.push(pt));

		expect(partials.length).toBe(1);
		expect(partials[0].pending).toBe(0);
		expect(partials[0].interleaved.map((t) => t.uid)).toContain('netease:n1');
	});
});

describe('searchAllUncached inter-source stagger (GAPLESS-PREFETCH)', () => {
	it('sleep(ms) resolves after ~ms (native setTimeout pattern)', async () => {
		vi.useFakeTimers();
		try {
			let settled = false;
			const p = sleep(50).then(() => {
				settled = true;
			});
			expect(settled).toBe(false);
			await vi.advanceTimersByTimeAsync(50);
			await p;
			expect(settled).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('exports a small stagger constant in the 150-300ms band', () => {
		expect(SEARCH_STAGGER_MS).toBeGreaterThanOrEqual(150);
		expect(SEARCH_STAGGER_MS).toBeLessThanOrEqual(300);
	});

	it('staggers adapter launches — adapter[1] is not invoked until the timer advances', async () => {
		vi.useFakeTimers();
		try {
			const n = vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1')]);
			const q = vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([mk('qq', 'q1')]);
			const k = vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([mk('kuwo', 'k1')]);
			const j = vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([mk('joox', 'j1')]);

			const done = searchAll('staggerkw', 1, ALL);
			// Let the synchronous fan-out launch + adapter[0]'s 0ms sleep flush.
			// debug/upnext-diverse-fallback-kuwo-dead (2026-08-31) demoted kuwo to #3, so the
			// registry is qq-first → adapter[0]=qq, [1]=netease, [2]=kuwo, [3]=joox.
			await vi.advanceTimersByTimeAsync(0);
			expect(q).toHaveBeenCalledTimes(1);
			// adapter[1] (netease) must still be waiting on its SEARCH_STAGGER_MS sleep.
			expect(n).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(SEARCH_STAGGER_MS);
			expect(n).toHaveBeenCalledTimes(1);
			// kuwo at 2x, joox at 3x — still pending until their windows pass.
			expect(k).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(SEARCH_STAGGER_MS * 2);
			expect(k).toHaveBeenCalledTimes(1);
			expect(j).toHaveBeenCalledTimes(1);

			const { perSource, interleaved } = await done;
			expect(perSource.map((p) => p.source).sort()).toEqual([
				'joox',
				'kuwo',
				'netease',
				'qq'
			]);
			// final membership matches the un-staggered registry-ordered (qq-first) interleave
			expect(interleaved.map((t) => t.uid)).toEqual([
				'qq:q1',
				'netease:n1',
				'kuwo:k1',
				'joox:j1'
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('aborting during the stagger window stops later adapters from being invoked', async () => {
		vi.useFakeTimers();
		try {
			const n = vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1')]);
			const q = vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([mk('qq', 'q1')]);
			const k = vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([mk('kuwo', 'k1')]);
			const j = vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([mk('joox', 'j1')]);

			const ac = new AbortController();
			const done = searchAll('abortstagger', 1, ALL, ac.signal);
			// adapter[0] (qq since the 2026-08-31 kuwo demotion) fires immediately; the rest are
			// still in their sleep windows.
			await vi.advanceTimersByTimeAsync(0);
			expect(q).toHaveBeenCalledTimes(1);
			expect(n).not.toHaveBeenCalled();

			// Abort BEFORE the later windows elapse — they must be skipped.
			ac.abort();
			await vi.advanceTimersByTimeAsync(SEARCH_STAGGER_MS * 4);
			await done;

			expect(n).not.toHaveBeenCalled();
			expect(k).not.toHaveBeenCalled();
			expect(j).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('ensureTrackDetails (registry dispatch + readiness guard)', () => {
	// quick-260629-nyl Task 3: a netease (lyric-capable) track that resolves WITHOUT an lrc now arms
	// the bounded cross-source lyric fallback (a searchAll). Stub every source's search to [] so the
	// fallback finds no candidate and returns instantly (no real network) — these readiness/dispatch
	// tests are about the PRIMARY resolve, not the fallback (which has its own describe block below).
	function stubEmptySearches() {
		for (const id of Object.keys(SOURCES) as SourceId[]) {
			vi.spyOn(SOURCES[id], 'search').mockResolvedValue([]);
		}
	}

	it('dispatches to SOURCES[track.source].resolve when not yet loaded', async () => {
		stubEmptySearches();
		const t = mk('netease', 'n1');
		const resolved = { ...t, detailsLoaded: true, audioUrl: 'https://cdn/x.mp3' };
		const spy = vi.spyOn(SOURCES.netease, 'resolve').mockResolvedValue(resolved);

		const out = await ensureTrackDetails(t);
		expect(spy).toHaveBeenCalledOnce();
		expect(out.audioUrl).toBe('https://cdn/x.mp3');
	});

	it('re-resolves a Netease track whose lrcUrl is set but lrc not yet fetched', async () => {
		// readiness guard: detailsLoaded && audioUrl && (lrc || !lrcUrl)
		// here lrc=null and lrcUrl set → (null || !set) = false → NOT ready → re-resolve
		const t = mk('netease', 'n1', 1, {
			detailsLoaded: true,
			audioUrl: 'https://cdn/x.mp3',
			lrc: null,
			lrcUrl: 'https://cdn/x.lrc'
		});
		const spy = vi.spyOn(SOURCES.netease, 'resolve').mockResolvedValue({ ...t, lrc: '[00:01]hi' });

		const out = await ensureTrackDetails(t);
		expect(spy).toHaveBeenCalledOnce();
		expect(out.lrc).toBe('[00:01]hi');
	});

	it('returns early (no resolve) when fully loaded', async () => {
		const t = mk('netease', 'n1', 1, {
			detailsLoaded: true,
			audioUrl: 'https://cdn/x.mp3',
			lrc: '[00:01]hi',
			lrcUrl: 'https://cdn/x.lrc'
		});
		const spy = vi.spyOn(SOURCES.netease, 'resolve');

		const out = await ensureTrackDetails(t);
		expect(spy).not.toHaveBeenCalled();
		expect(out).toBe(t);
	});

	it('forwards an explicit per-call quality to the adapter resolve (WR-07 download path)', async () => {
		stubEmptySearches();
		const t = mk('qq', 'q1');
		const resolved = { ...t, detailsLoaded: true, audioUrl: 'https://cdn/x.flac' };
		const spy = vi.spyOn(SOURCES.qq, 'resolve').mockResolvedValue(resolved);

		await ensureTrackDetails(t, undefined, 'lossless');
		expect(spy).toHaveBeenCalledOnce();
		// (track, signal, quality) — the download tier reaches the adapter WITHOUT touching
		// the global settings.defaultQuality (the old temporary-swap shared-state race).
		expect(spy.mock.calls[0][2]).toBe('lossless');
	});
});

// quick-260629-nyl Task 3: bounded cross-source lyric fallback. When the primary source resolves a
// playable track with NO lrc, ensureTrackDetails does ONE cross-source lookup (searchAll + matchKey/
// scoreMatch) and copies a matched DIFFERENT source's lrc across — without touching the primary
// audioUrl. It is bounded (one fallback resolve), never-throws, and never fires for lyric-less sources.
describe('ensureTrackDetails — cross-source lyric fallback (quick-260629-nyl)', () => {
	it('fills lrc from a DIFFERENT source when the primary resolves a playable track with no lrc', async () => {
		// Primary qq track resolves playable but lyric-less. A matching netease candidate (same
		// artist+title via matchKey) HAS the lyric. The returned track keeps qq's audioUrl + gains the lrc.
		const primary = mk('qq', 'q1', 1, { artist: 'Jay', title: 'Sunny' });
		const qqResolved = { ...primary, detailsLoaded: true, audioUrl: 'https://cdn/qq.flac', lrc: null };
		const qqResolve = vi.spyOn(SOURCES.qq, 'resolve').mockResolvedValue(qqResolved);

		// searchAll fan-out: netease yields a same-song candidate; the others are empty.
		const neCand = mk('netease', 'n9', 1, { artist: 'Jay', title: 'Sunny' });
		vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([neCand]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([]);
		// The netease candidate resolves WITH a lyric.
		const neResolve = vi
			.spyOn(SOURCES.netease, 'resolve')
			.mockResolvedValue({ ...neCand, detailsLoaded: true, audioUrl: 'https://cdn/ne.mp3', lrc: '[00:01]cross' });

		const out = await ensureTrackDetails(primary);

		expect(qqResolve).toHaveBeenCalledOnce();
		expect(out.audioUrl).toBe('https://cdn/qq.flac'); // primary audio preserved
		expect(out.lrc).toBe('[00:01]cross'); // cross-source lyric copied across
		// Bounded: at most ONE fallback candidate resolved.
		expect(neResolve).toHaveBeenCalledOnce();
	});

	it('does NOT fire the fallback when the primary already produced lyrics', async () => {
		const primary = mk('qq', 'q1', 1, { artist: 'Jay', title: 'Sunny' });
		vi.spyOn(SOURCES.qq, 'resolve').mockResolvedValue({
			...primary,
			detailsLoaded: true,
			audioUrl: 'https://cdn/qq.flac',
			lrc: '[00:00]already'
		});
		const neSearch = vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([]);

		const out = await ensureTrackDetails(primary);
		expect(out.lrc).toBe('[00:00]already');
		expect(neSearch).not.toHaveBeenCalled(); // no fallback searchAll
	});

	it('does NOT fire the fallback for a genuinely lyric-less source (jamendo)', async () => {
		const primary = mk('jamendo', 'j1', 1, { artist: 'Free', title: 'Track' });
		vi.spyOn(SOURCES.jamendo, 'resolve').mockResolvedValue({
			...primary,
			detailsLoaded: true,
			audioUrl: 'https://cdn/jam.mp3',
			lrc: null
		});
		const neSearch = vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([]);

		const out = await ensureTrackDetails(primary);
		expect(out.lrc).toBeNull();
		expect(neSearch).not.toHaveBeenCalled(); // lyric-less source never triggers the fallback
	});

	it('never throws and returns the primary track unchanged when the fallback search fails', async () => {
		const primary = mk('kuwo', 'k1', 1, { artist: 'Jay', title: 'Sunny' });
		const resolved = { ...primary, detailsLoaded: true, audioUrl: 'https://cdn/kw.mp3', lrc: null };
		vi.spyOn(SOURCES.kuwo, 'resolve').mockResolvedValue(resolved);
		// Every source search rejects → searchAll still resolves (allSettled) with no candidates;
		// the fallback finds nothing and returns the primary track lyric-less, never throwing.
		vi.spyOn(SOURCES.netease, 'search').mockRejectedValue(new Error('boom'));
		vi.spyOn(SOURCES.qq, 'search').mockRejectedValue(new Error('boom'));
		vi.spyOn(SOURCES.kuwo, 'search').mockRejectedValue(new Error('boom'));
		vi.spyOn(SOURCES.joox, 'search').mockRejectedValue(new Error('boom'));

		const out = await ensureTrackDetails(primary);
		expect(out.audioUrl).toBe('https://cdn/kw.mp3');
		expect(out.lrc).toBeNull();
	});
});

// Phase 26 (RESOLVE-02, POLICY.md / spikes 001+002+004): a sourceless name-only stub (Plan 26-03's
// Last.fm track.getSimilar Up-Next shape) resolves kuwo-FIRST through a SINGLE source at a time —
// never a 7-source searchAll fan-out. It stops at the first source yielding a playable name-matching
// candidate, never-throws, and honors AbortSignal.
describe('resolveNameStub — registry-first single-source name resolution (RESOLVE-02)', () => {
	// Stub EVERY registered source's search so an unexpected walk step never hits the network.
	function stubAllEmpty() {
		for (const id of Object.keys(SOURCES) as SourceId[]) {
			vi.spyOn(SOURCES[id], 'search').mockResolvedValue([]);
		}
	}

	// debug/upnext-diverse-fallback-kuwo-dead (2026-08-31): the floor head moved kuwo → qq
	// (kuwo's upstream cert expired, every /api/kuwo/* 526s). The CONTRACT under test is unchanged:
	// search the FIRST enabled source only, stop at the first hit, never fan out.
	it('happy path: searches the FIRST source (qq) ONLY and returns a real playable Track', async () => {
		stubAllEmpty();
		const qqCand = mk('qq', 'q1', 1, { artist: 'Jay', title: 'Blue' });
		const qqSearch = vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([qqCand]);
		// qq resolves playable WITH an lrc so the cross-source lyric fallback never fires (which
		// would otherwise search other sources and defeat the "first source only" assertion).
		vi.spyOn(SOURCES.qq, 'resolve').mockResolvedValue({
			...qqCand,
			detailsLoaded: true,
			audioUrl: 'https://cdn/qq.flac',
			lrc: '[00:01]x'
		});

		const out = await resolveNameStub('Jay', 'Blue');

		expect(out?.uid).toBe('qq:q1');
		expect(out?.source).toBe('qq');
		expect(out?.audioUrl).toBe('https://cdn/qq.flac');
		// SINGLE-SOURCE + stop-at-first-hit: qq searched exactly once; netease/kuwo never touched.
		expect(qqSearch).toHaveBeenCalledOnce();
		expect(SOURCES.netease.search).not.toHaveBeenCalled();
		expect(SOURCES.kuwo.search).not.toHaveBeenCalled();
	});

	it('advances to netease (single-source) when qq misses', async () => {
		stubAllEmpty();
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([]); // floor head dry
		const neCand = mk('netease', 'n1', 1, { artist: 'Jay', title: 'Blue' });
		const neSearch = vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([neCand]);
		vi.spyOn(SOURCES.netease, 'resolve').mockResolvedValue({
			...neCand,
			detailsLoaded: true,
			audioUrl: 'https://cdn/ne.mp3',
			lrc: '[00:01]x'
		});

		const out = await resolveNameStub('Jay', 'Blue');

		expect(out?.uid).toBe('netease:n1');
		expect(neSearch).toHaveBeenCalledOnce();
		// kuwo is AFTER netease in the registry order → never reached once netease hits.
		expect(SOURCES.kuwo.search).not.toHaveBeenCalled();
	});

	it('returns null (never throws) when every source misses', async () => {
		stubAllEmpty();
		const out = await resolveNameStub('Nobody', 'Nothing');
		expect(out).toBeNull();
	});

	it('returns null when the signal is already aborted (no search issued)', async () => {
		stubAllEmpty();
		const ac = new AbortController();
		ac.abort();
		const out = await resolveNameStub('Jay', 'Blue', ac.signal);
		expect(out).toBeNull();
		expect(SOURCES.qq.search).not.toHaveBeenCalled();
	});

	it('does NOT adopt an UNRELATED (different-song) candidate — sameSongKey gate (WR-06)', async () => {
		stubAllEmpty();
		// the floor head returns a totally different song → must be rejected, walk continues, ends null.
		const wrong = mk('qq', 'w', 1, { artist: 'Other', title: 'Different', audioUrl: 'https://cdn/x.mp3' });
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([wrong]);
		const qqResolve = vi.spyOn(SOURCES.qq, 'resolve');

		const out = await resolveNameStub('Jay', 'Blue');
		expect(out).toBeNull();
		expect(qqResolve).not.toHaveBeenCalled(); // never even resolved the mismatch
	});

	// 27-04 (YT-RESILIENCE-01): ytmusic is enabledByDefault (searchable) but autoResolveEligible:false,
	// so the kuwo-first name-stub walk must SKIP it — an Up-Next name stub never auto-resolves to a
	// searchable-but-off-the-hot-path source (search-page + explicit-pick only).
	it('EXCLUDES ytmusic from the kuwo-first name-stub walk (off the auto-resolve floor)', async () => {
		stubAllEmpty(); // every source dry → the walk covers all ELIGIBLE sources, then returns null
		const out = await resolveNameStub('Nobody', 'Nothing');

		expect(out).toBeNull();
		// The walk DID run (kuwo, the floor, was searched)…
		expect(SOURCES.kuwo.search).toHaveBeenCalled();
		// …but ytmusic (autoResolveEligible:false) was NEVER searched — it is not an auto-resolve target.
		expect(SOURCES.ytmusic.search).not.toHaveBeenCalled();
	});
});

// Phase 26 (RESOLVE-02): ensureTrackDetails routes a marked name-stub through resolveNameStub and
// returns the resolved REAL Track (new source + uid); a normal source-bearing track path is unchanged.
describe('ensureTrackDetails — name-stub routing (RESOLVE-02)', () => {
	it('routes a resolveByName stub through the kuwo-first resolver', async () => {
		for (const id of Object.keys(SOURCES) as SourceId[]) {
			vi.spyOn(SOURCES[id], 'search').mockResolvedValue([]);
		}
		const kuwoCand = mk('kuwo', 'k1', 1, { artist: 'Jay', title: 'Blue' });
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([kuwoCand]);
		vi.spyOn(SOURCES.kuwo, 'resolve').mockResolvedValue({
			...kuwoCand,
			detailsLoaded: true,
			audioUrl: 'https://cdn/kw.mp3',
			lrc: '[00:01]x'
		});

		// Sourceless name-only stub: placeholder source, no songid, resolveByName marker set.
		const stub = mk('kuwo', '', 1, {
			resolveByName: true,
			detailsLoaded: false,
			artist: 'Jay',
			title: 'Blue'
		});

		const out = await ensureTrackDetails(stub);
		expect(out.uid).toBe('kuwo:k1');
		expect(out.source).toBe('kuwo');
		expect(out.audioUrl).toBe('https://cdn/kw.mp3');
		// Proves the name-resolver path (which SEARCHES) ran — not a direct SOURCES[source].resolve
		// dispatch on the placeholder stub (which would issue no search).
		expect(SOURCES.kuwo.search).toHaveBeenCalledOnce();
	});
});

// Phase 26 (RESOLVE-02): crossSourceLyric is bounded to a SINGLE-source lyric lookup (registry-order
// walk, skip own source + LYRICLESS_SOURCES), never the old all-enabled searchAll fan-out.
describe('ensureTrackDetails — crossSourceLyric is single-source (RESOLVE-02)', () => {
	it('fills lrc via a SINGLE-source lookup and never fans out to all sources', async () => {
		// Primary joox resolves playable but lyric-less (joox IS lyric-capable → fallback fires).
		const primary = mk('joox', 'j1', 1, { artist: 'Jay', title: 'Rain' });
		vi.spyOn(SOURCES.joox, 'resolve').mockResolvedValue({
			...primary,
			detailsLoaded: true,
			audioUrl: 'https://cdn/joox.mp3',
			lrc: null
		});
		// qq is FIRST in the walk (joox is the own source → skipped) and yields a matching candidate.
		const qqCand = mk('qq', 'q9', 1, { artist: 'Jay', title: 'Rain' });
		const qqSearch = vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([qqCand]);
		const neSearch = vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([]);
		const kuwoSearch = vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		const qqResolve = vi
			.spyOn(SOURCES.qq, 'resolve')
			.mockResolvedValue({ ...qqCand, detailsLoaded: true, audioUrl: 'https://cdn/qq.flac', lrc: '[00:02]cross' });

		const out = await ensureTrackDetails(primary);

		expect(out.audioUrl).toBe('https://cdn/joox.mp3'); // primary audio preserved
		expect(out.lrc).toBe('[00:02]cross'); // lyric copied from the single-source candidate
		// SINGLE-source, stop-at-first: qq searched once; netease/kuwo never searched (no fan-out).
		expect(qqSearch).toHaveBeenCalledOnce();
		expect(neSearch).not.toHaveBeenCalled();
		expect(kuwoSearch).not.toHaveBeenCalled();
		// bounded: at most ONE candidate resolved.
		expect(qqResolve).toHaveBeenCalledOnce();
	});
});

// Phase 31 (31-D-08 / 31-D-06) + phase 32 (32-D-10 / 32-D-10b / 32-D-11): ensureTrackDetails reads
// the edge resolve cache at most ONCE, serially, before the resolveByName branch and before the
// adapter dispatch. The cache is ADVISORY: a hit is a SHORTCUT PAST THE QQ SEARCH (the entry stores
// a permanent song_mid, never a playable url), and a miss / fault / failed qq resolve leaves the
// pre-existing path byte-identical. There is deliberately no client WRITE path (the edge fills its
// own entry out of band — a client-supplied mid would change what every other user in the PoP plays).
describe('ensureTrackDetails — edge resolve cache (32-D-10 / 32-D-10b)', () => {
	const MID = '003OUlho2gk0Ny';
	/** 32-D-10: the entry payload is a qq song_mid + the avail hints. No url. */
	const HIT: ResolveEntry = { source: 'qq', songid: MID, avail: { qq: 'ok' } };

	/** Spy every source's search AND resolve so "zero source calls" is provable, not inferred. */
	function spyAllSources() {
		const search: Partial<Record<SourceId, ReturnType<typeof vi.spyOn>>> = {};
		const resolve: Partial<Record<SourceId, ReturnType<typeof vi.spyOn>>> = {};
		for (const id of Object.keys(SOURCES) as SourceId[]) {
			search[id] = vi.spyOn(SOURCES[id], 'search').mockResolvedValue([]);
			resolve[id] = vi.spyOn(SOURCES[id], 'resolve').mockImplementation(async (t) => t);
		}
		return { search, resolve };
	}

	/** What a qq detail resolve returns off a mid: url + lyrics + duration in ONE call (32-D-09). */
	const qqComplete = (t: Track): Track => ({
		...t,
		detailsLoaded: true,
		audioUrl: 'https://cdn.qq/flac.flac',
		lrc: '[00:01]hi',
		duration: 231
	});

	const nameStub = () =>
		mk('kuwo', '', 1, { resolveByName: true, detailsLoaded: false, artist: 'Jay', title: 'Blue' });

	// 32-D-10b — the single largest remaining latency win post-32-D-08: the entry stores a MID, so a
	// caller that already holds one can never gain from the 0-400ms serial lookup.
	describe('32-D-10b: a track that already holds a qq mid never reads the cache', () => {
		it('a qq-sourced track skips the lookup entirely', async () => {
			const spies = spyAllSources();
			spies.resolve.qq?.mockImplementation(async (t: Track) => qqComplete(t));

			const out = await ensureTrackDetails(mk('qq', MID));

			expect(readResolveCache).not.toHaveBeenCalled();
			expect(out.audioUrl).toBe('https://cdn.qq/flac.flac');
			expect(spies.resolve.qq).toHaveBeenCalledOnce();
		});

		it('a non-qq track carrying songMid/qqId also skips the lookup', async () => {
			const spies = spyAllSources();
			spies.resolve.netease?.mockImplementation(async (t: Track) => ({
				...t,
				detailsLoaded: true,
				audioUrl: 'https://cdn/n.mp3',
				lrc: '[00:01]x'
			}));

			await ensureTrackDetails(mk('netease', 'n1', 1, { songMid: MID }));
			await ensureTrackDetails(mk('netease', 'n2', 1, { qqId: MID }));

			expect(readResolveCache).not.toHaveBeenCalled();
			expect(spies.resolve.netease).toHaveBeenCalledTimes(2);
		});

		it('a mid-LESS track still reads the cache, and logs the mid-less branch exactly once', async () => {
			spyAllSources();
			readResolveCache.mockResolvedValue(null);

			await ensureTrackDetails(mk('netease', 'n1', 1, { artist: 'Jay', title: 'Blue' }));

			expect(readResolveCache).toHaveBeenCalledTimes(1);
			expect(logAction).toHaveBeenCalledTimes(1);
			expect(logAction.mock.calls[0][0]).toBe('resolve.midless');
			expect(logAction.mock.calls[0][1]).toMatchObject({ source: 'netease', uid: 'netease:n1' });
		});

		it('never logs resolve.midless for a track that holds a mid', async () => {
			const spies = spyAllSources();
			spies.resolve.qq?.mockImplementation(async (t: Track) => qqComplete(t));

			await ensureTrackDetails(mk('qq', MID));

			expect(logAction).not.toHaveBeenCalled();
		});
	});

	// 32-D-10: the hit branch REPLACES 31's T-31-04-01 source+songid equality gate. In 31 the entry
	// carried a URL, so adopting it for a different identity would have played another VERSION of the
	// song than the one the user picked. A MID entry is different in kind: switching a mid-less track
	// onto qq IS the phase's purpose, and a matchKey collision is repaired by the retained POST bust.
	describe('32-D-10: a mid hit is a shortcut PAST the qq search, not a finished resolve', () => {
		it('rewrites a name-stub onto qq and completes it in ONE qq resolve, with NO lrcUnresolved', async () => {
			const spies = spyAllSources();
			spies.resolve.qq?.mockImplementation(async (t: Track) => qqComplete(t));
			readResolveCache.mockResolvedValue(HIT);

			const out = await ensureTrackDetails(nameStub());

			expect(out.source).toBe('qq');
			expect(out.songid).toBe(MID);
			expect(out.uid).toBe(`qq:${MID}`);
			expect(out.qqId).toBe(MID);
			expect(out.songMid).toBe(MID);
			expect(out.audioUrl).toBe('https://cdn.qq/flac.flac');
			// A mid hit is a COMPLETE resolve — url AND lyrics AND duration in one call — so the
			// 31-D-08 lyric re-resolve flag is not needed on this path and must NOT be set.
			expect(out.lrc).toBe('[00:01]hi');
			expect(out.duration).toBe(231);
			expect(out.lrcUnresolved).toBeUndefined();
			// The whole search walk is skipped — that is the saved call 32-D-10 exists for.
			for (const id of Object.keys(SOURCES) as SourceId[]) {
				expect(spies.search[id]).not.toHaveBeenCalled();
			}
			expect(spies.resolve.qq).toHaveBeenCalledOnce();
		});

		it('rewrites a source-bearing MID-LESS track onto qq (the 31 equality gate is superseded)', async () => {
			const spies = spyAllSources();
			spies.resolve.qq?.mockImplementation(async (t: Track) => qqComplete(t));
			readResolveCache.mockResolvedValue(HIT);

			const out = await ensureTrackDetails(mk('netease', 'n1'));

			expect(out.source).toBe('qq');
			expect(out.uid).toBe(`qq:${MID}`);
			expect(out.audioUrl).toBe('https://cdn.qq/flac.flac');
			expect(spies.resolve.netease).not.toHaveBeenCalled();
		});

		it('the derived track handed to qq.resolve is mid-bearing and NOT already loaded', async () => {
			const spies = spyAllSources();
			spies.resolve.qq?.mockImplementation(async (t: Track) => qqComplete(t));
			readResolveCache.mockResolvedValue(HIT);

			await ensureTrackDetails(mk('netease', 'n1'));

			const derived = spies.resolve.qq?.mock.calls[0][0] as Track;
			expect(derived.songid).toBe(MID);
			expect(derived.detailsLoaded).toBe(false);
			expect(derived.audioUrl).toBeNull();
		});

		it('registers the qq-RESOLVED url so reportDeadUrl can still bust a wrong mid (32-D-10a)', async () => {
			const spies = spyAllSources();
			spies.resolve.qq?.mockImplementation(async (t: Track) => qqComplete(t));
			readResolveCache.mockResolvedValue(HIT);

			await ensureTrackDetails(mk('netease', 'n1', 1, { artist: 'Jay', title: 'Blue' }));

			expect(registerServedResolve).toHaveBeenCalledWith(
				'https://cdn.qq/flac.flac',
				'Jay',
				'Blue'
			);
		});

		it('a THROWING qq resolve off a cached mid falls through — a hit is never worse than a miss', async () => {
			// 31-D-11 advisory contract, carried forward: the failure path is load-bearing.
			const spies = spyAllSources();
			spies.resolve.qq?.mockRejectedValue(new Error('tang down'));
			spies.resolve.netease?.mockImplementation(async (t: Track) => ({
				...t,
				detailsLoaded: true,
				audioUrl: 'https://cdn/n1.mp3',
				lrc: '[00:01]x'
			}));
			readResolveCache.mockResolvedValue(HIT);

			const out = await ensureTrackDetails(mk('netease', 'n1'));

			expect(out.audioUrl).toBe('https://cdn/n1.mp3'); // the ORIGINAL path ran
			expect(spies.resolve.netease).toHaveBeenCalledOnce();
			expect(registerServedResolve).not.toHaveBeenCalled();
		});

		it('a qq resolve that yields no audioUrl falls through to the original path', async () => {
			const spies = spyAllSources();
			spies.resolve.qq?.mockImplementation(async (t: Track) => ({ ...t, detailsLoaded: true }));
			spies.resolve.netease?.mockImplementation(async (t: Track) => ({
				...t,
				detailsLoaded: true,
				audioUrl: 'https://cdn/n1.mp3',
				lrc: '[00:01]x'
			}));
			readResolveCache.mockResolvedValue(HIT);

			const out = await ensureTrackDetails(mk('netease', 'n1'));

			expect(out.audioUrl).toBe('https://cdn/n1.mp3');
			expect(spies.resolve.netease).toHaveBeenCalledOnce();
		});

		it('a failed mid resolve on a NAME STUB still runs the full kuwo-first walk', async () => {
			const spies = spyAllSources();
			spies.resolve.qq?.mockRejectedValue(new Error('tang down'));
			const cand = mk('kuwo', 'k1', 1, { artist: 'Jay', title: 'Blue' });
			spies.search.kuwo?.mockResolvedValue([cand]);
			spies.resolve.kuwo?.mockResolvedValue({
				...cand,
				detailsLoaded: true,
				audioUrl: 'https://cdn/kw.mp3',
				lrc: '[00:01]x'
			});
			readResolveCache.mockResolvedValue(HIT);

			const out = await ensureTrackDetails(nameStub());

			expect(out.audioUrl).toBe('https://cdn/kw.mp3');
			expect(spies.search.kuwo).toHaveBeenCalledOnce();
		});

		it('a hit with a null songid (a cached KNOWN-NONE) is not adopted', async () => {
			const spies = spyAllSources();
			spies.resolve.netease?.mockImplementation(async (t: Track) => ({
				...t,
				detailsLoaded: true,
				audioUrl: 'https://cdn/n1.mp3',
				lrc: '[00:01]x'
			}));
			readResolveCache.mockResolvedValue({ source: null, songid: null, avail: { qq: 'dry' } });

			const out = await ensureTrackDetails(mk('netease', 'n1'));

			expect(out.audioUrl).toBe('https://cdn/n1.mp3');
			expect(spies.resolve.qq).not.toHaveBeenCalled();
		});
	});

	describe('a MISS / fault leaves the pre-existing path byte-identical (31-D-08 advisory)', () => {
		it('a MISS leaves the source-bearing path byte-identical', async () => {
			const spies = spyAllSources();
			spies.resolve.netease?.mockResolvedValue({
				...mk('netease', 'n1'),
				detailsLoaded: true,
				audioUrl: 'https://cdn/x.mp3'
			});
			readResolveCache.mockResolvedValue(null);

			const out = await ensureTrackDetails(mk('netease', 'n1'));

			expect(spies.resolve.netease).toHaveBeenCalledOnce();
			expect(out.audioUrl).toBe('https://cdn/x.mp3');
		});

		it('a MISS leaves the name-stub path byte-identical (the full kuwo-first walk still runs)', async () => {
			const spies = spyAllSources();
			const cand = mk('kuwo', 'k1', 1, { artist: 'Jay', title: 'Blue' });
			spies.search.kuwo?.mockResolvedValue([cand]);
			spies.resolve.kuwo?.mockResolvedValue({
				...cand,
				detailsLoaded: true,
				audioUrl: 'https://cdn/kw.mp3',
				lrc: '[00:01]x'
			});
			readResolveCache.mockResolvedValue(null);

			const out = await ensureTrackDetails(nameStub());

			expect(out.audioUrl).toBe('https://cdn/kw.mp3');
			expect(spies.search.kuwo).toHaveBeenCalledOnce();
		});

		it('a 404/500/malformed read (null sentinel) is indistinguishable from a miss', async () => {
			// The client maps EVERY fault to null, so catalog only ever sees "no cached data".
			const spies = spyAllSources();
			spies.resolve.kuwo?.mockResolvedValue({
				...mk('kuwo', 'k7'),
				detailsLoaded: true,
				audioUrl: 'https://cdn/k7.mp3'
			});
			readResolveCache.mockResolvedValue(null);

			const out = await ensureTrackDetails(mk('kuwo', 'k7'));

			expect(out.audioUrl).toBe('https://cdn/k7.mp3');
			expect(spies.resolve.kuwo).toHaveBeenCalledOnce();
		});
	});

	describe('31-D-06(c): the avail hints still thread into the name-stub walk', () => {
		it('a source marked dry is SKIPPED in the name-stub walk', async () => {
			const spies = spyAllSources();
			const cand = mk('joox', 'j1', 1, { artist: 'Jay', title: 'Blue' });
			spies.search.joox?.mockResolvedValue([cand]);
			spies.resolve.joox?.mockResolvedValue({
				...cand,
				detailsLoaded: true,
				audioUrl: 'https://cdn/joox.mp3',
				lrc: '[00:01]x'
			});
			readResolveCache.mockResolvedValue({
				source: null,
				songid: null,
				avail: { kuwo: 'dry' }
			});

			const out = await ensureTrackDetails(nameStub());

			expect(out.audioUrl).toBe('https://cdn/joox.mp3');
			expect(spies.search.kuwo).not.toHaveBeenCalled(); // the wasted call the hint exists to skip
		});

		it('an all-dry hint never EMPTIES the walk order', async () => {
			const spies = spyAllSources();
			const cand = mk('kuwo', 'k1', 1, { artist: 'Jay', title: 'Blue' });
			spies.search.kuwo?.mockResolvedValue([cand]);
			spies.resolve.kuwo?.mockResolvedValue({
				...cand,
				detailsLoaded: true,
				audioUrl: 'https://cdn/kw.mp3',
				lrc: '[00:01]x'
			});
			const avail = Object.fromEntries(
				(Object.keys(SOURCES) as SourceId[]).map((id) => [id, 'dry' as const])
			);
			readResolveCache.mockResolvedValue({ source: null, songid: null, avail });

			const out = await ensureTrackDetails(nameStub());

			// Every source is "dry" — the filter must degrade to the FULL order, not to nothing.
			expect(out.audioUrl).toBe('https://cdn/kw.mp3');
			expect(spies.search.kuwo).toHaveBeenCalledOnce();
		});
	});

	describe('read placement, bounds and supersedence', () => {
		it('the readiness guard short-circuits BEFORE any cache read', async () => {
			const t = mk('netease', 'n1', 1, {
				detailsLoaded: true,
				audioUrl: 'https://cdn/x.mp3',
				lrc: '[00:01]hi',
				lrcUrl: 'https://cdn/x.lrc'
			});

			const out = await ensureTrackDetails(t);

			expect(out).toBe(t);
			expect(readResolveCache).not.toHaveBeenCalled();
		});

		it('an abort DURING the cache read returns the unresolved stub with no further work', async () => {
			const spies = spyAllSources();
			const ac = new AbortController();
			readResolveCache.mockImplementation(async () => {
				ac.abort(); // superseded mid-lookup (a newer play bumped the generation)
				return null;
			});
			const t = mk('kuwo', 'k1');

			const out = await ensureTrackDetails(t, ac.signal);

			expect(out).toBe(t);
			expect(spies.resolve.kuwo).not.toHaveBeenCalled();
		});

		it('threads the caller signal and the raw artist/title into the read', async () => {
			spyAllSources();
			const ac = new AbortController();
			readResolveCache.mockResolvedValue(null);

			await ensureTrackDetails(mk('kuwo', 'k1', 1, { artist: 'Jay', title: 'Blue' }), ac.signal);

			expect(readResolveCache).toHaveBeenCalledTimes(1);
			expect(readResolveCache).toHaveBeenCalledWith('Jay', 'Blue', ac.signal);
		});

		// The 31-D-08 LYRIC RE-RESOLVE BYPASS survives 32-D-10 for the paths that still produce a
		// url-only track (the offline blob path, and player.backfillLyrics handing one back): reading
		// the cache again would just re-run the mid shortcut for a track that already has its url.
		it('a marked lyric re-resolve SKIPS the cache and resolves lyrics through the source', async () => {
			const spies = spyAllSources();
			spies.resolve.kuwo?.mockImplementation(async (t: Track) => ({
				...t,
				detailsLoaded: true,
				audioUrl: 'https://cdn/cached.mp3',
				lrc: '[00:01]hi'
			}));

			const filled = await ensureTrackDetails(
				mk('kuwo', 'k1', 1, { lrcUnresolved: true, audioUrl: 'https://cdn/cached.mp3' })
			);

			expect(readResolveCache).not.toHaveBeenCalled();
			expect(spies.resolve.kuwo).toHaveBeenCalledOnce();
			expect(filled.lrc).toBe('[00:01]hi');
		});

		it('still reads the cache for a marked track that ALREADY has lyrics (marker is inert)', async () => {
			const spies = spyAllSources();
			spies.resolve.qq?.mockImplementation(async (t: Track) => qqComplete(t));
			readResolveCache.mockResolvedValue(HIT);

			const out = await ensureTrackDetails(
				mk('kuwo', 'k1', 1, { lrcUnresolved: true, lrc: '[00:01]hi' })
			);

			expect(readResolveCache).toHaveBeenCalledTimes(1); // the bypass is scoped to a LYRIC re-resolve
			expect(out.audioUrl).toBe('https://cdn.qq/flac.flac');
		});
	});
});
