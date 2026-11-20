import { describe, it, expect, vi, afterEach } from 'vitest';
import { ARTIST_POOL, buildDiversePicks } from './picks';
import * as catalog from './catalog';
import * as dedupe from './dedupe';
import { settings } from '$lib/stores/settings.svelte';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// Characterisation pins for buildDiversePicks (Coverage Inventory gap G3 — the seam had
// NO test at head while discovery/radio/similar all did). These pin the CURRENT contract
// of picks.ts itself: sample N distinct pool artists → one searchAll(artist, 1) each →
// take interleaved[0] only → dedupeBest(tops, settings.preferredSource) → drop
// excludeUids. Best-effort throughout: a failing/empty artist is skipped, never fatal.
// The dedupe WINNER rule inside a same-song group is dedupe.ts's own contract
// (dedupe.test.ts) — here we pin only that the collapse happens and what picks hands it.

// Mirrors similar.test.ts mk() factory — a minimal valid Track for fixtures.
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

/** A SearchResult whose interleaved holds the given tracks. */
function result(tracks: Track[]): catalog.SearchResult {
	return { perSource: [], interleaved: tracks };
}

/**
 * Stub searchAll per artist keyword: an artist mapped to an Error rejects, an artist
 * mapped to tracks resolves with them as `interleaved`, an unmapped artist resolves
 * empty. Returns the spy for call-shape assertions.
 */
function stubSearch(byArtist: Map<string, Track[] | Error> = new Map()) {
	return vi.spyOn(catalog, 'searchAll').mockImplementation(async (kw: string) => {
		const v = byArtist.get(kw);
		if (v instanceof Error) throw v;
		return result(v ?? []);
	});
}

/** Pin Math.random so sample()'s Fisher–Yates is the identity shuffle (j = i for all i):
 *  the sampled artists are then exactly the first N of ARTIST_POOL, in pool order. */
function identityShuffle() {
	vi.spyOn(Math, 'random').mockReturnValue(0.999);
}

afterEach(() => {
	vi.restoreAllMocks();
	settings.defaultSource = 'auto';
});

describe('ARTIST_POOL', () => {
	it('is exactly the current 20-artist pool, in order', () => {
		expect(ARTIST_POOL).toEqual([
			'周杰伦', '邓紫棋', '林俊杰', '陈奕迅', '五月天', '李荣浩', '张惠妹', '王菲', '周深', '李宗盛',
			'Taylor Swift', 'Ed Sheeran', 'Lana Del Rey', 'Bruno Mars', 'Adele', 'The Weeknd', 'Billie Eilish', 'Coldplay', 'Maroon 5', 'Dua Lipa'
		]);
	});

	it('contains no duplicate artist (sampling can never repeat an artist)', () => {
		expect(new Set(ARTIST_POOL).size).toBe(ARTIST_POOL.length);
	});
});

describe('buildDiversePicks — sampling & search contract', () => {
	it('searches the first `count` pool artists (identity shuffle), one searchAll(artist, 1) each, and returns their tops in artist order', async () => {
		identityShuffle();
		const tops = ARTIST_POOL.slice(0, 3).map((a, i) => mk('kuwo', `t${i}`, a, { title: `Song ${i}` }));
		const spy = stubSearch(new Map(ARTIST_POOL.slice(0, 3).map((a, i) => [a, [tops[i]]])));

		const out = await buildDiversePicks(3);

		expect(spy).toHaveBeenCalledTimes(3);
		expect(spy.mock.calls.map((c) => c[0])).toEqual(ARTIST_POOL.slice(0, 3));
		expect(spy.mock.calls.every((c) => c[1] === 1)).toBe(true);
		expect(out.map((t) => t.uid)).toEqual(tops.map((t) => t.uid));
	});

	it('samples DISTINCT pool artists under real randomness', async () => {
		const spy = stubSearch();
		for (let run = 0; run < 5; run++) {
			spy.mockClear();
			await buildDiversePicks(6);
			const keywords = spy.mock.calls.map((c) => c[0] as string);
			expect(keywords).toHaveLength(6);
			expect(new Set(keywords).size).toBe(6);
			expect(keywords.every((k) => ARTIST_POOL.includes(k))).toBe(true);
		}
	});

	it('caps the sample at the pool size: count 25 searches each of the 20 artists exactly once', async () => {
		const byArtist = new Map(ARTIST_POOL.map((a, i) => [a, [mk('kuwo', `t${i}`, a)]]));
		const spy = stubSearch(byArtist);

		const out = await buildDiversePicks(25);

		expect(spy).toHaveBeenCalledTimes(ARTIST_POOL.length);
		expect(new Set(spy.mock.calls.map((c) => c[0])).size).toBe(ARTIST_POOL.length);
		expect(out).toHaveLength(ARTIST_POOL.length);
	});

	it('count 0 searches nothing and returns []', async () => {
		const spy = stubSearch();
		await expect(buildDiversePicks(0)).resolves.toEqual([]);
		expect(spy).not.toHaveBeenCalled();
	});

	// CURRENT BEHAVIOUR, suspected bug (flagged in the landing report, not fixed here):
	// count is clamped only ABOVE (Math.min(count, pool.length)); a negative count reaches
	// sample() untouched and slice(0, -1) drops just one artist — buildDiversePicks(-1)
	// searches 19 artists instead of none. All real callers pass a positive count (8).
	it('negative count currently samples all-but-one artists (slice(0, -1) — pinned as-is)', async () => {
		identityShuffle();
		const spy = stubSearch();
		await buildDiversePicks(-1);
		expect(spy).toHaveBeenCalledTimes(ARTIST_POOL.length - 1);
		expect(spy.mock.calls.map((c) => c[0])).toEqual(ARTIST_POOL.slice(0, -1));
	});
});

describe('buildDiversePicks — top extraction', () => {
	it("takes ONLY interleaved[0] from each artist's result — later rows never appear", async () => {
		identityShuffle();
		const first = mk('kuwo', 'first', ARTIST_POOL[0], { title: 'First' });
		const second = mk('kuwo', 'second', ARTIST_POOL[0], { title: 'Second' });
		stubSearch(new Map([[ARTIST_POOL[0], [first, second]]]));

		const out = await buildDiversePicks(1);

		expect(out.map((t) => t.uid)).toEqual([first.uid]);
	});

	it('reads interleaved only — tracks present solely in perSource contribute nothing', async () => {
		identityShuffle();
		const buried = mk('qq', 'buried', ARTIST_POOL[0]);
		vi.spyOn(catalog, 'searchAll').mockResolvedValue({
			perSource: [{ source: 'qq', status: 'ok', tracks: [buried] }],
			interleaved: []
		});

		await expect(buildDiversePicks(1)).resolves.toEqual([]);
	});
});

describe('buildDiversePicks — sparse & failure behaviour (best-effort, never throws)', () => {
	it('skips an artist whose search rejects and still returns the others', async () => {
		identityShuffle();
		const t0 = mk('kuwo', 't0', ARTIST_POOL[0]);
		const t2 = mk('kuwo', 't2', ARTIST_POOL[2]);
		stubSearch(
			new Map<string, Track[] | Error>([
				[ARTIST_POOL[0], [t0]],
				[ARTIST_POOL[1], new Error('source down')],
				[ARTIST_POOL[2], [t2]]
			])
		);

		const out = await buildDiversePicks(3);
		expect(out.map((t) => t.uid)).toEqual([t0.uid, t2.uid]);
	});

	it('skips an artist whose search returns an empty interleaved', async () => {
		identityShuffle();
		const t1 = mk('kuwo', 't1', ARTIST_POOL[1]);
		stubSearch(new Map([[ARTIST_POOL[1], [t1]]]));

		const out = await buildDiversePicks(3);
		expect(out.map((t) => t.uid)).toEqual([t1.uid]);
	});

	it('resolves to [] when every artist search rejects', async () => {
		identityShuffle();
		stubSearch(
			new Map(ARTIST_POOL.slice(0, 4).map((a) => [a, new Error('down')] as [string, Error]))
		);
		await expect(buildDiversePicks(4)).resolves.toEqual([]);
	});

	it('sparse pool: count 8 with only 2 artists answering returns exactly those 2, in artist order', async () => {
		identityShuffle();
		const t1 = mk('kuwo', 't1', ARTIST_POOL[1]);
		const t4 = mk('kuwo', 't4', ARTIST_POOL[4]);
		stubSearch(
			new Map([
				[ARTIST_POOL[1], [t1]],
				[ARTIST_POOL[4], [t4]]
			])
		);

		const out = await buildDiversePicks(8);
		expect(out.map((t) => t.uid)).toEqual([t1.uid, t4.uid]);
	});
});

describe('buildDiversePicks — cross-source dedupe composition', () => {
	it('hands the tops (in artist order) to dedupeBest exactly once, with settings.preferredSource', async () => {
		identityShuffle();
		settings.defaultSource = 'qq'; // preferredSource getter → 'qq'
		const t0 = mk('kuwo', 't0', ARTIST_POOL[0], { title: 'Song A' });
		const t1 = mk('kuwo', 't1', ARTIST_POOL[1], { title: 'Song B' });
		stubSearch(
			new Map([
				[ARTIST_POOL[0], [t0]],
				[ARTIST_POOL[1], [t1]]
			])
		);
		const dedupeSpy = vi.spyOn(dedupe, 'dedupeBest');

		await buildDiversePicks(2);

		expect(dedupeSpy).toHaveBeenCalledTimes(1);
		expect(dedupeSpy.mock.calls[0][0].map((t) => t.uid)).toEqual([t0.uid, t1.uid]);
		expect(dedupeSpy.mock.calls[0][1]).toBe('qq');
	});

	it('passes undefined as the dedupe preference when defaultSource is auto (the default)', async () => {
		identityShuffle();
		const t0 = mk('kuwo', 't0', ARTIST_POOL[0], { title: 'Song A' });
		stubSearch(new Map([[ARTIST_POOL[0], [t0]]]));
		const dedupeSpy = vi.spyOn(dedupe, 'dedupeBest');

		await buildDiversePicks(1);

		expect(dedupeSpy).toHaveBeenCalledTimes(1);
		expect(dedupeSpy.mock.calls[0][1]).toBeUndefined();
	});

	it('two artists whose tops are the SAME song collapse to a single pick', async () => {
		identityShuffle();
		const a = mk('netease', 'x', '周杰伦', { title: '稻香' });
		const b = mk('qq', 'y', '周杰伦', { title: '稻香' });
		stubSearch(
			new Map([
				[ARTIST_POOL[0], [a]],
				[ARTIST_POOL[1], [b]]
			])
		);

		const out = await buildDiversePicks(2);

		// the collapse is picks' contract; WHICH variant survives is dedupeBest's own
		// ranked-winner rule (dedupe.test.ts) — either uid is a correct collapse here.
		expect(out).toHaveLength(1);
		expect([a.uid, b.uid]).toContain(out[0].uid);
	});

	it('distinct songs never collapse — one pick per artist, order preserved', async () => {
		identityShuffle();
		const tops = ARTIST_POOL.slice(0, 3).map((a, i) => mk('kuwo', `d${i}`, a, { title: `Distinct ${i}` }));
		stubSearch(new Map(ARTIST_POOL.slice(0, 3).map((a, i) => [a, [tops[i]]])));

		const out = await buildDiversePicks(3);
		expect(out.map((t) => t.uid)).toEqual(tops.map((t) => t.uid));
	});
});

describe('buildDiversePicks — excludeUids', () => {
	it('drops picks whose uid is in excludeUids, keeping the rest in artist order', async () => {
		identityShuffle();
		const tops = ARTIST_POOL.slice(0, 3).map((a, i) => mk('kuwo', `e${i}`, a, { title: `Ex ${i}` }));
		stubSearch(new Map(ARTIST_POOL.slice(0, 3).map((a, i) => [a, [tops[i]]])));

		const out = await buildDiversePicks(3, new Set([tops[1].uid]));
		expect(out.map((t) => t.uid)).toEqual([tops[0].uid, tops[2].uid]);
	});

	it('returns [] when every pick is excluded', async () => {
		identityShuffle();
		const tops = ARTIST_POOL.slice(0, 2).map((a, i) => mk('kuwo', `x${i}`, a, { title: `X ${i}` }));
		stubSearch(new Map(ARTIST_POOL.slice(0, 2).map((a, i) => [a, [tops[i]]])));

		await expect(buildDiversePicks(2, new Set(tops.map((t) => t.uid)))).resolves.toEqual([]);
	});

	it('an excludeUids entry that matches no pick changes nothing', async () => {
		identityShuffle();
		const t0 = mk('kuwo', 'keep', ARTIST_POOL[0], { title: 'Keep' });
		stubSearch(new Map([[ARTIST_POOL[0], [t0]]]));

		const out = await buildDiversePicks(1, new Set(['kuwo:absent']));
		expect(out.map((t) => t.uid)).toEqual([t0.uid]);
	});
});
