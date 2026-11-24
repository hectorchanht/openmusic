// Workstream F / Skin D — Character-Catch chart pins (addendum §7, NO SILENT
// BREAKAGE). The char chart is pure core: these tests pin its determinism, its
// target thinning, the shared-core judgment path (a target IS a note — no forked
// judgment for characters), stream-glyph ghost semantics, and the honest
// no-lyrics behaviour.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	generateCharChart,
	charChartToNoteChart,
	visibleChars,
	charChartCacheKey,
	serializeCharChart,
	parseCharChart,
	createRun,
	tapDown,
	advanceRun,
	runStats,
	sungChars,
	type Difficulty
} from './songbeat';
import type { LyricLine } from '$lib/services/lrc';

const HASH = '0123456789abcdef0123456789abcdef';

/** One dense line: 16 sung chars over a 4s window → onsets every 0.25s. */
function denseLine(): LyricLine[] {
	return [{ time: 0, text: '一二三四五六七八九十甲乙丙丁戊己', end: 4 }];
}

describe('generateCharChart — every grapheme falls (addendum §3)', () => {
	it('is deterministic: same inputs → byte-identical chart', () => {
		const a = generateCharChart(denseLine(), 60, 'standard', HASH);
		const b = generateCharChart(denseLine(), 60, 'standard', HASH);
		expect(a).toEqual(b);
		expect(a.source).toBe('char-est');
	});

	it('carries every sung grapheme of every line, in order, onsets centred in the window', () => {
		const lines: LyricLine[] = [
			{ time: 0, text: '你好', end: 2 },
			{ time: 2, text: '世界人', end: 5 }
		];
		const cc = generateCharChart(lines, 60, 'standard', HASH);
		expect(cc.chars.map((c) => c.ch)).toEqual(['你', '好', '世', '界', '人']);
		// (k + 0.5)/n allocation: line 1 chars at 0.5 / 1.5; line 2 at 2.5 / 3.5 / 4.5.
		expect(cc.chars.map((c) => c.t)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5]);
		// Targets are a subset of the chars — never anything else.
		expect(cc.chars.every((c) => c.target === true || c.target === false)).toBe(true);
		expect(cc.chars.filter((c) => c.target).length).toBeGreaterThan(0);
	});

	it('never assigns 3 same-lane characters in a row (§4.1.6 rule family)', () => {
		const lines: LyricLine[] = [{ time: 0, text: '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯', end: 12 }];
		const cc = generateCharChart(lines, 60, 'fever', HASH);
		for (let i = 2; i < cc.chars.length; i++) {
			expect(cc.chars[i].lane === cc.chars[i - 1].lane && cc.chars[i].lane === cc.chars[i - 2].lane).toBe(false);
		}
		for (const c of cc.chars) expect(c.lane).toBeGreaterThanOrEqual(0);
		for (const c of cc.chars) expect(c.lane).toBeLessThanOrEqual(3);
	});

	it('target counts are non-decreasing by difficulty; fever/hell keep every char at 0.25s spacing', () => {
		const count = (d: Difficulty) => generateCharChart(denseLine(), 60, d, HASH).chars.filter((c) => c.target).length;
		const relaxed = count('relaxed');
		const standard = count('standard');
		const fever = count('fever');
		const hell = count('hell');
		// The addendum's pin is non-decreasing (輕鬆 ≤ 標準 ≤ 熱血): greedy thinning
		// quantises, so adjacent tiers may tie on a given spacing — but the full
		// range must strictly widen, and the top tiers keep everything here.
		expect(relaxed).toBeLessThanOrEqual(standard);
		expect(standard).toBeLessThanOrEqual(fever);
		expect(relaxed).toBeLessThan(fever);
		// 0.25s spacing clears both the 0.21s (fever) and 0.15s (hell) floors → all 16.
		expect(fever).toBe(16);
		expect(hell).toBe(16);
		// At 0.4s spacing the tiers separate cleanly: standard (0.30) keeps all 10,
		// relaxed (0.45) thins to roughly every second character.
		const wide: LyricLine[] = [{ time: 0, text: '一二三四五六七八九十', end: 4 }];
		const wCount = (d: Difficulty) => generateCharChart(wide, 60, d, HASH).chars.filter((c) => c.target).length;
		expect(wCount('standard')).toBe(10);
		expect(wCount('relaxed')).toBeLessThan(10);
	});

	it('fever floor merge: characters denser than 0.21s drop the later one to stream', () => {
		// 16 chars over 2s → 0.125s spacing: every second char is too close to the
		// previous target and must fall as stream, never as a second target.
		const lines: LyricLine[] = [{ time: 0, text: '一二三四五六七八九十甲乙丙丁戊己', end: 2 }];
		const cc = generateCharChart(lines, 60, 'fever', HASH);
		const targets = cc.chars.filter((c) => c.target);
		expect(targets.length).toBeLessThan(16);
		for (let i = 1; i < targets.length; i++) {
			expect(targets[i].t - targets[i - 1].t).toBeGreaterThanOrEqual(0.21 - 1e-9);
		}
	});

	it('no-lyrics and empty-line inputs never throw and yield no characters', () => {
		expect(generateCharChart([], 200, 'standard', HASH).chars).toEqual([]);
		expect(generateCharChart([{ time: 0, text: '' }, { time: 4, text: '———' }], 60, 'hell', HASH).chars).toEqual([]);
		expect(() => generateCharChart([{ time: 0, text: 'x' }], 0, 'relaxed', HASH)).not.toThrow();
	});
});

describe('char targets judge through the SHARED core path (addendum §7)', () => {
	/** A single-char line: onset = 7 + 0.5 × 2 = 8.0 exactly, an anchor target. */
	function singleTarget() {
		const cc = generateCharChart([{ time: 7, text: '字', end: 9 }], 60, 'standard', HASH);
		expect(cc.chars).toHaveLength(1);
		expect(cc.chars[0].target).toBe(true);
		expect(cc.chars[0].t).toBe(8);
		return cc;
	}

	it('charChartToNoteChart maps targets 1:1 to tap notes, stream chars excluded', () => {
		const cc = generateCharChart(denseLine(), 60, 'relaxed', HASH);
		const nc = charChartToNoteChart(cc);
		expect(nc.notes.length).toBe(cc.chars.filter((c) => c.target).length);
		expect(nc.notes.every((n) => n.type === 'tap' && n.dur === 0)).toBe(true);
	});

	it('judgment at the §5.1 boundaries equals a note’s, exactly', () => {
		const cc = singleTarget();
		const lane = cc.chars[0].lane;
		// Binary-exact offsets: 0.0625 (perfect), 0.125 (great), 0.1875 (good).
		for (const [dt, j] of [[0.0625, 'perfect'], [0.125, 'great'], [0.1875, 'good']] as const) {
			const run = createRun(charChartToNoteChart(cc), 'standard', false);
			const out = tapDown(run, lane, 8 + dt);
			expect(out.kind).toBe('hit');
			expect(out.judgment).toBe(j);
		}
	});

	it('stream characters are never judged and never drain HP (ghost semantics)', () => {
		const cc = generateCharChart(denseLine(), 60, 'relaxed', HASH);
		const nc = charChartToNoteChart(cc);
		const targetCount = nc.notes.length;
		// A stream char far from any same-lane target: tapping its lane at its time
		// is a ghost — sounds, consumes nothing.
		const stream = cc.chars.find(
			(c) => !c.target && !nc.notes.some((n) => n.lane === c.lane && Math.abs(n.t - c.t) <= 0.25)
		);
		expect(stream).toBeDefined();
		const run = createRun(nc, 'standard', true);
		const out = tapDown(run, stream!.lane, stream!.t);
		expect(out.kind).toBe('ghost');
		// Advancing past the whole song misses exactly the targets — stream chars
		// produce no miss events and no HP drain beyond the targets' own.
		const events = advanceRun(run, 100);
		expect(events.filter((e) => e.kind === 'miss')).toHaveLength(targetCount);
		expect(runStats(run).counts.miss).toBe(targetCount);
	});
});

describe('visibleChars — stream stays stream, targets carry run state', () => {
	it('windows chars around now and mirrors target states from the run', () => {
		const cc = generateCharChart(denseLine(), 60, 'relaxed', HASH);
		const run = createRun(charChartToNoteChart(cc), 'standard', false);
		expect(visibleChars(cc, run, -10, 1.6)).toEqual([]);
		const at1 = visibleChars(cc, run, 1, 1.6);
		expect(at1.length).toBeGreaterThan(0);
		for (const c of at1) {
			if (!c.target) expect(c.state).toBe('stream');
			else expect(c.state).toBe('pending');
		}
		advanceRun(run, 100);
		const late = visibleChars(cc, run, 4.4, 1.6);
		for (const c of late) {
			if (!c.target) expect(c.state).toBe('stream');
			else expect(c.state).toBe('missed');
		}
	});
});

describe('char chart cache (addendum §3 key scheme)', () => {
	it('key format + serialize/parse roundtrip + garbage rejected', () => {
		expect(charChartCacheKey('abc', 'standard')).toBe('openmusic:songbeat:chart:v1:abc:char:standard');
		const cc = generateCharChart(denseLine(), 60, 'fever', HASH);
		expect(parseCharChart(serializeCharChart(cc))).toEqual(cc);
		expect(parseCharChart(null)).toBeNull();
		expect(parseCharChart('{"chars":[{"t":"x"}]}')).toBeNull();
		expect(parseCharChart('not json')).toBeNull();
	});
});

describe('Character-Catch skin — source pins', () => {
	const npGame = readFileSync('src/lib/components/NpGame.svelte', 'utf-8');
	const skin = readFileSync('src/lib/components/SongBeatCharCatchSkin.svelte', 'utf-8');

	it('NpGame wires the char family, the unavailable fallback and the results line', () => {
		expect(npGame).toContain('SongBeatCharCatchSkin');
		expect(npGame).toContain('generateCharChart');
		expect(npGame).toContain('visibleChars(charChart, run, now, beat.approachSec)');
		expect(npGame).toContain("t('songbeat.charUnavailable')");
		expect(npGame).toContain("t('songbeat.charAccuracy')");
		expect(npGame).toContain('WholeWord');
	});

	it('cells are fixed squares and glyphs ride the growOut skeleton (NO STRETCH)', () => {
		expect(skin).toContain('width: 40px; height: 40px');
		expect(skin).toContain('growOut(c.signedDt, approachSec)');
		expect(skin).toContain('judge-line');
		expect(skin).toContain('HALF * (1 + g.offset)');
		// Workstream H: lanes carry the shared pad icon, never a visible text label.
		expect(skin).toContain('<SongBeatPadIcon pad={lanePad(lane)}');
		expect(skin).not.toContain('lane-label');
	});

	it('sungChars fixtures used above are the house segmentation', () => {
		expect(sungChars('你好，世界！')).toEqual(['你', '好', '世', '界']);
	});
});
