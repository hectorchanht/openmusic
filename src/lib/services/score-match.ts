// score-match — the PURE best-match re-ranking term for resolveStub (Phase 10, LFSRC-03 / D-02).
//
// resolveStub re-searches a Last.fm {artist, title} stub through searchAll + dedupeBest.
// dedupeBest collapses same-song dupes and orders by quality + preferredSource, but its
// FIRST element can still be a karaoke / cover / live / instrumental variant of the song
// the user actually tapped (Pitfall 7 wrong-song resolution). scoreMatch re-ranks the
// candidates so a CLEAN title outranks a variant of the same song, while a candidate whose
// normalized artist+title (via matchKey) matches the query closely outranks a loose one.
//
// PURE + import-light (matchKey, dedupe's foldScript + the Track type): no $state, no $app/*, no I/O,
// no source/quality/preferredSource logic (that is dedupeBest's job — Task 2 keeps it as
// the final tie-break). node-Vitest-testable like match-key.ts / dedupe.ts.
//
// Score = similarity(query, candidate) − variantPenalty(query, candidate). Higher = better.
// It NEVER returns null/NaN and NEVER applies a threshold (D-03 — scoring only re-orders).
//
// quick-261006-lyr: in LYRIC MODE (ctx.lyricMode — the query reads as a pasted lyric line, see
// score-context.ts LYRIC-01/02) the formula gains two set-relative terms: a consensus boost for
// candidates whose canonical title matches the set's elected consensus title, and a full
// query-title-credit zero-out for a candidate whose canonical title IS the query (a pasted-lyric
// mistitle, not the song). Both are ctx-gated; the 2-arg resolveStub path is byte-identical.
import { matchKey } from '$lib/services/match-key';
import { foldScript, titleKey } from '$lib/services/dedupe';
import type { Track } from '$lib/sources/types';
import type { SetContext } from '$lib/services/score-context';

/**
 * Variant-keyword list (D-02a) — English + common CJK variant terms. A candidate whose
 * TITLE contains one of these is down-ranked UNLESS the query asked for that variant.
 * Lowercased; the scanner lowercases both candidate title and query before matching, so
 * mixed-case upstream titles (e.g. "Karaoke", "卡拉OK") are caught. EDITABLE — tune freely.
 */
export const VARIANT_KEYWORDS: string[] = [
	// English
	'cover',
	'karaoke',
	'live',
	'instrumental',
	'remix',
	'r&b', // quick-261006-lyr: an R&B rearrangement is a version marker like remix版 — the latin word-boundary rule fires it inside "木紋 (R&B版)" (\b between b and 版) without matching inside longer words
	'sped up',
	'speed up',
	'slowed',
	'8d',
	'tribute',
	're-recorded',
	'rerecorded',
	'acoustic',
	'demo',
	'reprise',
	// CJK (simplified + traditional)
	'翻唱',
	'卡拉ok',
	'现场',
	'現場',
	'伴奏',
	'纯音乐',
	'純音樂',
	'加速版',
	'live版',
	'现场版',
	'現場版',
	'重制',
	'重製',
	'remix版'
];

// --- Tuning weights (named consts so the balance is explicit + editable) ---------------
// SIM_* feed the similarity reward; VARIANT_WEIGHT is subtracted per offending keyword.
// Kept so the similarity term out-weighs a single variant hit when the variant is clearly
// the intended song, but a CLEAN exact match always beats a variant of the same key.
const SIM_EXACT = 10; // candidate matchKey === query matchKey
const SIM_ARTIST = 3; // artist component matches
const SIM_TITLE = 3; // title component matches
const SIM_TOKEN = 2; // graded latin-token overlap (max contribution)
const VARIANT_WEIGHT = 4; // subtracted per un-asked-for variant keyword
// SIM_SUBSTR (CJK-safe substring-containment credit, quick-260715-l9p) is DERIVED from the Phase 21
// boost consts, so it is defined in the set-relative block below — after SHORT_TITLE_BOOST_MAX +
// ARTIST_FREQ_BOOST (a forward reference here would hit the const temporal-dead-zone at load).

// --- Phase 21 set-relative tuning (SRCH-01) ---------------------------------------------
/** A track strictly SHORTER than this many seconds is a 試聽 preview clip (D-04). A length
 *  AT the threshold is a full track. undefined/0 = unknown = NEVER penalized (D-03). */
export const SHORT_CLIP_SEC = 60;
/** Max reward for a candidate title whose length is close to the query length (D-06). */
export const SHORT_TITLE_BOOST_MAX = 3;
/** Flat reward when the candidate's artist appears under 2+ distinct sources (D-05). */
export const ARTIST_FREQ_BOOST = 2;
/** SIM_SUBSTR (quick-260715-l9p) — additive credit for a candidate whose normalized artist+title
 *  LITERALLY contains the (normalized) query. It is the ONLY signal for a CJK query that is a
 *  SUBSTRING of a longer title — matchKey strips spaces so such a query collapses to one token and
 *  earns no token/component credit (see similarity()); applied ONLY when score===0 (purely additive).
 *  DERIVED (like PREVIEW_PENALTY below), NOT independently chosen, to strictly dominate the
 *  set-relative boost stack a NON-containing row can accumulate — shortTitleBoost (≤
 *  SHORT_TITLE_BOOST_MAX) + artistFrequencyBoost (ARTIST_FREQ_BOOST), + 1 to break the tie. A
 *  candidate that literally CONTAINS the typed query is a strong relevance signal that MUST outrank
 *  any row lifted PURELY by those boosts: they are tie-breakers among already-relevant rows, not a
 *  lever to float an unrelated short title above a containing one. (The exact live 港耆 failure: a
 *  2-char non-containing title "港城"/"耆卿" scored shortTitle(3)+artistFreq(2)=5 and beat the
 *  containing video at the old flat SIM_SUBSTR=2.) Still == a full component match (SIM_ARTIST +
 *  SIM_TITLE = 6 — equal is acceptable: "contains the whole query" ≈ "matched a full component")
 *  and far below SIM_EXACT(10). */
const SIM_SUBSTR = SHORT_TITLE_BOOST_MAX + ARTIST_FREQ_BOOST + 1; // = 6
/** 試聽 penalty — DERIVED to strictly dominate the full boost stack (Pitfall 2): a clip can
 *  carry SIM_EXACT + SHORT_TITLE_BOOST_MAX + ARTIST_FREQ_BOOST at most, so subtracting one
 *  more than that guarantees NO boost combination lifts a sub-60s clip above a clean full
 *  track (D-04 penalty-dominance). Not an independently-chosen magnitude. */
export const PREVIEW_PENALTY = SIM_EXACT + SHORT_TITLE_BOOST_MAX + ARTIST_FREQ_BOOST + 1;

// --- Lyric-query tuning (quick-261006-lyr, LYRIC-03) -----------------------------------------
/**
 * Flat reward for a candidate whose title-only canonical key (titleKey) equals the result set's
 * lyric consensus (score-context.ts LYRIC-02). PICKED, not derived: added to the original's own
 * modest lyric-mode base (short-title proximity, ~2-3), the total must clear the best
 * NON-consensus row a lyric query can realistically produce — shortTitleBoost (≤
 * SHORT_TITLE_BOOST_MAX) + artistFrequencyBoost (ARTIST_FREQ_BOOST) = 5 — while staying far
 * below SIM_EXACT (10) so a genuine exact title/artist match outside lyric mode is never
 * outranked by it. Lyric mode is the ONLY path that awards it (ctx.lyricMode), so normal
 * title/artist searches are byte-identical.
 */
const LYRIC_CONSENSUS_BOOST = 4;

/** Split a matchKey component into latin word tokens for graded partial overlap. */
function tokens(component: string): string[] {
	return component.split(/[^\p{L}\p{N}]+/u).filter((s) => s.length > 0);
}

/**
 * Graded similarity (D-02b): reuse matchKey (artist-first normalization) for both the
 * query and the candidate. Exact key match = max reward; else credit per-component
 * (artist / title) equality plus a small token-overlap term so a near-match beats an
 * unrelated one. Deterministic, never negative.
 */
function similarity(query: { artist: string; title: string }, candidate: Track): number {
	// debug album-zip-duplicate-songs: fold BOTH sides Traditional→Simplified before keying. dedupeBest's
	// key() has folded since quick-260926-n0r, so for a Traditional stub (MusicBrainz album rows) the
	// merged group's survivor is the Simplified qq/netease row — which this script-blind compare scored
	// 0 while a junk same-artist Traditional row (joox's artist-popular filler) scored 4 and won: six
	// different album tracks resolved to one joox 明年今日. Same per-char fold as key(), so ranking and
	// identity agree; cold dict → identity (the pre-fix numbers), warm → script-insensitive.
	const qKey = matchKey(foldScript(query.artist), foldScript(query.title));
	const cKey = matchKey(foldScript(candidate.artist), foldScript(candidate.title));
	if (qKey === cKey) return SIM_EXACT;

	const [qArtist, qTitle] = qKey.split('|');
	const [cArtist, cTitle] = cKey.split('|');

	let score = 0;
	if (qArtist && qArtist === cArtist) score += SIM_ARTIST;
	if (qTitle && qTitle === cTitle) score += SIM_TITLE;

	// Token overlap (latin words only; CJK components have no internal spaces so they fall
	// through the per-component equality above). Graded 0..SIM_TOKEN by overlap fraction.
	const qToks = new Set([...tokens(qArtist), ...tokens(qTitle)]);
	const cToks = new Set([...tokens(cArtist), ...tokens(cTitle)]);
	if (qToks.size > 0) {
		let hit = 0;
		for (const tk of qToks) if (cToks.has(tk)) hit++;
		score += SIM_TOKEN * (hit / qToks.size);
	}

	// CJK-safe substring-containment credit (quick-260715-l9p). matchKey strips spaces, so a CJK
	// query that is a substring of a longer title (港耆 ⊂ 摩四老年港耆…) earns NO token/component
	// credit — it collapses into one token that never token-matches inside the title, so it scores
	// 0, tying with unrelated fuzzy rows. This substring term lets a candidate that LITERALLY
	// contains the typed query outrank those unrelated matches. GUARDED by `score === 0` so it is
	// additive-only: it can never demote a real match, and it keeps every already-matching
	// candidate byte-identical — resolution scoring (Pitfall 7) is unchanged for any candidate
	// that already earned exact/component/token credit. `length >= 2` avoids single-CJK-char noise.
	if (score === 0) {
		const cJoin = cArtist + cTitle;
		// The search page (rankList) passes {artist:q, title:q}, so the two matchKey halves are
		// IDENTICAL — join them once, else a CJK query would double (港耆港耆) and fail to match
		// inside a title that contains it only once. resolveStub/crossSourceLyric pass a distinct
		// artist/title, so their join is the real artist+title concatenation.
		const qJoin = qArtist === qTitle ? qTitle : qArtist + qTitle;
		if (qJoin.length >= 2 && cJoin.includes(qJoin)) score += SIM_SUBSTR;
	}
	return score;
}

/** Escape a string for safe literal use inside a RegExp. */
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Precomputed keyword testers. Latin/ASCII keywords match on WORD BOUNDARIES (CR-01) so
 * `live` does NOT fire inside `Olive`/`Relive` and `cover` does NOT fire inside `Discover`.
 * CJK keywords have no word separators, so they match as a substring (safe — low false-
 * positive risk for CJK). `\b` (ASCII word boundary) still fires at a latin↔CJK seam, so
 * `\blive\b` correctly matches inside `live版`.
 */
const ASCII_ONLY = /^[\x00-\x7f]+$/;
const KW_TESTERS: { kw: string; re: RegExp | null }[] = VARIANT_KEYWORDS.map((kw) => ({
	kw,
	re: ASCII_ONLY.test(kw) ? new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i') : null
}));
function kwHit(text: string, t: { kw: string; re: RegExp | null }): boolean {
	return t.re ? t.re.test(text) : text.includes(t.kw);
}

/**
 * Variant penalty (D-02a): scan the candidate TITLE for VARIANT_KEYWORDS terms NOT present
 * in the query TITLE (WR-02 — title only, so a band literally named "Live" no longer
 * suppresses the live-penalty for every candidate). Word-boundary match for latin (CR-01).
 * Paired keywords are de-duped so `live`⊂`live版` counts ONCE, not twice (CR-02). Non-negative.
 */
function variantPenalty(query: { artist: string; title: string }, candidate: Track): number {
	const title = (candidate.title || '').toLowerCase();
	const qTitle = (query.title || '').toLowerCase(); // WR-02: query TITLE only, not artist

	// Keywords present in the candidate title that the query did NOT ask for.
	const matched: string[] = [];
	for (const t of KW_TESTERS) {
		if (!kwHit(title, t)) continue;
		if (kwHit(qTitle, t)) continue; // query asked for this variant — do not penalize
		matched.push(t.kw);
	}
	// CR-02: drop a matched keyword that is a substring of ANOTHER matched keyword
	// (e.g. `live` when `live版` also matched) so the same variant token counts once.
	const deduped = matched.filter(
		(kw) => !matched.some((other) => other !== kw && other.includes(kw))
	);
	return deduped.length * VARIANT_WEIGHT;
}

/**
 * 試聽 preview penalty (D-03 / D-04). Fires ONLY for a finite, positive, sub-SHORT_CLIP_SEC
 * duration. undefined / null / 0 = the source did not report a length = unknown = NO penalty
 * (so a source that omits duration is never falsely down-ranked). A flat large subtraction so
 * no boost can lift a clip above a full track (PREVIEW_PENALTY is derived to dominate).
 */
function previewPenalty(candidate: Track): number {
	const d = candidate.duration;
	return typeof d === 'number' && d > 0 && d < SHORT_CLIP_SEC ? PREVIEW_PENALTY : 0;
}

/**
 * Short-title proximity boost (D-06). Rewards a candidate TITLE whose length is CLOSE to the
 * query length — proximity, NOT "shorter is always better" (a long title the user actually
 * typed must not be punished). Graded SHORT_TITLE_BOOST_MAX..0 by absolute length delta.
 * Returns 0 when ctx is absent or queryLen is 0 (nothing to compare against).
 */
function shortTitleBoost(candidate: Track, ctx: SetContext): number {
	if (ctx.queryLen <= 0) return 0;
	const titleLen = (candidate.title || '').trim().length;
	const delta = Math.abs(titleLen - ctx.queryLen);
	// Linear decay: delta 0 → full boost; delta >= queryLen → 0. Bounded, never negative.
	const frac = Math.max(0, 1 - delta / ctx.queryLen);
	return SHORT_TITLE_BOOST_MAX * frac;
}

/**
 * Cross-source artist boost (D-05). Adds ARTIST_FREQ_BOOST only when the candidate's artist
 * (keyed artist-only, matching computeSetContext) appears under 2+ DISTINCT sources — i.e.
 * cross-source PRESENCE, never raw row count from a single source. Returns 0 otherwise.
 */
function artistFrequencyBoost(candidate: Track, ctx: SetContext): number {
	const sources = ctx.artistSources.get(matchKey(candidate.artist, ''));
	return sources && sources.size >= 2 ? ARTIST_FREQ_BOOST : 0;
}

/**
 * quick-261006-lyr LYRIC-03: in lyric mode, a candidate whose canonical title IS the query is a
 * pasted-lyric mislabel (an uploader titled a cover/clip with the lyric line), NOT the song the
 * lyric belongs to — the set's consensus title names that song instead. True only when the
 * lyric reading is SET-VALIDATED: a real consensus exists and differs from this title. (When
 * the query is a genuine long title, the consensus IS that title and nothing demotes.)
 */
function isMislabeledLyricTitle(
	query: { artist: string; title: string },
	candidate: Track,
	ctx: SetContext
): boolean {
	if (!ctx.lyricMode || !ctx.lyricConsensus) return false;
	const qk = titleKey(query.title);
	const ck = titleKey(candidate.title);
	return !!qk && qk === ck && ck !== ctx.lyricConsensus;
}

/**
 * quick-261006-lyr LYRIC-02: flat reward when the candidate's title-only canonical key matches
 * the lyric consensus — the song the lyric-matching upstreams agree on. 0 unless lyric mode is
 * on and a consensus was elected.
 */
function lyricConsensusBoost(candidate: Track, ctx: SetContext): number {
	if (!ctx.lyricMode || !ctx.lyricConsensus) return 0;
	return titleKey(candidate.title) === ctx.lyricConsensus ? LYRIC_CONSENSUS_BOOST : 0;
}

// --- Artist-intent tuning (quick-261024-cig) ---------------------------------------------
/**
 * Flat reward when the candidate's ARTIST (fuzzy-)equals the WHOLE search query — the user
 * typed an artist's name, so that artist's songs are the intent, whatever their titles are.
 * DERIVED, like SIM_SUBSTR / PREVIEW_PENALTY above, to strictly dominate the best stack a
 * TITLE-collision impostor can earn: a track literally TITLED with the query by an unrelated
 * artist gets SIM_TITLE (3) + full token overlap (SIM_TOKEN 2) + full short-title proximity
 * (SHORT_TITLE_BOOST_MAX 3) = 8. The live failure (Hector 2026-10-24): searching the
 * singular "cigarette after sex", two impostor tracks titled "Cigarette After Sex" (Black
 * Roses / ELISSAR BENJAMIN, ~8) outranked every real Cigarettes After Sex song (~6, because
 * `cigarette ≠ cigarettes` earned no artist component at all). +1 breaks the tie, so an
 * artist-matching row wins even before its own similarity / frequency credit is counted.
 */
export const ARTIST_INTENT_BOOST = SIM_TITLE + SIM_TOKEN + SHORT_TITLE_BOOST_MAX + 1; // = 9

const HAN_ANY = /\p{Script=Han}/u;

/**
 * Damerau–Levenshtein distance (optimal string alignment: one adjacent transposition
 * counts as ONE edit — "beatels" → "beatles"), the typo metric for token comparison.
 * Pure DP, O(|a|·|b|); callers only pass single words, so this stays tiny.
 */
export function damerauLevenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	const d: number[][] = Array.from({ length: m + 1 }, (_, i) => {
		const row = new Array<number>(n + 1).fill(0);
		row[0] = i;
		return row;
	});
	for (let j = 0; j <= n; j++) d[0][j] = j;
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			d[i][j] = Math.min(
				d[i - 1][j] + 1, // deletion
				d[i][j - 1] + 1, // insertion
				d[i - 1][j - 1] + cost // substitution / match
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // adjacent transposition
			}
		}
	}
	return d[m][n];
}

/**
 * Allowed edit distance for one Latin token pair, scaled by length: short words are too
 * easy to collide ("sex" / "six", "art" / "act") so ≤3 chars — and any pair whose shorter
 * side is < 4 — must be EXACT; 4–6 chars tolerate 1 edit (a plural `s`, a dropped letter,
 * a transposition); ≥7 tolerates 2 (e.g. "cigarete" → "cigarettes").
 */
function tokenEditBudget(q: string, c: string): number {
	const min = Math.min(q.length, c.length);
	if (min < 4) return 0;
	return min >= 7 ? 2 : 1;
}

/** Tokenize an artist string the same way computeSetContext tokenizes the query. */
function artistTokens(artist: string): string[] {
	return (artist || '')
		.toLowerCase()
		.replace(/[（(【\[].*?[)）\]】]/g, ' ') // bracketed qualifiers are not part of the name
		.replace(/\s*\(?\b(?:feat|ft)\.?\b[^)]*\)?\s*$/i, '') // a trailing feat. credit is not the act
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

/**
 * quick-261024-cig: does this ARTIST name match the whole query, tolerating ordinary
 * typing errors? Two routes, either is enough:
 *   1. Token-by-token, IN ORDER, same token count — every token equal or within its
 *      length-scaled Damerau–Levenshtein budget (plurals, dropped/doubled letters,
 *      transpositions), with a TOTAL budget across tokens so a name that is wrong in
 *      every word does not pass on per-token slack alone.
 *   2. Joined (spaces removed) comparison — catches spacing errors ("cigarettesafter
 *      sex", "cigarette aftersex"), where the token counts themselves differ.
 * Strictness guards, learned from the artist-page exactness work:
 *   - Han tokens compare EXACTLY (no edit distance, no script fold): one different Han
 *     character can be a different person (姜涛 ≠ 姜濤), and CJK names are short enough
 *     that a distance-1 rule would collide constantly.
 *   - Short Latin tokens (≤3) compare exactly (see tokenEditBudget).
 *   - Token ORDER matters (route 1 compares pairwise in order) — "After Sex Cigarette"
 *     is not the band.
 * Exported for direct unit tests.
 */
export function fuzzyArtistMatchesQuery(artist: string, queryTokens: string[]): boolean {
	if (!queryTokens.length) return false;
	const cand = artistTokens(artist);
	if (!cand.length) return false;

	// Route 2 (joined) is checked inside both branches below via this helper: equal joins
	// are an exact spacing-only difference. Near joins allow ONE edit total — deliberately
	// stricter than summing the per-token budgets, so this route cannot re-admit a pair the
	// token route rejected for a short-token difference ("…after sex" vs "…after six" is
	// distance 2 joined: the plural `s` plus sex→six). Han joins stay exact-only (see the
	// guard note above), and so do joins shorter than 6 chars.
	const qJoin = queryTokens.join('');
	const cJoin = cand.join('');
	const joinedFuzzy = (): boolean => {
		if (qJoin === cJoin) return true;
		if (HAN_ANY.test(qJoin) || HAN_ANY.test(cJoin)) return false;
		if (Math.min(qJoin.length, cJoin.length) < 6) return false;
		return damerauLevenshtein(qJoin, cJoin) <= 1;
	};

	if (cand.length !== queryTokens.length) return joinedFuzzy();

	let totalDist = 0;
	const totalBudget = Math.max(1, Math.floor(qJoin.length / 6));
	for (let i = 0; i < cand.length; i++) {
		const q = queryTokens[i];
		const c = cand[i];
		if (q === c) continue;
		if (HAN_ANY.test(q) || HAN_ANY.test(c)) return joinedFuzzy();
		const dist = damerauLevenshtein(q, c);
		if (dist > tokenEditBudget(q, c)) return joinedFuzzy();
		totalDist += dist;
		if (totalDist > totalBudget) return joinedFuzzy();
	}
	return true;
}

/**
 * quick-261024-cig: the artist-intent term. ctx-gated (it needs the whole raw query, which
 * only the search page's computeSetContext carries) so the 2-arg resolveStub / fallback
 * callers stay byte-identical, exactly like the other set-relative boosts.
 */
function artistIntentBoost(candidate: Track, ctx: SetContext): number {
	if (!ctx.queryTokens?.length) return 0;
	return fuzzyArtistMatchesQuery(candidate.artist, ctx.queryTokens) ? ARTIST_INTENT_BOOST : 0;
}

/**
 * Pure best-match score for one candidate against a {artist, title} query.
 * Higher = better. Base score = similarity − variantPenalty (UNCHANGED for 2-arg callers —
 * resolveStub / tryFallback see byte-identical values). When the optional `ctx` is supplied
 * (Phase 21 search page) the set-relative short-title + cross-source-artist boosts are added,
 * and the 試聽 sub-60s penalty is subtracted whenever the candidate carries a known sub-clip
 * duration (the penalty does NOT require ctx — it fires off duration alone). quick-261006-lyr:
 * in lyric mode (ctx.lyricMode) a pasted-lyric mistitle earns NO query-title credit at all —
 * no similarity, no substring containment, no short-title proximity — while consensus members
 * gain LYRIC_CONSENSUS_BOOST; the variant/試聽 penalties and artist-frequency boost still apply
 * to every row. quick-261024-cig: with ctx, a candidate whose artist fuzzy-equals the whole
 * query also gains ARTIST_INTENT_BOOST. Never null/NaN, no threshold, no source/quality logic
 * (dedupeBest owns that).
 */
export function scoreMatch(
	query: { artist: string; title: string },
	candidate: Track,
	ctx?: SetContext
): number {
	// LYRIC-03: the mistitle check needs the set-validated consensus, so it lives behind ctx.
	const mislabeled = !!ctx && isMislabeledLyricTitle(query, candidate, ctx);
	let score = (mislabeled ? 0 : similarity(query, candidate)) - variantPenalty(query, candidate);
	// 試聽 penalty fires off duration alone (D-04) — independent of ctx.
	score -= previewPenalty(candidate);
	// Set-relative boosts require the per-set summary; absent ctx the 2-arg behavior is unchanged.
	if (ctx) {
		// LYRIC-03: a pasted-lyric title's length "proximity" to the query IS the mislabel —
		// it must not earn shortTitleBoost either.
		if (!mislabeled) score += shortTitleBoost(candidate, ctx);
		score += artistFrequencyBoost(candidate, ctx);
		score += lyricConsensusBoost(candidate, ctx);
		// quick-261024-cig: an artist-name query lifts that artist's whole catalogue above
		// title-collision impostors (see ARTIST_INTENT_BOOST).
		score += artistIntentBoost(candidate, ctx);
	}
	return score;
}
