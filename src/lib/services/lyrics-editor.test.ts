import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	snapTenth,
	splitPastedText,
	looksLikeLrc,
	estimateLines,
	editorLinesFromLrc,
	serializeEditorLines,
	clampEditorLine,
	nudgeEditorLine,
	moveEditorLine,
	stampEditorLine,
	hasDegenerateStamps,
	stampNextInSequence,
	cascadeEditorLines,
	ESTIMATE_FALLBACK_LINE_SEC,
	type EditorLine
} from './lyrics-editor';
import { parseLRC } from './lrc';
import { getPinnedLyrics, setPinnedLyrics, removePinnedLyrics } from './lyric-pins';

// quick-261120-ugcb2 — the LyricsEditor's pure seam. The founding principle under test:
// ONE paste of plain text yields a singable estimated lyric with zero further work; the
// estimator's maths, the 0.1s pinpoint gestures and the start+end round-trip through
// serialize → parse → pin store are what make that promise safe to keep.

describe('snapTenth — the one 0.1s granularity', () => {
	it('rounds to tenths, folds -0, floors negatives and non-finite at 0', () => {
		expect(snapTenth(1.24)).toBe(1.2);
		expect(snapTenth(1.25)).toBe(1.3);
		expect(snapTenth(-0.04)).toBe(0);
		expect(snapTenth(-3)).toBe(0);
		expect(snapTenth(Number.NaN)).toBe(0);
		expect(snapTenth(Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe('splitPastedText — newlines are the lines', () => {
	it('splits, trims and drops blanks', () => {
		expect(splitPastedText('  one \n\ntwo\r\n three ')).toEqual(['one', 'two', 'three']);
		expect(splitPastedText('')).toEqual([]);
		expect(splitPastedText('\n\n')).toEqual([]);
	});
});

describe('looksLikeLrc', () => {
	it('detects timestamp tags, rejects plain text', () => {
		expect(looksLikeLrc('[00:12.34]hello')).toBe(true);
		expect(looksLikeLrc('[1:02]hello')).toBe(true);
		expect(looksLikeLrc('just some lyrics\nmore words')).toBe(false);
	});
});

describe('estimateLines — duration ÷ lines, stamped in sequence', () => {
	it('gives each line the average interval; the last line ends at the duration', () => {
		const lines = estimateLines(['a', 'b', 'c', 'd'], 100);
		expect(lines.map((l) => [l.start, l.end])).toEqual([
			[0, 25],
			[25, 50],
			[50, 75],
			[75, 100]
		]);
	});
	it('snaps fractional steps to 0.1s and stays monotonic', () => {
		const lines = estimateLines(['a', 'b', 'c'], 10);
		expect(lines.map((l) => l.start)).toEqual([0, 3.3, 6.7]);
		for (let i = 1; i < lines.length; i++) expect(lines[i].start).toBeGreaterThanOrEqual(lines[i - 1].start);
		expect(lines[lines.length - 1].end).toBe(10);
	});
	it('falls back to a nominal per-line step when the duration is unknown', () => {
		const lines = estimateLines(['a', 'b'], 0);
		expect(lines[0]).toMatchObject({ start: 0, end: ESTIMATE_FALLBACK_LINE_SEC });
		expect(lines[1].start).toBe(ESTIMATE_FALLBACK_LINE_SEC);
	});
	it('empty in, empty out', () => {
		expect(estimateLines([], 100)).toEqual([]);
	});
});

describe('start+end round-trip — editor → serialize → parse → editor', () => {
	it('explicit ends survive, including an end that is NOT the next start (instrumental gap)', () => {
		const lines: EditorLine[] = [
			{ start: 0, end: 4.5, text: 'first' },
			{ start: 12, end: 15, text: 'after the break' }
		];
		const lrc = serializeEditorLines(lines);
		const back = editorLinesFromLrc(lrc, 60);
		expect(back).toEqual(lines);
	});
	it('legacy single-tag LRC gets ends from the next line start, last from the duration', () => {
		const back = editorLinesFromLrc('[00:01.00]one\n[00:05.50]two', 20);
		expect(back).toEqual([
			{ start: 1, end: 5.5, text: 'one' },
			{ start: 5.5, end: 20, text: 'two' }
		]);
	});
	it('parseLRC reads the double-tag end; a tag not after the start stays legacy text', () => {
		const parsed = parseLRC('[00:10.00][00:14.00]kept\n[00:20.00][00:19.00]stale tag');
		expect(parsed[0]).toMatchObject({ time: 10, end: 14, text: 'kept' });
		// Legacy behaviour preserved byte-for-byte: before the end existed, a second tag was
		// simply part of the text (parseLRC stripped only the first). A stale end must not
		// silently eat text lines in the wild may carry.
		expect(parsed[1].end).toBeUndefined();
		expect(parsed[1].text).toBe('[00:19.00]stale tag');
	});
});

describe('editorLinesFromLrc — untimed lines survive (quick-261123-untimed)', () => {
	// Hector 2026-11-23: header lines typed into the raw box above the timed lines vanished
	// at derive time — parseLRC drops untimed lines, and the editor was built on it alone.
	const withHeaders =
		'Sorry呢度係香港\nSong by Billy Choi · 2023\n[00:05.50]first sung\n[00:10.00]second sung';

	it('headers above the timed lines survive editor → serialize → parse, texts and order intact', () => {
		const lines = editorLinesFromLrc(withHeaders, 60);
		expect(lines.map((l) => l.text)).toEqual([
			'Sorry呢度係香港',
			'Song by Billy Choi · 2023',
			'first sung',
			'second sung'
		]);
		// Positional: before the first timed line → start 0, end = that line's start.
		expect(lines[0]).toMatchObject({ start: 0, end: 5.5 });
		expect(lines[1]).toMatchObject({ start: 0, end: 5.5 });
		const back = parseLRC(serializeEditorLines(lines));
		expect(back.map((l) => l.text)).toEqual(lines.map((l) => l.text));
	});

	it('an untimed line between timed lines spans previous end → next start', () => {
		const lines = editorLinesFromLrc('[00:01.00][00:05.50]one\nmiddle note\n[00:10.00]two', 60);
		expect(lines.map((l) => l.text)).toEqual(['one', 'middle note', 'two']);
		expect(lines[1]).toMatchObject({ start: 5.5, end: 10 });
		expect(parseLRC(serializeEditorLines(lines)).map((l) => l.text)).toEqual(['one', 'middle note', 'two']);
	});

	it('with a playhead supplied, untimed lines are stamped at the playhead (0.1 snap)', () => {
		const lines = editorLinesFromLrc(withHeaders, 60, 12.34);
		expect(lines[0]).toMatchObject({ start: 12.3, text: 'Sorry呢度係香港' });
		expect(lines[1]).toMatchObject({ start: 12.3, text: 'Song by Billy Choi · 2023' });
		// The timed lines keep their own stamps.
		expect(lines[2]).toMatchObject({ start: 5.5, text: 'first sung' });
	});

	it('untimed-only text is kept (estimator distribution, round-trips)', () => {
		const lines = editorLinesFromLrc('alpha\nbeta', 40);
		expect(lines.map((l) => l.text)).toEqual(['alpha', 'beta']);
		expect(lines.map((l) => [l.start, l.end])).toEqual([
			[0, 20],
			[20, 40]
		]);
		expect(parseLRC(serializeEditorLines(lines)).map((l) => l.text)).toEqual(['alpha', 'beta']);
	});
});

describe('pinpoint gestures — drag / nudge / stamp at 0.1s', () => {
	const line: EditorLine = { start: 10, end: 14, text: 'x' };
	it('nudge moves one boundary and clamps end above start', () => {
		expect(nudgeEditorLine(line, 'start', 0.1)).toMatchObject({ start: 10.1, end: 14 });
		expect(nudgeEditorLine(line, 'end', -0.1)).toMatchObject({ start: 10, end: 13.9 });
		expect(nudgeEditorLine(line, 'end', -99)).toMatchObject({ end: 10.1 });
		expect(nudgeEditorLine(line, 'start', -99)).toMatchObject({ start: 0 });
	});
	it('move shifts both boundaries, preserving length, clamped to the duration', () => {
		expect(moveEditorLine(line, 2.04, 60)).toMatchObject({ start: 12, end: 16 });
		const clamped = moveEditorLine(line, 999, 60);
		expect(clamped.end).toBe(60);
		expect(clamped.end - clamped.start).toBeCloseTo(4, 5);
	});
	it('stamp puts the start at the playhead and keeps the length', () => {
		expect(stampEditorLine(line, 20.26, 60)).toMatchObject({ start: 20.3, end: 24.3 });
	});
	it('clamp enforces a minimum line length of 0.1s', () => {
		expect(clampEditorLine({ start: 5, end: 5, text: 'x' })).toMatchObject({ start: 5, end: 5.1 });
	});
});

// The Phase-1 save path end to end, minus the DOM: editor lines → LRC text → the pin store →
// the read every lyric surface performs. In-memory localStorage stub, the lyric-pins.test.ts way.
class MemStorage {
	private m = new Map<string, string>();
	getItem(k: string): string | null {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string): void {
		this.m.set(k, String(v));
	}
	removeItem(k: string): void {
		this.m.delete(k);
	}
	clear(): void {
		this.m.clear();
	}
}

describe('editor → pin store round-trip (Phase-1 save path)', () => {
	const original = (globalThis as { localStorage?: Storage }).localStorage;
	beforeEach(() => {
		Object.defineProperty(globalThis, 'localStorage', { value: new MemStorage(), configurable: true });
	});
	afterEach(() => {
		Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true });
	});

	it('a pasted, estimated draft saves and reads back with the same starts, ends and texts', () => {
		const draft = estimateLines(splitPastedText('line one\nline two\nline three'), 30);
		setPinnedLyrics('uid-b2', serializeEditorLines(draft));
		const saved = getPinnedLyrics('uid-b2');
		expect(saved).toBeTruthy();
		expect(editorLinesFromLrc(saved as string, 30)).toEqual(draft);
		removePinnedLyrics('uid-b2');
		expect(getPinnedLyrics('uid-b2')).toBeNull();
	});
});

describe('cascadeEditorLines — the [start][end] chain cascade (quick-261123-cascade)', () => {
	// Hector's case: a chain lyric whose line 1 really starts at 0 but was pulled to 0:35.9.
	const chain = (): EditorLine[] => [
		{ start: 0, end: 7.7, text: 'one' },
		{ start: 7.7, end: 15, text: 'two' },
		{ start: 15, end: 22, text: 'three' }
	];
	const spans = (ls: EditorLine[]) => ls.map((l) => [l.start, l.end]);

	it("line 1's start edit shifts ALL following lines by the same delta, gaps preserved", () => {
		expect(spans(cascadeEditorLines(chain(), 0, 'start', 35.9, 60))).toEqual([
			[35.9, 43.6],
			[43.6, 50.9],
			[50.9, 57.9]
		]);
	});

	it('the saved order can no longer scramble: a cascaded chain round-trips in text order', () => {
		const out = cascadeEditorLines(chain(), 0, 'start', 35.9, 60);
		expect(parseLRC(serializeEditorLines(out)).map((l) => l.text)).toEqual(['one', 'two', 'three']);
	});

	it("a mid-chain start edit chains the previous line's end to the new start", () => {
		expect(spans(cascadeEditorLines(chain(), 1, 'start', 2, 60))).toEqual([
			[0, 9.7],
			[9.7, 17],
			[17, 24]
		]);
	});

	it("an end edit moves the next line's start with it and shifts the tail", () => {
		expect(spans(cascadeEditorLines(chain(), 0, 'end', -2, 60))).toEqual([
			[0, 5.7],
			[5.7, 13],
			[13, 20]
		]);
	});

	it('a start edit never crosses the previous line or zero (delta clamps, chain stays valid)', () => {
		const out = cascadeEditorLines(chain(), 1, 'start', -20, 60);
		expect(out[1].start).toBe(0.1);
		expect(out[0].end).toBe(0.1);
		for (let k = 1; k < out.length; k++) expect(out[k].start).toBeGreaterThan(out[k - 1].start);
	});

	it('nothing is pushed past the duration — the whole chain stops together', () => {
		const out = cascadeEditorLines(chain(), 0, 'start', 100, 60);
		expect(out[out.length - 1].end).toBe(60);
		expect(spans(out)).toEqual([
			[38, 45.7],
			[45.7, 53],
			[53, 60]
		]);
	});

	it('an end edit keeps at least 0.1s of its own line', () => {
		const out = cascadeEditorLines(chain(), 2, 'end', -100, 60);
		expect(out[2]).toMatchObject({ start: 15, end: 15.1 });
	});

	it('out-of-range index and zero delta are no-ops (copies, never the input array)', () => {
		const src = chain();
		expect(cascadeEditorLines(src, 9, 'start', 1, 60)).toEqual(src);
		expect(cascadeEditorLines(src, 0, 'start', 0, 60)).toEqual(src);
		expect(cascadeEditorLines(src, 0, 'start', 1, 60)).not.toBe(src);
	});
});

describe('hasDegenerateStamps — the all-at-end signature (quick-261122-tsfix)', () => {
	const atEnd = (n: number, t = 222): EditorLine[] =>
		Array.from({ length: n }, (_, i) => ({ start: t, end: t, text: `line ${i}` }));
	it('fires on 51 lines all stamped at the duration (the 刺蝟的智慧 case)', () => {
		expect(hasDegenerateStamps(atEnd(51), 222)).toBe(true);
	});
	it('fires when ≥90% sit at the end even if a few lines carry real stamps', () => {
		const lines = atEnd(10);
		lines[0] = { start: 3, end: 6, text: 'real' };
		expect(hasDegenerateStamps(lines, 222)).toBe(true);
	});
	it('does not fire on a normal spread', () => {
		expect(hasDegenerateStamps(estimateLines(['a', 'b', 'c', 'd', 'e', 'f'], 60), 60)).toBe(false);
	});
	it('does not fire below the line floor, or on an empty draft', () => {
		expect(hasDegenerateStamps(atEnd(4), 222)).toBe(false);
		expect(hasDegenerateStamps([], 222)).toBe(false);
	});
	it('all-at-0 is provable without a duration; all-at-end is not', () => {
		expect(hasDegenerateStamps(atEnd(6, 0), 0)).toBe(true);
		expect(hasDegenerateStamps(atEnd(6, 222), 0)).toBe(false);
	});
	it('a same-stamp cluster mid-song is not the signature', () => {
		const lines = [...atEnd(9, 30), { start: 200, end: 210, text: 'x' }];
		expect(hasDegenerateStamps(lines, 222)).toBe(false);
	});
	// quick-261122-tsfix2 — REGRESSION (live failure 2026-11-22): stamps are written against
	// the NOMINAL duration (222.0) but the editor passes the LIVE player duration, which is
	// essentially never exactly nominal. The original 0.1s end tolerance made the predicate
	// false for every real file (12 probe lines × [03:42.00] on 刺蝟的智慧， no banner).
	it('fires when the live duration runs slightly long (222.0 stamps, 222.6 duration)', () => {
		expect(hasDegenerateStamps(atEnd(12), 222.6)).toBe(true);
	});
	it('fires when the live duration runs ~2s long (222.0 stamps, 224 duration)', () => {
		expect(hasDegenerateStamps(atEnd(12), 224)).toBe(true);
	});
	it('fires when the stamps overshoot a slightly-shorter actual duration (222.0 stamps, 221.5 duration)', () => {
		expect(hasDegenerateStamps(atEnd(12), 221.5)).toBe(true);
	});
	it('a cluster at 200 with duration 222 is still mid-song, not the end (stays false)', () => {
		expect(hasDegenerateStamps(atEnd(10, 200), 222)).toBe(false);
	});
});

describe('stampNextInSequence — tap-to-sync chain stamp (quick-261122-tsfix)', () => {
	const degen = (): EditorLine[] => [0, 1, 2].map((i) => ({ start: 222, end: 222, text: `l${i}` }));
	it('first stamp sets the start at the playhead (snapped) and keeps the duration end', () => {
		const r = stampNextInSequence(degen(), 0, 12.34, 222);
		expect(r.cursor).toBe(1);
		expect(r.lines[0]).toMatchObject({ start: 12.3, end: 222 });
		expect(r.lines[1]).toMatchObject({ start: 222, end: 222 });
	});
	it('the next stamp chains the previous line shut at the same instant', () => {
		const first = stampNextInSequence(degen(), 0, 12.34, 222);
		const r = stampNextInSequence(first.lines, first.cursor, 15.26, 222);
		expect(r.cursor).toBe(2);
		expect(r.lines[0]).toMatchObject({ start: 12.3, end: 15.3 });
		expect(r.lines[1]).toMatchObject({ start: 15.3, end: 222 });
	});
	it('stamping the last line completes the cursor; further stamps are a no-op', () => {
		let s = stampNextInSequence(degen(), 0, 10, 222);
		s = stampNextInSequence(s.lines, s.cursor, 20, 222);
		s = stampNextInSequence(s.lines, s.cursor, 30, 222);
		expect(s.cursor).toBe(3);
		expect(s.lines[2]).toMatchObject({ start: 30, end: 222 });
		const again = stampNextInSequence(s.lines, s.cursor, 40, 222);
		expect(again.cursor).toBe(3);
		expect(again.lines).toEqual(s.lines);
	});
	it('a normal line keeps its length when its old end is behind the playhead', () => {
		const lines: EditorLine[] = [
			{ start: 10, end: 14, text: 'x' },
			{ start: 14, end: 18, text: 'y' }
		];
		const r = stampNextInSequence(lines, 0, 20, 60);
		expect(r.lines[0]).toMatchObject({ start: 20, end: 24 });
	});
	it('outputs stay monotonic and 0.1-snapped through a full pass', () => {
		let s: { lines: EditorLine[]; cursor: number } = { lines: degen(), cursor: 0 };
		for (const t of [3.33, 7.77, 11.11]) s = stampNextInSequence(s.lines, s.cursor, t, 222);
		expect(s.lines.map((l) => l.start)).toEqual([3.3, 7.8, 11.1]);
		for (let i = 1; i < s.lines.length; i++) expect(s.lines[i].start).toBeGreaterThanOrEqual(s.lines[i - 1].start);
	});
	it('hand-set character spans re-time through the chain (the carryChars route)', () => {
		const lines: EditorLine[] = [
			{ start: 0, end: 4, text: 'ab', chars: [{ text: 'a', start: 0, end: 2 }, { text: 'b', start: 2, end: 4 }] },
			{ start: 4, end: 8, text: 'cd' }
		];
		const r1 = stampNextInSequence(lines, 0, 10, 60);
		expect(r1.lines[0]).toMatchObject({ start: 10, end: 14 });
		expect(r1.lines[0].chars).toEqual([
			{ text: 'a', start: 10, end: 12 },
			{ text: 'b', start: 12, end: 14 }
		]);
		const r2 = stampNextInSequence(r1.lines, 1, 12, 60);
		expect(r2.lines[0]).toMatchObject({ start: 10, end: 12 });
		expect(r2.lines[0].chars).toEqual([
			{ text: 'a', start: 10, end: 11 },
			{ text: 'b', start: 11, end: 12 }
		]);
	});
});
