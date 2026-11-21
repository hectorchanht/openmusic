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
