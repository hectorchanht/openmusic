// lyric-chars — THE CHARACTER LAYER (quick-261122-ugcb4, UGC lyrics B4, brief §2.4–2.5). Pure.
//
// Every character of a line has a START and an END inside the line's [start, end] window.
//
// ESTIMATE-FIRST, RECURSIVELY (Hector 2026-11-20 20:26 — "it never starts blank"): a line with no
// hand-set character timings is PRE-ALLOCATED — each character gets an equal share of the line's
// window, in singing order (allocateChars). The user only adjusts (改一改) boundaries, at the app's
// one 0.1s granularity. So the allocation is DERIVED, never stored: a line's characters are either
// explicit (the user touched them) or the deterministic equal division of its window — which makes
// "absent" a lossless encoding of "pre-allocated", and keeps unedited LRC byte-clean.
//
// STORAGE = enhanced LRC, clean exportable structured data (the corpus dividend, brief §2.5):
//   [00:12.00][00:15.00]<00:12.00>我<00:12.80>愛<00:13.50>你<00:14.60>
// Each `<t>` stamp starts the text that follows it. A stamp followed by NO text is an END marker:
// it ends the preceding character (a held note / gap before the next one), and a trailing one ends
// the last character. Without a marker a character ends where the next one starts, and the last
// one at the line's end (lineEndAt). parseCharStamps ∘ serializeCharSpans is lossless.
//
// A "character" is a grapheme (Intl.Segmenter when available); whitespace rides with the
// character before it, so Latin words highlight letter by letter and spaces never get a slot.

/** One character's span. `end` may be absent on the LAST parsed span (= the line's end). */
export interface CharSpan {
	text: string;
	start: number;
	end?: number;
}
/** A span whose end is resolved (what renderers and editors work with). */
export interface TimedChar {
	text: string;
	start: number;
	end: number;
}

const CHAR_STAMP = /<(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?>/g;
const HAS_CHAR_STAMP = /<\d{1,2}:\d{1,2}(?:\.\d{1,3})?>/;

/** Smallest character length the editor allows (a character can be short, never empty). */
export const MIN_CHAR_SEC = 0.01;

const round2 = (v: number) => Math.round(v * 100) / 100 || 0;

let seg: Intl.Segmenter | null | undefined;
function graphemes(s: string): string[] {
	if (seg === undefined) {
		try {
			seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
		} catch {
			seg = null;
		}
	}
	return seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s);
}

/** The line's character units: graphemes, whitespace folded onto the preceding unit. */
export function splitLineChars(text: string): string[] {
	const out: string[] = [];
	let lead = '';
	for (const g of graphemes(text ?? '')) {
		if (/^\s+$/.test(g)) {
			if (out.length) out[out.length - 1] += g;
			else lead += g;
			continue;
		}
		out.push(lead + g);
		lead = '';
	}
	return out;
}

/**
 * Re-slice a line's spans onto a re-scripted text (the 简/繁 script lock converts the display text
 * after parse). Conversion is grapheme-for-grapheme in practice, so each span takes the same number
 * of graphemes from the new text; any count mismatch returns null and the line falls back to
 * allocation (still timed, never blank).
 */
export function reflowCharText<T extends { text: string }>(chars: readonly T[], newText: string): T[] | null {
	const g = graphemes(newText);
	const total = chars.reduce((n, c) => n + graphemes(c.text).length, 0);
	if (total !== g.length) return null;
	let k = 0;
	return chars.map((c) => {
		const n = graphemes(c.text).length;
		const text = g.slice(k, k + n).join('');
		k += n;
		return { ...c, text };
	});
}

/** PRE-ALLOCATION: equal share of [start, end] per character, in singing order. */
export function allocateChars(text: string, start: number, end: number): TimedChar[] {
	const units = splitLineChars(text);
	if (!units.length) return [];
	const span = Math.max(0, end - start);
	const step = span / units.length;
	return units.map((u, i) => ({
		text: u,
		start: start + i * step,
		end: i === units.length - 1 ? Math.max(start, end) : start + (i + 1) * step
	}));
}

export function hasCharStamps(text: string): boolean {
	return HAS_CHAR_STAMP.test(text ?? '');
}

/**
 * Parse a line body that carries `<t>` character stamps. Returns the display text (stamps
 * stripped) and the spans; null when the body has no character stamps. Text before the first
 * stamp becomes part of the text but gets no span (an unstamped prefix: the line falls back to
 * allocation in charSpansFor, since its spans no longer cover the whole text).
 */
export function parseCharStamps(body: string): { text: string; chars: CharSpan[] } | null {
	if (!hasCharStamps(body)) return null;
	const ms = [...body.matchAll(CHAR_STAMP)];
	const prefix = body.slice(0, ms[0].index);
	const chars: CharSpan[] = [];
	for (let k = 0; k < ms.length; k++) {
		const m = ms[k];
		const t =
			(parseInt(m[1], 10) || 0) * 60 + (parseInt(m[2], 10) || 0) + (m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0);
		const from = (m.index ?? 0) + m[0].length;
		const to = k + 1 < ms.length ? (ms[k + 1].index ?? body.length) : body.length;
		const chunk = body.slice(from, to);
		if (chunk.trim()) {
			chars.push({ text: chunk, start: t });
			continue;
		}
		// A stamp with no text after it = the END marker of the character before it.
		const prev = chars[chars.length - 1];
		if (prev) {
			if (prev.end === undefined) prev.end = t;
			prev.text += chunk;
		}
	}
	// Implicit ends: the next character's start.
	for (let i = 0; i < chars.length - 1; i++) {
		if (chars[i].end === undefined) chars[i].end = chars[i + 1].start;
	}
	const text = (prefix + chars.map((c) => c.text).join('')).trim();
	return { text, chars: trimSpans(chars) };
}

// Leading/trailing whitespace of the line body belongs to no character.
function trimSpans(chars: CharSpan[]): CharSpan[] {
	if (!chars.length) return chars;
	const out = chars.map((c) => ({ ...c }));
	out[0].text = out[0].text.replace(/^\s+/, '');
	out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '');
	return out.filter((c) => c.text.length > 0);
}

function stamp(t0: number): string {
	const t = Math.max(0, t0);
	const min = Math.floor(t / 60);
	const sec = Math.floor(t % 60);
	const cs = Math.round((t - Math.floor(t)) * 100) % 100;
	return `<${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}>`;
}

/**
 * The inverse of parseCharStamps: `<start>char` per span, an END marker `<end>` wherever a
 * character ends before the next one starts, and a trailing marker when the last character ends
 * before `lineEnd`.
 */
export function serializeCharSpans(chars: readonly TimedChar[], lineEnd: number): string {
	let out = '';
	for (let i = 0; i < chars.length; i++) {
		const c = chars[i];
		out += stamp(c.start) + c.text;
		const nextStart = i + 1 < chars.length ? chars[i + 1].start : lineEnd;
		if (round2(c.end) < round2(nextStart)) out += stamp(c.end);
	}
	return out;
}

/**
 * THE character read for a line: its explicit spans when they cover exactly the line's text,
 * else the pre-allocation. Never empty for a non-empty line — the layer never starts blank.
 */
/** Do a line's hand-set spans still cover exactly its text? (An edited line's spans do not.) */
export function explicitCharsMatch(line: { text: string; chars?: readonly CharSpan[] }): boolean {
	const ex = line.chars;
	return !!ex && ex.length > 0 && ex.map((c) => c.text).join('').replace(/\s+/g, '') === (line.text ?? '').replace(/\s+/g, '');
}

export function charSpansFor(line: { text: string; time: number; chars?: CharSpan[] }, lineEnd: number): TimedChar[] {
	const explicit = line.chars;
	if (explicit && explicitCharsMatch(line)) {
		return explicit.map((c, i) => ({
			text: c.text,
			start: c.start,
			end: c.end ?? (i + 1 < explicit.length ? explicit[i + 1].start : Math.max(c.start, lineEnd))
		}));
	}
	return allocateChars(line.text, line.time, lineEnd);
}

/** True when `chars` is (to the centisecond) the equal allocation — i.e. carries no hand edit. */
export function isAllocation(chars: readonly TimedChar[], text: string, start: number, end: number): boolean {
	const a = allocateChars(text, start, end);
	return (
		a.length === chars.length &&
		a.every((x, i) => x.text === chars[i].text && round2(x.start) === round2(chars[i].start) && round2(x.end) === round2(chars[i].end))
	);
}

const snapTenth = (v: number) => Math.round(v * 10) / 10 || 0;

/**
 * Move the START of character `i` by `delta` (the ±0.1s nudge) — a shared boundary: the previous
 * character's end moves with it when they touched. Result snapped to 0.1s and clamped so every
 * character keeps ≥ MIN_CHAR_SEC and stays inside [lineStart, lineEnd]. Character 0's start is the
 * line's start (moved by line gestures), so i = 0 is a no-op.
 */
export function nudgeCharStart(chars: readonly TimedChar[], i: number, delta: number, lineStart: number, lineEnd: number): TimedChar[] {
	return setCharStart(chars, i, snapTenth(chars[i]?.start + delta), lineStart, lineEnd);
}

/** Set the start of character `i` (tap-to-stamp at the playhead), same clamps as the nudge. */
export function setCharStart(chars: readonly TimedChar[], i: number, at: number, lineStart: number, lineEnd: number): TimedChar[] {
	if (i <= 0 || i >= chars.length || !Number.isFinite(at)) return chars.map((c) => ({ ...c }));
	const prev = chars[i - 1];
	const cur = chars[i];
	const touching = round2(prev.end) === round2(cur.start);
	const lo = Math.max(lineStart, prev.start) + MIN_CHAR_SEC;
	const hi = Math.min(lineEnd, cur.end) - MIN_CHAR_SEC;
	if (hi < lo) return chars.map((c) => ({ ...c }));
	const start = Math.min(hi, Math.max(lo, at));
	return chars.map((c, j) => {
		if (j === i) return { ...c, start };
		if (j === i - 1 && (touching || c.end > start)) return { ...c, end: start };
		return { ...c };
	});
}

/** Linearly re-time spans from one line window to another (a line drag / nudge / stamp). */
export function retimeChars(
	chars: readonly TimedChar[],
	from: { start: number; end: number },
	to: { start: number; end: number }
): TimedChar[] {
	const a = Math.max(1e-6, from.end - from.start);
	const k = (to.end - to.start) / a;
	const map = (t: number) => to.start + (t - from.start) * k;
	return chars.map((c) => ({ text: c.text, start: round2(map(c.start)), end: round2(map(c.end)) }));
}

/**
 * Re-group a line's timed characters under a SECOND segmentation of the SAME text — the
 * furigana spans (word surfaces that partition the line). Returns one TimedChar[] per surface,
 * in order, or null when the two segmentations do not cover exactly the same graphemes (the
 * caller then renders the surfaces plain rather than sweeping wrong timings). A character that
 * straddles a surface boundary is split at the boundary, its time window divided in grapheme
 * proportion — the same linear assumption charFillAt makes inside one character.
 */
export function groupCharSpansBySurfaces(chars: readonly TimedChar[], surfaces: readonly string[]): TimedChar[][] | null {
	const totalChars = chars.reduce((n, c) => n + graphemes(c.text).length, 0);
	const totalSurfaces = surfaces.reduce((n, s) => n + graphemes(s).length, 0);
	if (!chars.length || !surfaces.length || totalChars !== totalSurfaces) return null;
	const groups: TimedChar[][] = [];
	let ci = 0; // index into chars
	let co = 0; // graphemes already consumed of chars[ci]
	for (const surface of surfaces) {
		let need = graphemes(surface).length;
		const group: TimedChar[] = [];
		while (need > 0) {
			const c = chars[ci];
			if (!c) return null;
			const cg = graphemes(c.text);
			const take = Math.min(need, cg.length - co);
			const from = co / cg.length;
			const to = (co + take) / cg.length;
			group.push({
				text: cg.slice(co, co + take).join(''),
				start: c.start + (c.end - c.start) * from,
				end: c.start + (c.end - c.start) * to
			});
			co += take;
			need -= take;
			if (co === cg.length) {
				ci++;
				co = 0;
			}
		}
		groups.push(group);
	}
	return ci === chars.length ? groups : null;
}

/** Per-character fill at `clock`: 1 = sung, 0 = not yet, a fraction for the character being sung. */
export function charFillAt(c: TimedChar, clock: number): number {
	if (clock >= c.end) return 1;
	if (clock <= c.start) return 0;
	const span = c.end - c.start;
	return span > 0 ? (clock - c.start) / span : 1;
}
