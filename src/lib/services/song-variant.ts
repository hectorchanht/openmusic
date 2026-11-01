// SUBSTITUTION VARIANT GUARD — "is this candidate an acceptable stand-in for the song that failed?"
// OFFICIAL SONG PRIORITIZER lives at the bottom (quick-261020-off1).

import { variantTag, foldScript } from '$lib/services/dedupe';
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
const VARIANT_KEYWORDS = [
	// CJK
	'伴奏', '伴唱', '無人聲', '无人声', '去人聲', '去人声', '消音', '卡拉',
	'翻唱', '現場', '现场', '演唱會', '演唱会', '純音樂', '纯音乐',
	'DJ版', 'dj版', '加速版', '減速版', '减速版', '重製', '重制', '重錄', '重录',
	// quick-261101-ring1: the junk-drawer markers the 2026-11-01 incident exposed — NONE of these
	// were in any marker list, so `偏偏喜歡你(48秒鈴聲版)` classified as an OFFICIAL title and a
	// 48-second ringtone was auto-played over the studio version. Ringtones / carrier clips
	// （鈴聲/彩鈴）, excerpt + preview cuts （片段/試聽）, pseudo-surround re-encodes （環繞）,
	// edits （剪輯）, pitch-shifted cuts （升調/降調） and bare 混音 are rendition markers wherever
	// they appear in a title, bracketed or not.
	'鈴聲', '铃声', '彩鈴', '彩铃', '片段', '試聽', '试听', '環繞', '环绕',
	'剪輯', '剪辑', '混音', '升調', '升调', '降調', '降调',
	// Latin (word-boundary)
	'instrumental', 'karaoke', 'ktv', 'offvocal', 'off vocal', 'backing track',
	'minus one', 'cover', 'live', 'acoustic', 'unplugged', 'remix', 'remaster',
	'demo', 'dj mix', 'nightcore', 'sped up', 'slowed', 'ringtone'
];

function hasVariantKeyword(text: string): boolean {
	const t = (text || '').toLowerCase();
	// quick-261020-dj1: DJ versions with a DJ name between DJ and 版 — e.g. "DJ 阿樂版",
	// "DJ LUX 煜版", "1.1x DJ 慢搖版" — slip past the literal 'DJ版' substring. Match DJ
	// followed by optional spaces/CJK chars then 版.
	if (/dj[\s\w\u4e00-\u9fff]*版/i.test(text || '')) return true;
	return VARIANT_KEYWORDS.some((kw) => {
		// CJK keywords: substring match. Latin: word-boundary match.
		if (/[\u4e00-\u9fff]/.test(kw)) return t.includes(kw.toLowerCase());
		return new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text || '');
	});
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

/**
 * Pool order shared by findOfficial / pickOfficial (quick-261101-ring1):
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
	const plausible = (pool: T[]) => pool.filter((c) => !isImplausiblyShort(c, expected));
	const short = (pool: T[]) => pool.filter((c) => isImplausiblyShort(c, expected));
	return [plausible(official), plausible(variants), short(official), short(variants)];
}

/**
 * Playback-candidate tier for cross-source arbitration (quick-261101-ring1): 0 when the
 * candidate is an official, plausible-length pick for the target title; 1 when it is a
 * variant and/or implausibly short. fallback's race uses it so a fast degraded hit cannot
 * beat a slower clean one merely by arriving first.
 */
export function candidateTier(
	candidate: { title: string; duration?: number },
	queryTitle: string,
	pool: readonly { duration?: number }[],
	expectedSec?: number
): 0 | 1 {
	const { official } = partitionOfficial([candidate], queryTitle);
	if (official.length === 0) return 1;
	const expected = expectedSec ?? poolExpectedDuration(pool);
	return isImplausiblyShort(candidate, expected) ? 1 : 0;
}

/**
 * Find the first candidate matching `pred`, walking the pools in priority order
 * (official-plausible → variant-plausible → official-short → variant-short — see
 * poolsInOrder). `opts.expectedSec` is the target track's own known duration when the
 * caller has one; otherwise the pool median stands in.
 */
export function findOfficial<T extends { title: string; duration?: number }>(
	candidates: T[],
	queryTitle: string,
	pred: (c: T) => boolean,
	opts?: { expectedSec?: number }
): T | undefined {
	for (const pool of poolsInOrder(candidates, queryTitle, opts?.expectedSec)) {
		const hit = pool.find(pred);
		if (hit) return hit;
	}
	return undefined;
}

/**
 * Pick the highest-scoring candidate via `scoreFn`, from the first non-empty pool in
 * the same priority order findOfficial walks. Within the pool, the standard stable-max
 * applies (first wins ties).
 */
export function pickOfficial<T extends { title: string; duration?: number }>(
	candidates: T[],
	query: { artist: string; title: string },
	scoreFn: (q: { artist: string; title: string }, c: T) => number,
	opts?: { expectedSec?: number }
): T | null {
	const pools = poolsInOrder(candidates, query.title, opts?.expectedSec);
	const pool = pools.find((p) => p.length > 0);
	if (!pool) return null;
	let best = pool[0];
	let bestScore = scoreFn(query, best);
	for (let i = 1; i < pool.length; i++) {
		const s = scoreFn(query, pool[i]);
		if (s > bestScore) {
			best = pool[i];
			bestScore = s;
		}
	}
	return best;
}
