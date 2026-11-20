// quick-261120-segmix: pure segment splitter for MIXED lyric lines (Han + non-Han
// in one line) — the segment-granularity companion to i18n/detect.ts.
//
// WHY: the zh-Hant pipeline routes per LINE (services/translate.ts resolveZhHant):
// a line classified Chinese goes ENTIRELY to the offline s2t converter, so the
// English words inside a Chinese line were never translated (Hector 2026-11-20),
// while a pure-English line went to the MT API and translated fine. The fix keeps
// the line as the unit of alignment but splits a MIXED line into runs:
//   - 'cjk' runs (Han)        → offline script conversion ONLY (never MT — the
//                               standing rule: Chinese text is script control,
//                               never MT paraphrase)
//   - 'mt' runs (letters of any other script — Latin, kana, hangul, …)
//                             → the MT API path, subject to the skip list
//   - 'raw' runs (no letters: punctuation / digits / spacing only)
//                             → pass through untouched
// Kana/hangul chars are 'mt', never 'cjk': the Japanese-kanji guard (D-04) — a
// kana-bearing run must not be offline-converted.
//
// PURE .ts (house style): no runes, no browser globals — node-testable. Char
// ranges mirror i18n/detect.ts exactly (explicit \u ranges, no property escapes
// for the CJK classes) so segment classification can never disagree with the
// line classifier about what is Han/kana/hangul.
//
// INVARIANT: concatenating the segment texts reproduces the input line EXACTLY
// (order, spacing, punctuation) — stitching is just join('').

export interface LyricSegment {
	kind: 'cjk' | 'mt' | 'raw';
	text: string;
}

// Same ranges as i18n/detect.ts (kept in sync deliberately — see header).
const HAN = /[㐀-䶿一-鿿]/;
const KANA = /[぀-ゟ゠-ヿㇰ-ㇿｦ-ﾝ]/;
const HANGUL = /[가-힣㄰-㆏ᄀ-ᇿ]/;
// Any Unicode letter (Latin, Cyrillic, kana, hangul, …). A non-Han run carrying
// at least one letter is translatable content; a run without one is furniture.
const LETTER = /\p{L}/u;

type CharClass = 'han' | 'script' | 'neutral';

function charClass(ch: string): CharClass {
	if (HAN.test(ch)) return 'han';
	if (KANA.test(ch) || HANGUL.test(ch) || LETTER.test(ch)) return 'script';
	return 'neutral'; // spaces, punctuation, digits, symbols — glue, never a run of their own
}

/**
 * Split `line` into ordered runs. Neutral characters glue onto the run in
 * progress (leading neutrals join the first typed run), so a Han run keeps its
 * trailing comma/space for the phrase converter and an MT run keeps its
 * surrounding spacing for exact stitching.
 */
export function splitLyricSegments(line: string): LyricSegment[] {
	const runs: Array<{ han: boolean; text: string }> = [];
	let buf = '';
	let bufHan: boolean | null = null;
	const flush = () => {
		if (buf) runs.push({ han: bufHan === true, text: buf });
		buf = '';
	};
	for (const ch of line) {
		const cls = charClass(ch);
		if (cls === 'neutral') {
			buf += ch;
			continue;
		}
		const han = cls === 'han';
		if (bufHan === null) {
			bufHan = han;
			buf += ch;
			continue;
		}
		if (han !== bufHan) {
			flush();
			bufHan = han;
		}
		buf += ch;
	}
	flush();
	return runs.map((r) =>
		r.han
			? { kind: 'cjk' as const, text: r.text }
			: LETTER.test(r.text)
				? { kind: 'mt' as const, text: r.text }
				: { kind: 'raw' as const, text: r.text }
	);
}

/**
 * A line is MIXED when it carries BOTH a Han run and a translatable non-Han
 * run — the only shape the old per-line routing got wrong. Pure-Chinese lines
 * (Han + furniture) and pure-foreign lines are NOT mixed and keep their
 * existing whole-line paths exactly.
 */
export function isMixedLyricLine(line: string): boolean {
	if (!line) return false;
	const segs = splitLyricSegments(line);
	return segs.some((s) => s.kind === 'cjk') && segs.some((s) => s.kind === 'mt');
}
