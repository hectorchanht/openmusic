// lyrics-editor — the PURE logic of the LyricsEditor (quick-261120-ugcb2, UGC lyrics Phase 1).
//
// The editor component (components/LyricsEditor.svelte) is a thin shell over these functions so
// every decision — the estimator's maths, the start/end clamping, the LRC round-trip — is
// node-testable without a DOM, the same split as lrc.ts / lyric-pins.ts.
//
// FOUNDING PRINCIPLE (Hector 2026-11-20): users are lazy — zero-effort in, perfect data out.
// A paste of plain text (newlines = lines) must yield a singable, estimated lyric IMMEDIATELY;
// refinement (drag / nudge / stamp at the app's one 0.1s granularity) is optional, never the
// price of entry. Estimation is a first-class class, honestly labelled, and any hand adjustment
// promotes the draft out of it.

import { parseLRC, serializeLRC, lineEndAt, type LyricLine } from './lrc';
import { charSpansFor, explicitCharsMatch, retimeChars, type TimedChar } from './lyric-chars';

/** One editable lyric line: explicit START and END (brief §2.4 line layer). */
export interface EditorLine {
	start: number;
	end: number;
	text: string;
	/** quick-261122-ugcb4: HAND-SET character spans (B4). Absent = pre-allocated (equal share of
	 *  [start, end], derived by charSpansFor — never stored, never blank). */
	chars?: TimedChar[];
}

/** quick-261122-ugcb4: carry hand-set character spans onto a line's NEW window (drag / nudge /
 *  stamp / clamp), re-timed linearly so each character keeps its share. No spans → nothing to do. */
function carryChars(prev: EditorLine, next: EditorLine): EditorLine {
	if (!prev.chars?.length) return next;
	if (prev.start === next.start && prev.end === next.end) return { ...next, chars: prev.chars };
	return { ...next, chars: retimeChars(prev.chars, prev, next) };
}

/**
 * Snap a time to the app's ONE lyric-timing granularity — 0.1s, the standard the existing
 * lyric timing fixer already uses (normalizeLyricOffset rounds to 0.1s). Non-finite → 0,
 * negatives → 0, -0 folded. NOT a new granularity: the same tenth, applied to absolute times.
 */
export function snapTenth(v: number): number {
	if (!Number.isFinite(v)) return 0;
	return Math.max(0, Math.round(v * 10) / 10) || 0;
}

/** Split pasted plain text into lyric lines: newlines are the lines; blanks dropped, trimmed. */
export function splitPastedText(text: string): string[] {
	if (!text) return [];
	return text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
}

/** True when the pasted text already carries LRC timestamps (its real times are kept as-is). */
export function looksLikeLrc(text: string): boolean {
	return /\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?\]/.test(text ?? '');
}

/**
 * Nominal per-line seconds when the song length is unknown, so a paste still gets stamps to
 * refine instead of a dead end. The draft stays in the Estimated class either way.
 */
export const ESTIMATE_FALLBACK_LINE_SEC = 4;

/**
 * THE ESTIMATOR (brief §2.2, Hector's spec): timestamps from exactly two inputs — song length
 * and line count. Each line gets the average interval (duration ÷ lines), stamped in sequence:
 * line i spans [i·step, (i+1)·step], the last line ends at the duration. Monotonic by
 * construction, so an estimated draft can never fail a timing sanity check.
 */
export function estimateLines(texts: readonly string[], durationSec: number): EditorLine[] {
	if (!texts.length) return [];
	const usable = Number.isFinite(durationSec) && durationSec > 0;
	const step = usable ? durationSec / texts.length : ESTIMATE_FALLBACK_LINE_SEC;
	return texts.map((text, i) => ({
		start: snapTenth(i * step),
		end: snapTenth((i + 1) * step),
		text
	}));
}

/**
 * Editor lines from existing LRC text (paste/import of a ready .lrc, or editing the current
 * lyrics): real timestamps kept; each line's END is its explicit end when the text carries one,
 * else the next line's start, else the duration (lineEndAt — the one definition).
 */
export function editorLinesFromLrc(lrc: string, durationSec = 0): EditorLine[] {
	const parsed = parseLRC(lrc ?? '');
	return parsed.map((l, i) => {
		const end = lineEndAt(parsed, i, durationSec);
		const line: EditorLine = { start: l.time, end, text: l.text };
		// quick-261122-ugcb4: hand-set character spans survive import / re-edit.
		if (explicitCharsMatch(l)) line.chars = charSpansFor(l, end);
		return line;
	});
}

/** Editor lines → LyricLine[] for serializeLRC / the render pipeline (start→time, end kept). */
export function editorLinesToLyricLines(lines: readonly EditorLine[]): LyricLine[] {
	return lines.map((l) => {
		const out: LyricLine = { time: l.start, text: l.text, end: l.end };
		// quick-261122-ugcb4: only spans that still match the (possibly edited) text are kept.
		if (l.chars?.length && explicitCharsMatch(l)) out.chars = l.chars;
		return out;
	});
}

/** The saved form: LRC text with explicit ends (the [start][end] double-tag serializeLRC form). */
export function serializeEditorLines(lines: readonly EditorLine[]): string {
	return serializeLRC(editorLinesToLyricLines(lines));
}

/**
 * Keep a line valid after any gesture: start ≥ 0, end ≥ start + 0.1 (a line must have SOME
 * length), and — when the duration is known — both inside [0, duration]. All at 0.1s snap.
 */
export function clampEditorLine(line: EditorLine, durationSec = 0): EditorLine {
	const start = snapTenth(line.start);
	let end = snapTenth(line.end);
	if (end < start + 0.1) end = snapTenth(start + 0.1);
	if (Number.isFinite(durationSec) && durationSec > 0) {
		end = Math.min(end, snapTenth(durationSec));
		if (end < start + 0.1) return carryChars(line, { start: Math.max(0, snapTenth(end - 0.1)), end, text: line.text });
	}
	return carryChars(line, { start, end, text: line.text });
}

/** Nudge one boundary by delta (the ±0.1s buttons pass ±0.1). */
export function nudgeEditorLine(
	line: EditorLine,
	which: 'start' | 'end',
	delta: number,
	durationSec = 0
): EditorLine {
	const bare = { start: line.start, end: line.end, text: line.text };
	const next = clampEditorLine(
		which === 'start' ? { ...bare, start: line.start + delta } : { ...bare, end: line.end + delta },
		durationSec
	);
	// quick-261122-ugcb4: hand-set character spans re-time from the ORIGINAL window.
	return carryChars(line, next);
}

/** Drag the whole line: both boundaries move together, length preserved — the drag clamps
 *  at the song's edges instead of squashing the line against them. */
export function moveEditorLine(line: EditorLine, delta: number, durationSec = 0): EditorLine {
	const len = Math.max(0.1, line.end - line.start);
	let start = snapTenth(line.start + delta);
	if (Number.isFinite(durationSec) && durationSec > 0) {
		start = Math.min(start, snapTenth(Math.max(0, durationSec - len)));
	}
	start = Math.max(0, start);
	return clampEditorLine(carryChars(line, { start, end: snapTenth(start + len), text: line.text }), durationSec);
}

/**
 * Tap-to-stamp: the line starts at the playhead (snapped to 0.1s), keeping its length — the
 * stamp is the same adjustment as a drag, in one tap, while the song plays.
 */
export function stampEditorLine(line: EditorLine, atSec: number, durationSec = 0): EditorLine {
	const len = Math.max(0.1, line.end - line.start);
	const start = snapTenth(atSec);
	return clampEditorLine(carryChars(line, { start, end: snapTenth(start + len), text: line.text }), durationSec);
}

/**
 * The draft's timing class: 'estimated' while every stamp is still the estimator's, 'precise'
 * once any real timestamp source or hand adjustment has touched it, 'empty' with no lines.
 * The component tracks the transitions; this names the classes in one place.
 */
export type EditorTimingClass = 'empty' | 'estimated' | 'precise';
