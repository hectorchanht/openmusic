// SUBSTITUTION VARIANT GUARD — "is this candidate an acceptable stand-in for the song that failed?"
// OFFICIAL SONG PRIORITIZER lives at the bottom (quick-261020-off1).

import { variantTag, sameArtistCredit, sameSongStrings, sameSongByCredit, titleKeys } from '$lib/services/dedupe';
import { foldScript } from '$lib/services/zh-convert';
import { VARIANT_KEYWORDS, scoreMatch } from '$lib/services/score-match';
//
// WHY (user report, debug `slow-cold-start-first-playing`): when a source truly cannot serve a track,
// the player retries the SAME song on another source so playback never visibly stops. That is the
// right behavior and it already exists (`tryFallback`, `resolveNameStub`). The hole is in the
// adoption gate they both use, `sameSongKey`.
//
// `sameSongKey` is built on dedupe's `key()`, which DELIBERATELY strips bracketed suffixes:
//
//     .replace(/[（(【\[].*?[)）\]】]/g, ' ')   // drop (Live) / [Remaster] / 【...】
//
// That is correct for DEDUPE — collapsing cross-source variants into one row is the whole point
// there. It is wrong for SUBSTITUTION: it makes `告白氣球（純音樂版）` key-identical to `告白氣球`,
// so a failover happily adopts the INSTRUMENTAL and the user gets a karaoke backing track under the
// original song's name. Same for `(Cover)` and `(Karaoke)`.
//
// This module is the missing half: `sameSongKey` answers "same song?", this answers "same KIND of
// recording?". Both must pass before a substitute is adopted.
//
// SCOPE, per the user's explicit call: block no-vocal renditions (instrumental / karaoke / backing)
// and third-party covers. LIVE is deliberately ALLOWED — a live take by the same artist is a fine
// stand-in. Remix is also left allowed; it was not in the request, and silently narrowing what the
// player will substitute is worse than the occasional remix.
//
// Pure module: no runes, no `$app/*`, no network — node-Vitest-testable like dedupe / match-key.

/**
 * The rendition tags that DISQUALIFY a candidate from standing in for a different rendition.
 *
 * CJK markers match as plain substrings (no word boundaries in CJK). Latin markers match as whole
 * tokens so a legitimate title is never caught by an accidental substring.
 */
const CJK_MARKERS: Record<VariantTag, readonly string[]> = {
	// No original vocal: instrumental cuts, karaoke/backing tracks, vocal-removed edits.
	instrumental: [
		'純音樂',
		'纯音乐',
		'純音乐',
		'纯音樂',
		'伴奏',
		'伴唱',
		'無人聲',
		'无人声',
		'去人聲',
		'去人声',
		'消音',
		'卡拉'
	],
	// Performed by someone other than the original artist.
	cover: ['翻唱', '翻自', '改編自', '改编自']
};

const LATIN_MARKERS: Record<VariantTag, readonly string[]> = {
	instrumental: [
		'instrumental',
		'inst',
		'karaoke',
		'ktv',
		'offvocal',
		'off vocal',
		'no vocal',
		'without vocal',
		'backing track',
		'minus one'
	],
	cover: ['cover', 'covered by']
};

export type VariantTag = 'instrumental' | 'cover';

/**
 * Pull out ONLY the parts of a title where a rendition marker legitimately lives: bracketed
 * segments and a trailing dash-suffix.
 *
 * This scoping is what keeps the guard safe. Scanning the WHOLE title for `cover` would reject the
 * real song "Cover Me in Sunshine"; scanning for `inst` would catch anything containing those four
 * letters. A marker only counts when it sits where variant labels actually go —
 * `告白氣球（純音樂版）`, `Song Name (Cover)`, `Song - Karaoke Version`.
 *
 * Extraction is deliberately liberal (a trailing `-Man` from "Spider-Man" becomes a segment); that
 * is harmless because the MARKER list is what gates the decision, and no marker matches it.
 */
function variantSegments(title: string): string {
	const segments: string[] = [];
	for (const m of (title || '').matchAll(/[（(【\[]([^)）\]】]*)[)）\]】]/g)) segments.push(m[1]);
	const dash = (title || '').match(/[-–—~〜]([^-–—~〜]*)$/);
	if (dash) segments.push(dash[1]);
	return segments.join(' ').toLowerCase();
}

/** True when `segment` contains `marker` as a whole latin token (so `inst` never matches `instant`). */
function hasLatinToken(segment: string, marker: string): boolean {
	const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(segment);
}

/**
 * Which disqualifying rendition tags does this title advertise? Reads the bracketed / dash-suffix
 * segments only. An untagged title (the common case) returns an empty set.
 */
export function variantTagsOf(title: string): Set<VariantTag> {
	const seg = variantSegments(title);
	const tags = new Set<VariantTag>();
	if (!seg.trim()) return tags;
	for (const tag of ['instrumental', 'cover'] as const) {
		if (CJK_MARKERS[tag].some((m) => seg.includes(m))) tags.add(tag);
		else if (LATIN_MARKERS[tag].some((m) => hasLatinToken(seg, m))) tags.add(tag);
	}
	return tags;
}

/**
 * May `candidateTitle` stand in for `originalTitle`?
 *
 * RELATIVE, never absolute — it rejects only tags the candidate ADDS. If the user is deliberately
 * playing `告白氣球（純音樂）`, another instrumental is exactly the right substitute and swapping in
 * the vocal version would be the error. The guard exists to stop a SILENT change of rendition, in
 * whichever direction the user did not ask for.
 *
 * Live takes and remixes pass: they carry no disqualifying tag by design (see the module header).
 */
export function isAcceptableSubstitute(originalTitle: string, candidateTitle: string): boolean {
	const candidate = variantTagsOf(candidateTitle);
	if (candidate.size === 0) return true; // nothing to object to
	const original = variantTagsOf(originalTitle);
	for (const tag of candidate) if (!original.has(tag)) return false;
	return true;
}

// --- OFFICIAL SONG PRIORITIZER (quick-261020-off1) -------------------------------------------
// A track is OFFICIAL if its title carries NO variant markers — no (伴奏), (Live), (DJ版),
// (Remix), (Cover), etc. Uses dedupe's broader variantTag (live/acoustic/demo/cover/remix/
// instrumental/remaster) rather than this module's narrow instrumental/cover-only detector,
// because "official" means the plain original recording, not just "not karaoke".
//
// This is a HARD preference, not a score penalty: when an official version exists among the
// candidates, it wins outright. Variants are only used when NO official version is available.
// The query is respected — if the user explicitly asked for a variant (e.g. searched
// "告白氣球 伴奏"), the partition is bypassed and every candidate stays eligible.

/**
 * Does this text contain a variant marker ANYWHERE (not just bracketed)?
 * Used for the query-bypass check: a user typing "告白氣球 DJ版" wants that variant.
 * Covers the same ground as dedupe's variantTag plus bare keywords (DJ, 伴奏, …)
 * that variantTag's bracket-only scan would miss.
 */
// quick-261102-t7i: the variant marker list is score-match's VARIANT_KEYWORDS (one list).

/** One keyword against a title: CJK keywords match as substrings, Latin as whole words. */
function matchesKeyword(text: string, kw: string): boolean {
	const t = (text || '').toLowerCase();
	if (/[\u4e00-\u9fff]/.test(kw)) return t.includes(kw.toLowerCase());
	return new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text || '');
}

function hasVariantKeyword(text: string): boolean {
	// quick-261020-dj1: DJ versions with a DJ name between DJ and 版 — e.g. "DJ 阿樂版",
	// "DJ LUX 煜版", "1.1x DJ 慢搖版" — slip past the literal 'DJ版' substring. Match DJ
	// followed by optional spaces/CJK chars then 版.
	if (/dj[\s\w\u4e00-\u9fff]*版/i.test(text || '')) return true;
	return VARIANT_KEYWORDS.some((kw) => matchesKeyword(text, kw));
}

/**
 * The raw text of a title's FIRST bracketed qualifier — `偏偏喜歡你（48秒鈴聲版）` → `48秒鈴聲版`,
 * `Song (Live)` → `Live` — or null when the title carries no (non-empty) bracketed segment.
 * Same bracket family dedupe's key() strips. quick-261101-ring1: this is the primitive behind
 * Hector's parenthetical rule — a bracketed qualifier IS a version claim, whether or not its
 * text matches a known marker list (the incident's 鈴聲版 / 環繞版 / 中四版 matched none).
 */
export function bracketQualifier(title: string): string | null {
	const m = (title || '').match(/[（(【\[]([^)）\]】]*)[)）\]】]/);
	const text = (m?.[1] ?? '').trim();
	return text ? text : null;
}

/** Qualifier equality key: script-folded, lowercased, punctuation/space-stripped. */
function normQualifier(q: string): string {
	return foldScript(q)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Is this title the OFFICIAL (plain original) version? True when it carries no variant
 * markers — no bracketed qualifier of ANY kind (quick-261101-ring1: previously only a
 * RECOGNIZED variantTag key disqualified, so `偏偏喜歡你(48秒鈴聲版)` — whose bracket text
 * matches no known tag — counted as official), and no bare variant keyword.
 */
export function isOfficialTitle(title: string): boolean {
	if (variantTag(title)) return false;
	return !hasVariantKeyword(title);
}

/**
 * Split candidates into official (plain original) vs variants.
 *
 * quick-261101-ring1 — the partition is TARGET-AWARE (Hector's parenthetical rule):
 * - Target carries a bracketed qualifier (`偏偏喜歡你（Live）` — the user deliberately picked
 *   that version): candidates carrying the SAME qualifier are official FIRST, plain titles
 *   are official second (an untagged take is still an acceptable stand-in), and every other
 *   rendition is a variant. The chosen version is never demoted below a different one.
 * - Target carries a bare variant keyword but no brackets (a typed search like
 *   `給我一首歌的時間 伴奏`): the user wants that variant — return everything as official
 *   (no filtering), as before.
 * - Target is plain: only plain titles are official; ANY bracketed or keyword-marked
 *   candidate is a variant, used only when no official matches.
 */
export function partitionOfficial<T extends { title: string }>(
	candidates: T[],
	queryTitle: string
): { official: T[]; variants: T[] } {
	const q = bracketQualifier(queryTitle);
	if (q !== null) {
		const want = normQualifier(q);
		const matching: T[] = [];
		const clean: T[] = [];
		const variants: T[] = [];
		for (const c of candidates) {
			const cq = bracketQualifier(c.title);
			if (cq !== null && normQualifier(cq) === want) matching.push(c);
			else if (isOfficialTitle(c.title)) clean.push(c);
			else variants.push(c);
		}
		return { official: [...matching, ...clean], variants };
	}
	// User asked for a variant (bare keyword) — do not interfere.
	if (hasVariantKeyword(queryTitle)) return { official: candidates, variants: [] };
	const official: T[] = [];
	const variants: T[] = [];
	for (const c of candidates) {
		if (isOfficialTitle(c.title)) official.push(c);
		else variants.push(c);
	}
	return { official, variants };
}

// --- DURATION PLAUSIBILITY (quick-261101-ring1) -------------------------------------------------
// The second half of the incident: even had the ringtone been classified a variant, NOTHING in
// the findOfficial path ever looked at DURATION — a 48s clip and a 212s studio cut were equals.
// These helpers give the prioritizers a plausibility axis. Unknown duration (undefined / 0 —
// the source did not report one) is NEVER implausible: a source that omits durations must not
// be falsely demoted (the same D-03 philosophy as score-match's previewPenalty).

/** A track strictly SHORTER than this is a clip （試聽/鈴聲/片段）, never a full song. */
export const SHORT_TRACK_SEC = 60;

/**
 * The expected full length for a candidate pool: the MEDIAN of the durations the pool
 * actually reports (robust to the pool's own outliers — a pool of mostly-studio rows with
 * one ringtone medians to the studio length). undefined when the pool reports nothing.
 */
export function poolExpectedDuration(
	candidates: readonly { duration?: number }[]
): number | undefined {
	const known = candidates
		.map((c) => c.duration)
		.filter((d): d is number => typeof d === 'number' && isFinite(d) && d > 0)
		.sort((a, b) => a - b);
	if (known.length === 0) return undefined;
	const mid = Math.floor(known.length / 2);
	return known.length % 2 === 1 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
}

/**
 * Is this candidate implausibly short for the song? True when its KNOWN duration is either
 * under SHORT_TRACK_SEC outright, or under HALF the expected length (the target track's own
 * duration when the caller has one, else the pool median the caller computed).
 */
export function isImplausiblyShort(
	c: { duration?: number },
	expectedSec?: number
): boolean {
	const d = c.duration;
	if (typeof d !== 'number' || !isFinite(d) || d <= 0) return false;
	if (d < SHORT_TRACK_SEC) return true;
	return expectedSec !== undefined && expectedSec > 0 && d < expectedSec * 0.5;
}

// --- PREVIEW-LENGTH (Hector 2026-11-19) ---------------------------------------------------------
// The direct-play hole the plausibility axis above never covered: it only ever runs INSIDE an
// arbitration (fallback race, auto-pick, dedupe collapse). A concrete track the user tapped —
// or a share link's pinned uid — is resolved and played VERBATIM, so nothing ever asked whether
// the file behind it is the whole song. QQ's paywall preview is the incident: mid 003b8p2c1T2JPF
// （永不失聯的愛 · 周興哲） reports `song_play_time: 60` and serves a 737,512-byte file — exactly
// 60.0s at its 98kbps tier — while the full 258s studio cut sits on kuwo AND on QQ itself under
// a different mid. Two properties of that shape drive the rules below:
//   - EXACTLY 60s escapes `isImplausiblyShort`'s absolute clause (`60 < 60` is false), so a
//     boundary-safe band is needed: previews cluster at ≤65s (60s nominal + container slop).
//   - The band alone is only a SUSPECT trigger, never a verdict — a genuine 60s interlude sits
//     in the same band. The verdict (`isPreviewLength`) requires the song's expected full
//     length, from the longest duration the acceptable pool reports (preview-rescue.ts).

/** A KNOWN duration at or under this sits in the preview band （試聽 cluster: 60s nominal). */
export const PREVIEW_BAND_SEC = 65;

/**
 * Is this track a preview SUSPECT — worth one cross-source lookup before it may play?
 * True only for a KNOWN duration inside the preview band. Unknown duration is never a
 * suspect (D-03 neutrality: a source that omits durations must not pay a lookup per play),
 * and anything past the band is a full-length file by the only evidence available.
 */
export function isPreviewSuspect(c: { duration?: number }): boolean {
	const d = c.duration;
	return typeof d === 'number' && isFinite(d) && d > 0 && d <= PREVIEW_BAND_SEC;
}

// --- JUNK-TITLE GATE (Hector 2026-11-19) ---------------------------------------------------------
// The preview rule generalised to the whole junk class, per Hector's no-leak doctrine:
// 「user can search for trash they like if they want to; OpenMusic just makes sure things are
// 整理好」 — junk stays in the catalog, classified and findable, but a SIMPLE CLICK must never
// play it when the canonical version exists. Duration is only one junk signal; the other is
// the title itself. These markers are the junk drawer of the ONE shared VARIANT_KEYWORDS
// list (score-match): carrier ringtones （鈴聲/彩鈴）, excerpt + preview cuts （片段/試聽）,
// pseudo-surround re-encodes （環繞）, edits （剪輯）, pitch-shifted cuts （升調/降調） and the
// sped/slowed family （加速版/減速版/慢速版/sped up/slowed/nightcore). Legitimate renditions
// (Live, Acoustic, Remix, Demo, Remaster, 純音樂…) are deliberately NOT in this gate: they
// are versions a user may mean, already demoted below the studio cut by the official/variant
// partition — the click gate is only for degraded cuts that impersonate the song itself.
// Like the preview band, a marker is a SUSPECT trigger, never a verdict: preview-rescue only
// substitutes when a canonical full version is confirmed in the pool, so a false positive
// costs one search and the tapped row still plays.
const JUNK_TITLE_MARKERS: readonly string[] = [
	'鈴聲',
	'铃声',
	'彩鈴',
	'彩铃',
	'ringtone',
	'片段',
	'試聽',
	'试听',
	'環繞',
	'环绕',
	'剪輯',
	'剪辑',
	'升調',
	'升调',
	'降調',
	'降调',
	'加速版',
	'減速版',
	'减速版',
	'慢速版',
	'sped up',
	'speed up',
	'slowed',
	'nightcore'
];

/** Does this title advertise a junk-drawer cut (ringtone / fragment / preview / edit)? */
export function isJunkTitle(title: string): boolean {
	return JUNK_TITLE_MARKERS.some((kw) => matchesKeyword(title, kw));
}

/**
 * The title with its junk dressing stripped — bracketed qualifiers removed wholesale and
 * bare junk markers cut — for searching the CANONICAL pool ("晴天（48秒鈴聲版）" → "晴天",
 * "晴天 加速版" → "晴天"). Falls back to the original title when stripping would empty it.
 * Only ever a search query: identity is still judged against the un-stripped track.
 */
export function junklessTitle(title: string): string {
	let t = (title || '').replace(/[（(【\[][^)）\]】]*[)）\]】]/g, ' ');
	for (const kw of JUNK_TITLE_MARKERS) {
		if (/[\u4e00-\u9fff]/.test(kw)) t = t.split(kw).join(' ');
	}
	t = t.replace(/\b(sped up|speed up|slowed|nightcore|ringtone)\b/gi, ' ');
	t = t.replace(/\s+/g, ' ').trim();
	return t || (title || '').trim();
}

/**
 * Is this track PREVIEW-LENGTH for a song whose full length is `expectedSec` (the longest
 * duration the acceptable same-song pool reports)? The verdict needs BOTH sides: without a
 * known expectation there is nothing to be short AGAINST, so an unknown/short pool can never
 * convict — which is exactly what keeps a genuine ~1-minute song (every source agrees it is
 * ~1 minute) playing as-is. True when the track is implausibly short in the existing sense
 * (<60s, or <50% of expected), or runs ≤65% of the expected length, or sits in the preview
 * band while the song is known to run at least 30s longer.
 */
export function isPreviewLength(
	c: { duration?: number },
	expectedSec?: number
): boolean {
	const d = c.duration;
	if (typeof d !== 'number' || !isFinite(d) || d <= 0) return false;
	if (expectedSec === undefined || !isFinite(expectedSec) || expectedSec <= 0) return false;
	// The song ITSELF is band-length: every source agrees it runs ~1 minute, so nothing
	// can be a preview OF it. This guard is what keeps isImplausiblyShort's bare `<60`
	// clause from convicting a genuine 58s interlude against its own 62s pool.
	if (expectedSec <= PREVIEW_BAND_SEC) return false;
	if (isImplausiblyShort(c, expectedSec)) return true;
	if (d <= expectedSec * 0.65) return true;
	return d <= PREVIEW_BAND_SEC && expectedSec >= d + 30;
}

/**
 * The song's KNOWN FULL LENGTH for ranking (Hector 2026-11-19): the longest duration the
 * pool's OFFICIAL rows report. Official-only on purpose — a variant's length (a 12-minute
 * DJ extended mix, a long live take) must not become the yardstick the studio cut is
 * measured against; the plain original defines how long the song is. undefined when no
 * official row reports a duration (nothing can be judged preview-length against silence).
 */
export function poolFullDuration(
	candidates: readonly { title?: string; duration?: number }[],
	queryTitle: string
): number | undefined {
	const { official } = partitionOfficial(
		candidates.map((c) => ({ title: c.title ?? '', duration: c.duration })),
		queryTitle
	);
	let max: number | undefined;
	for (const c of official) {
		const d = c.duration;
		if (typeof d === 'number' && isFinite(d) && d > 0 && (max === undefined || d > max)) {
			max = d;
		}
	}
	return max;
}

/**
 * THE shared short judgement for ranking (quick-261101-ring1 + Hector 2026-11-19): a
 * candidate is SHORT for its pool when it is implausibly short against the pool
 * expectation (median / caller-supplied) OR preview-length against the pool's known full
 * length. The preview clause is the down-weight doctrine: a 試聽 version is never deleted
 * and never blocked, but it sorts BELOW every full version in every ranking this module
 * feeds — dedupe's canonical slot, search order, the VersionPicker, auto-pick and the
 * fallback race all read poolsInOrder / candidateTier, so the penalty lives exactly here
 * and nowhere else. The median alone could not do this: a pool of [60s preview, 62s, 258s]
 * medians to 62, under which the 60s preview judged "plausible" and could win its slot on
 * quality — against the longest (258) it is unmistakably a preview.
 */
function isShortInPool(
	c: { duration?: number },
	expected: number | undefined,
	full: number | undefined
): boolean {
	return isImplausiblyShort(c, expected) || isPreviewLength(c, full);
}

/**
 * Pool order behind rankPool (quick-261101-ring1):
 * official-plausible → variant-plausible → official-short → variant-short.
 * A full-length VARIANT outranks a SHORT official-titled clip: the clip is not the song at
 * any title, while the variant at least is. Short candidates remain reachable — they are
 * the last resort, never the first pick.
 */
function poolsInOrder<T extends { title: string; duration?: number }>(
	candidates: T[],
	queryTitle: string,
	expectedSec?: number
): T[][] {
	const { official, variants } = partitionOfficial(candidates, queryTitle);
	const expected = expectedSec ?? poolExpectedDuration(candidates);
	const full = poolFullDuration(candidates, queryTitle);
	const plausible = (pool: T[]) => pool.filter((c) => !isShortInPool(c, expected, full));
	const short = (pool: T[]) => pool.filter((c) => isShortInPool(c, expected, full));
	return [plausible(official), plausible(variants), short(official), short(variants)];
}

/**
 * Playback-candidate tier for cross-source arbitration (quick-261101-ring1): 0 when the
 * candidate is an official, plausible-length pick for the target title; 1 when it is a
 * variant and/or short for the pool (implausibly short, or preview-length against the
 * pool's known full length — Hector 2026-11-19). fallback's race uses it so a fast
 * degraded hit cannot beat a slower clean one merely by arriving first, and dedupeBest
 * uses it so a preview can never take a song's canonical slot from a full version.
 */
export function candidateTier(
	candidate: { title: string; duration?: number },
	queryTitle: string,
	pool: readonly { title?: string; duration?: number }[],
	expectedSec?: number
): 0 | 1 {
	const { official } = partitionOfficial([candidate], queryTitle);
	if (official.length === 0) return 1;
	const expected = expectedSec ?? poolExpectedDuration(pool);
	const full = poolFullDuration(pool, queryTitle);
	return isShortInPool(candidate, expected, full) ? 1 : 0;
}

/**
 * quick-261102-t7i (DECISIONS.md §4) — THE pool ranker. Pools in priority order
 * (official-plausible → variant-plausible → official-short → variant-short — see poolsInOrder),
 * and within each pool by `opts.score` descending (stable: input order breaks ties; without a
 * score, input order alone). Search results, auto-pick (discovery, the fallback/name-stub walk,
 * JBSou, edge resolve) and the VersionPicker all consume this one order and may only truncate
 * it — replacing rankAcceptable / findOfficial / pickOfficial, three views of the same pools that
 * disagreed on within-pool order.
 *
 * quick-261102-exh1 (kept): the automatic chains walk this ranked list, resolving until one
 * candidate yields a URL — a single failed resolve never burns a source whose #2 row would play.
 */
export function rankPool<T extends { title: string; duration?: number }>(
	candidates: T[],
	queryTitle: string,
	opts?: { expectedSec?: number; score?: (c: T) => number }
): T[] {
	const pools = poolsInOrder(candidates, queryTitle, opts?.expectedSec);
	const score = opts?.score;
	if (!score) return pools.flat();
	return pools.flatMap((pool) =>
		pool
			.map((c, i) => ({ c, i, s: score(c) }))
			.sort((x, y) => y.s - x.s || x.i - y.i)
			.map((x) => x.c)
	);
}

// --- ARTIST-IDENTITY GATE (quick-261102-cov1) --------------------------------------------------
// The third substitution question, beside sameSongKey ("same song?") and
// isAcceptableSubstitute ("same KIND of recording?"): "same ARTIST?" — asked by every
// AUTOMATIC adoption seam (fallback.ts tryOneSource, catalog.ts resolveNameStub,
// discovery.ts resolveStub) before a candidate may be played under the tapped track's
// identity.
//
// WHY (user report 2026-11-02): he tapped 《說了再見》·周杰倫 on Your Radio and the app
// played a 同人 cover by 阿傑 (netease 3388515483). The netease pool for that query is
// covers-only (live-probed: its first 10 rows are all fan covers, the official is not
// among them), and resolveStub's selection had NO artist check anywhere — scoreMatch
// only RANKS (every plain-titled cover earns the same title-only credit), and
// preferEligible's weak fallback (quick-261020-wrong1) verified the TITLE overlap but
// never the artist. A different artist is worse than a variant rendition: a variant is
// at least the same act, a cover by someone else is a different recording entirely.
// Hector's rule: on click, ALWAYS the original song by the original artist — when no
// source can serve the original artist, the song is unplayable-as-original and the
// caller's skip path runs; a cover is NEVER silently substituted.

/**
 * THE one-line policy flip. While false (the shipped behaviour), a candidate credited
 * to a clearly DIFFERENT artist is never auto-accepted by any automatic chain. Flip to
 * true to restore cover-as-last-resort substitution (different-artist candidates become
 * acceptable again, ranked by the existing official/variant machinery) — no other code
 * changes needed; every seam reads this constant through isAutoAcceptableArtist.
 */
export const ALLOW_COVER_AS_AUTO_SUBSTITUTE = false;

/**
 * May an automatic chain adopt `candidateArtist`'s row for a target credited to
 * `targetArtist`? True when:
 *   - the target carries no credited artist (title-only stub — nothing to enforce), or
 *   - the candidate's artist is blank/unknown (no identity to check — the title and
 *     variant gates still apply in full), or
 *   - the two credits name the same act under sameArtistCredit (canonical equality,
 *     alias subsets, or a shared duet/featuring segment).
 * A clearly different credited artist （阿傑 for a 周杰倫 target) is false.
 */
export function isAutoAcceptableArtist(targetArtist: string, candidateArtist: string): boolean {
	if (ALLOW_COVER_AS_AUTO_SUBSTITUTE) return true;
	const t = (targetArtist ?? '').trim();
	if (!t) return true;
	const c = (candidateArtist ?? '').trim();
	if (!c) return true;
	return sameArtistCredit(t, c);
}

type Named = { artist: string; title: string };

/**
 * quick-261102-sy0 (DECISIONS.md §3) — THE auto-play acceptance predicate: may `cand` be
 * played automatically AS `target` (the song the user tapped / the queue asked for)? Every
 * automatic path consumes this one function — the cross-source fallback, the name-stub walk,
 * discovery.resolveStub, the JBSou pipe and the edge resolve — so none keeps its own copy.
 *   1. same song: sameSongStrings (script-folded identity + artist alias) OR sameSongByCredit
 *      (same title, a duet/featuring credit that CONTAINS the target artist as a whole segment);
 *   2. same kind of recording: isAcceptableSubstitute (never an instrumental/karaoke/cover
 *      the target did not ask for);
 *   3. same artist: isAutoAcceptableArtist (a different credited act is a cover — never
 *      substituted while ALLOW_COVER_AS_AUTO_SUBSTITUTE is false).
 * Junk variants / short clips are NOT rejected here — rankAutoCandidates demotes them below
 * every clean full version (product call 2026-11-03: a junk-only pool still plays).
 */
export function isAutoAcceptable(target: Named, cand: Named): boolean {
	return (
		(sameSongStrings(cand.artist, cand.title, target.artist, target.title) || sameSongByCredit(cand, target)) &&
		isAcceptableSubstitute(target.title, cand.title) &&
		isAutoAcceptableArtist(target.artist, cand.artist)
	);
}

/** quick-261102-sy0: a pool's auto-acceptable rows in rankPool order (quick-261102-t7i: tiers,
 *  then scoreMatch against the target). The one ranked view every automatic path walks. */
export function rankAutoCandidates<T extends Named & { duration?: number }>(
	pool: T[],
	target: Named,
	opts?: { expectedSec?: number }
): T[] {
	return rankPool(
		pool.filter((c) => isAutoAcceptable(target, c)),
		target.title,
		{ expectedSec: opts?.expectedSec, score: (c) => scoreMatch(target, c) }
	);
}

/**
 * 43-D-08 — "PLAY it but say so". Does an AUTO-picked substitute notably differ from the song the
 * user asked for? Never rejects anything: it only decides whether the pick deserves the "may not be
 * the original" notice. True when candidateTier calls it a variant / implausibly short, or when both
 * durations are known and differ by more than max(30 s, 15 % of the TARGET). Unknown duration is
 * neutral. Threshold is A5 (assumed) — tune it here only.
 */
export function isNotableVersionMismatch(
	candidate: { title: string; duration?: number },
	target: { title: string; duration?: number }
): boolean {
	if (candidateTier(candidate, target.title, [], target.duration) === 1) return true;
	const a = candidate.duration;
	const b = target.duration;
	if (!a || !b) return false;
	return Math.abs(a - b) > Math.max(30, 0.15 * b);
}

// quick-261102-tdc (DECISIONS.md §6): bare trailing words a cover candidate may carry without
// being a different release — Deezer literally titles a pressing "Without you explicit", and a
// clean/remastered/live/acoustic pressing shares the song's art.
const COVER_TITLE_TAIL = ['explicit', 'clean', 'remastered', 'remaster', 'live', 'acoustic'];

function coverTitleKeys(title: string): string[] {
	return titleKeys(title).map((k) => {
		for (const w of COVER_TITLE_TAIL) while (k.length > w.length && k.endsWith(w)) k = k.slice(0, -w.length);
		return k;
	});
}

/**
 * quick-261102-tdc (DECISIONS.md §6) — THE cover identity gate: may a cover candidate whose own
 * metadata reads (cand.artist, cand.title) be shown as `song`'s cover? Every cover rung — the
 * in-app race (iTunes / Deezer / CN / QQ / YTM), the artist and album heroes and /api/og — asks
 * this one question, so a miss means the branded/gradient fallback, never another song's cover.
 *   - artist: sameArtistCredit — whole credited segment or script-run alias (高爾宣 OSN ≡ Osn ≡
 *     高爾宣), never substring (product call 2026-11-03: was ≥2-char containment in /api/og);
 *   - title: the identity title key (script-folded, brackets dropped, either half of a bilingual
 *     title) after stripping a bare trailing explicit/clean/remaster/live/acoustic word.
 * A field the candidate does not carry cannot convict it; a candidate carrying neither is
 * accepted (a synthetic body, not a real catalog row — see og-cover's gate history).
 */
export function isCoverOf(song: Named, cand: { artist?: string | null; title?: string | null }): boolean {
	const ca = (cand.artist ?? '').trim();
	const ct = (cand.title ?? '').trim();
	if (!ca && !ct) return true;
	if (ca && song.artist.trim() && !sameArtistCredit(song.artist, ca)) return false;
	if (ct && song.title.trim()) {
		const want = coverTitleKeys(song.title);
		if (!coverTitleKeys(ct).some((k) => want.includes(k))) return false;
	}
	return true;
}
