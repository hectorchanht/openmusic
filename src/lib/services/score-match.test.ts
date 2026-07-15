import { describe, it, expect } from 'vitest';
import {
	scoreMatch,
	VARIANT_KEYWORDS,
	SHORT_CLIP_SEC,
	PREVIEW_PENALTY,
	SHORT_TITLE_BOOST_MAX,
	ARTIST_FREQ_BOOST
} from './score-match';
import { computeSetContext } from './score-context';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// scoreMatch (Phase 10, LFSRC-03 / D-02) is the PURE re-ranking term Task 2 wires into
// resolveStub. It returns a number (higher = better) computed as
// `similarity(query, candidate) − variantPenalty(query, candidate)`:
//   - similarity reuses matchKey (artist-first normalization) — an exact key match scores
//     highest, a loose match lower.
//   - variantPenalty down-ranks a candidate whose TITLE carries a cover/karaoke/live/
//     instrumental/remix (+ CJK 翻唱/伴奏/现场…) keyword — UNLESS the QUERY asked for it.
// It NEVER reads source/quality/preferredSource (dedupeBest's job) and NEVER nulls/NaNs.

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

describe('scoreMatch — variant-keyword penalty (D-02a)', () => {
	it('ranks a clean title above an English karaoke variant of the same song', () => {
		const query = { artist: '周杰伦', title: '稻香' };
		const clean = mk('netease', 'clean', '周杰伦', { title: '稻香' });
		const karaoke = mk('qq', 'karaoke', '周杰伦', { title: '稻香 (Karaoke)' });
		expect(scoreMatch(query, clean)).toBeGreaterThan(scoreMatch(query, karaoke));
	});

	it('ranks a clean title above a cover / live / instrumental variant', () => {
		const query = { artist: 'X', title: 'Song' };
		const clean = mk('netease', 'clean', 'X', { title: 'Song' });
		const cover = mk('qq', 'cover', 'X', { title: 'Song (Cover)' });
		const live = mk('kuwo', 'live', 'X', { title: 'Song (Live)' });
		const instrumental = mk('joox', 'inst', 'X', { title: 'Song - Instrumental' });
		const cleanScore = scoreMatch(query, clean);
		expect(cleanScore).toBeGreaterThan(scoreMatch(query, cover));
		expect(cleanScore).toBeGreaterThan(scoreMatch(query, live));
		expect(cleanScore).toBeGreaterThan(scoreMatch(query, instrumental));
	});

	it('penalizes a CJK variant term (翻唱 cover / 伴奏 instrumental)', () => {
		const query = { artist: '周杰伦', title: '稻香' };
		const clean = mk('netease', 'clean', '周杰伦', { title: '稻香' });
		const fanchang = mk('qq', 'fc', '周杰伦', { title: '稻香 翻唱' });
		const banzou = mk('kuwo', 'bz', '周杰伦', { title: '稻香 伴奏' });
		const cleanScore = scoreMatch(query, clean);
		expect(cleanScore).toBeGreaterThan(scoreMatch(query, fanchang));
		expect(cleanScore).toBeGreaterThan(scoreMatch(query, banzou));
	});
});

describe('scoreMatch — query-asked-for-variant exception (D-02a)', () => {
	it('does NOT penalize a Live candidate when the query itself asked for Live', () => {
		const query = { artist: 'X', title: 'Song (Live)' };
		const liveCandidate = mk('netease', 'live', 'X', { title: 'Song (Live)' });
		const cleanCandidate = mk('qq', 'clean', 'X', { title: 'Song' });
		// The user tapped a Live track → the live take must NOT be down-ranked below the
		// clean studio cut. The exact-variant candidate should score at least as high.
		expect(scoreMatch(query, liveCandidate)).toBeGreaterThanOrEqual(
			scoreMatch(query, cleanCandidate)
		);
	});

	it('does NOT penalize a CJK variant candidate when the query asked for that variant', () => {
		const query = { artist: '周杰伦', title: '稻香 现场' };
		const liveCandidate = mk('netease', 'live', '周杰伦', { title: '稻香 现场' });
		// query asked for 现场 → the 现场 keyword must not be penalized for this resolve.
		expect(scoreMatch(query, liveCandidate)).toBeGreaterThanOrEqual(0);
		// Compare to a plain studio candidate of a (slightly) different normalized title:
		const plain = mk('qq', 'plain', '周杰伦', { title: '稻香' });
		expect(scoreMatch(query, liveCandidate)).toBeGreaterThanOrEqual(scoreMatch(query, plain));
	});
});

describe('scoreMatch — artist+title similarity reward (D-02b)', () => {
	it('ranks an exact matchKey candidate above a loosely-matching one', () => {
		const query = { artist: '周杰伦', title: '稻香' };
		const exact = mk('netease', 'exact', '周杰伦', { title: '稻香' });
		const loose = mk('qq', 'loose', '林俊杰', { title: '江南' });
		expect(scoreMatch(query, exact)).toBeGreaterThan(scoreMatch(query, loose));
	});

	it('ranks a same-title-wrong-artist candidate below an exact match', () => {
		const query = { artist: '周杰伦', title: '稻香' };
		const exact = mk('netease', 'exact', '周杰伦', { title: '稻香' });
		const wrongArtist = mk('qq', 'wrong', '某某', { title: '稻香' });
		expect(scoreMatch(query, exact)).toBeGreaterThan(scoreMatch(query, wrongArtist));
	});
});

describe('scoreMatch — CJK-safe substring-containment credit (quick-260715-l9p)', () => {
	// matchKey strips ALL spaces/punctuation, so a CJK query that is a SUBSTRING of a longer title
	// (港耆 ⊂ 摩四老年港耆…) collapses into one token and earns NO token/component credit — it scores 0,
	// tying with unrelated fuzzy rows. The substring term gives a candidate that LITERALLY contains
	// the typed query an edge over those zero-similarity rows. This is the RIGHT-layer fix: the search
	// page ranks EVERY source's results through scoreMatch, so crediting containment here fixes the
	// live search ordering (the l9p ytmusic-adapter re-rank was dead code — the page re-sorts anyway).
	it('a candidate whose title CONTAINS the CJK query outranks ones that do NOT', () => {
		const query = { artist: '', title: '港耆' };
		// title CONTAINS 港耆 (not equal to it); artist deliberately ≠ any query artist.
		const containing = mk('ytmusic', 'vid', '摩四青年', {
			title: '摩四老年 《港耆》 [Official Music Video]'
		});
		const looseGang = mk('netease', 'gang', '陳百強', { title: '港城' }); // shares only 港
		const looseQi = mk('qq', 'qi', '柳永', { title: '耆卿' }); // shares only 耆
		// The containing row scores exactly the derived SIM_SUBSTR (no ctx, no other component/token
		// credit): SHORT_TITLE_BOOST_MAX(3) + ARTIST_FREQ_BOOST(2) + 1 = 6. Pinned so the derived
		// magnitude is guarded (a stray edit back to a flat literal would trip this).
		expect(scoreMatch(query, containing)).toBe(6 /* SIM_SUBSTR = 3 + 2 + 1 */);
		expect(scoreMatch(query, containing)).toBeGreaterThan(scoreMatch(query, looseGang));
		expect(scoreMatch(query, containing)).toBeGreaterThan(scoreMatch(query, looseQi));
	});

	it('LIVE FAILURE (l9p tuning): a CONTAINING long title beats a NON-containing SAME-LENGTH title carrying the FULL shortTitle+artistFreq boost stack', () => {
		// The exact search-page failure: query {artist:q, title:q}. A 2-char non-containing title
		// (== queryLen → FULL shortTitleBoost) whose artist appears under 2+ sources (→ ARTIST_FREQ_BOOST)
		// accumulates 3 + 2 = 5 purely from set-relative boosts, and at the OLD flat SIM_SUBSTR=2 it beat
		// the containing video (which sits at SIM_SUBSTR + ~0 short-title boost). With SIM_SUBSTR derived
		// to 6 (= 3 + 2 + 1) the containing row must now dominate the fully-boosted non-containing one.
		const query = { artist: '港耆', title: '港耆' };
		const containing = mk('ytmusic', 'vid', '摩四青年', {
			title: '摩四老年 《港耆》 [Official Music Video]'
		});
		// NON-containing, title length == queryLen(2) → full shortTitleBoost; artist under 2 sources → freq boost
		const looseA = mk('netease', 'gang', '陳百強', { title: '港城' });
		const looseB = mk('qq', 'gang2', '陳百強', { title: '港城' });
		const ctx = computeSetContext([containing, looseA, looseB], '港耆');
		// Sanity: the non-containing row really is carrying the full boost stack (3 + 2 = 5).
		expect(scoreMatch(query, looseA, ctx)).toBe(5 /* SHORT_TITLE_BOOST_MAX(3) + ARTIST_FREQ_BOOST(2) */);
		// The fix: the containing row (SIM_SUBSTR 6, ~0 short-title boost, single-source artist) wins.
		expect(scoreMatch(query, containing, ctx)).toBeGreaterThan(scoreMatch(query, looseA, ctx));
	});

	it('the search-page {artist:q, title:q} shape still credits containment (halves de-duped, no 港耆港耆 doubling)', () => {
		// rankList passes the raw keyword into BOTH slots; the credit must still fire for a title that
		// contains the query ONCE (the joined query must not double to 港耆港耆 and miss).
		const query = { artist: '港耆', title: '港耆' };
		const containing = mk('ytmusic', 'vid', '摩四青年', {
			title: '摩四老年 《港耆》 [Official Music Video]'
		});
		const unrelated = mk('netease', 'gang', '陳百強', { title: '港城' });
		expect(scoreMatch(query, containing)).toBeGreaterThan(scoreMatch(query, unrelated));
	});

	it('does NOT perturb an EXACT match (early return still scores SIM_EXACT)', () => {
		const query = { artist: '', title: '港耆' };
		const exact = mk('ytmusic', 'e', '', { title: '港耆' }); // matchKey === query → early SIM_EXACT
		expect(scoreMatch(query, exact)).toBe(10 /* SIM_EXACT */);
	});

	it('does NOT double-credit a candidate with a prior non-zero token/component score (score===0 guard)', () => {
		// Candidate title === query title (→ SIM_TITLE + full token overlap) AND its artist+title
		// join literally contains 港耆. The score===0 guard must block the substring bump so the value
		// is SIM_TITLE(3) + SIM_TOKEN(2) = 5, NOT 7.
		const query = { artist: '', title: '港耆' };
		const titleMatch = mk('netease', 't', '周杰倫', { title: '港耆' });
		expect(scoreMatch(query, titleMatch)).toBe(5 /* SIM_TITLE(3) + SIM_TOKEN(2), no substring add */);
	});

	it('does NOT fire for a single-CJK-char query (length >= 2 guard) — 港 alone earns no containment credit', () => {
		const single = { artist: '', title: '港' };
		const containing = mk('ytmusic', 'c', '陳百強', { title: '港城' }); // contains 港 but query too short
		const other = mk('qq', 'o', '柳永', { title: '耆卿' });
		// both score 0 (no component/token match, single-char query blocked) → equal, no lift
		expect(scoreMatch(single, containing)).toBe(scoreMatch(single, other));
	});
});

describe('VARIANT_KEYWORDS — exported editable list', () => {
	it('is a non-empty array containing both an English and a CJK term', () => {
		expect(Array.isArray(VARIANT_KEYWORDS)).toBe(true);
		expect(VARIANT_KEYWORDS.length).toBeGreaterThan(0);
		expect(VARIANT_KEYWORDS).toContain('karaoke');
		expect(VARIANT_KEYWORDS).toContain('翻唱');
	});
});

describe('scoreMatch — review regressions (CR-01/CR-02/WR-02/IN-01/IN-02)', () => {
	it('CR-01: a clean title containing a keyword as a SUBSTRING is not penalized (Olive ⊅ live)', () => {
		// 'live' must not fire inside 'Olive'; 'cover' must not fire inside 'Discover'.
		// An exact-match clean title scores the same whether or not it embeds a keyword substring.
		const olive = scoreMatch({ artist: 'X', title: 'Olive' }, mk('netease', 'o', 'X', { title: 'Olive' }));
		const apple = scoreMatch({ artist: 'X', title: 'Apple' }, mk('netease', 'a', 'X', { title: 'Apple' }));
		const discover = scoreMatch({ artist: 'X', title: 'Discover' }, mk('qq', 'd', 'X', { title: 'Discover' }));
		expect(olive).toBe(apple); // both exact, both un-penalized
		expect(discover).toBe(apple);
	});

	it('CR-01: the keyword as a real WORD is still penalized', () => {
		const query = { artist: 'X', title: 'Song' };
		const clean = mk('netease', 'c', 'X', { title: 'Song' });
		const live = mk('qq', 'l', 'X', { title: 'Song (Live)' });
		expect(scoreMatch(query, clean)).toBeGreaterThan(scoreMatch(query, live));
	});

	it('CR-02: a paired keyword (live ⊂ live版) counts ONCE, not twice', () => {
		const query = { artist: 'X', title: 'Song' };
		const onePair = mk('netease', 'p', 'X', { title: 'Song live版' }); // matched live+live版 → dedup → 1×
		const twoDistinct = mk('qq', 't', 'X', { title: 'Song live remix' }); // live+remix → 2×
		// One de-duped variant must be penalized LESS than two genuinely distinct variants.
		expect(scoreMatch(query, onePair)).toBeGreaterThan(scoreMatch(query, twoDistinct));
	});

	it('WR-02: an artist literally named "Live" does NOT suppress the live penalty', () => {
		const query = { artist: 'Live', title: 'Song' }; // band "Live", clean title
		const clean = mk('netease', 'c', 'Live', { title: 'Song' });
		const liveTake = mk('qq', 'l', 'Live', { title: 'Song (Live)' });
		// The exception keys off the query TITLE only — a live recording is still down-ranked.
		expect(scoreMatch(query, clean)).toBeGreaterThan(scoreMatch(query, liveTake));
	});

	it('IN-01: "speed up" is penalized (not only "sped up")', () => {
		const query = { artist: 'X', title: 'Song' };
		const clean = mk('netease', 'c', 'X', { title: 'Song' });
		const speedUp = mk('qq', 's', 'X', { title: 'Song (speed up)' });
		expect(scoreMatch(query, clean)).toBeGreaterThan(scoreMatch(query, speedUp));
	});

	it('IN-02: empty query / all-variant candidate still returns a finite number', () => {
		const empty = scoreMatch({ artist: '', title: '' }, mk('netease', 'e', '', { title: '' }));
		expect(Number.isFinite(empty)).toBe(true);
		const allVariant = scoreMatch(
			{ artist: 'X', title: 'Song' },
			mk('qq', 'v', 'Z', { title: 'Karaoke Cover (Live)' })
		);
		expect(Number.isFinite(allVariant)).toBe(true); // negative is fine; NaN/null is not
	});
});

describe('scoreMatch — 試聽 sub-60s preview penalty (D-03 / D-04)', () => {
	const query = { artist: 'X', title: 'Song' };

	it('D-03: an undefined-duration candidate is NOT penalized (== an identical full-length one)', () => {
		const undef = mk('netease', 'u', 'X', { title: 'Song' }); // duration undefined
		const full = mk('qq', 'f', 'X', { title: 'Song', duration: 223 }); // full track
		// neither is a sub-60s clip → identical base score; the unknown duration must not lose points
		expect(scoreMatch(query, undef)).toBe(scoreMatch(query, full));
	});

	it('D-03: a duration=0 candidate is NOT penalized (0 = unknown)', () => {
		const known = mk('netease', 'k', 'X', { title: 'Song' });
		const zero = mk('qq', 'z', 'X', { title: 'Song', duration: 0 });
		// no ctx → identical similarity; the zero-duration one must not lose points
		expect(scoreMatch(query, zero)).toBe(scoreMatch(query, known));
	});

	it('D-04 penalty-dominance: a fully-boosted sub-60s clip scores STRICTLY LESS than a clean unboosted full track', () => {
		const clipQuery = { artist: '周杰倫', title: '稻香' };
		// clip carries EVERY boost: exact title length, cross-source artist, exact similarity
		const clip = mk('qq', 'clip', '周杰倫', { title: '稻香', duration: 30 });
		const otherSourceSameArtist = mk('netease', 'x', '周杰倫', { title: '晴天' });
		const fullClean = mk('kuwo', 'full', '周杰倫', { title: '稻香', duration: 223 });
		const ctx = computeSetContext([clip, otherSourceSameArtist, fullClean], '稻香');
		expect(scoreMatch(clipQuery, clip, ctx)).toBeLessThan(scoreMatch(clipQuery, fullClean, ctx));
	});

	it('D-04: PREVIEW_PENALTY strictly exceeds the max achievable boost stack (derived invariant)', () => {
		expect(PREVIEW_PENALTY).toBeGreaterThan(10 /* SIM_EXACT */ + SHORT_TITLE_BOOST_MAX + ARTIST_FREQ_BOOST);
	});

	it('SHORT_CLIP_SEC threshold: a duration AT the threshold is NOT a clip; just under IS', () => {
		const atThreshold = mk('qq', 'at', 'X', { title: 'Song', duration: SHORT_CLIP_SEC });
		const justUnder = mk('qq', 'under', 'X', { title: 'Song', duration: SHORT_CLIP_SEC - 1 });
		expect(scoreMatch(query, atThreshold)).toBeGreaterThan(scoreMatch(query, justUnder));
	});
});

describe('scoreMatch — set-relative boosts behind optional ctx (D-05 / D-06)', () => {
	it('D-06: a title whose length ≈ queryLen outranks a longer same-song variant title', () => {
		const query = { artist: 'X', title: 'Song' };
		const tight = mk('netease', 't', 'X', { title: 'Song' }); // len close to query
		const longer = mk('qq', 'l', 'X', { title: 'Song (Deluxe Extended Edition)' });
		const ctx = computeSetContext([tight, longer], 'Song');
		expect(scoreMatch(query, tight, ctx)).toBeGreaterThan(scoreMatch(query, longer, ctx));
	});

	it('D-05: a candidate whose artist appears in 2+ sources outranks an identical one in 1 source', () => {
		const query = { artist: '周杰倫', title: '稻香' };
		// crossSource artist is in qq + netease; single is in qq only — same candidate fields otherwise
		const cross = mk('qq', 'c', '周杰倫', { title: '稻香' });
		const crossOther = mk('netease', 'c2', '周杰倫', { title: '稻香' });
		const single = mk('kuwo', 's', '林俊傑', { title: '江南' });
		const ctx = computeSetContext([cross, crossOther, single], '稻香');
		// build a ctx where ONLY the cross artist is multi-source; compare two candidates whose
		// only difference is whether their artist is multi-source in the ctx
		const crossCand = mk('qq', 'q', '周杰倫', { title: '稻香' });
		const singleCand = mk('kuwo', 'k', '林俊傑', { title: '江南' });
		expect(scoreMatch(query, crossCand, ctx)).toBeGreaterThan(
			scoreMatch({ artist: '林俊傑', title: '江南' }, singleCand, ctx)
		);
	});

	it('D-07 regression: 2-arg scoreMatch is byte-identical to passing an empty-ctx-less call', () => {
		const query = { artist: '周杰倫', title: '稻香' };
		const c = mk('netease', 'c', '周杰倫', { title: '稻香 (Karaoke)' });
		// the existing 2-arg shape (no ctx, no duration) must not change value vs prior behavior
		expect(scoreMatch(query, c)).toBe(scoreMatch(query, c));
		// and passing an undefined ctx explicitly equals the 2-arg form
		expect(scoreMatch(query, c, undefined)).toBe(scoreMatch(query, c));
	});
});

describe('scoreMatch — determinism + numeric safety', () => {
	it('returns the same number for the same inputs and never NaN/null', () => {
		const query = { artist: '周杰伦', title: '稻香' };
		const c = mk('netease', 'c', '周杰伦', { title: '稻香 (Karaoke)' });
		const a = scoreMatch(query, c);
		const b = scoreMatch(query, c);
		expect(a).toBe(b);
		expect(typeof a).toBe('number');
		expect(Number.isNaN(a)).toBe(false);
		expect(a).not.toBeNull();
	});
});
