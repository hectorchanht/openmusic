// Lazy client-side Simplified→Traditional (zh-Hans → zh-Hant) converter + CJK-source
// predicate. This is the OFFLINE PRIMARY path for the translate choke point (Plan 03
// wires it into `translateLinesEx`): zh-Hans→zh-Hant is a deterministic char/phrase
// conversion, so it needs no API, never rate-limits, and works offline / on lockscreen.
//
// Decision refs:
//   D-01  Use TongWenTang (`tongwen-core` + `tongwen-dict`), s2t char + phrase dicts ONLY.
//         Phrase-level quality disambiguates 头发→頭髮 and 里→裡/裏 (char-only libs can't).
//   D-03  Run client-side; pull the ~72 KB dict via a DYNAMIC import() so it stays out of
//         the initial bundle and is fetched at most once (memoized).
//   D-04  Offline-eligibility rides the kana/hangul-FIRST classifier in `$lib/i18n/detect`
//         so Japanese-kanji lines (kana present) are NOT s2t-converted — they fall through
//         to the API cascade instead of being wrongly Traditionalized.
//
// PURE .ts (NOT .svelte.ts): no runes, no browser globals — node-testable under the single
// Vitest server project (the dict loads via dynamic import, which Vitest resolves natively).

import { detectLang } from '$lib/i18n/detect';

// A ready-to-use single-line converter. We memoize THIS (not the raw tongwen Converter) so
// `LangType` stays captured inside the closure and callers never touch tongwen types.
type ConvertLine = (line: string) => string;

// Module-scoped memo: a single dynamic-import + build reused across every call, so the
// ~72 KB s2t dict (D-01/D-03) is fetched at most once for the app's lifetime.
let convertLinePromise: Promise<ConvertLine> | null = null;

// Lazily import ONLY the s2t (Simplified→Traditional) char + phrase dictionaries plus the
// tongwen engine, then build the phrase-level converter. The tongwen import lives ONLY inside
// these import() calls — a static/top-level import would pull the dict into the initial chunk
// and defeat D-03. t2s is intentionally left empty (Traditional→Simplified is out of scope —
// Deferred — and skipping its tables keeps the lazy chunk near the measured ~72 KB).
async function buildConvertLine(): Promise<ConvertLine> {
	const [core, charMod, phraseMod] = await Promise.all([
		import('tongwen-core'),
		import('tongwen-dict/dist/s2t-char.min.json'),
		import('tongwen-dict/dist/s2t-phrase.min.json')
	]);
	const { createConverterMap, LangType } = core;
	// createConverterMap merges the array into length-grouped single/multi maps, so char (len 1)
	// and phrase (len ≥ 2) entries never collide — order is irrelevant.
	const converter = createConverterMap({
		s2t: [charMod.default, phraseMod.default],
		t2s: []
	});
	// `.phrase()` applies the multi-char phrase map AND the single-char map, so it converts both
	// 头发→頭髮 (phrase) and 简体→簡體 (per-char) in one pass (per convertPhrase in tongwen-core).
	return (line: string) => converter.phrase(LangType.s2t, line);
}

function loadConvertLine(): Promise<ConvertLine> {
	if (!convertLinePromise) {
		convertLinePromise = buildConvertLine().catch((err) => {
			// Do NOT cache a rejected build — null it so a later call can retry the lazy import
			// (a transient chunk-load failure should not permanently disable offline conversion).
			convertLinePromise = null;
			throw err;
		});
	}
	return convertLinePromise;
}

/**
 * D-04 offline-eligibility predicate: is this line safe to convert offline (i.e. Chinese)?
 *
 * Delegates to `detectLang`, which classifies kana→'ja' and hangul→'ko' BEFORE Han — so any
 * line containing kana/hangul returns false and is left for the API cascade (the Japanese-kanji
 * guard). Returns true ONLY for detected Chinese ('zh-Hant' | 'zh-Hans'); empty / whitespace /
 * pure-Latin lines detect as 'en' and return false. Pure — reuses the shared Unicode ranges in
 * `$lib/i18n/detect`; does NOT redefine kana/hangul/Han regexes.
 */
export function isChineseLine(text: string): boolean {
	const lang = detectLang(text);
	return lang === 'zh-Hant' || lang === 'zh-Hans';
}

/**
 * Positionally-aligned batch Simplified→Traditional convert (out.length === lines.length).
 *
 * On the first call the s2t dict is dynamically imported + built once, then memoized. Each line
 * is converted with the phrase-level converter (D-01); blank lines pass through untouched so
 * alignment and empty slots are preserved (['', '中国'] → ['', '中國']). Already-Traditional
 * input is a no-op (s2t leaves 台灣 as 台灣).
 *
 * Never-throw boundary: any import/build/convert failure degrades to IDENTITY (the input lines
 * returned unchanged) rather than throwing into the caller — a converter fault becomes "not
 * converted", never a broken render or a rejected promise up the translate choke point.
 */
export async function s2tConvertLines(lines: string[]): Promise<string[]> {
	if (lines.length === 0) return [];
	try {
		const convert = await loadConvertLine();
		return lines.map((line) => (line ? convert(line) : line));
	} catch {
		return lines.slice();
	}
}
