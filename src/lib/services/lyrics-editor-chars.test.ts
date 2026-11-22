// quick-261122-ugcb4 — hand-set character spans ride every line gesture and the save round-trip.
import { describe, it, expect } from 'vitest';
import { nudgeEditorLine, moveEditorLine, stampEditorLine, serializeEditorLines, editorLinesFromLrc } from './lyrics-editor';
import { allocateChars, setCharStart } from './lyric-chars';

const mkLine = () => {
	const base = { start: 10, end: 13, text: '我愛你' };
	return { ...base, chars: setCharStart(allocateChars(base.text, 10, 13), 1, 11.5, 10, 13) };
};

describe('character spans in the editor (B4)', () => {
	it('a nudge re-times the spans from the ORIGINAL window', () => {
		const n = nudgeEditorLine(mkLine(), 'end', 3, 100); // 10–13 → 10–16 (×2)
		expect(n.chars?.map((c) => c.start)).toEqual([10, 13, 14]);
	});
	it('a drag moves the spans with the line', () => {
		const m = moveEditorLine(mkLine(), 5, 100);
		expect(m.chars?.[1].start).toBeCloseTo(16.5);
	});
	it('a stamp moves the spans with the line', () => {
		const s = stampEditorLine(mkLine(), 20, 100);
		expect(s.chars?.[0].start).toBeCloseTo(20);
		expect(s.chars?.[1].start).toBeCloseTo(21.5);
	});
	it('a line without hand-set spans stays without (pre-allocation is derived, never stored)', () => {
		const plain = moveEditorLine({ start: 1, end: 2, text: 'x' }, 1, 100);
		expect(plain.chars).toBeUndefined();
		expect(serializeEditorLines([plain])).not.toContain('<');
	});
	it('save → load round-trips hand-set spans; an edited text drops them', () => {
		const lrc = serializeEditorLines([mkLine()]);
		expect(lrc).toContain('<00:11.50>愛');
		const back = editorLinesFromLrc(lrc, 100);
		expect(back[0].chars?.[1].start).toBeCloseTo(11.5);
		expect(serializeEditorLines([{ ...back[0], text: '我恨你' }])).not.toContain('<');
	});
});
