// quick-261121-beat: Song Beat core pins (brief §9). The core is pure, so every pin is
// a plain node assertion: chart determinism + invariants, judgment boundaries, ghost
// semantics, holds, the capped score, seek derivation, and the Amendment-C fail model
// (challenge ON drains/ends; the default OFF never does) incl. the hell tier (01:26).
import { describe, it, expect } from 'vitest';
import type { LyricLine } from '$lib/services/lrc';
import {
	generateChart,
	judgeDelta,
	weightOf,
	gradeOf,
	hpDeltas,
	createRun,
	tapDown,
	tapUp,
	advanceRun,
	seekRun,
	runStats,
	bestKey,
	bestEligible,
	parseBest,
	parseSongBeatSettings,
	serializeSongBeatSettings,
	chartCacheKey,
	serializeChart,
	parseChart,
	MIN_INTERVAL,
	type Chart,
	type ChartNote,
	type Difficulty
} from './songbeat';

const HASH = 'abcdef0123456789abcdef0123456789';

/** 12 unique lines, 4s apart, 11 sung chars each (≈2.75 chars/s — above the sustained
 *  threshold, so fills are generated) — a small singable fixture song. */
function fixtureLines(): LyricLine[] {
	const words = [
		'明月幾時有把酒問青天',
		'不知天上宮闕今夕何年',
		'我欲乘風歸去又恐瓊樓',
		'玉宇高處不勝寒起舞弄',
		'清影何似在人間轉朱閣',
		'低綺戶照無眠不應有恨',
		'何事長向別時圓人有悲',
		'歡離合月有陰晴圓缺此',
		'事古難全但願人長久千',
		'里共嬋娟山重水復疑無',
		'路柳暗花明又一村簫鼓',
		'追隨春社近衣冠簡樸古'
	];
	return words.map((text, i) => ({ time: i * 4, text: text + '呀' }));
}

function manualChart(specs: Array<Partial<ChartNote> & { t: number }>): Chart {
	return {
		source: 'lyric-est',
		version: 1,
		notes: specs.map((s) => ({ lane: 0, type: 'tap' as const, dur: 0, anchor: false, ...s }))
	};
}

describe('chart generation — determinism + invariants (§4, §9)', () => {
	it('same inputs → deep-equal chart, twice (incl. lane assignment)', () => {
		const a = generateChart(fixtureLines(), 60, 'standard', HASH);
		const b = generateChart(fixtureLines(), 60, 'standard', HASH);
		expect(a).toEqual(b);
		expect(a.source).toBe('lyric-est');
		expect(a.notes.length).toBeGreaterThan(20);
	});

	it('note counts are non-decreasing across difficulties (hell densest)', () => {
		const counts = (['relaxed', 'standard', 'fever', 'hell'] as Difficulty[]).map(
			(d) => generateChart(fixtureLines(), 60, d, HASH).notes.length
		);
		expect(counts[0]).toBeLessThanOrEqual(counts[1]);
		expect(counts[1]).toBeLessThanOrEqual(counts[2]);
		expect(counts[2]).toBeLessThanOrEqual(counts[3]);
	});

	it('anchors are never thinned — every line start carries an anchor note', () => {
		const chart = generateChart(fixtureLines(), 60, 'hell', HASH);
		for (const line of fixtureLines()) {
			expect(chart.notes.some((n) => n.anchor && Math.abs(n.t - line.time) < 1e-9)).toBe(true);
		}
	});

	it('kept fills respect the difficulty min-interval after the last kept note', () => {
		for (const d of ['relaxed', 'standard', 'fever', 'hell'] as Difficulty[]) {
			const chart = generateChart(fixtureLines(), 60, d, HASH);
			let lastT = -Infinity;
			for (const n of chart.notes) {
				if (!n.anchor && n.t > lastT) {
					expect(n.t - lastT).toBeGreaterThanOrEqual(MIN_INTERVAL[d] - 1e-9);
				}
				lastT = Math.max(lastT, n.t);
			}
		}
	});

	it('never 3 same-lane notes in a row (unique-line fixture → no doubles)', () => {
		const chart = generateChart(fixtureLines(), 60, 'fever', HASH);
		for (let i = 2; i < chart.notes.length; i++) {
			const a = chart.notes[i - 2].lane;
			const b = chart.notes[i - 1].lane;
			const c = chart.notes[i].lane;
			expect(a === b && b === c).toBe(false);
		}
	});

	it('a hold lane stays clear until holdEnd + 0.25s', () => {
		// One sustained line (8s window, 4 chars → 0.5 chars/s) followed by dense lines.
		const lines: LyricLine[] = [
			{ time: 0, text: '長——音——' },
			{ time: 8, text: '一二三四五六七八' },
			{ time: 10, text: '九十甲乙丙丁戊己' }
		];
		const chart = generateChart(lines, 20, 'hell', HASH);
		const hold = chart.notes.find((n) => n.type === 'hold');
		expect(hold).toBeTruthy();
		for (const n of chart.notes) {
			if (n === hold || n.lane !== hold!.lane) continue;
			expect(n.t < hold!.t || n.t >= hold!.t + hold!.dur + 0.25 - 1e-9).toBe(true);
		}
	});

	it('no-lyrics input → grid chart, non-empty for a normal song, honestly labelled', () => {
		const chart = generateChart([], 60, 'standard', HASH);
		expect(chart.source).toBe('grid');
		expect(chart.notes.length).toBeGreaterThan(10);
		expect(generateChart([], 3, 'standard', HASH).notes.length).toBe(0);
	});

	it('degenerate inputs never throw', () => {
		expect(() => generateChart([{ time: 0, text: 'x' }], 0, 'hell', HASH)).not.toThrow();
		expect(() => generateChart([{ time: 999, text: 'past the end' }], 60, 'relaxed', HASH)).not.toThrow();
		expect(generateChart([{ time: 0, text: '' }], 30, 'standard', HASH).notes.length).toBeGreaterThanOrEqual(1);
	});
});

describe('judgment (§5.1)', () => {
	it('window boundaries are exact, both signs', () => {
		expect(judgeDelta(0.07)).toBe('perfect');
		expect(judgeDelta(-0.07)).toBe('perfect');
		expect(judgeDelta(0.071)).toBe('great');
		expect(judgeDelta(-0.13)).toBe('great');
		expect(judgeDelta(0.131)).toBe('good');
		expect(judgeDelta(-0.2)).toBe('good');
		expect(judgeDelta(0.201)).toBeNull();
		expect(judgeDelta(-0.22)).toBeNull();
	});

	it('a ghost tap never consumes a note — it stays hittable', () => {
		const run = createRun(manualChart([{ t: 10, lane: 1 }]), 'standard', false);
		expect(tapDown(run, 1, 9.75).kind).toBe('ghost'); // 0.25s early — outside GOOD
		expect(run.notes[0].state).toBe('pending');
		const hit = tapDown(run, 1, 10.01);
		expect(hit.kind).toBe('hit');
		expect(hit.judgment).toBe('perfect');
	});

	it('the nearest note in the lane wins', () => {
		const run = createRun(manualChart([{ t: 10, lane: 0 }, { t: 10.3, lane: 0 }]), 'standard', false);
		const hit = tapDown(run, 0, 10.26);
		expect(hit.index).toBe(1);
	});

	it('calibration shifts Δt exactly', () => {
		const run = createRun(manualChart([{ t: 10, lane: 2 }]), 'standard', false);
		const hit = tapDown(run, 2, 10.1, -0.1);
		expect(hit.judgment).toBe('perfect');
		expect(hit.dt).toBeCloseTo(0, 9);
	});

	it('a tap in the wrong lane is a ghost for the note (no wrong-lane error)', () => {
		const run = createRun(manualChart([{ t: 10, lane: 0 }]), 'standard', false);
		expect(tapDown(run, 3, 10).kind).toBe('ghost');
		expect(run.notes[0].state).toBe('pending');
	});
});

describe('holds (§5.1)', () => {
	const holdChart = () => manualChart([{ t: 10, lane: 0, type: 'hold', dur: 2 }]);

	it('still held at tail + 0.05 → completes at full head weight', () => {
		const run = createRun(holdChart(), 'standard', false);
		tapDown(run, 0, 10);
		advanceRun(run, 12.06);
		expect(run.notes[0].state).toBe('hit');
		expect(run.notes[0].weight).toBe(1);
	});

	it('released at ≥60% → weight capped at GREAT, not a break', () => {
		const run = createRun(holdChart(), 'standard', false);
		tapDown(run, 0, 10);
		tapUp(run, 0, 11.3); // held 1.3 of 2.0 = 65%
		expect(run.notes[0].weight).toBeCloseTo(weightOf('great'));
		expect(run.notes[0].broke).toBe(false);
	});

	it('released at <60% → break: weight 0.4, combo resets', () => {
		const run = createRun(
			manualChart([{ t: 5, lane: 1 }, { t: 10, lane: 0, type: 'hold', dur: 2 }, { t: 15, lane: 1 }]),
			'standard',
			false
		);
		tapDown(run, 1, 5);
		tapDown(run, 0, 10);
		tapUp(run, 0, 10.5); // 25% — break
		tapDown(run, 1, 15);
		const stats = runStats(run);
		expect(run.notes[1].broke).toBe(true);
		expect(run.notes[1].weight).toBeCloseTo(0.4);
		expect(stats.maxCombo).toBe(1); // break reset the chain both sides
	});

	it('an unpressed hold head past +0.22 is a miss', () => {
		const run = createRun(holdChart(), 'standard', false);
		advanceRun(run, 10.23);
		expect(run.notes[0].state).toBe('missed');
	});
});

describe('score + grade (§5.2)', () => {
	it('all-PERFECT = exactly 1,000,000; all-MISS = 0 / grade D', () => {
		const specs = Array.from({ length: 10 }, (_, i) => ({ t: 10 + i * 2, lane: i % 4 }));
		const perfect = createRun(manualChart(specs), 'standard', false);
		for (const n of perfect.chart.notes) tapDown(perfect, n.lane, n.t);
		const ps = runStats(perfect);
		expect(ps.score).toBe(1_000_000);
		expect(ps.grade).toBe('S');

		const missed = createRun(manualChart(specs), 'standard', false);
		advanceRun(missed, 100);
		const ms = runStats(missed);
		expect(ms.score).toBe(0);
		expect(ms.grade).toBe('D');
		expect(ms.complete).toBe(true);
	});

	it('grade boundaries', () => {
		expect(gradeOf(0.95)).toBe('S');
		expect(gradeOf(0.949)).toBe('A');
		expect(gradeOf(0.88)).toBe('A');
		expect(gradeOf(0.75)).toBe('B');
		expect(gradeOf(0.6)).toBe('C');
		expect(gradeOf(0.599)).toBe('D');
	});
});

describe('seek derivation (§6)', () => {
	it('seek back revives notes and recomputes stats; seek forward skips without MISS', () => {
		const run = createRun(
			manualChart([{ t: 5, lane: 0 }, { t: 10, lane: 1 }, { t: 20, lane: 2 }]),
			'standard',
			false
		);
		tapDown(run, 0, 5);
		advanceRun(run, 11); // second note missed
		expect(runStats(run).counts.miss).toBe(1);
		seekRun(run, 4); // back before everything
		expect(run.notes.every((n) => n.state === 'pending')).toBe(true);
		expect(runStats(run).resolved).toBe(0);
		seekRun(run, 15); // forward past the first two
		expect(run.notes[0].state).toBe('skipped');
		expect(run.notes[1].state).toBe('skipped');
		const stats = runStats(run);
		expect(stats.resolved).toBe(0); // skipped excluded from N
		expect(stats.counts.miss).toBe(0);
	});
});

describe('fail state — Amendment C (default OFF; challenge ON drains + ends)', () => {
	const specs = (n: number) => Array.from({ length: n }, (_, i) => ({ t: 10 + i, lane: i % 4 }));

	it('casual (default): an all-MISS run never drains, never fails, completes normally', () => {
		const run = createRun(manualChart(specs(30)), 'standard', false);
		advanceRun(run, 100);
		const stats = runStats(run);
		expect(stats.failed).toBe(false);
		expect(stats.hp).toBe(100);
		expect(stats.complete).toBe(true);
		expect(stats.score).toBe(0);
	});

	it('challenge: HP arithmetic is exact — 13 unanswered misses end the round', () => {
		const run = createRun(manualChart(specs(30)), 'standard', true);
		advanceRun(run, 21.3); // 12 misses resolved (t=10..20 past +0.22)
		expect(runStats(run).hp).toBe(100 - 12 * 8);
		expect(runStats(run).failed).toBe(false);
		advanceRun(run, 22.3); // 13th miss
		const stats = runStats(run);
		expect(stats.hp).toBe(0);
		expect(stats.failed).toBe(true);
	});

	it('challenge: PERFECT +2 / GREAT +1 recovery, capped at 100', () => {
		const run = createRun(manualChart(specs(6)), 'standard', true);
		advanceRun(run, 10.3); // miss note 0 → 92
		tapDown(run, 1, 11); // perfect → 94
		tapDown(run, 2, 12.1); // great (0.1) → 95
		expect(runStats(run).hp).toBe(95);
		const fresh = createRun(manualChart(specs(3)), 'standard', true);
		tapDown(fresh, 0, 10);
		expect(runStats(fresh).hp).toBe(100); // capped
	});

	it('ghost taps drain 0 HP across a barrage', () => {
		const run = createRun(manualChart(specs(3)), 'standard', true);
		for (let i = 0; i < 50; i++) tapDown(run, i % 4, 5 + i * 0.05);
		expect(runStats(run).hp).toBe(100);
	});

	it('hell drains faster: MISS −12, PERFECT +1', () => {
		expect(hpDeltas('hell')).toEqual({ miss: -12, perfect: 1, great: 1 });
		expect(hpDeltas('standard')).toEqual({ miss: -8, perfect: 2, great: 1 });
		const run = createRun(manualChart(specs(12)), 'hell', true);
		advanceRun(run, 17.3); // 8 misses → 100 − 96 = 4
		expect(runStats(run).hp).toBe(4);
		advanceRun(run, 18.3); // 9th miss → fail
		expect(runStats(run).failed).toBe(true);
		const run2 = createRun(manualChart(specs(4)), 'hell', true);
		advanceRun(run2, 10.3); // −12 → 88
		tapDown(run2, 1, 11); // perfect +1 → 89
		expect(runStats(run2).hp).toBe(89);
	});

	it('seek-skipped notes drain 0 HP', () => {
		const run = createRun(manualChart(specs(10)), 'standard', true);
		seekRun(run, 15);
		expect(runStats(run).hp).toBe(100);
	});
});

describe('bests per mode (§5.4)', () => {
	it('casual and challenge keys never collide', () => {
		expect(bestKey(HASH, 'standard', 'casual')).not.toBe(bestKey(HASH, 'standard', 'challenge'));
		expect(bestKey(HASH, 'hell', 'casual')).toContain('hell');
	});

	it('eligibility: failed runs never write; <90% resolved never writes', () => {
		const run = createRun(manualChart([{ t: 1, lane: 0 }]), 'standard', false);
		tapDown(run, 0, 1);
		expect(bestEligible(runStats(run))).toBe(true);
		const failedRun = createRun(
			manualChart(Array.from({ length: 20 }, (_, i) => ({ t: 10 + i, lane: i % 4 }))),
			'standard',
			true
		);
		advanceRun(failedRun, 100);
		expect(runStats(failedRun).failed).toBe(true);
		expect(bestEligible(runStats(failedRun))).toBe(false);
		expect(parseBest('{"score":123,"grade":"A"}')?.score).toBe(123);
		expect(parseBest('garbage')).toBeNull();
	});
});

describe('settings + chart cache (§7/§4.2)', () => {
	it('settings roundtrip; garbage falls back per-field; calibration clamps', () => {
		const s = parseSongBeatSettings(serializeSongBeatSettings({ skin: 'round', difficulty: 'hell', challenge: true, approachSec: 1.25, calibrationMs: 999, mirror: true }));
		expect(s.skin).toBe('round');
		expect(s.difficulty).toBe('hell');
		expect(s.challenge).toBe(true);
		expect(s.calibrationMs).toBe(150);
		expect(parseSongBeatSettings('not json').difficulty).toBe('standard');
		expect(parseSongBeatSettings(null).challenge).toBe(false);
	});

	it('chart cache roundtrip + key shape', () => {
		const chart = generateChart(fixtureLines(), 60, 'fever', HASH);
		expect(parseChart(serializeChart(chart))).toEqual(chart);
		expect(parseChart('{"notes":"nope"}')).toBeNull();
		expect(chartCacheKey(HASH, 'fever')).toContain('fever');
	});
});
