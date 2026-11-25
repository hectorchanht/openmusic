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
import { charSpansFor, explicitCharsMatch, parseCharStamps, retimeChars, type TimedChar } from './lyric-chars';

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
 *
 * quick-261123-untimed — UNTIMED LINES SURVIVE (Hector 2026-11-23: header lines typed into the
 * raw box above the timed lines — "Sorry呢度係香港 / Song by Billy Choi · 2023" — vanished).
 * parseLRC drops any line without a timestamp tag, and it stays that way (it is the shared
 * verbatim display parser); the EDITOR layer keeps the untimed lines instead, in raw order,
 * and gives each one a time so the serialize → parse round-trip carries it like any other line:
 *   · with `untimedStartSec` supplied (the component passes the live playhead when this track
 *     is the playing one — D(i)'s real-time stamp for newly typed lines), every untimed line
 *     is stamped at that instant, 0.1-snapped;
 *   · otherwise positional: before the first timed line → 0; between timed lines → the
 *     previous timed line's end (lineEndAt over the timed lines). Ends then resolve through
 *     lineEndAt over the combined list, so a header before the first timed line ends exactly
 *     where that line starts, and an in-between note spans previous-end → next-start.
 *   · text with NO timed lines at all and no playhead falls back to the estimator's even
 *     distribution (the same shape a plain-text paste gets), so it is kept, singable and
 *     round-trips instead of collapsing onto a single instant.
 */
export function editorLinesFromLrc(lrc: string, durationSec = 0, untimedStartSec?: number): EditorLine[] {
	const tagRe = /\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?\]/;
	type RawEntry = { text: string; timed?: LyricLine; timedIdx: number };
	const entries: RawEntry[] = [];
	const timedRaw: LyricLine[] = [];
	for (const raw of (lrc ?? '').split(/\r?\n/)) {
		if (tagRe.test(raw)) {
			const parsed = parseLRC(raw);
			if (!parsed.length) continue; // a tag with no text is not a line (parseLRC's own rule)
			entries.push({ text: parsed[0].text, timed: parsed[0], timedIdx: timedRaw.length });
			timedRaw.push(parsed[0]);
		} else {
			// Enhanced-LRC character stamps are timing data, never display text (lrc.ts's rule).
			const cs = parseCharStamps(raw);
			const text = (cs ? cs.text : raw).trim();
			if (text) entries.push({ text, timedIdx: -1 });
		}
	}
	if (!entries.length) return [];
	const hasPlayhead = untimedStartSec !== undefined && Number.isFinite(untimedStartSec);
	if (!timedRaw.length && !hasPlayhead) {
		return estimateLines(entries.map((e) => e.text), durationSec);
	}
	const playhead = hasPlayhead ? snapTenth(untimedStartSec as number) : 0;
	const combined: LyricLine[] = entries.map((e) => {
		if (e.timed) return e.timed;
		let start: number;
		if (hasPlayhead) {
			start = playhead;
		} else {
			// The previous TIMED entry in raw order anchors the positional stamp.
			let prevIdx = -1;
			for (let k = entries.indexOf(e) - 1; k >= 0; k--) {
				if (entries[k].timed) {
					prevIdx = entries[k].timedIdx;
					break;
				}
			}
			start = prevIdx < 0 ? 0 : lineEndAt(timedRaw, prevIdx, durationSec);
		}
		return { time: start, text: e.text };
	});
	return combined.map((l, i) => {
		const end = lineEndAt(combined, i, durationSec);
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
 * quick-261123-cascade (Hector 2026-11-23 04:11 + 04:14) — THE CHAIN CASCADE. Editor LRC is a
 * [start][end] CHAIN: one line's end is the next line's start. The old pinpoint nudges moved
 * ONE boundary of ONE line, so pulling line 1's start later left lines 2+ behind — line 1
 * ended after line 2 began, and the saved order scrambled on re-parse (parseLRC sorts by
 * time, so the TEXT order silently changed). Hector's spec: changing line 1's start shifts
 * ALL following lines by the same delta, preserving relative gaps.
 *
 * Generalization choice (noted per the brief): the chain makes the same rule natural for ANY
 * line, so this helper is not line-1-only —
 *   · a START edit on line i shifts lines i…end bodily by the delta (lengths + gaps kept),
 *     and line i−1's END follows to the new start (the chain link), so no gap or overlap
 *     opens behind the edit;
 *   · an END edit on line i moves that end and shifts lines i+1…end bodily by the delta
 *     (line i+1's start IS line i's end in a chain), so no gap or overlap opens ahead of it.
 * The delta is clamped before anything moves: the edited start never crosses the previous
 * line's start (+0.1), the edited end never crosses its own start (+0.1), and nothing is
 * pushed past the duration — a clamped edit moves the whole chain by the clamped amount, so
 * the chain can never collide with itself. Every moved line routes through moveEditorLine /
 * nudgeEditorLine, so hand-set character spans carry exactly as with any other gesture.
 */
export function cascadeEditorLines(
	lines: readonly EditorLine[],
	i: number,
	which: 'start' | 'end',
	delta: number,
	durationSec = 0
): EditorLine[] {
	const copy = () => lines.map((l) => ({ ...l }));
	if (!lines.length || i < 0 || i >= lines.length || !Number.isFinite(delta)) return copy();
	// Signed 0.1s snap (snapTenth floors negatives at 0 — it snaps TIMES, not deltas).
	let d = Math.round(delta * 10) / 10 || 0;
	if (d === 0) return copy();
	const last = lines.length - 1;
	const hasDur = Number.isFinite(durationSec) && durationSec > 0;
	if (which === 'start') {
		const minStart = i > 0 ? lines[i - 1].start + 0.1 : 0;
		d = Math.max(d, Math.round((minStart - lines[i].start) * 10) / 10);
		if (hasDur) d = Math.min(d, Math.round((snapTenth(durationSec) - lines[last].end) * 10) / 10);
		if (d === 0) return copy();
		return lines.map((l, j) => {
			if (j < i - 1) return { ...l };
			if (j === i - 1) return nudgeEditorLine(l, 'end', lines[i].start + d - l.end, durationSec);
			return moveEditorLine(l, d, durationSec);
		});
	}
	// which === 'end': the edited end keeps ≥0.1s of its own line; the tail chain shifts by d.
	d = Math.max(d, Math.round((lines[i].start + 0.1 - lines[i].end) * 10) / 10);
	if (hasDur) d = Math.min(d, Math.round((snapTenth(durationSec) - lines[last].end) * 10) / 10);
	if (d === 0) return copy();
	return lines.map((l, j) => {
		if (j < i) return { ...l };
		if (j === i) return nudgeEditorLine(l, 'end', d, durationSec);
		return moveEditorLine(l, d, durationSec);
	});
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
 * quick-261122-tsfix — DEGENERATE-STAMP DETECTION. Some lyric sources ship every line stamped
 * at the track's exact duration (《刺蝟的智慧》: 51 lines × [03:42.00] on a 222s song): every
 * line is zero-length at the end, activeLineAt can never fire, and no highlight exists anywhere.
 * The signature: at least MIN_DEGENERATE_LINES lines AND ≥ 90% of starts sharing ONE 0.1s
 * bucket AND that bucket sitting at the end of the song — or at 0 when the duration is
 * unknown (all-at-0 is provable without it). "At the end" (quick-261122-tsfix2) means
 * within the last max(2s, 2% of duration) or beyond it: LRC stamps are written against the
 * NOMINAL duration (222.0 for a "3:42" song) while the editor's duration is the LIVE player
 * duration, and real audio routinely runs a fraction of a second to ~2s longer than nominal
 * — the original 0.1s end tolerance therefore never fired on real files (live-verified:
 * 12 lines × [03:42.00], no banner). Detection only ever OFFERS a repair
 * (the editor's banner); it never rewrites a seed on its own — a genuinely repetitive chant
 * must survive a user's "no".
 */
export const MIN_DEGENERATE_LINES = 5;
export function hasDegenerateStamps(lines: readonly EditorLine[], durationSec = 0): boolean {
	if (lines.length < MIN_DEGENERATE_LINES) return false;
	const buckets = new Map<number, number>();
	for (const l of lines) {
		const b = snapTenth(l.start);
		buckets.set(b, (buckets.get(b) ?? 0) + 1);
	}
	let topBucket = 0;
	let topCount = 0;
	for (const [b, n] of buckets) {
		if (n > topCount) {
			topCount = n;
			topBucket = b;
		}
	}
	if (topCount < Math.ceil(lines.length * 0.9)) return false;
	if (topBucket === 0) return true;
	if (Number.isFinite(durationSec) && durationSec > 0) {
		// quick-261122-tsfix2: realistic end tolerance — nominal-vs-actual duration gap (see
		// the header note). A bucket beyond the duration also satisfies >=, so stamps that
		// overshoot a slightly-shorter actual length still count as at-the-end.
		const endTolerance = Math.max(2, durationSec * 0.02);
		return topBucket >= snapTenth(durationSec - endTolerance);
	}
	return false;
}

/**
 * quick-261122-tsfix — TAP-TO-SYNC CHAIN STAMP, the re-time mode's one gesture: stamp line
 * `cursor` at the playhead AND close the previous line at the same instant, so one tap per
 * line, in singing order, rebuilds the whole timing in a single play-through (the karaoke
 * tap-sync). The stamped line keeps its existing end when that end is still ahead (the
 * degenerate case keeps the duration end, so the line stays "current" until the next tap
 * chains it shut); the last line's end is the duration end it already carries. All outputs
 * pass clampEditorLine — 0.1s snap, duration clamp, and hand-set character spans re-time
 * through the same carryChars every other gesture uses. `atSec` never moves a stamp before
 * the previous line's start (a backward seek mid-mode cannot un-monotonic the draft).
 * Returns the next cursor (cursor + 1, clamped at lines.length = mode complete).
 */
export function stampNextInSequence(
	lines: readonly EditorLine[],
	cursor: number,
	atSec: number,
	durationSec = 0
): { lines: EditorLine[]; cursor: number } {
	if (!lines.length) return { lines: [], cursor: 0 };
	const cur = Math.max(0, Math.min(Math.trunc(cursor) || 0, lines.length));
	if (cur >= lines.length) return { lines: lines.map((l) => ({ ...l })), cursor: cur };
	const prevStart = cur > 0 ? lines[cur - 1].start : 0;
	const at = snapTenth(Math.max(snapTenth(atSec), prevStart));
	const out = lines.map((l) => ({ ...l }));
	if (cur > 0) {
		// Chain rule: the previous line ENDS where this one begins — an end nudge from its
		// true window, so hand-set character spans carry through the same path as a manual nudge.
		const prev = lines[cur - 1];
		out[cur - 1] = nudgeEditorLine(prev, 'end', at - prev.end, durationSec);
	}
	// The stamp itself is the existing gesture (start at the playhead, length kept, chars
	// carried); when the line's old end is still ahead of the playhead — the degenerate case,
	// where it sits at the duration — that end is kept, so the line stays "current" until the
	// next tap chains it shut.
	const orig = lines[cur];
	const stamped = stampEditorLine(orig, at, durationSec);
	const end = orig.end > at ? Math.max(stamped.end, orig.end) : stamped.end;
	out[cur] = end !== stamped.end ? nudgeEditorLine(stamped, 'end', end - stamped.end, durationSec) : stamped;
	return { lines: out, cursor: cur + 1 };
}

/**
 * The draft's timing class: 'estimated' while every stamp is still the estimator's, 'precise'
 * once any real timestamp source or hand adjustment has touched it, 'empty' with no lines.
 * The component tracks the transitions; this names the classes in one place.
 */
export type EditorTimingClass = 'empty' | 'estimated' | 'precise';

// ─────────────────────────────────────────────────────────────────────────────
// quick-261125-cascade — CASCADE TIMING + INTERLUDE SEGMENTS (Hector 2026-11-23
// rulings 02:26 / 04:11 / 04:14 / 16:59, re-flagged 2026-11-25 as still unbuilt).
//
// CASCADE (the "train" metaphor): editing one line's start in Single mode moves
// only that line — wrong when an imported LRC is offset by a different intro:
// the user fixes line 1 and every later line must follow by the same delta,
// relative gaps preserved. Three modes, one pure implementation each:
//   · 'single' — the pre-cascade behaviour (nudge/move/stamp above), unchanged.
//   · 'ripple' — lines from the edited index onward shift by one delta; the
//     CHAIN rule applies: this format is [start][end] where a line's end is the
//     next line's start, so the previous line's end follows the shifted start
//     (it stretches/shrinks — no hole, no overlap is ever created).
//   · 'anchor' — first start + last end are pinned to new values and every
//     middle boundary scales proportionally between them.
//
// INTERLUDES (blank-time segments): a stretch of instrumental / long-note time
// between lines is REAL timing data — an InterludeSegment {start,end} — never a
// fake empty lyric line. ONE model, read by BOTH sides:
//   · the editor renders a segment as a SPINNER row only (no word ever sits in
//     a lyric position; duration appears only as editor-side info);
//   · playback (NpLyrics) derives segments from the same spans via
//     interludeSegmentsFromSpans and shows a plain progress bar.
// PERSISTENCE / LRC EXPORT: a segment needs no new syntax — it exports AS the
// silence between the previous line's explicit [end] tag and the next line's
// [start] tag (head segment = the first line's start; tail segment = last
// line's [end] against the known duration). serializeEditorLines therefore
// carries segments losslessly for line timings, and interludesFromEditorLines
// recovers the gap as one segment on re-import. A tail segment's end beyond
// the last line is bounded by the track duration, exactly as lineEndAt does.

/** How a start/end edit propagates. 'single' is the default and the fallback. */
export type EditorCascadeMode = 'single' | 'ripple' | 'anchor';

/** A blank-time (instrumental / long-note) segment: real timing data, no text. */
export interface InterludeSegment {
	start: number;
	end: number;
}

/** Default length of a freshly inserted interlude, before the user resizes it. */
export const DEFAULT_INTERLUDE_SEC = 5;

/** Half a snap step: two stamps closer than this are the same chain joint. */
const JOINT_EPS = 0.05;

/** Snap a DELTA to the 0.1s grid — unlike snapTenth (absolute times), negatives survive. */
function snapDelta(v: number): number {
	if (!Number.isFinite(v)) return 0;
	return Math.round(v * 10) / 10 || 0;
}

function shiftLine(l: EditorLine, delta: number): EditorLine {
	return { start: snapTenth(l.start + delta), end: snapTenth(l.end + delta), text: l.text };
}

/**
 * Clamp a ripple delta so the shift can never collide or leave the song:
 * the first shifted line's start stays ≥ the previous line's chain floor
 * (its start + 0.1 when chained — the previous line stretches — or its end
 * when a gap precedes, the gap may close to zero), ≥ 0 at the head, and the
 * last line's end stays ≤ duration when known. Returns the applied delta.
 */
function clampRippleDelta(
	lines: readonly EditorLine[],
	fromIndex: number,
	delta: number,
	durationSec: number
): number {
	let d = snapDelta(delta);
	if (fromIndex <= 0) {
		d = Math.max(d, -lines[0].start);
	} else {
		const prev = lines[fromIndex - 1];
		const cur = lines[fromIndex];
		const chained = prev.end >= cur.start - JOINT_EPS;
		const floor = chained ? prev.start + 0.1 : prev.end;
		d = Math.max(d, snapDelta(floor - cur.start));
	}
	if (Number.isFinite(durationSec) && durationSec > 0) {
		d = Math.min(d, snapDelta(durationSec - lines[lines.length - 1].end));
	}
	return d;
}

/**
 * RIPPLE-TRAIN: shift lines[fromIndex..] (start AND end) by delta, gaps
 * preserved. The previous line, when chained to the first shifted line
 * (its end == the shifted start), has its end pulled along to the new start —
 * the chain never tears. Monotonic non-decreasing by construction + clamping.
 */
export function rippleShiftLines(
	lines: readonly EditorLine[],
	fromIndex: number,
	delta: number,
	durationSec = 0
): EditorLine[] {
	if (!lines.length || fromIndex < 0 || fromIndex >= lines.length) return lines.slice();
	const d = clampRippleDelta(lines, fromIndex, delta, durationSec);
	if (d === 0) return lines.slice();
	const out = lines.map((l, i) => (i >= fromIndex ? shiftLine(l, d) : { ...l }));
	if (fromIndex > 0) {
		const prev = lines[fromIndex - 1];
		if (prev.end >= lines[fromIndex].start - JOINT_EPS) {
			out[fromIndex - 1] = { ...prev, end: out[fromIndex].start };
		}
	}
	return out;
}

/**
 * Ripple applied to a whole draft (lines + interlude segments): segments at or
 * after the shift point ride along; the segment that ENDS at the shift point
 * (the blank before the first shifted line) resizes — the gap absorbs the move.
 */
export function rippleShiftDraft(
	lines: readonly EditorLine[],
	segments: readonly InterludeSegment[],
	fromIndex: number,
	delta: number,
	durationSec = 0
): { lines: EditorLine[]; segments: InterludeSegment[] } {
	if (!lines.length || fromIndex < 0 || fromIndex >= lines.length)
		return { lines: lines.slice(), segments: segments.slice() };
	const fromStart = lines[fromIndex].start;
	const next = rippleShiftLines(lines, fromIndex, delta, durationSec);
	const applied = snapDelta(next[fromIndex].start - fromStart);
	if (applied === 0) return { lines: next, segments: segments.slice() };
	// When a segment ends exactly at the shift point, the SEGMENT absorbs the
	// move (it resizes below) — the previous line's end must not be chain-pulled
	// across it, so restore it.
	if (fromIndex > 0 && segments.some((s) => Math.abs(s.end - fromStart) < JOINT_EPS)) {
		next[fromIndex - 1] = { ...next[fromIndex - 1], end: lines[fromIndex - 1].end };
	}
	const segs = segments.map((s) => {
		if (s.start >= fromStart - JOINT_EPS)
			return { start: snapTenth(s.start + applied), end: snapTenth(s.end + applied) };
		if (s.end >= fromStart - JOINT_EPS)
			return { start: s.start, end: snapTenth(s.end + applied) };
		return { ...s };
	});
	return { lines: next, segments: segs };
}

/**
 * ANCHOR STRETCH: pin the first line's start to newStart and the last line's
 * end to newEnd; every boundary scales proportionally between the pins. The
 * span is floored so every line keeps its 0.1s minimum, pins clamp into
 * [0, duration], and a repair pass keeps the chain monotonic after snapping.
 */
export function anchorStretchLines(
	lines: readonly EditorLine[],
	newStart: number,
	newEnd: number,
	durationSec = 0
): EditorLine[] {
	if (lines.length < 2) return lines.slice();
	const oldStart = lines[0].start;
	const oldEnd = lines[lines.length - 1].end;
	const oldSpan = oldEnd - oldStart;
	if (!(oldSpan > 0)) return lines.slice();
	let start = snapTenth(Math.max(0, newStart));
	let end = snapTenth(newEnd);
	const minSpan = snapTenth(lines.length * 0.1);
	if (end < start + minSpan) end = snapTenth(start + minSpan);
	if (Number.isFinite(durationSec) && durationSec > 0 && end > snapTenth(durationSec)) {
		end = snapTenth(durationSec);
		if (end < start + minSpan) start = Math.max(0, snapTenth(end - minSpan));
	}
	const factor = (end - start) / oldSpan;
	const mapped = lines.map((l) => ({
		start: snapTenth(start + (l.start - oldStart) * factor),
		end: snapTenth(start + (l.end - oldStart) * factor),
		text: l.text
	}));
	// Repair: snapping must never invert a line or tear the chain's monotonicity.
	for (let i = 0; i < mapped.length; i++) {
		if (i > 0 && mapped[i].start < mapped[i - 1].end)
			mapped[i] = { ...mapped[i], start: mapped[i - 1].end };
		if (mapped[i].end < mapped[i].start + 0.1)
			mapped[i] = { ...mapped[i], end: snapTenth(mapped[i].start + 0.1) };
	}
	const last = mapped[mapped.length - 1];
	if (last.end !== end) {
		mapped[mapped.length - 1] = { ...last, end };
		if (end < last.start + 0.1)
			mapped[mapped.length - 1] = { ...last, end, start: snapTenth(end - 0.1) };
	}
	return mapped;
}

/**
 * THE segment derivation — the one definition both the editor and playback
 * read. Given timed spans (start/end pairs) in song order, the blank time is
 * wherever the next span starts after everything before it has ended: the
 * head gap (0 → first start), every between-gap, and the tail gap against
 * the known duration. Spans may share timestamps (translation siblings):
 * the cursor only ever moves forward, so siblings create no phantom gaps.
 */
export function interludeSegmentsFromSpans(
	spans: readonly { start: number; end: number }[],
	durationSec = 0
): InterludeSegment[] {
	const out: InterludeSegment[] = [];
	let cursor = 0;
	const sorted = spans.slice().sort((a, b) => a.start - b.start);
	for (const s of sorted) {
		if (s.start > cursor + JOINT_EPS) out.push({ start: snapTenth(cursor), end: snapTenth(s.start) });
		cursor = Math.max(cursor, s.end);
	}
	if (Number.isFinite(durationSec) && durationSec > cursor + JOINT_EPS)
		out.push({ start: snapTenth(cursor), end: snapTenth(durationSec) });
	return out;
}

/** Segments of an editor draft, derived from its lines (see header: one model). */
export function interludesFromEditorLines(
	lines: readonly EditorLine[],
	durationSec = 0
): InterludeSegment[] {
	return interludeSegmentsFromSpans(lines, durationSec);
}

/**
 * Insert a blank-time segment BEFORE lines[beforeIndex] (beforeIndex ==
 * lines.length inserts after the last line; 0 inserts before the first).
 * Between lines, the following lines ripple by the segment's length so the
 * gap is real; at the tail nothing moves — the segment runs from the last
 * line's end toward the duration. An existing segment touching the insertion
 * point is extended instead of stacking a second one. Length clamps to the
 * room available; a segment that cannot fit changes nothing.
 */
export function insertInterlude(
	lines: readonly EditorLine[],
	segments: readonly InterludeSegment[],
	beforeIndex: number,
	lengthSec: number,
	durationSec = 0
): { lines: EditorLine[]; segments: InterludeSegment[] } {
	const len = Math.max(0.1, snapTenth(lengthSec));
	const at = Math.max(0, Math.min(beforeIndex, lines.length));
	if (at >= lines.length) {
		// Tail (or empty draft): no line moves.
		const start = lines.length ? lines[lines.length - 1].end : 0;
		let end = snapTenth(start + len);
		if (Number.isFinite(durationSec) && durationSec > 0) end = Math.min(end, snapTenth(durationSec));
		if (end < start + 0.1) return { lines: lines.slice(), segments: segments.slice() };
		const segs = segments.slice();
		const touch = segs.findIndex((s) => Math.abs(s.start - start) < JOINT_EPS);
		if (touch >= 0) segs[touch] = { start: segs[touch].start, end };
		else segs.push({ start, end });
		return { lines: lines.slice(), segments: segs.sort((a, b) => a.start - b.start) };
	}
	const gapStart = lines[at].start;
	// A segment already ending at the insertion point absorbs the shift inside
	// rippleShiftDraft (its end rides along) — it must not be duplicated below.
	const hadTouching = segments.some((s) => Math.abs(s.end - gapStart) < JOINT_EPS);
	const shifted = rippleShiftDraft(lines, segments, at, len, durationSec);
	const applied = snapDelta(shifted.lines[at].start - gapStart);
	if (applied < 0.1) return { lines: lines.slice(), segments: segments.slice() };
	// The inserted segment is the absorber at this joint: the previous line
	// keeps its own end (the segment starts there), never chain-pulled across.
	if (at > 0) shifted.lines[at - 1] = { ...shifted.lines[at - 1], end: lines[at - 1].end };
	const segs = shifted.segments.slice();
	if (!hadTouching) segs.push({ start: gapStart, end: snapTenth(gapStart + applied) });
	return { lines: shifted.lines, segments: segs.sort((a, b) => a.start - b.start) };
}

/**
 * Resize a segment by moving its END: every line and segment at or after the
 * old end rides by the same delta (the chain rule), so the following lyric
 * keeps its distance from everything after it. The segment keeps a 0.1s
 * minimum — the monotonic guard: a resize can never push a line before the
 * segment's own start, nor past the duration.
 */
export function resizeInterlude(
	lines: readonly EditorLine[],
	segments: readonly InterludeSegment[],
	segIndex: number,
	newEnd: number,
	durationSec = 0
): { lines: EditorLine[]; segments: InterludeSegment[] } {
	const seg = segments[segIndex];
	if (!seg) return { lines: lines.slice(), segments: segments.slice() };
	let end = snapTenth(newEnd);
	end = Math.max(end, snapTenth(seg.start + 0.1));
	if (Number.isFinite(durationSec) && durationSec > 0) end = Math.min(end, snapTenth(durationSec));
	const delta = snapDelta(end - seg.end);
	if (delta === 0) return { lines: lines.slice(), segments: segments.slice() };
	// Clamp the delta against the tail of the song (last affected line's end).
	if (Number.isFinite(durationSec) && durationSec > 0 && delta > 0) {
		const tail = lines.filter((l) => l.start >= seg.end - JOINT_EPS);
		if (tail.length) {
			const room = snapTenth(durationSec - tail[tail.length - 1].end);
			if (room <= 0) return { lines: lines.slice(), segments: segments.slice() };
			if (room < delta) return resizeInterlude(lines, segments, segIndex, seg.end + room, durationSec);
		}
	}
	const outLines = lines.map((l) =>
		l.start >= seg.end - JOINT_EPS ? shiftLine(l, delta) : { ...l }
	);
	const outSegs = segments.map((s, i) => {
		if (i === segIndex) return { start: s.start, end };
		if (s.start >= seg.end - JOINT_EPS)
			return { start: snapTenth(s.start + delta), end: snapTenth(s.end + delta) };
		return { ...s };
	});
	return { lines: outLines, segments: outSegs };
}

/**
 * Delete a segment: the lines after it ripple back by its length, closing
 * the gap — the chain is whole again (the previous line's end meets the
 * following line's start exactly as before the insert).
 */
export function deleteInterlude(
	lines: readonly EditorLine[],
	segments: readonly InterludeSegment[],
	segIndex: number
): { lines: EditorLine[]; segments: InterludeSegment[] } {
	const seg = segments[segIndex];
	if (!seg) return { lines: lines.slice(), segments: segments.slice() };
	const len = snapTenth(seg.end - seg.start);
	const outLines = lines.map((l) =>
		l.start >= seg.end - JOINT_EPS ? shiftLine(l, -len) : { ...l }
	);
	const outSegs = segments
		.filter((_, i) => i !== segIndex)
		.map((s) =>
			s.start >= seg.end - JOINT_EPS
				? { start: snapTenth(s.start - len), end: snapTenth(s.end - len) }
				: { ...s }
		);
	return { lines: outLines, segments: outSegs };
}

/** The segment playing at `now`, with its 0..1 progress — playback's bar maths. */
export function activeInterludeAt(
	segments: readonly InterludeSegment[],
	now: number
): { segment: InterludeSegment; progress: number } | null {
	for (const s of segments) {
		if (now >= s.start && now < s.end) {
			const span = s.end - s.start;
			return { segment: s, progress: span > 0 ? Math.min(1, Math.max(0, (now - s.start) / span)) : 0 };
		}
	}
	return null;
}

