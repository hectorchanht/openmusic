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
const { readResolveCache } = vi.hoisted(() => ({
	readResolveCache: vi.fn(async (): Promise<ResolveEntry | null> => null)
}));
vi.mock('$lib/services/resolve-cache-client', () => ({ readResolveCache, reportDeadUrl: vi.fn() }));

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

	it('interleaves round-robin in registry order (kuwo→qq→netease→joox)', async () => {
		vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1'), mk('netease', 'n2')]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([mk('qq', 'q1')]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([mk('kuwo', 'k1')]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([mk('joox', 'j1')]);

		// Phase 26 (RESOLVE-01): interleave inherits the kuwo-first registry order.
		const { interleaved } = await searchAll('x', 1, ALL);
		expect(interleaved.map((t) => t.uid)).toEqual([
			'kuwo:k1',
			'qq:q1',
			'netease:n1',
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
		// same resolved shape (kuwo-first registry order → qq before netease when kuwo is empty)
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
		// interleave stays registry-ordered (kuwo-first) regardless of settle order
		expect(interleaved.map((t) => t.uid)).toEqual([
			'kuwo:k1',
			'qq:q1',
			'netease:n1',
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
			// Phase 26 (RESOLVE-01): kuwo-first registry → adapter[0]=kuwo, [1]=qq, [2]=netease, [3]=joox.
			await vi.advanceTimersByTimeAsync(0);
			expect(k).toHaveBeenCalledTimes(1);
			// adapter[1] (qq) must still be waiting on its SEARCH_STAGGER_MS sleep.
			expect(q).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(SEARCH_STAGGER_MS);
			expect(q).toHaveBeenCalledTimes(1);
			// netease at 2x, joox at 3x — still pending until their windows pass.
			expect(n).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(SEARCH_STAGGER_MS * 2);
			expect(n).toHaveBeenCalledTimes(1);
			expect(j).toHaveBeenCalledTimes(1);

			const { perSource, interleaved } = await done;
			expect(perSource.map((p) => p.source).sort()).toEqual([
				'joox',
				'kuwo',
				'netease',
				'qq'
			]);
			// final membership matches the un-staggered registry-ordered (kuwo-first) interleave
			expect(interleaved.map((t) => t.uid)).toEqual([
				'kuwo:k1',
				'qq:q1',
				'netease:n1',
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
			// adapter[0] (kuwo, kuwo-first registry) fires immediately; the rest are still in their
			// sleep windows.
			await vi.advanceTimersByTimeAsync(0);
			expect(k).toHaveBeenCalledTimes(1);
			expect(q).not.toHaveBeenCalled();

			// Abort BEFORE the later windows elapse — they must be skipped.
			ac.abort();
			await vi.advanceTimersByTimeAsync(SEARCH_STAGGER_MS * 4);
			await done;

			expect(q).not.toHaveBeenCalled();
			expect(n).not.toHaveBeenCalled();
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
describe('resolveNameStub — kuwo-first single-source name resolution (RESOLVE-02)', () => {
	// Stub EVERY registered source's search so an unexpected walk step never hits the network.
	function stubAllEmpty() {
		for (const id of Object.keys(SOURCES) as SourceId[]) {
			vi.spyOn(SOURCES[id], 'search').mockResolvedValue([]);
		}
	}

	it('happy path: searches kuwo ONLY and returns a real playable Track', async () => {
		stubAllEmpty();
		const kuwoCand = mk('kuwo', 'k1', 1, { artist: 'Jay', title: 'Blue' });
		const kuwoSearch = vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([kuwoCand]);
		// kuwo resolves playable WITH an lrc so the cross-source lyric fallback never fires (which
		// would otherwise search other sources and defeat the "kuwo only" assertion).
		vi.spyOn(SOURCES.kuwo, 'resolve').mockResolvedValue({
			...kuwoCand,
			detailsLoaded: true,
			audioUrl: 'https://cdn/kw.mp3',
			lrc: '[00:01]x'
		});

		const out = await resolveNameStub('Jay', 'Blue');

		expect(out?.uid).toBe('kuwo:k1');
		expect(out?.source).toBe('kuwo');
		expect(out?.audioUrl).toBe('https://cdn/kw.mp3');
		// SINGLE-SOURCE + stop-at-first-hit: kuwo searched exactly once; qq/netease never touched.
		expect(kuwoSearch).toHaveBeenCalledOnce();
		expect(SOURCES.qq.search).not.toHaveBeenCalled();
		expect(SOURCES.netease.search).not.toHaveBeenCalled();
	});

	it('advances to qq (single-source) when kuwo misses', async () => {
		stubAllEmpty();
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]); // kuwo dry
		const qqCand = mk('qq', 'q1', 1, { artist: 'Jay', title: 'Blue' });
		const qqSearch = vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([qqCand]);
		vi.spyOn(SOURCES.qq, 'resolve').mockResolvedValue({
			...qqCand,
			detailsLoaded: true,
			audioUrl: 'https://cdn/qq.flac',
			lrc: '[00:01]x'
		});

		const out = await resolveNameStub('Jay', 'Blue');

		expect(out?.uid).toBe('qq:q1');
		expect(qqSearch).toHaveBeenCalledOnce();
		// netease is AFTER qq in the kuwo-first order → never reached once qq hits.
		expect(SOURCES.netease.search).not.toHaveBeenCalled();
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
		expect(SOURCES.kuwo.search).not.toHaveBeenCalled();
	});

	it('does NOT adopt an UNRELATED (different-song) candidate — sameSongKey gate (WR-06)', async () => {
		stubAllEmpty();
		// kuwo returns a totally different song → must be rejected, walk continues, ends null.
		const wrong = mk('kuwo', 'w', 1, { artist: 'Other', title: 'Different', audioUrl: 'https://cdn/x.mp3' });
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([wrong]);
		const kuwoResolve = vi.spyOn(SOURCES.kuwo, 'resolve');

		const out = await resolveNameStub('Jay', 'Blue');
		expect(out).toBeNull();
		expect(kuwoResolve).not.toHaveBeenCalled(); // never even resolved the mismatch
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

// Phase 26 (RESOLVE-02): crossSourceLyric is bounded to a SINGLE-source lyric lookup (kuwo-first
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
		// kuwo is FIRST in the walk (joox is the own source → skipped) and yields a matching candidate.
		const kuwoCand = mk('kuwo', 'k9', 1, { artist: 'Jay', title: 'Rain' });
		const kuwoSearch = vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([kuwoCand]);
		const qqSearch = vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([]);
		const neSearch = vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([]);
		const kuwoResolve = vi
			.spyOn(SOURCES.kuwo, 'resolve')
			.mockResolvedValue({ ...kuwoCand, detailsLoaded: true, audioUrl: 'https://cdn/kw.mp3', lrc: '[00:02]cross' });

		const out = await ensureTrackDetails(primary);

		expect(out.audioUrl).toBe('https://cdn/joox.mp3'); // primary audio preserved
		expect(out.lrc).toBe('[00:02]cross'); // lyric copied from the single-source candidate
		// SINGLE-source, stop-at-first: kuwo searched once; qq/netease never searched (no fan-out).
		expect(kuwoSearch).toHaveBeenCalledOnce();
		expect(qqSearch).not.toHaveBeenCalled();
		expect(neSearch).not.toHaveBeenCalled();
		// bounded: at most ONE candidate resolved.
		expect(kuwoResolve).toHaveBeenCalledOnce();
	});
});

// Phase 31 (31-D-08 / 31-D-06): ensureTrackDetails reads the edge resolve cache ONCE, serially,
// before the resolveByName branch and before the adapter dispatch. The cache is ADVISORY: a hit
// short-circuits the whole source walk, and a miss / fault / identity mismatch leaves the
// pre-existing path byte-identical. There is deliberately no client WRITE path (the edge fills its
// own entry out of band — a client-supplied URL would change what every other user in the PoP plays).
describe('ensureTrackDetails — edge resolve cache (31-D-08 / 31-D-06)', () => {
	const HIT: ResolveEntry = {
		source: 'kuwo',
		songid: 'k1',
		url: 'https://cdn/cached.mp3',
		avail: { kuwo: 'ok' }
	};

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

	const nameStub = () =>
		mk('kuwo', '', 1, { resolveByName: true, detailsLoaded: false, artist: 'Jay', title: 'Blue' });

	it('a name-stub cache hit resolves with ZERO source calls', async () => {
		const spies = spyAllSources();
		readResolveCache.mockResolvedValue(HIT);

		const out = await ensureTrackDetails(nameStub());

		expect(out.audioUrl).toBe('https://cdn/cached.mp3');
		expect(out.uid).toBe('kuwo:k1');
		expect(out.source).toBe('kuwo');
		expect(out.songid).toBe('k1');
		expect(out.detailsLoaded).toBe(true);
		// searchAll fans out through SOURCES[].search — zero calls proves the whole walk was skipped.
		for (const id of Object.keys(SOURCES) as SourceId[]) {
			expect(spies.search[id]).not.toHaveBeenCalled();
			expect(spies.resolve[id]).not.toHaveBeenCalled();
		}
	});

	it('a source-bearing track adopts the cached url when source AND songid match', async () => {
		const spies = spyAllSources();
		readResolveCache.mockResolvedValue(HIT);

		const out = await ensureTrackDetails(mk('kuwo', 'k1'));

		expect(out.audioUrl).toBe('https://cdn/cached.mp3');
		expect(out.detailsLoaded).toBe(true);
		expect(spies.resolve.kuwo).not.toHaveBeenCalled();
	});

	it('IGNORES a cached entry for a DIFFERENT songid and resolves normally', async () => {
		// T-31-04-01: adopting another songid would play a different version than the one the user
		// picked in the VersionPicker.
		const spies = spyAllSources();
		spies.resolve.kuwo?.mockResolvedValue({
			...mk('kuwo', 'k2'),
			detailsLoaded: true,
			audioUrl: 'https://cdn/real-k2.mp3'
		});
		readResolveCache.mockResolvedValue(HIT); // entry is for k1

		const out = await ensureTrackDetails(mk('kuwo', 'k2'));

		expect(spies.resolve.kuwo).toHaveBeenCalledOnce();
		expect(out.audioUrl).toBe('https://cdn/real-k2.mp3');
	});

	it('IGNORES a cached entry for a DIFFERENT source and resolves normally', async () => {
		const spies = spyAllSources();
		spies.resolve.qq?.mockResolvedValue({
			...mk('qq', 'k1'),
			detailsLoaded: true,
			audioUrl: 'https://cdn/real-qq.mp3'
		});
		readResolveCache.mockResolvedValue(HIT); // entry is for kuwo

		const out = await ensureTrackDetails(mk('qq', 'k1'));

		expect(spies.resolve.qq).toHaveBeenCalledOnce();
		expect(out.audioUrl).toBe('https://cdn/real-qq.mp3');
	});

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

	it('31-D-06(c): a source marked dry is SKIPPED in the name-stub walk', async () => {
		const spies = spyAllSources();
		const cand = mk('qq', 'q1', 1, { artist: 'Jay', title: 'Blue' });
		spies.search.qq?.mockResolvedValue([cand]);
		spies.resolve.qq?.mockResolvedValue({
			...cand,
			detailsLoaded: true,
			audioUrl: 'https://cdn/qq.mp3',
			lrc: '[00:01]x'
		});
		readResolveCache.mockResolvedValue({
			source: null,
			songid: null,
			url: null,
			avail: { kuwo: 'dry' }
		});

		const out = await ensureTrackDetails(nameStub());

		expect(out.audioUrl).toBe('https://cdn/qq.mp3');
		expect(spies.search.kuwo).not.toHaveBeenCalled(); // the wasted call the hint exists to skip
		expect(spies.search.qq).toHaveBeenCalledOnce();
	});

	it('31-D-06(c): an all-dry hint never EMPTIES the walk order', async () => {
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
		readResolveCache.mockResolvedValue({ source: null, songid: null, url: null, avail });

		const out = await ensureTrackDetails(nameStub());

		// Every source is "dry" — the filter must degrade to the FULL order, not to nothing.
		expect(out.audioUrl).toBe('https://cdn/kw.mp3');
		expect(spies.search.kuwo).toHaveBeenCalledOnce();
	});

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
});
