// quick-261122-ugcb4 — the character layer: pre-allocation, enhanced-LRC round-trip, 0.1s edits.
import { describe, it, expect } from 'vitest';
import {
	splitLineChars,
	allocateChars,
	parseCharStamps,
	serializeCharSpans,
	charSpansFor,
	isAllocation,
	nudgeCharStart,
	setCharStart,
	retimeChars,
	charFillAt,
	MIN_CHAR_SEC
} from './lyric-chars';
import { parseLRC, serializeLRC } from './lrc';

describe('pre-allocation — the layer never starts blank', () => {
	it('splits graphemes, folding whitespace onto the previous character', () => {
		expect(splitLineChars('我愛你')).toEqual(['我', '愛', '你']);
		expect(splitLineChars('I love')).toEqual(['I ', 'l', 'o', 'v', 'e']);
		expect(splitLineChars('👍🏽ok')).toEqual(['👍🏽', 'o', 'k']);
	});
	it('equal share of the line window, in singing order, ending exactly at the line end', () => {
		const a = allocateChars('我愛你', 12, 15);
		expect(a.map((c) => [c.text, c.start, c.end])).toEqual([
			['我', 12, 13],
			['愛', 13, 14],
			['你', 14, 15]
		]);
	});
	it('charSpansFor allocates when a line has no hand-set characters', () => {
		const spans = charSpansFor({ text: 'abcd', time: 0 }, 4);
		expect(spans.map((c) => c.start)).toEqual([0, 1, 2, 3]);
		expect(isAllocation(spans, 'abcd', 0, 4)).toBe(true);
	});
	it('falls back to allocation when explicit spans no longer match the text (edited line)', () => {
		const spans = charSpansFor({ text: 'xyz', time: 0, chars: [{ text: 'a', start: 0, end: 1 }] }, 3);
		expect(spans.map((c) => c.text)).toEqual(['x', 'y', 'z']);
	});
});

describe('enhanced-LRC format — lossless structured data', () => {
	it('parses starts, implicit ends and an explicit end marker (held note / gap)', () => {
		const p = parseCharStamps('<00:12.00>我<00:12.80>愛<00:13.50>你<00:14.60>');
		expect(p?.text).toBe('我愛你');
		expect(p?.chars).toEqual([
			{ text: '我', start: 12, end: 12.8 },
			{ text: '愛', start: 12.8, end: 13.5 },
			{ text: '你', start: 13.5, end: 14.6 }
		]);
	});
	it('a mid-line end marker ends the previous character before the next starts', () => {
		const p = parseCharStamps('<00:01.00>a<00:01.50><00:02.00>b');
		expect(p?.chars).toEqual([
			{ text: 'a', start: 1, end: 1.5 },
			{ text: 'b', start: 2 }
		]);
	});
	it('serialize ∘ parse round-trips (centisecond precision)', () => {
		const chars = [
			{ text: '我', start: 12, end: 12.8 },
			{ text: '愛', start: 12.8, end: 13.2 },
			{ text: '你', start: 13.5, end: 14.6 }
		];
		const s = serializeCharSpans(chars, 15);
		expect(s).toBe('<00:12.00>我<00:12.80>愛<00:13.20><00:13.50>你<00:14.60>');
		const back = parseCharStamps(s);
		expect(charSpansFor({ text: back!.text, time: 12, chars: back!.chars }, 15)).toEqual(chars);
	});
	it('word-level enhanced LRC from elsewhere parses as word spans', () => {
		const p = parseCharStamps('<00:01.00>hello <00:02.00>world');
		expect(p?.text).toBe('hello world');
		expect(p?.chars.map((c) => c.text)).toEqual(['hello ', 'world']);
	});
	it('parseLRC strips character stamps from display text and keeps the spans', () => {
		const [l] = parseLRC('[00:12.00][00:15.00]<00:12.00>我<00:13.00>愛<00:14.00>你');
		expect(l.text).toBe('我愛你');
		expect(l.end).toBe(15);
		expect(l.chars?.length).toBe(3);
	});
	it('serializeLRC writes hand-set spans back; lines without them stay byte-clean', () => {
		const lrc = '[00:12.00][00:15.00]<00:12.00>我<00:13.00>愛<00:14.00>你\n[00:15.00]plain';
		expect(serializeLRC(parseLRC(lrc))).toBe(lrc);
	});
});

describe('0.1s boundary editing', () => {
	const base = allocateChars('abc', 0, 3); // a 0–1, b 1–2, c 2–3
	it('nudging a start moves the shared boundary with the previous character', () => {
		const n = nudgeCharStart(base, 1, 0.1, 0, 3);
		expect(n[1].start).toBeCloseTo(1.1);
		expect(n[0].end).toBeCloseTo(1.1);
		expect(n[2]).toEqual(base[2]);
	});
	it('character 0 is anchored to the line start (no-op)', () => {
		expect(nudgeCharStart(base, 0, 0.1, 0, 3)).toEqual(base);
	});
	it('clamps so every character keeps a minimum length', () => {
		const n = setCharStart(base, 1, 5, 0, 3);
		expect(n[1].start).toBeCloseTo(2 - MIN_CHAR_SEC);
		const m = setCharStart(base, 1, -5, 0, 3);
		expect(m[1].start).toBeCloseTo(MIN_CHAR_SEC);
	});
	it('retime maps spans linearly onto a moved / resized line window', () => {
		const r = retimeChars(base, { start: 0, end: 3 }, { start: 10, end: 16 });
		expect(r.map((c) => [c.start, c.end])).toEqual([
			[10, 12],
			[12, 14],
			[14, 16]
		]);
	});
});

describe('charFillAt — the per-character highlight', () => {
	const c = { text: '愛', start: 1, end: 2 };
	it('0 before, fraction during, 1 after', () => {
		expect(charFillAt(c, 0.5)).toBe(0);
		expect(charFillAt(c, 1.25)).toBeCloseTo(0.25);
		expect(charFillAt(c, 3)).toBe(1);
	});
});
