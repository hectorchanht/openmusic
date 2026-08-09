import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	resolveStub,
	mapWithConcurrency,
	shuffle,
	pickRandomPage,
	DISCOVERY_TAGS,
	DISCOVERY_COUNTRIES
} from './discovery';
import * as catalog from './catalog';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// resolveStub (Phase 9, D-03) is the LOAD-BEARING transform: a Last.fm {artist,title}
// stub is NOT a Track (no uid/source/audioUrl), so it cannot be handed to player.play()
// directly. resolveStub re-searches via searchAll + dedupeBest (the same resolver
// picks.ts/similar.ts use) and returns the best playable Track, or null on a miss.
// It NEVER throws and does NOT modify catalog.ts/dedupe.ts.

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

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('resolveStub — Last.fm {artist,title} stub → playable Track', () => {
	it('returns the top dedupeBest hit when searchAll finds a match', async () => {
		const hit = mk('netease', 'hit', '周杰伦', { title: '稻香' });
		const spy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));

		const out = await resolveStub('周杰伦', '稻香');
		expect(spy).toHaveBeenCalledWith('周杰伦 稻香', 1);
		expect(out).not.toBeNull();
		expect(out?.uid).toBe(hit.uid);
	});

	it('returns the FIRST track (best cross-source hit) when several are returned', async () => {
		const first = mk('netease', 'first', '周杰伦', { title: '稻香' });
		const second = mk('qq', 'second', '周杰伦', { title: '稻香' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([first, second]));

		const out = await resolveStub('周杰伦', '稻香');
		expect(out?.uid).toBe(first.uid);
	});

	it('returns null when searchAll returns no hits', async () => {
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));
		await expect(resolveStub('Nobody', 'Nothing')).resolves.toBeNull();
	});

	it('returns null (never throws) when searchAll throws', async () => {
		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('search down'));
		await expect(resolveStub('X', 'Y')).resolves.toBeNull();
	});
});

describe('resolveStub — scored best-match pick (LFSRC-03 / D-02)', () => {
	it('returns the CLEAN track even when a karaoke/翻唱 variant is ordered first', async () => {
		// searchAll surfaces the 翻唱 (cover) variant BEFORE the clean studio cut. The two
		// titles normalize to DIFFERENT dedupe keys (稻香翻唱 vs 稻香) so both survive dedupeBest;
		// without scoring, dedupeBest[0] would be the variant. scoreMatch must beat that.
		const variant = mk('netease', 'variant', '周杰伦', { title: '稻香 翻唱' });
		const clean = mk('qq', 'clean', '周杰伦', { title: '稻香' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([variant, clean]));

		const out = await resolveStub('周杰伦', '稻香');
		expect(out?.uid).toBe(clean.uid);
	});

	it('returns the CLEAN track over an English cover variant ordered first', async () => {
		const cover = mk('netease', 'cover', 'X', { title: 'Song Cover' });
		const clean = mk('qq', 'clean', 'X', { title: 'Song' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([cover, clean]));

		const out = await resolveStub('X', 'Song');
		expect(out?.uid).toBe(clean.uid);
	});

	it('falls back to dedupeBest order among equal-scored candidates (WR-01: strict stable max, ≥2 survive)', async () => {
		// Two DISTINCT, equally-(zero-)scored candidates with DIFFERENT normalized keys so
		// BOTH survive dedupeBest (the prior version used identical 稻香/稻香 which dedupeBest
		// collapsed to one, so the ≥2-candidate stable-max never ran). Both are unrelated to
		// the query → similarity 0, penalty 0 → equal score. The strict `s > bestScore` max
		// keeps the EARLIER dedupeBest position → `first` wins the tie.
		const first = mk('netease', 'first', 'Alpha', { title: 'Aaa' });
		const second = mk('qq', 'second', 'Beta', { title: 'Bbb' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([first, second]));

		const out = await resolveStub('周杰伦', '稻香');
		expect(out?.uid).toBe(first.uid); // tie → first-wins (not last-wins)
	});

	it('still returns null on zero results and never throws (posture preserved)', async () => {
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));
		await expect(resolveStub('Nobody', 'Nothing')).resolves.toBeNull();

		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('search down'));
		await expect(resolveStub('X', 'Y')).resolves.toBeNull();
	});
});

// quick-260808-urx — t2s rescue-on-miss.
//
// Share links now carry the SHARER'S DISPLAY-language names (Half A), so a Traditional query
// against the mostly-Simplified CN index stopped being an accident and became a designed input.
// resolveStub rescues a Chinese-script miss with EXACTLY ONE t2s-normalized retry.
//
// The real t2sConvertLines runs here (deterministic offline dict; Vitest resolves its dynamic
// JSON imports natively — see the zh-convert.ts header), so the conversions asserted below are
// the production ones. Every branch is pinned by an EXACT call count: "no extra search" is a
// hard guarantee for non-Chinese and already-Simplified input, not a claim.
describe('resolveStub — t2s rescue-on-miss (quick-260808-urx)', () => {
	it('retries ONCE with the Simplified form when a Traditional query misses', async () => {
		const hit = mk('kuwo', 'hit', '周杰伦', { title: '止战之殇' });
		const spy = vi
			.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([])) // Traditional query → miss (the production failure)
			.mockResolvedValueOnce(result([hit])); // Simplified retry → hit

		const out = await resolveStub('周傑倫', '止戰之殤');
		expect(out?.uid).toBe(hit.uid);
		expect(spy).toHaveBeenCalledTimes(2);
		expect(spy.mock.calls[0][0]).toBe('周傑倫 止戰之殤');
		// The production-verified pair from quick-260807-vl1's /api/og probe.
		expect(spy.mock.calls[1][0]).toBe('周杰伦 止战之殇');
	});

	it('does NOT retry when the first Chinese query already hits', async () => {
		const hit = mk('kuwo', 'hit', '周傑倫', { title: '止戰之殤' });
		const spy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));

		expect((await resolveStub('周傑倫', '止戰之殤'))?.uid).toBe(hit.uid);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('does NOT retry a non-Chinese miss (isChineseLine gate — zero extra cost)', async () => {
		const spy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));

		await expect(resolveStub('Adele', 'Hello')).resolves.toBeNull();
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('does NOT retry an already-Simplified miss (identity conversion → nothing to re-search)', async () => {
		const spy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));

		await expect(resolveStub('周杰伦', '止战之殇')).resolves.toBeNull();
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('retries at most ONCE — a miss on the retry returns null, never loops', async () => {
		const spy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));

		await expect(resolveStub('周傑倫', '止戰之殤')).resolves.toBeNull();
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('scores the retry against the CONVERTED query (the terms actually searched)', async () => {
		// Both survive dedupeBest (different normalized keys). The clean Simplified cut must win
		// over the 翻唱 variant — which only happens if scoreMatch is given the converted query.
		const variant = mk('netease', 'variant', '周杰伦', { title: '止战之殇 翻唱' });
		const clean = mk('qq', 'clean', '周杰伦', { title: '止战之殇' });
		vi.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([]))
			.mockResolvedValueOnce(result([variant, clean]));

		expect((await resolveStub('周傑倫', '止戰之殤'))?.uid).toBe(clean.uid);
	});

	it('never throws when the retry search throws (never-throw contract holds)', async () => {
		vi.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([]))
			.mockRejectedValueOnce(new Error('search down'));

		await expect(resolveStub('周傑倫', '止戰之殤')).resolves.toBeNull();
	});
});

describe('mapWithConcurrency — order-preserving capped async pool (Pitfall 11)', () => {
	it('runs at most `limit` calls in flight and preserves input order', async () => {
		const items = [0, 1, 2, 3, 4, 5];
		let inFlight = 0;
		let maxInFlight = 0;

		const out = await mapWithConcurrency(items, 2, async (n) => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			// Yield a few microtasks so concurrent slots actually overlap before resolving.
			await new Promise((r) => setTimeout(r, 5));
			inFlight--;
			return n * 10;
		});

		// Cap of 2 is never exceeded...
		expect(maxInFlight).toBeLessThanOrEqual(2);
		// ...and at least 2 ran together (proves it isn't accidentally serial).
		expect(maxInFlight).toBe(2);
		// Result order matches input order regardless of completion order.
		expect(out).toEqual([0, 10, 20, 30, 40, 50]);
	});

	it('never rejects when an item fn throws — that slot is left empty', async () => {
		const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
			if (n === 2) throw new Error('boom');
			return n;
		});
		expect(out[0]).toBe(1);
		expect(out[1]).toBeUndefined(); // the thrown slot is swallowed, not propagated
		expect(out[2]).toBe(3);
	});

	it('handles an empty input list without spawning workers', async () => {
		const fn = vi.fn(async (n: number) => n);
		await expect(mapWithConcurrency([], 4, fn)).resolves.toEqual([]);
		expect(fn).not.toHaveBeenCalled();
	});
});

describe('shuffle / pickRandomPage variation helpers (Randomize, VX2)', () => {
	// shuffle + pickRandomPage are the PURE Randomize variation primitives: shuffle varies
	// tile + shelf ORDER, pickRandomPage varies which Last.fm chart/tag/geo page is fetched.
	// Both must be deterministic in their INVARIANTS (permutation / bounded integer) even
	// though the specific output is random — these tests assert the invariants, never a
	// fixed output.

	it('shuffle returns a NEW same-length permutation with the same multiset of elements', () => {
		const input = [1, 2, 3, 4, 5, 6, 7, 8];
		const out = shuffle(input);
		expect(out).not.toBe(input); // a new array, not the same reference
		expect(out).toHaveLength(input.length);
		// Same multiset: sorting both yields identical arrays regardless of order.
		expect([...out].sort((a, b) => a - b)).toEqual([...input].sort((a, b) => a - b));
	});

	it('shuffle does NOT mutate the input array (order preserved after the call)', () => {
		const input = ['a', 'b', 'c', 'd', 'e'];
		const snapshot = [...input];
		shuffle(input);
		expect(input).toEqual(snapshot); // input untouched
	});

	it('shuffle of [] → [] and [x] → [x]', () => {
		expect(shuffle<number>([])).toEqual([]);
		expect(shuffle(['only'])).toEqual(['only']);
	});

	it('pickRandomPage stays an integer in [1, max] across many iterations', () => {
		const max = 5;
		for (let i = 0; i < 200; i++) {
			const p = pickRandomPage(max);
			expect(Number.isInteger(p)).toBe(true);
			expect(p).toBeGreaterThanOrEqual(1);
			expect(p).toBeLessThanOrEqual(max);
		}
	});

	it('pickRandomPage(1) and pickRandomPage(0) always return 1 (1-based, never 0)', () => {
		for (let i = 0; i < 50; i++) {
			expect(pickRandomPage(1)).toBe(1);
			expect(pickRandomPage(0)).toBe(1);
		}
	});

	it('pickRandomPage never returns a fraction even when given a fractional max', () => {
		for (let i = 0; i < 100; i++) {
			const p = pickRandomPage(4.9);
			expect(Number.isInteger(p)).toBe(true);
			expect(p).toBeGreaterThanOrEqual(1);
			expect(p).toBeLessThanOrEqual(4); // floor(4.9) = 4
		}
	});
});

describe('curated discovery sets', () => {
	it('DISCOVERY_TAGS is a small, non-empty editable genre/mood set', () => {
		expect(Array.isArray(DISCOVERY_TAGS)).toBe(true);
		expect(DISCOVERY_TAGS.length).toBeGreaterThan(0);
		expect(DISCOVERY_TAGS).toContain('mandopop');
	});

	it('DISCOVERY_COUNTRIES is a CN-biased set of ISO 3166-1 NAMES (not codes)', () => {
		expect(DISCOVERY_COUNTRIES).toContain('China');
		expect(DISCOVERY_COUNTRIES).toContain('Taiwan');
		// Names, not codes: 'United States' (not 'US'), so no 2-letter entries.
		expect(DISCOVERY_COUNTRIES).toContain('United States');
		expect(DISCOVERY_COUNTRIES.every((c) => c.length > 2)).toBe(true);
	});
});
