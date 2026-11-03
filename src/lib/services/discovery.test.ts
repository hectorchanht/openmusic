import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
	resolveStub,
	preferEligible,
	type Bests,
	mapWithConcurrency,
	shuffle,
	pickRandomPage,
	DISCOVERY_TAGS,
	DISCOVERY_COUNTRIES
} from './discovery';
import * as catalog from './catalog';
import * as nameRescue from './name-rescue';
import { warmScript } from './zh-convert';
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

// quick-260925-wa7: a Latin weak/miss now calls lookupChineseName, which would hit YTM + iTunes for
// real. Default it to a miss for EVERY test so no test touches the network; the rescue block below
// re-programs it per case.
beforeEach(() => {
	vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(null);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('resolveStub — Last.fm {artist,title} stub → playable Track', () => {
	it('returns the top dedupeBest hit when searchAll finds a match', async () => {
		const hit = mk('netease', 'hit', '周杰伦', { title: '稻香' });
		const spy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));

		const out = await resolveStub('周杰伦', '稻香');
		// quick-261020-speed: tiered search — first call is tier-1 only.
		expect(spy).toHaveBeenCalledWith('周杰伦 稻香', 1, expect.anything());
		expect(out).not.toBeNull();
		expect(out?.uid).toBe(hit.uid);
	});

	// 32-D-08 DECISION CHANGE: this case's two fixtures are the SAME song (周杰伦 / 稻香) from two
	// sources, so dedupeBest collapses them to ONE candidate and the surviving row is decided purely
	// by SOURCE_RANK — scoreMatch never gets a choice to make. Pre-32 the expectation was the netease
	// row and the case was named "returns the FIRST track", but those two readings only coincided
	// because netease was BOTH first in the interleaved list AND the rank winner; the case could not
	// tell them apart. 32-D-08 promoted qq above netease, which separates them, and the contract
	// resolveStub actually offers for same-song rows is "the dedupe winner", not "index 0". So the
	// assertion is retargeted to the rank winner (still an exact uid, not a loosened check) and the
	// name now states what is really being pinned.
	it('returns the SOURCE_RANK winner when several same-song rows are returned (32-D-08)', async () => {
		const neteaseRow = mk('netease', 'first', '周杰伦', { title: '稻香' });
		const qqRow = mk('qq', 'second', '周杰伦', { title: '稻香' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([neteaseRow, qqRow]));

		const out = await resolveStub('周杰伦', '稻香');
		// qq outranks netease (32-D-08) so it survives the collapse even though it is second in the
		// interleaved list — the win is rank-driven, not position-driven.
		expect(out?.uid).toBe(qqRow.uid);
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
		// Two DISTINCT songs by the same artist, both matching the query equally well.
		// Different titles → different dedupe keys → both survive. Equal score →
		// the strict `s > bestScore` max keeps the EARLIER position → `first` wins.
		// (Uses rankPool directly: resolveStub's dedupeBest would collapse identical
		// artist+title pairs, and unrelated songs now return null per quick-261020-wrong1.)
		const { rankPool } = await import('$lib/services/song-variant');
		const { scoreMatch } = await import('$lib/services/score-match');
		const first = mk('netease', 'first', '周杰伦', { title: '稻香' });
		const second = mk('qq', 'second', '周杰伦', { title: '稻香 (DJ版)' });
		// DJ版 is a variant, so use two non-variant equal scorers instead:
		const a = mk('netease', 'a', '周杰伦', { title: '稻香' });
		const b = mk('qq', 'b', '周杰伦', { title: '稻香' });
		// Force equal scores by mocking scoreMatch to return the same for both.
		const out = rankPool([a, b], '稻香', { score: () => 10 })[0];
		expect(out?.uid).toBe(a.uid); // tie → first-wins (not last-wins)
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
// quick-261102-sdm (DECISIONS.md §2): the urx t2s rescue-on-miss is GONE. searchAll folds every
// keyword to Simplified before the fan-out, so the first attempt already is the Simplified
// search — a re-search would repeat it. These pin "one attempt, folded matching".
describe('resolveStub — Traditional query, no re-search (quick-261102-sdm)', () => {
	it('a Traditional query matches a Simplified row on the first attempt', async () => {
		const hit = mk('kuwo', 'hit', '周杰伦', { title: '止战之殇' });
		const spy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));

		expect((await resolveStub('周傑倫', '止戰之殤'))?.uid).toBe(hit.uid);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('a Traditional miss is a miss — tier-1 + full, never a third search', async () => {
		const spy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));

		await expect(resolveStub('周傑倫', '止戰之殤')).resolves.toBeNull();
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('does NOT re-search a non-Chinese miss', async () => {
		const spy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));

		await expect(resolveStub('Adele', 'Hello')).resolves.toBeNull();
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('scores Simplified rows against a Traditional query (clean cut beats the 翻唱 variant)', async () => {
		const variant = mk('netease', 'variant', '周杰伦', { title: '止战之殇 翻唱' });
		const clean = mk('qq', 'clean', '周杰伦', { title: '止战之殇' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([variant, clean]));

		expect((await resolveStub('周傑倫', '止戰之殤'))?.uid).toBe(clean.uid);
	});

	it('never throws when the search throws', async () => {
		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('search down'));

		await expect(resolveStub('周傑倫', '止戰之殤')).resolves.toBeNull();
	});
});

// quick-260925-wa7 — English/romanized name rescue. Every branch pins BOTH the searchAll count and
// the lookupChineseName count: a strong hit and every CJK query must cost exactly what they did
// before. The real t2sConvertLines runs (offline dict), so the Simplified re-search query is literal.
describe('resolveStub — English/romanized name rescue (quick-260925-wa7)', () => {
	const GRAD = 'Graduation ("Mom, Don\'t Do That!" TV Series Theme Song)';
	const nct = () => mk('qq', 'nct', 'NCT DREAM', { title: 'Graduation' });
	const zhGrad = { artist: '周興哲', title: '最後一堂課' };

	it('strong English hit → returned; searchAll 1, lookup 0', async () => {
		const hit = mk('netease', 'lb', 'lullaboy', { title: 'someone like u' });
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName');

		expect((await resolveStub('lullaboy', 'someone like u'))?.uid).toBe(hit.uid);
		expect(search).toHaveBeenCalledTimes(1);
		expect(look).toHaveBeenCalledTimes(0);
	});

	it('strong English hit (Bones & The Boy) → searchAll 1, lookup 0', async () => {
		const hit = mk('qq', 'bb', 'Bones & The Boy', { title: 'Good In Me' });
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName');

		expect((await resolveStub('Bones & The Boy', 'Good In Me'))?.uid).toBe(hit.uid);
		expect(search).toHaveBeenCalledTimes(1);
		expect(look).toHaveBeenCalledTimes(0);
	});

	it('English zero-result miss + lookup null → null; searchAll 2, lookup 1 with the ORIGINAL names', async () => {
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(null);

		await expect(resolveStub('Eric Chou', 'Zai Ai Ni')).resolves.toBeNull();
		// quick-261020-speed: tiered search = 2 calls (tier-1 + full) on a miss.
		expect(search).toHaveBeenCalledTimes(2);
		expect(look).toHaveBeenCalledTimes(1);
		expect(look).toHaveBeenCalledWith('Eric Chou', 'Zai Ai Ni');
	});

	it('weak English hit by a DIFFERENT artist + lookup null → null (cov1 supersedes "never worse"); searchAll 1, lookup 1', async () => {
		// quick-261102-cov1 SUPERSEDES the wa7 "weak row (never worse)" expectation for
		// this fixture: the weak row is NCT DREAM's 'Graduation' — a DIFFERENT artist's
		// different song standing in for an Eric Chou tap. Under Hector's rule (always
		// the original song by the original artist) a different-artist row is a cover-
		// class substitution and resolves to null; the rescue remains the recovery path
		// when the lookup DOES find the Chinese names (cases below). Call counts are
		// unchanged — the gate filters the pick, it does not add searches.
		const weak = nct();
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([weak]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(null);

		await expect(resolveStub('Eric Chou', GRAD)).resolves.toBeNull();
		// quick-261102-sy0: the weak row is not ACCEPTABLE, so tier-1 holds no acceptable official and
		// the full fan-out runs too (+1 search) — it used to stop at tier-1 on any plain-titled row.
		expect(search).toHaveBeenCalledTimes(2);
		expect(look).toHaveBeenCalledTimes(1);
	});

	it('weak hit + lookup hit → ONE Simplified re-search whose strong row wins; searchAll 2', async () => {
		const rescued = mk('qq', 'grad', 'Eric周兴哲', { title: '最后一堂课' });
		const search = vi
			.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([nct()]))
			.mockResolvedValueOnce(result([nct()]))
			.mockResolvedValueOnce(result([rescued]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(zhGrad);

		expect((await resolveStub('Eric Chou', GRAD))?.uid).toBe(rescued.uid);
		// quick-261102-sy0: the weak row is not ACCEPTABLE, so tier-1 holds no acceptable official and
		// the full fan-out runs too (+1 search) — it used to stop at tier-1 on any plain-titled row.
		expect(search).toHaveBeenCalledTimes(3);
		expect(look).toHaveBeenCalledTimes(1);
		// t2s is applied BEFORE the re-search (accepted convert-first deviation).
		expect(search.mock.calls[2][0]).toBe('周兴哲 最后一堂课');
	});

	it('a Traditional re-search row still strong-matches (candidate folded to Simplified)', async () => {
		const rescued = mk('kuwo', 'trad', '周興哲', { title: '最後一堂課' });
		vi.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([nct()]))
			.mockResolvedValueOnce(result([nct()]))
			.mockResolvedValueOnce(result([rescued]));
		vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(zhGrad);

		expect((await resolveStub('Eric Chou', GRAD))?.uid).toBe(rescued.uid);
	});

	it('the re-search ranks only strong rows — a better-scored cover does not hide the real one', async () => {
		// scoreMatch prefers the cover (exact Simplified title) over the Traditional real row, so a
		// top-row-only check would reject the rescue; ranking only strong rows keeps it.
		const cover = mk('netease', 'cover', '某歌手', { title: '最后一堂课' });
		const real = mk('joox', 'real', '周興哲', { title: '最後一堂課' });
		const search = vi
			.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([nct()]))
			.mockResolvedValueOnce(result([nct()]))
			.mockResolvedValueOnce(result([cover, real]));
		vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(zhGrad);

		expect((await resolveStub('Eric Chou', GRAD))?.uid).toBe(real.uid);
		expect(search).toHaveBeenCalledTimes(3);
	});

	it('weak hit + lookup hit + unrelated re-search row → null (cov1: the different-artist weak row is no longer the fallback); searchAll 2', async () => {
		// quick-261102-cov1: previously this returned the ORIGINAL weak row (NCT DREAM) —
		// a different artist. The re-search row (Alpha) is unrelated and the rescue
		// rightly discards it; with no same-artist row anywhere the resolve is null.
		const weak = nct();
		const search = vi
			.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([weak]))
			.mockResolvedValueOnce(result([weak]))
			.mockResolvedValueOnce(result([mk('qq', 'aaa', 'Alpha', { title: 'Aaa' })]))
			.mockResolvedValueOnce(result([]));
		vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(zhGrad);

		await expect(resolveStub('Eric Chou', GRAD)).resolves.toBeNull();
		// quick-261102-sy0: each attempt whose tier-1 holds no ACCEPTABLE official also runs the
		// full fan-out — 2 for the original names + 2 for the rescue re-search.
		expect(search).toHaveBeenCalledTimes(4);
	});

	it('weak hit + lookup hit + empty re-search → null (cov1: no same-artist row anywhere)', async () => {
		const weak = nct();
		const search = vi
			.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([weak]))
			.mockResolvedValueOnce(result([weak]))
			.mockResolvedValueOnce(result([]))
			.mockResolvedValueOnce(result([]));
		vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(zhGrad);

		// quick-261102-cov1: was "the original weak row" — that row is a different
		// artist (NCT DREAM), so the resolve now ends null. The never-worse guarantee
		// survives for SAME-artist weak rows (the gate only vetoes a different act).
		await expect(resolveStub('Eric Chou', GRAD)).resolves.toBeNull();
		// quick-261102-sy0: the initial tier-1 row is not acceptable → full search too (2);
		// re-search: tier-1 miss (1) + full miss (1) = 4 total.
		expect(search).toHaveBeenCalledTimes(4);
	});

	it('weak hit + lookup hit + re-search THROWS → resolves (never throws) to null', async () => {
		const weak = nct();
		vi.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([weak]))
			.mockRejectedValueOnce(new Error('search down'));
		vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(zhGrad);

		// quick-261102-cov1: never-throws posture unchanged; the VALUE is now null
		// because the only row anywhere is a different artist's (see above).
		const out = await resolveStub('Eric Chou', GRAD);
		expect(out).toBeNull();
	});

	it('Japanese miss → null; searchAll 2, lookup 0 (kana gate)', async () => {
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName');

		await expect(resolveStub('YOASOBI', '夜に駆ける')).resolves.toBeNull();
		expect(search).toHaveBeenCalledTimes(2);
		expect(look).toHaveBeenCalledTimes(0);
	});

	it('Traditional Chinese query → one attempt (searchAll folds to Simplified), lookup 0', async () => {
		const hit = mk('kuwo', 'hit', '周杰伦', { title: '止战之殇' });
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName');

		expect((await resolveStub('周傑倫', '止戰之殤'))?.uid).toBe(hit.uid);
		expect(search).toHaveBeenCalledTimes(1);
		expect(look).toHaveBeenCalledTimes(0);
	});

	it('mixed Latin-artist / Chinese-title miss → t2s path only, lookup 0', async () => {
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName');

		await expect(resolveStub('Jay Chou', '珊瑚海')).resolves.toBeNull();
		// quick-261020-speed: tiered = 2 calls (tier-1 + full). No t2s retry — '珊瑚海'
		// is already Simplified, so the conversion is identity and there's nothing to re-search.
		expect(search).toHaveBeenCalledTimes(2);
		expect(look).toHaveBeenCalledTimes(0);
	});

	it('a weak hit on a CJK query by a DIFFERENT artist → null (no rescue; cov1 supersedes "returned as before")', async () => {
		// quick-261102-cov1 SUPERSEDES this case's old expectation: the weak row is a
		// piano rendition by 酷客音乐 — a different artist's version of 周杰伦's 珊瑚海，
		// i.e. exactly the cover-class substitution the artist gate now vetoes. The
		// resolve ends null (the caller's skip path), no rescue fires, and the call
		// counts below are unchanged.
		const weak = mk('qq', 'w', '酷客音乐', { title: '珊瑚海(钢琴曲)' });
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([weak]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName');

		await expect(resolveStub('周杰伦', '珊瑚海')).resolves.toBeNull();
		// quick-261101-ring1: the call count moves 1 → 2. （钢琴曲） is a bracketed rendition
		// qualifier, which the parenthetical rule now classifies as a VARIANT (it previously
		// counted as "official" because 钢琴曲 matched no known tag), so the tiered search
		// widens past tier-1 exactly as designed for "tier-1 has no official version".
		expect(search).toHaveBeenCalledTimes(2);
		expect(look).toHaveBeenCalledTimes(0);
	});
});

// quick-261103-cjk — bilingual title split. A "車匙 - Car Key" stub is unfindable on the
// CN catalogs under its full spelling (live QQ probe, 2026-11-03: full string → junk,
// CJK half alone → the original), so with no strong eligible row the resolver retries
// with the CJK half, and a Latin artist bridges via the wa7 name rescue.
describe('resolveStub — bilingual title split (quick-261103-cjk)', () => {
	const ytm = () => mk('ytmusic', 'yt1', 'Jason Chan', { title: '車匙 - Car Key' });
	const qqRow = () => mk('qq', 'car', '陳柏宇', { title: '車匙' });

	it('the reported song: ytmusic-only full attempt → name rescue finds the 陳柏宇 CN row', async () => {
		const hit = qqRow();
		const search = vi
			.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([ytm()]))
			.mockResolvedValueOnce(result([ytm()]))
			.mockResolvedValueOnce(result([hit]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue({ artist: '陳柏宇', title: '車匙' });

		expect((await resolveStub('Jason Chan', '車匙 - Car Key'))?.uid).toBe(hit.uid);
		expect(look).toHaveBeenCalledTimes(1);
		expect(look).toHaveBeenCalledWith('Jason Chan', '車匙 - Car Key');
		expect(search).toHaveBeenCalledTimes(3);
		// The split attempt searched the CJK half alone.
		expect(search.mock.calls[1][0]).toBe('Jason Chan 車匙');
	});

	it('CJK artist: the split attempt alone resolves, no lookup spent', async () => {
		const hit = qqRow();
		const search = vi
			.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([]))
			.mockResolvedValueOnce(result([]))
			.mockResolvedValueOnce(result([hit]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName');

		expect((await resolveStub('陳柏宇', '車匙 - Car Key'))?.uid).toBe(hit.uid);
		expect(look).toHaveBeenCalledTimes(0);
		expect(search).toHaveBeenCalledTimes(3);
		expect(search.mock.calls[2][0]).toBe('陳柏宇 車匙');
	});

	it('strong eligible on the full attempt → returned as before, no split, no lookup', async () => {
		const hit = mk('qq', 'full', '陳柏宇', { title: '車匙 - Car Key' });
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName');

		expect((await resolveStub('陳柏宇', '車匙 - Car Key'))?.uid).toBe(hit.uid);
		expect(search).toHaveBeenCalledTimes(1);
		expect(look).toHaveBeenCalledTimes(0);
	});

	it('split + rescue both dry → the original ytmusic row still settles (never worse)', async () => {
		const yt = ytm();
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([yt]));
		vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(null);

		expect((await resolveStub('Jason Chan', '車匙 - Car Key'))?.uid).toBe(yt.uid);
	});
});

// quick-260926-c69 — eligible-first selection. resolveStub honours SourceAdapter.autoResolveEligible
// (registry isAutoResolveEligible): a strong eligible (CN) row beats a ytmusic row; for a Latin query
// with no strong eligible row the wa7 rescue runs FIRST to find one; a strong ytmusic row still beats
// a weak eligible one; ytmusic stays the last resort. Every case pins BOTH call counts.
describe('resolveStub — eligible-first selection (quick-260926-c69)', () => {
	const junk = () => mk('qq', 'junk', '汪苏泷', { title: '左转灯' });
	const ytm = () => mk('ytmusic', 'v1', 'Eric Chou', { title: '再愛你 - Zai Ai Ni' });
	const cnEn = () => mk('qq', 'en', 'Eric Chou', { title: 'Zai Ai Ni' });
	const cn = () => mk('qq', 'cn', '周兴哲', { title: '再爱你' });
	const ytmZh = () => mk('ytmusic', 'z', '周興哲', { title: '再愛你' });
	const zh = { artist: '周興哲', title: '再愛你' };

	it('T1 Latin: strong eligible beats a strong ytmusic row ordered first; searchAll 1, lookup 0', async () => {
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([ytm(), cnEn()]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName');

		expect((await resolveStub('Eric Chou', 'Zai Ai Ni'))?.uid).toBe(cnEn().uid);
		expect(search).toHaveBeenCalledTimes(1);
		expect(look).toHaveBeenCalledTimes(0);
	});

	it('T2 LIVE CASE: weak eligible + strong ytmusic → rescue re-search finds the CN row; searchAll 2, lookup 1', async () => {
		const search = vi
			.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([junk(), ytm()]))
			.mockResolvedValueOnce(result([cn()]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(zh);

		expect((await resolveStub('Eric Chou', 'Zai Ai Ni'))?.uid).toBe(cn().uid);
		expect(search).toHaveBeenCalledTimes(2);
		expect(search.mock.calls[1][0]).toBe('周兴哲 再爱你');
		expect(look).toHaveBeenCalledTimes(1);
		expect(look).toHaveBeenCalledWith('Eric Chou', 'Zai Ai Ni');
	});

	it('T3 rescue miss → the strong ytmusic row, NOT the weak eligible junk; searchAll 1, lookup 1', async () => {
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([junk(), ytm()]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(null);

		expect((await resolveStub('Eric Chou', 'Zai Ai Ni'))?.uid).toBe(ytm().uid);
		expect(search).toHaveBeenCalledTimes(1);
		expect(look).toHaveBeenCalledTimes(1);
	});

	it('T4 no eligible row + strong ytmusic + rescue miss → ytmusic; searchAll 1, lookup 1 (pinned new cost)', async () => {
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([ytm()]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(null);

		expect((await resolveStub('Eric Chou', 'Zai Ai Ni'))?.uid).toBe(ytm().uid);
		expect(search).toHaveBeenCalledTimes(1);
		expect(look).toHaveBeenCalledTimes(1);
	});

	it('T5 the rescue re-search is eligible-only: its ytmusic row is ignored → the ORIGINAL ytmusic row; searchAll 2', async () => {
		const search = vi
			.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([junk(), ytm()]))
			.mockResolvedValueOnce(
				result([
					mk('ytmusic', 'v2', '周興哲', { title: '再愛你' }),
					mk('qq', 'aaa', 'Alpha', { title: 'Aaa' })
				])
			);
		vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(zh);

		expect((await resolveStub('Eric Chou', 'Zai Ai Ni'))?.uid).toBe(ytm().uid);
		expect(search).toHaveBeenCalledTimes(2);
	});

	it('T6 rescue re-search THROWS → resolves (never throws) to the strong ytmusic row', async () => {
		vi.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([junk(), ytm()]))
			.mockRejectedValueOnce(new Error('search down'));
		vi.spyOn(nameRescue, 'lookupChineseName').mockResolvedValue(zh);

		expect((await resolveStub('Eric Chou', 'Zai Ai Ni'))?.uid).toBe(ytm().uid);
	});

	it('T7 CJK: weak eligible + strong ytmusic → ytmusic, no rescue; searchAll 1, lookup 0', async () => {
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([junk(), ytmZh()]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName');

		expect((await resolveStub('周興哲', '再愛你'))?.uid).toBe(ytmZh().uid);
		expect(search).toHaveBeenCalledTimes(1);
		expect(look).toHaveBeenCalledTimes(0);
	});

	it('T8 CJK fold: Traditional query vs Simplified eligible row is STRONG → beats Traditional ytmusic; searchAll 1, lookup 0', async () => {
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([ytmZh(), cn()]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName');

		expect((await resolveStub('周興哲', '再愛你'))?.uid).toBe(cn().uid);
		expect(search).toHaveBeenCalledTimes(1);
		expect(look).toHaveBeenCalledTimes(0);
	});

	it('T9 CJK, nothing strong: weak eligible is a DIFFERENT artist → null (cov1 supersedes "weak eligible wins"); searchAll 2, lookup 0', async () => {
		// quick-261102-cov1: the weak eligible row is 酷客音乐's piano rendition of
		// 周杰伦's 珊瑚海 — a different artist's version, gated out like any cover; the
		// weak ytmusic row ('Someone'/'Other') is neither the artist nor the song.
		// Nothing acceptable exists → null. quick-261102-sy0: the tier-width decision now
		// runs on ACCEPTABLE rows too, so the unrelated 'Other' row no longer stops the
		// fan-out at tier-1 — the full search runs (2 calls) before declaring null.
		const weak = mk('qq', 'w2', '酷客音乐', { title: '珊瑚海(钢琴曲)' });
		const search = vi
			.spyOn(catalog, 'searchAll')
			.mockResolvedValue(result([mk('ytmusic', 'w', 'Someone', { title: 'Other' }), weak]));
		const look = vi.spyOn(nameRescue, 'lookupChineseName');

		await expect(resolveStub('周杰伦', '珊瑚海')).resolves.toBeNull();
		expect(search).toHaveBeenCalledTimes(2);
		expect(look).toHaveBeenCalledTimes(0);
	});

	it('T10 ONLY a weak ytmusic row with unrelated title → null (never wrong song); searchAll 2', async () => {
		// quick-261020-wrong1: query 周傑倫/珊瑚海, only candidate is Someone/Other —
		// completely unrelated, so null instead of the wrong song. quick-261102-sdm: no t2s
		// re-search any more (searchAll already searched in Simplified) → one call.
		const only = mk('ytmusic', 'w', 'Someone', { title: 'Other' });
		const search = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([only]));

		expect(await resolveStub('周傑倫', '珊瑚海')).toBeNull();
		// quick-261102-sy0: the unrelated row is not acceptable → tier-1 + full fan-out.
		expect(search).toHaveBeenCalledTimes(2);
	});

	it('T11 the t2s retry follows the same rule (eligible over a same-song ytmusic row); searchAll 2', async () => {
		const cnRow = mk('qq', 'c', '周杰伦', { title: '止战之殇' });
		const search = vi
			.spyOn(catalog, 'searchAll')
			.mockResolvedValueOnce(result([]))
			.mockResolvedValueOnce(result([mk('ytmusic', 'y', '周杰伦', { title: '止战之殇' }), cnRow]));

		expect((await resolveStub('周傑倫', '止戰之殤'))?.uid).toBe(cnRow.uid);
		expect(search).toHaveBeenCalledTimes(2);
	});
});

// quick-261102-cov1 (user report 2026-11-02): the artist-identity gate on the tap
// resolve. Hector tapped 《說了再見》·周杰倫 on Your Radio and heard 阿傑's 同人 cover
// (netease 3388515483): the netease pool for that query is covers-only, scoreMatch only
// ranks (every plain-titled cover earns the same title-only credit), and the weak
// fallback verified title overlap but never the artist. These cases pin the rule:
// original artist or null — never a different artist's version.
describe('resolveStub — artist-identity gate (quick-261102-cov1)', () => {
	it('(d) INCIDENT VERBATIM: covers-only netease pool → null, the 阿傑 cover is never returned', async () => {
		// Pool shape live-probed from the Meting netease search for "周杰倫 說了再見"
		// (2026-11-02): the first rows are ALL fan covers; row #1 is the incident track.
		const pool = [
			mk('netease', '3388515483', '阿傑', { title: '說了再見' }),
			mk('netease', '2098186082', '張錫陽', { title: '說了再見' }),
			mk('netease', '2714751792', '旺仔小喬', { title: '說了再見' })
		];
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result(pool));

		await expect(resolveStub('周杰倫', '說了再見')).resolves.toBeNull();
	});

	it('(a-shape) covers + the original on another source → the ORIGINAL row, cover never picked', async () => {
		const cover = mk('netease', '3388515483', '阿傑', { title: '說了再見' });
		const official = mk('qq', 'official', '周杰倫', { title: '說了再見' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([cover, official]));

		const out = await resolveStub('周杰倫', '說了再見');
		expect(out?.uid).toBe(official.uid);
	});

	it('(c) a duet credit containing the target artist counts as the original', async () => {
		const duet = mk('qq', 'duet', '周杰倫/蔡依林', { title: '說了再見' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([duet]));

		const out = await resolveStub('周杰倫', '說了再見');
		expect(out?.uid).toBe(duet.uid);
	});

	it('preferEligible: a weak SAME-title row by a different artist is vetoed even when handed in directly', async () => {
		const cover = mk('netease', '3388515483', '阿傑', { title: '說了再見' });
		await expect(
			preferEligible({ artist: '周杰倫', title: '說了再見' }, { eligible: cover, ineligible: null })
		).resolves.toBeNull();
	});

	it('preferEligible: a weak same-artist row with an overlapping title still passes (gate is artist-only)', async () => {
		// The weak path survives for the SAME act: a script-variant credit of the target
		// artist with a qualified (longer) title — title containment carries it as before.
		const weak = mk('qq', 'w', '周杰伦', { title: '珊瑚海 (Live)' });
		await expect(
			preferEligible({ artist: '周杰倫', title: '珊瑚海' }, { eligible: weak, ineligible: null })
		).resolves.toBe(weak);
	});
});

describe('preferEligible (quick-260926-c69)', () => {
	const q = { artist: 'Eric Chou', title: 'Zai Ai Ni' };
	const strongE = mk('qq', 'e', 'Eric Chou', { title: 'Zai Ai Ni' });
	const weakE = mk('qq', 'we', '汪苏泷', { title: '左转灯' });
	const strongI = mk('ytmusic', 'i', 'Eric Chou', { title: '再愛你 - Zai Ai Ni' });
	const weakI = mk('ytmusic', 'wi', 'Someone', { title: 'Other' });
	const pick = (b: Bests) => preferEligible(q, b);

	it('(a) eligible strong + ineligible strong → eligible', async () => {
		expect(await pick({ eligible: strongE, ineligible: strongI })).toBe(strongE);
	});
	it('(b) eligible weak + ineligible strong → ineligible', async () => {
		expect(await pick({ eligible: weakE, ineligible: strongI })).toBe(strongI);
	});
	it('(c) both weak with unrelated titles → null (never play wrong song)', async () => {
		// quick-261020-wrong1: weakE is 汪苏泷/左转灯 vs query Eric Chou/Zai Ai Ni —
		// completely different, so null instead of the wrong song.
		expect(await pick({ eligible: weakE, ineligible: weakI })).toBeNull();
	});
	it('(d) no eligible + ineligible weak with unrelated title → null', async () => {
		// quick-261020-wrong1: same as (c) — a weak ineligible with an unrelated title
		// must not be returned as "last resort".
		expect(await pick({ eligible: null, ineligible: weakI })).toBeNull();
	});
	it('(e) both null → null', async () => {
		expect(await pick({ eligible: null, ineligible: null })).toBeNull();
	});
	it('(f) Traditional query vs Simplified eligible row → eligible (t2s fold)', async () => {
		const cnRow = mk('qq', 'cn', '周兴哲', { title: '再爱你' });
		const ytZh = mk('ytmusic', 'z', '周興哲', { title: '再愛你' });
		expect(
			await preferEligible({ artist: '周興哲', title: '再愛你' }, { eligible: cnRow, ineligible: ytZh })
		).toBe(cnRow);
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

// debug album-zip-duplicate-songs — the live 陳奕迅 "rice & shine" case. For a Traditional stub the
// searchAll rows carry the right song in qq/netease (Simplified) AND joox (Traditional) plus joox's
// junk artist-popular rows (明年今日/富士山下). With the t2s dict warm, dedupeBest merges the Trad joox
// row with the Simplified qq row (qq wins by SOURCE_RANK); scoreMatch then had to score that
// Simplified survivor 0 against the Traditional query, so the junk row (4) won and six different
// album tracks resolved to the same joox 明年今日. One searchAll: the right row is already there.
describe('resolveStub — Traditional stub vs Simplified rows (debug album-zip-duplicate-songs)', () => {
	it('resolves the Simplified qq row, never the junk same-artist Traditional row; searchAll 1', async () => {
		await warmScript('zh-Hans');
		const junk = mk('joox', 'ZD7DF66B0C90DD', '陳奕迅', { title: '明年今日' });
		const right = mk('qq', 'right', '陈奕迅', { title: '愚人快乐' });
		const rightTrad = mk('joox', 'rightTrad', '陳奕迅', { title: '愚人快樂' });
		const search = vi
			.spyOn(catalog, 'searchAll')
			.mockResolvedValue(result([junk, mk('joox', 'f', '陳奕迅', { title: '富士山下' }), right, rightTrad]));

		// quick-261102-sqn: the same-song twin wins by PLAYBACK_ORDER (joox ahead of qq); the point
		// is unchanged — never the junk 明年今日 row.
		expect((await resolveStub('陳奕迅', '愚人快樂'))?.uid).toBe(rightTrad.uid);
		expect(search).toHaveBeenCalledTimes(1);
	});
});
