import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSimilarArtists, buildSimilarQueue } from './similar';
import * as catalog from './catalog';
import { __clearSearchCache } from './ttl-cache';
import { __resetGovernor } from './api-base';
import { matchKey } from './match-key';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// Mirrors catalog.test.ts mk() factory — a minimal valid Track for fixtures.
function mk(source: SourceId, songid: string, artist = 'a', extra: Partial<Track> = {}): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title: `${source}-${songid}`,
		artist,
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

/** A SearchResult whose interleaved[0] is the given top track (or empty). */
function result(top: Track | null): catalog.SearchResult {
	return { perSource: [], interleaved: top ? [top] : [] };
}

function jsonResponse(body: unknown) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

type Pair = { artist: string; title: string; match: number };

/**
 * Route-aware fetch stub for the CLIENT apiFetch seam. Answers the two Last.fm routes
 * buildSimilarQueue can hit — /api/lastfm/similar-tracks (PRIMARY) and /api/similar
 * (artist.getSimilar FALLBACK) — plus a `{}` default for the Deezer related fallback so
 * getSimilarArtists degrades to []. Records every URL for call-count assertions.
 */
function stubRoutes(opts: { tracks?: Pair[]; artists?: string[] }) {
	const spy = vi.fn(async (input: RequestInfo | URL) => {
		const u = String(input);
		if (u.includes('/api/lastfm/similar-tracks')) return jsonResponse({ tracks: opts.tracks ?? [] });
		if (u.includes('/api/similar')) return jsonResponse({ artists: opts.artists ?? [] });
		return jsonResponse({}); // deezer related etc. → empty
	});
	vi.stubGlobal('fetch', spy);
	return { spy };
}

/** Stub /api/similar to return the given artist names (no network) — for getSimilarArtists. */
function stubSimilarFetch(artists: string[]) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => jsonResponse({ artists }))
	);
}

beforeEach(() => {
	__clearSearchCache();
	__resetGovernor();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	__clearSearchCache();
	__resetGovernor();
});

describe('getSimilarArtists', () => {
	it('returns the artist names from /api/similar', async () => {
		stubSimilarFetch(['林俊杰', '陈奕迅']);
		const names = await getSimilarArtists('周杰伦');
		expect(names).toEqual(['林俊杰', '陈奕迅']);
	});

	it('returns [] when fetch throws', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
		const names = await getSimilarArtists('周杰伦');
		expect(names).toEqual([]);
	});
});

// PRIMARY path (Phase 26, UPNEXT-01 — the 56→1 change). buildSimilarQueue now issues ONE
// /api/lastfm/similar-tracks call and maps the {artist,title,match} pairs to lazy name-only
// stubs — ZERO searchAll on this path (the old 8× artist-hop is gone).
describe('buildSimilarQueue — track.getSimilar primary path (56 → 1)', () => {
	it('issues exactly 1 fetch to /api/lastfm/similar-tracks + 0 searchAll; returns resolveByName stubs in match order', async () => {
		const { spy } = stubRoutes({
			tracks: [
				{ artist: 'Adele', title: 'Someone Like You', match: 1 },
				{ artist: 'Sia', title: 'Chandelier', match: 0.8 },
				{ artist: 'Lorde', title: 'Royals', match: 0.6 }
			]
		});
		const searchSpy = vi.spyOn(catalog, 'searchAll');
		const seed = mk('kuwo', 'seed', 'Adele', { title: 'Hello' });

		const out = await buildSimilarQueue(seed);

		// PRIMARY path = exactly ONE track.getSimilar call, ZERO searchAll fan-out.
		const stCalls = spy.mock.calls.filter((c) => String(c[0]).includes('/api/lastfm/similar-tracks'));
		expect(stCalls).toHaveLength(1);
		expect(searchSpy).not.toHaveBeenCalled();

		// lazy name-only stubs: resolveByName marker, detailsLoaded false, no audio/cover yet.
		expect(out.length).toBe(3);
		for (const t of out) {
			expect(t.resolveByName).toBe(true);
			expect(t.detailsLoaded).toBe(false);
			expect(t.audioUrl).toBeNull();
			expect(t.cover).toBeNull();
		}
		// exact artist/title carried; upstream match-descending order preserved.
		expect(out.map((t) => `${t.artist} - ${t.title}`)).toEqual([
			'Adele - Someone Like You',
			'Sia - Chandelier',
			'Lorde - Royals'
		]);
		// STABLE synthetic uid derived from the normalized artist+title (matchKey).
		expect(out[0].uid).toContain(matchKey('Adele', 'Someone Like You'));
		// two builds of the same seed produce the SAME synthetic uid (stable identity).
		const again = await buildSimilarQueue(seed);
		expect(again[0].uid).toBe(out[0].uid);
	});

	it('drops a similar pair that IS the seed song (by normalized identity, since the seed is a real track)', async () => {
		const seed = mk('kuwo', 'seed', 'Adele', { title: 'Hello' });
		stubRoutes({
			tracks: [
				{ artist: 'Adele', title: 'Hello', match: 1 }, // the seed itself
				{ artist: 'Sia', title: 'Chandelier', match: 0.5 }
			]
		});
		const out = await buildSimilarQueue(seed);
		expect(out.map((t) => matchKey(t.artist, t.title))).not.toContain(matchKey('Adele', 'Hello'));
		expect(out.map((t) => t.title)).toContain('Chandelier');
	});

	it('excludes a stub whose synthetic uid is in excludeUids', async () => {
		const seed = mk('kuwo', 'seed', 'Adele', { title: 'Hello' });
		stubRoutes({
			tracks: [
				{ artist: 'Sia', title: 'Chandelier', match: 0.9 },
				{ artist: 'Lorde', title: 'Royals', match: 0.7 }
			]
		});
		const first = await buildSimilarQueue(seed);
		const excludeUid = first[0].uid; // Sia — Chandelier synthetic uid
		const second = await buildSimilarQueue(seed, new Set([excludeUid]));
		expect(second.map((t) => t.uid)).not.toContain(excludeUid);
		expect(second.map((t) => t.title)).toContain('Royals');
	});

	it('dedupes same-song pairs by synthetic identity (bracket suffix folded)', async () => {
		const seed = mk('kuwo', 'seed', 'Adele', { title: 'Hello' });
		stubRoutes({
			tracks: [
				{ artist: 'Sia', title: 'Chandelier', match: 0.9 },
				{ artist: 'Sia', title: 'Chandelier (Live)', match: 0.4 } // normalizes to the same song
			]
		});
		const out = await buildSimilarQueue(seed);
		expect(out.length).toBe(1);
	});
});

// FALLBACK path — some newer CN songs return 0 similar TRACKS (thin Last.fm scrobble data,
// spike 002: 邓紫棋 光年之外, 毛不易 消愁). Fall through to artist.getSimilar, but resolve each
// candidate SINGLE-source (kuwo), never an 8-source searchAll per artist.
describe('buildSimilarQueue — dry fallback resolves SINGLE-source (never all-enabled)', () => {
	it('falls to artist.getSimilar and searches each similar artist with single-source prefs', async () => {
		stubRoutes({ tracks: [], artists: ['林俊杰', '陈奕迅'] });
		const seed = mk('kuwo', 'seed', '周杰伦', { title: '稻香' });
		const fresh = mk('kuwo', 'fresh', '林俊杰');

		const searchSpy = vi
			.spyOn(catalog, 'searchAll')
			.mockImplementation(async (kw: string, _page?: number, prefs?: Partial<Record<SourceId, boolean>>) => {
				// single-source: exactly ONE source true, the rest explicitly false (never all-enabled).
				const vals = Object.values(prefs ?? {});
				expect(vals.filter((v) => v === true)).toHaveLength(1);
				expect(vals.some((v) => v === false)).toBe(true);
				if (kw === '林俊杰') return result(fresh);
				return result(null);
			});

		const out = await buildSimilarQueue(seed);
		expect(searchSpy).toHaveBeenCalled();
		expect(out.map((t) => t.uid)).toContain(fresh.uid);
		expect(out.map((t) => t.uid)).not.toContain(seed.uid); // seed excluded
	});

	it('last-resort same-artist search is ALSO single-source, and never-throws', async () => {
		stubRoutes({ tracks: [], artists: [] }); // route dry AND no similar artists → deezer empty
		const seed = mk('kuwo', 'seed', '周杰伦', { title: '稻香' });
		const sameArtist = mk('kuwo', 'sa1', '周杰伦');

		const searchSpy = vi
			.spyOn(catalog, 'searchAll')
			.mockImplementation(async (kw: string, _page?: number, prefs?: Partial<Record<SourceId, boolean>>) => {
				const vals = Object.values(prefs ?? {});
				expect(vals.filter((v) => v === true)).toHaveLength(1); // single-source on the last resort too
				if (kw === '周杰伦') return { perSource: [], interleaved: [seed, sameArtist] };
				return result(null);
			});

		const out = await buildSimilarQueue(seed);
		expect(out.map((t) => t.uid)).toContain(sameArtist.uid);
		expect(out.map((t) => t.uid)).not.toContain(seed.uid);
	});
});

// CR-01 (Phase 26-07 gap-closure): the PRIMARY track.getSimilar gate must key on the POST-filter
// `out.length`, not the pre-filter `stubs.length`. A thin response whose every pair is the seed or
// already in excludeUids used to return a silent EMPTY Up-Next with a working fallback sitting
// unused. Also: buildSimilarQueue now reports WHICH path formed the queue via an additive callback.
describe('buildSimilarQueue — CR-01 post-filter fallback gate + report(via) callback', () => {
	it('CR-01: a primary fully filtered to empty (only stub is in excludeUids) REACHES the artist fallback (not [])', async () => {
		const seed = mk('kuwo', 'seed', 'Adele', { title: 'Hello' });
		// exactly ONE similar pair — excluded below so the primary `out` filters to empty.
		stubRoutes({ tracks: [{ artist: 'Sia', title: 'Chandelier', match: 0.9 }], artists: ['林俊杰'] });
		const fresh = mk('kuwo', 'fresh', '林俊杰');

		// learn the lone stub's stable synthetic uid, then exclude it.
		const seeded = await buildSimilarQueue(seed);
		const onlyUid = seeded[0].uid;

		const searchSpy = vi
			.spyOn(catalog, 'searchAll')
			.mockImplementation(async (kw: string) => (kw === '林俊杰' ? result(fresh) : result(null)));

		const out = await buildSimilarQueue(seed, new Set([onlyUid]));
		// PRE-FIX (gate on stubs.length): returned [] and NEVER called searchAll.
		// POST-FIX (gate on out.length): falls through to the artist.getSimilar fallback.
		expect(searchSpy).toHaveBeenCalled();
		expect(out.map((t) => t.uid)).toContain(fresh.uid);
	});

	it("report emits 'similar' on a healthy primary", async () => {
		stubRoutes({ tracks: [{ artist: 'Sia', title: 'Chandelier', match: 0.9 }] });
		const seed = mk('kuwo', 'seed', 'Adele', { title: 'Hello' });
		const report = vi.fn();
		const out = await buildSimilarQueue(seed, new Set(), report);
		expect(out.length).toBeGreaterThan(0);
		expect(report).toHaveBeenCalledWith('similar');
	});

	it("report emits 'artist' when the primary is dry and similar-artists resolve", async () => {
		stubRoutes({ tracks: [], artists: ['林俊杰'] });
		const seed = mk('kuwo', 'seed', '周杰伦', { title: '稻香' });
		const fresh = mk('kuwo', 'fresh', '林俊杰');
		vi.spyOn(catalog, 'searchAll').mockImplementation(async (kw: string) =>
			kw === '林俊杰' ? result(fresh) : result(null)
		);
		const report = vi.fn();
		const out = await buildSimilarQueue(seed, new Set(), report);
		expect(out.map((t) => t.uid)).toContain(fresh.uid);
		expect(report).toHaveBeenCalledWith('artist');
	});

	it("report emits 'empty' on a total miss (all paths dry → [])", async () => {
		stubRoutes({ tracks: [], artists: [] });
		const seed = mk('kuwo', 'seed', '周杰伦', { title: '稻香' });
		vi.spyOn(catalog, 'searchAll').mockImplementation(async () => result(null));
		const report = vi.fn();
		const out = await buildSimilarQueue(seed, new Set(), report);
		expect(out).toEqual([]);
		expect(report).toHaveBeenCalledWith('empty');
	});
});

// Call-cost proof (Phase 26, UPNEXT-01 — mirrors the spike-003 audit method against the
// mocked seams). Proves the 56-call `8 artists × 7 sources` block is GONE: the up-next BUILD
// path is a single /api/* call (the track.getSimilar call) with 0 all-enabled searchAll fan-outs.
//
// END-TO-END budget (spike-003, click-to-play-cost.md — the ~59 → ~3/≤~5 target): a single-song
// play with a GENERATED up-next now costs, in /api/* calls:
//   1  buildSimilarQueue (this test — track.getSimilar; the old 56-call block is removed)
// + 1  seed resolve (kuwo-first single source, Plan 26-01 resolveNameStub; cover inline)
// + ≤1 lazy Deezer HQ cover upgrade (Plan 26-02, off the hot path)
// + ≤1 next-track prefetch resolve (kuwo-first)
// = ≤ ~4-5 total, vs the ~59 baseline. The other terms are proven in their own plans
// (26-01 resolve, 26-02 cover); this test owns the buildSimilarQueue = 1 assertion.
describe('buildSimilarQueue — call cost (spike-003: the 56-call block is gone)', () => {
	it('the up-next BUILD path is exactly 1 /api/* call with 0 all-enabled searchAll fan-outs', async () => {
		const { spy } = stubRoutes({
			tracks: [
				{ artist: 'Adele', title: 'Someone Like You', match: 1 },
				{ artist: 'Sia', title: 'Chandelier', match: 0.8 },
				{ artist: 'Lorde', title: 'Royals', match: 0.6 },
				{ artist: 'Halsey', title: 'Colors', match: 0.5 },
				{ artist: 'Birdy', title: 'Skinny Love', match: 0.4 }
			]
		});
		const searchSpy = vi.spyOn(catalog, 'searchAll');
		const seed = mk('kuwo', 'seed', 'Adele', { title: 'Hello' });

		const out = await buildSimilarQueue(seed);

		// exactly ONE /api/* call total on the build path, and it IS the track.getSimilar call.
		const apiCalls = spy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/api/'));
		expect(apiCalls).toHaveLength(1);
		expect(apiCalls[0]).toContain('/api/lastfm/similar-tracks');
		// ZERO searchAll — the 8×7 artist-hop fan-out (spike-003's 56 calls) does not occur.
		expect(searchSpy).not.toHaveBeenCalled();
		// and it actually produced a usable lazy up-next (5 resolveByName stubs).
		expect(out).toHaveLength(5);
		expect(out.every((t) => t.resolveByName === true)).toBe(true);
	});
});
