// furigana — LOCAL-NATIVE Japanese reading annotation (quick-261120-furi).
//
// Hector's ruling (spec Addenda 4–5, 2026-11-20): the readings engine belongs
// to @dawn-studio/pronounce and runs LOCALLY — the Japanese readings universe
// is finite, so the tables ship in-app (2,970 kanji + 18,016 common words,
// ~152KB gz) and annotation is a pure lookup: zero network, zero server cost,
// ~29µs/line. Kuromoji (~426MB RSS) and Lindera/WASM (+174MB) were measured
// and rejected for the client in the spike (~/workspace/furigana-spike).
// The pronounce package's own repo/publish path is not reachable from here
// (no repository field on npm; the publish connector is an unfilled
// template), so the engine is VENDORED here with the exact pronounce-shaped
// API (annotateLine → spans) — extraction into @dawn-studio/pronounce is a
// follow-up that changes the import path, not the shape.
//
// Addendum 6 (WHY NOT ALL): the data layer NEVER narrows to one reading.
// Every annotated span carries `variants` — ALL plausible readings of that
// surface (JMdict's readings for the word + the kanji table's readings) —
// with the engine's best pick first as `chosen`. Which variant is right in
// THIS song is the user's call: the UI shows `chosen`, a tap lists the
// variants, and the user's pin (services/furigana-pins) wins thereafter.
// Ambiguity is lesson material, not an error state.
//
// Lookup order at each kanji position (the spike engine, v2):
//   1. exact word-dict match, longest first (incl. single-kanji words —
//      reading selection is word-level: 行く=いく vs 行う=おこなう)
//   2. stem match: dictionary stem (surface minus trailing kana) found in
//      the text, with the text's own inflection kana appended to the stem
//      reading — handles 歩こう/あるこう, 向いて/むいて, 来れ/くれ
//   3. per-kanji fallback (okurigana-aware), flagged `estimated`
//
// Data: JMdict / KANJIDIC2 via jmdict-simplified 3.6.2 (EDRDG, CC BY-SA) —
// words.json (common tier, surface → chosen reading), kanji.json (per-kanji
// on/kun), variants.json (surface → every JMdict reading, built from the
// same source; only surfaces with ≥2 readings are stored).

export interface KanjiEntry {
	/** on'yomi, hiragana, most-common first */
	on: string[];
	/** kun'yomi as [stem, okurigana] pairs, most-common first */
	kun: [string, string][];
}

export interface StemEntry {
	stem: string;
	readingStem: string;
	suffixLen: number;
}

export interface FuriganaTables {
	words: Map<string, string>;
	kanji: Map<string, KanjiEntry>;
	/** surface → every plausible JMdict reading (only ≥2-reading surfaces) */
	wordVariants: Map<string, string[]>;
	stems: Map<string, StemEntry[]>;
	/** stem → every dictionary reading stem for that stem (variant assembly) */
	stemVariants: Map<string, string[]>;
	maxWordLen: number;
}

export interface FuriganaSpan {
	surface: string;
	/** ALL plausible readings of this surface, engine's best first.
	 *  Empty = no annotation (kana runs, punctuation, unknown kanji). */
	variants: string[];
	/** The reading to display: variants[0] unless a user pin overrides it
	 *  (pins are applied by the caller — see stores/furigana-pins.svelte). */
	chosen?: string;
	/** true when `chosen` came from the per-kanji fallback, not the word dict */
	estimated?: boolean;
}

const KANJI_RE = /[一-鿿々〆ヶ]/;
const KANA_RE = /[ぁ-ゖァ-ヺー]/;
const HIRAGANA_RE = /[ぁ-ゖ]/;
/** o-row kana that take a volitional う (歩こ→歩こう) */
const O_ROW = new Set([..."こごそぞとどのほぼぽもよろご"]);
/** case particles etc. — an inflection never starts with one of these;
 *  a stem match that would swallow one is not an inflection (上を向く) */
const PARTICLE_HEADS = new Set([..."はがをにへともやかの"]);
/** Chooser sanity cap — a span never lists more readings than this. */
const MAX_VARIANTS = 8;

export function isKanji(ch: string): boolean {
	return KANJI_RE.test(ch);
}

/** True when the text carries hiragana/katakana — the practical "this line is
 *  Japanese" signal (a kanji-only line is ambiguous with Chinese; kana is not). */
export function hasKana(text: string): boolean {
	for (const ch of text) if (KANA_RE.test(ch)) return true;
	return false;
}

function splitStem(surface: string, reading: string): StemEntry | null {
	// The inflection suffix of a dictionary form is its FINAL kana only:
	// okurigana belongs to the stem (重ねる -> stem 重ね, suffix る;
	// 溶ける -> stem 溶け; 歩く -> stem 歩, suffix く).
	const sChars = [...surface];
	if (sChars.length < 2 || !KANA_RE.test(sChars[sChars.length - 1])) return null;
	const stem = sChars.slice(0, -1).join("");
	if (![...stem].some(isKanji)) return null;
	const rChars = [...reading];
	if (rChars.length < 2) return null;
	return { stem, readingStem: rChars.slice(0, -1).join(""), suffixLen: 1 };
}

export function loadTables(
	words: Record<string, string>,
	kanji: Record<string, KanjiEntry>,
	variants: Record<string, string[]> = {}
): FuriganaTables {
	const wordMap = new Map(Object.entries(words));
	let maxWordLen = 0;
	const stems = new Map<string, StemEntry[]>();
	const seenStem = new Set<string>();
	const stemVariants = new Map<string, string[]>();
	// shortest-suffix stems first: they carry the most reliable stem reading
	const entries = Object.entries(words)
		.map(([s, r]) => splitStem(s, r))
		.filter((e): e is StemEntry => e !== null)
		.sort((a, b) => a.suffixLen - b.suffixLen);
	for (const e of entries) {
		if (!stemVariants.has(e.stem)) stemVariants.set(e.stem, []);
		const bucket = stemVariants.get(e.stem)!;
		if (!bucket.includes(e.readingStem)) bucket.push(e.readingStem);
		if (seenStem.has(e.stem)) continue;
		seenStem.add(e.stem);
		const key = [...e.stem][0];
		if (!stems.has(key)) stems.set(key, []);
		stems.get(key)!.push(e);
	}
	for (const bucket of stems.values()) {
		bucket.sort((a, b) => [...b.stem].length - [...a.stem].length);
	}
	for (const w of wordMap.keys()) {
		const n = [...w].length;
		if (n > maxWordLen) maxWordLen = n;
	}
	return {
		words: wordMap,
		kanji: new Map(Object.entries(kanji)),
		wordVariants: new Map(Object.entries(variants)),
		stems,
		stemVariants,
		maxWordLen
	};
}

/** chosen first, then every extra that is new — capped at MAX_VARIANTS. */
function assembleVariants(chosen: string, extras: Iterable<string>): string[] {
	const out: string[] = [chosen];
	for (const v of extras) {
		if (v && !out.includes(v)) out.push(v);
		if (out.length >= MAX_VARIANTS) break;
	}
	return out;
}

/** Every reading the kanji table offers for a span whose surface is exactly
 *  this one kanji plus `oku` okurigana ('' when the surface is the bare kanji):
 *  kun pairs whose okurigana matches the surface's trailing kana, plus — for a
 *  bare kanji only — the on'yomi (an on reading never covers okurigana). */
function kanjiSurfaceReadings(entry: KanjiEntry, oku: string): string[] {
	const out: string[] = [];
	for (const [stem, o] of entry.kun) {
		if (o === oku) out.push(stem + o);
	}
	if (!oku) for (const on of entry.on) out.push(on);
	return out;
}

function fallbackSpan(chars: string[], i: number, t: FuriganaTables): FuriganaSpan {
	const ch = chars[i];
	const entry = t.kanji.get(ch);
	if (!entry) return { surface: ch, variants: [], estimated: true };
	// okurigana match: a kun reading whose okurigana literally follows
	let best: { stem: string; oku: string } | null = null;
	for (const [stem, oku] of entry.kun) {
		if (!oku) continue;
		const okuChars = [...oku];
		let ok = true;
		for (let k = 0; k < okuChars.length; k++) {
			if (chars[i + 1 + k] !== okuChars[k]) {
				ok = false;
				break;
			}
		}
		if (ok && (!best || okuChars.length > [...best.oku].length)) best = { stem, oku };
	}
	if (best) {
		const chosen = best.stem + best.oku;
		return {
			surface: ch + best.oku,
			variants: assembleVariants(chosen, kanjiSurfaceReadings(entry, best.oku)),
			chosen,
			estimated: true
		};
	}
	const nextIsKanji = i + 1 < chars.length && isKanji(chars[i + 1]);
	const prevIsKanji = i > 0 && isKanji(chars[i - 1]);
	let chosen: string | undefined;
	if ((nextIsKanji || prevIsKanji) && entry.on.length > 0) {
		chosen = entry.on[0];
	} else if (entry.kun.length > 0) {
		chosen = entry.kun[0][0];
	} else if (entry.on.length > 0) {
		chosen = entry.on[0];
	}
	if (!chosen) return { surface: ch, variants: [], estimated: true };
	return {
		surface: ch,
		variants: assembleVariants(chosen, kanjiSurfaceReadings(entry, '')),
		chosen,
		estimated: true
	};
}

function stemMatch(
	chars: string[],
	i: number,
	t: FuriganaTables
): { span: FuriganaSpan; inflection: number } | null {
	const bucket = t.stems.get(chars[i]);
	if (!bucket) return null;
	const rest = chars.slice(i).join("");
	for (const e of bucket) {
		if (!rest.startsWith(e.stem)) continue;
		const stemLen = [...e.stem].length;
		// following hiragana run = the inflection as actually written
		const hira: string[] = [];
		let j = i + stemLen;
		while (j < chars.length && HIRAGANA_RE.test(chars[j])) {
			hira.push(chars[j]);
			j++;
		}
		let n = Math.min(e.suffixLen, hira.length);
		// a single-kanji stem with no inflection kana consumed is not evidence
		// (高 in 高楼 must fall through to the on'yomi compound fallback)
		if (n === 0 && stemLen < 2) continue;
		// the kana at the suffix position is the inflection itself; if it is a
		// particle, this is the bare stem in a sentence, not an inflected verb
		if (n >= 1 && PARTICLE_HEADS.has(hira[0])) continue;
		if (n >= 1 && hira[n] === "う" && O_ROW.has(hira[n - 1])) n++;
		const consumed = hira.slice(0, n).join("");
		const chosen = e.readingStem + consumed;
		// variants: every dictionary stem for this surface stem, inflected the
		// same way the text inflected the chosen one
		const extras = (t.stemVariants.get(e.stem) ?? []).map((rs) => rs + consumed);
		return {
			span: { surface: e.stem + consumed, variants: assembleVariants(chosen, extras), chosen },
			inflection: n
		};
	}
	return null;
}

/** Annotate one line of Japanese text into per-word reading spans.
 *  Kana-only runs pass through as spans with no variants/chosen. */
export function annotateLine(text: string, t: FuriganaTables): FuriganaSpan[] {
	const chars = [...text];
	const spans: FuriganaSpan[] = [];
	const pushPlain = (s: string) => {
		const last = spans[spans.length - 1];
		if (last && last.chosen === undefined && !last.estimated) last.surface += s;
		else spans.push({ surface: s, variants: [] });
	};
	let i = 0;
	while (i < chars.length) {
		const ch = chars[i];
		if (!isKanji(ch)) {
			pushPlain(ch);
			i++;
			continue;
		}
		// exact word match vs stem match: whichever consumes MORE of the text
		// wins (向いて is 向く inflected, not the noun 向い; 歩こう is 歩く, not
		// the counter 歩). Ties go to the exact dictionary form. A bare
		// zero-inflection stem never beats an exact word (思い出 the noun).
		let matched: string | null = null;
		const maxL = Math.min(t.maxWordLen, chars.length - i);
		for (let L = maxL; L >= 1; L--) {
			const cand = chars.slice(i, i + L).join("");
			if (t.words.has(cand)) {
				matched = cand;
				break;
			}
		}
		const sm = stemMatch(chars, i, t);
		const exLen = matched ? [...matched].length : 0;
		const smLen = sm ? [...sm.span.surface].length : 0;
		// tie-break: equal consumption, but the stem consumed inflection kana
		// and a て/で continuation follows — that is a verb te-form, not the
		// noun the exact match found (向いて = 向く, not 向い)
		const teTie =
			sm !== null &&
			matched !== null &&
			smLen === exLen &&
			sm.inflection >= 1 &&
			(chars[i + smLen] === "て" || chars[i + smLen] === "で");
		if (sm && (!matched || smLen > exLen || teTie)) {
			spans.push(sm.span);
			i += [...sm.span.surface].length;
			continue;
		}
		if (matched) {
			const chosen = t.words.get(matched)!;
			const extras: string[] = [...(t.wordVariants.get(matched) ?? [])];
			// a single-kanji word also carries its kanji table's readings
			const mChars = [...matched];
			if (mChars.length === 1) {
				const entry = t.kanji.get(matched);
				if (entry) extras.push(...kanjiSurfaceReadings(entry, ''));
			}
			spans.push({ surface: matched, variants: assembleVariants(chosen, extras), chosen });
			i += mChars.length;
			continue;
		}
		if (sm) {
			spans.push(sm.span);
			i += [...sm.span.surface].length;
			continue;
		}
		// 3. per-kanji fallback
		const fb = fallbackSpan(chars, i, t);
		spans.push(fb);
		i += [...fb.surface].length;
	}
	return spans;
}

// ---- lazy table loading ------------------------------------------------------
// The tables are ~700KB of JSON: they load as their own chunk, ONLY when a
// caller actually annotates (furigana on + a Japanese line on screen). The
// promise is cached at module scope so the load happens once per session.
let tablesPromise: Promise<FuriganaTables> | null = null;

export function ensureFuriganaTables(): Promise<FuriganaTables> {
	tablesPromise ??= (async () => {
		// ?raw + JSON.parse, NOT a JSON module import: Rolldown inflates a JSON
		// module into per-entry string constants (~1.8× the bytes); the raw text
		// ships at the JSON's own size and parses in ~15ms.
		const [{ default: wordsText }, { default: kanjiText }, { default: variantsText }] = await Promise.all([
			import('./furigana/words.json?raw'),
			import('./furigana/kanji.json?raw'),
			import('./furigana/variants.json?raw')
		]);
		return loadTables(
			JSON.parse(wordsText) as Record<string, string>,
			JSON.parse(kanjiText) as Record<string, KanjiEntry>,
			JSON.parse(variantsText) as Record<string, string[]>
		);
	})();
	return tablesPromise;
}
