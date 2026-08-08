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

// quick-260712-et3: a SYNCHRONOUS handle to the built converter, published once the lazy
// build above resolves. Latency-sensitive callers (the display-name resolver) read this to
// convert zh-Hans→zh-Hant on the FIRST render with zero flash — instead of returning
// Simplified and flipping to Traditional after the async debounce+queue. Null until warm.
let convertLineSync: ConvertLine | null = null;

// Lazily import ONLY the s2t (Simplified→Traditional) char + phrase dictionaries plus the
// tongwen engine, then build the phrase-level converter. The tongwen import lives ONLY inside
// these import() calls — a static/top-level import would pull the dict into the initial chunk
// and defeat D-03. The `t2s: []` below is NOT a stub — it keeps this map s2t-ONLY so an s2t
// caller never pays for the t2s tables (see buildT2sConvertLine for the mirror-image build).
//
// quick-250711-zh: import the `converter` + `dictionary` SUBMODULES, NOT the top-level
// `tongwen-core` index. The index does `export * from './walker'`, and the walker eval-time
// references `NodeFilter` (a DOM global) for DOM-tree conversion we never use. In the node
// Vitest project (no jsdom) `NodeFilter` is undefined, so importing the index THROWS and the
// never-throw fallback below silently returns identity (unconverted). Deep-importing the
// walker-free submodules also trims the walker out of the browser chunk.
async function buildConvertLine(): Promise<ConvertLine> {
	const [converterMod, dictMod, charMod, phraseMod] = await Promise.all([
		import('tongwen-core/esm/converter'),
		import('tongwen-core/esm/dictionary'),
		import('tongwen-dict/dist/s2t-char.min.json'),
		import('tongwen-dict/dist/s2t-phrase.min.json')
	]);
	const { createConverterMap } = converterMod;
	const { LangType } = dictMod;
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
		convertLinePromise = buildConvertLine()
			.then((fn) => {
				// Publish the sync handle so s2tConvertLineSync can convert without awaiting.
				convertLineSync = fn;
				return fn;
			})
			.catch((err) => {
				// Do NOT cache a rejected build — null it so a later call can retry the lazy import
				// (a transient chunk-load failure should not permanently disable offline conversion).
				convertLinePromise = null;
				throw err;
			});
	}
	return convertLinePromise;
}

/**
 * quick-260712-et3: fire-and-forget trigger of the lazy s2t dict load. Call early (e.g. at
 * app boot when the Chinese content target is Traditional) so the converter is WARM before
 * names render — then s2tConvertLineSync succeeds on the first render and there is no flash.
 * Never throws (a failed load leaves convertLineSync null; callers just fall back to async).
 */
export function warmS2T(): void {
	void loadConvertLine().catch(() => {});
}

/**
 * quick-260712-et3: SYNCHRONOUS Simplified→Traditional for ONE line. Returns the converted
 * (Traditional) string if the s2t dict is already loaded, else `null` — signalling "not warm
 * yet" so the caller can warmS2T() and fall back to the async path for this render. Never
 * throws: an empty input or a converter fault returns null (treated as not-ready). Callers
 * MUST gate on isChineseLine() first (this does not re-check language). Already-Traditional
 * input passes through unchanged (s2t leaves 台灣 as 台灣), so the returned string may equal
 * the input — that is a genuine, stable Traditional result.
 */
export function s2tConvertLineSync(text: string): string | null {
	if (!convertLineSync || !text) return null;
	try {
		return convertLineSync(text);
	} catch {
		return null;
	}
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

// ---------------------------------------------------------------------------------------------
// quick-260807-vl1 — the OPPOSITE direction: t2s (Traditional→Simplified), for the /api/og
// cover search ONLY.
//
// WHY: a Traditional-script query poisons every cover upstream, because the CN catalogs index
// the SIMPLIFIED name. Production-probed: `artist=周傑倫&title=止戰之殤` misses every tier 3/3
// attempts, while the t2s output `周杰伦 / 止战之殇` hits 4/4. og-cover.ts converts FIRST and
// searches with the Simplified terms, so the corrected query costs zero extra latency.
//
// THIS DOES NOT REVERSE OG-ZH-01. That decision removed Simplified→Traditional at SHARE time
// because converting the shared link's path corrupted its own resolution key. This is the other
// direction (t2s), server-side only, and never touches a URL the user sees — the /api/og cache
// key still hashes the INPUT artist/title.
//
// COST (measured on the installed tongwen-dict, `wc -c` + `gzip -9`):
//   t2s-char.min.json    34,273 raw / 14,728 gzip
//   t2s-phrase.min.json  16,394 raw /  7,560 gzip   → ~50 KB raw / ~22 KB gzip total
// t2s is largely MANY-TO-ONE, so its phrase table is ~9× smaller than s2t-phrase (148,406 raw).
// 30-RESEARCH.md §E's "~357 KB raw / 8.90 ms createConverterMap" cost objection was measured for
// BOTH directions merged and does NOT transfer to a t2s-only map.
//
// SEPARATE memoized build, deliberately NOT merged into buildConvertLine's one
// createConverterMap call: a merged map would drag s2t's 148 KB phrase dict into the edge bundle
// for a t2s-only caller (and vice versa).
let t2sPromise: Promise<ConvertLine> | null = null;

// quick-250711-zh idiom, verbatim: deep-import the walker-free `converter` + `dictionary`
// SUBMODULES. The top-level `tongwen-core` index does `export * from './walker'`, whose eval
// references the DOM global `NodeFilter`; in the node Vitest project that THROWS. Do not change
// this to a top-level import.
async function buildT2sConvertLine(): Promise<ConvertLine> {
	const [converterMod, dictMod, charMod, phraseMod] = await Promise.all([
		import('tongwen-core/esm/converter'),
		import('tongwen-core/esm/dictionary'),
		import('tongwen-dict/dist/t2s-char.min.json'),
		import('tongwen-dict/dist/t2s-phrase.min.json')
	]);
	const { createConverterMap } = converterMod;
	const { LangType } = dictMod;
	const converter = createConverterMap({
		s2t: [],
		t2s: [charMod.default, phraseMod.default]
	});
	return (line: string) => converter.phrase(LangType.t2s, line);
}

function loadT2sConvertLine(): Promise<ConvertLine> {
	if (!t2sPromise) {
		t2sPromise = buildT2sConvertLine().catch((err) => {
			// Never cache a rejected build (the s2t discipline) — a transient chunk/import failure
			// must not permanently disable conversion for the Worker's lifetime.
			t2sPromise = null;
			throw err;
		});
	}
	return t2sPromise;
}

/**
 * quick-260807-vl1: positionally-aligned batch Traditional→Simplified convert
 * (out.length === lines.length), mirroring s2tConvertLines exactly.
 *
 * On the first call the t2s char + phrase dicts are dynamically imported + built once, then
 * memoized (~22 KB gzip, ms-scale build). Blank lines pass through untouched so alignment and
 * empty slots survive (['', '中國'] → ['', '中国']). Already-Simplified input is a NO-OP, which
 * is what lets the caller detect "nothing changed" and skip its extra query entirely.
 *
 * Never-throw boundary: any import/build/convert failure degrades to IDENTITY (the input lines
 * returned unchanged) rather than throwing into the caller — at the edge that means the cover
 * search simply runs on the original terms, never a 500.
 *
 * No sync/warm variant (no `warmT2S`, no `t2sConvertLineSync`): the only caller is async edge
 * code, so a synchronous handle would be dead weight. Add them when a latency-sensitive UI
 * caller exists.
 */
export async function t2sConvertLines(lines: string[]): Promise<string[]> {
	if (lines.length === 0) return [];
	try {
		const convert = await loadT2sConvertLine();
		return lines.map((line) => (line ? convert(line) : line));
	} catch {
		return lines.slice();
	}
}
