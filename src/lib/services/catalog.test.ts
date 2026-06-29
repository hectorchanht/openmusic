import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	searchAll,
	ensureTrackDetails,
	__clearSearchCache,
	SEARCH_STAGGER_MS,
	type PartialSearchResult
} from './catalog';
import { sleep } from '$lib/proxy/http';
import { SOURCES } from '$lib/sources/registry';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

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

	it('interleaves round-robin in registry order (netease→qq→kuwo→joox)', async () => {
		vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1'), mk('netease', 'n2')]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([mk('qq', 'q1')]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([mk('kuwo', 'k1')]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([mk('joox', 'j1')]);

		const { interleaved } = await searchAll('x', 1, ALL);
		expect(interleaved.map((t) => t.uid)).toEqual([
			'netease:n1',
			'qq:q1',
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
		// same resolved shape
		expect(second.interleaved.map((t) => t.uid)).toEqual(first.interleaved.map((t) => t.uid));
		expect(second.interleaved.map((t) => t.uid)).toEqual(['netease:n1', 'qq:q1']);
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
		// interleave stays registry-ordered regardless of settle order
		expect(interleaved.map((t) => t.uid)).toEqual([
			'netease:n1',
			'qq:q1',
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
			await vi.advanceTimersByTimeAsync(0);
			expect(n).toHaveBeenCalledTimes(1);
			// adapter[1] (qq) must still be waiting on its SEARCH_STAGGER_MS sleep.
			expect(q).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(SEARCH_STAGGER_MS);
			expect(q).toHaveBeenCalledTimes(1);
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
			// final membership matches the un-staggered registry-ordered interleave
			expect(interleaved.map((t) => t.uid)).toEqual([
				'netease:n1',
				'qq:q1',
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
			// adapter[0] fires immediately; the rest are still in their sleep windows.
			await vi.advanceTimersByTimeAsync(0);
			expect(n).toHaveBeenCalledTimes(1);
			expect(q).not.toHaveBeenCalled();

			// Abort BEFORE the later windows elapse — they must be skipped.
			ac.abort();
			await vi.advanceTimersByTimeAsync(SEARCH_STAGGER_MS * 4);
			await done;

			expect(q).not.toHaveBeenCalled();
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
