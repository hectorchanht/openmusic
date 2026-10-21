// SUBSTITUTION VARIANT GUARD — "is this candidate an acceptable stand-in for the song that failed?"
// OFFICIAL SONG PRIORITIZER lives at the bottom (quick-261020-off1).

import { variantTag } from '$lib/services/dedupe';
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
	// Latin (word-boundary)
	'instrumental', 'karaoke', 'ktv', 'offvocal', 'off vocal', 'backing track',
	'minus one', 'cover', 'live', 'acoustic', 'unplugged', 'remix', 'remaster',
	'demo', 'dj mix', 'nightcore', 'sped up', 'slowed'
];

function hasVariantKeyword(text: string): boolean {
	const t = (text || '').toLowerCase();
	return VARIANT_KEYWORDS.some((kw) => {
		// CJK keywords: substring match. Latin: word-boundary match.
		if (/[\u4e00-\u9fff]/.test(kw)) return t.includes(kw.toLowerCase());
		return new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text || '');
	});
}

/**
 * Is this title the OFFICIAL (plain original) version? True when it carries no variant
 * markers — neither dedupe's bracketed variantTag nor a bare variant keyword.
 */
export function isOfficialTitle(title: string): boolean {
	if (variantTag(title)?.key) return false;
	return !hasVariantKeyword(title);
}

/**
 * Split candidates into official (no variant markers) vs variants.
 * If the query title itself carries a variant marker, the user wants that variant —
 * return everything as official (no filtering).
 */
export function partitionOfficial<T extends { title: string }>(
	candidates: T[],
	queryTitle: string
): { official: T[]; variants: T[] } {
	// User asked for a variant — do not interfere.
	if (hasVariantKeyword(queryTitle)) return { official: candidates, variants: [] };
	const official: T[] = [];
	const variants: T[] = [];
	for (const c of candidates) {
		if (isOfficialTitle(c.title)) official.push(c);
		else variants.push(c);
	}
	return { official, variants };
}

/**
 * Find the first candidate matching `pred`, preferring official versions.
 * Tries the official pool first; only falls back to variants when no official matches.
 */
export function findOfficial<T extends { title: string }>(
	candidates: T[],
	queryTitle: string,
	pred: (c: T) => boolean
): T | undefined {
	const { official, variants } = partitionOfficial(candidates, queryTitle);
	return official.find(pred) ?? variants.find(pred);
}

/**
 * Pick the highest-scoring candidate via `scoreFn`, preferring official versions.
 * Scores only the official pool when it is non-empty; the variant pool is scored
 * only when no official version exists. Within each pool, the standard stable-max
 * applies (first wins ties).
 */
export function pickOfficial<T extends { title: string }>(
	candidates: T[],
	query: { artist: string; title: string },
	scoreFn: (q: { artist: string; title: string }, c: T) => number
): T | null {
	const { official, variants } = partitionOfficial(candidates, query.title);
	const pool = official.length > 0 ? official : variants;
	if (pool.length === 0) return null;
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
