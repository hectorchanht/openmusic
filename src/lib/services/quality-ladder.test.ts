import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	QualityLadder,
	LADDER_RECOVER_SMOOTH_SEC,
	LADDER_TICK_CAP_SEC
} from './quality-ladder';

// The ladder's tier answers ride effectiveQuality, whose 'auto' rung reads
// navigator.connection. Node's global navigator has no `connection`, so the
// un-stubbed baseline resolves 'auto' → '320' (fail-closed); the wifi case
// below stubs it explicitly, following quality.test.ts's pattern.
afterEach(() => {
	vi.unstubAllGlobals();
});

/** Bank `sec` seconds of continuous smooth play through capped ticks. */
function playSmooth(ladder: QualityLadder, sec: number, startAt = 1_000_000) {
	let now = startAt;
	ladder.notePlayingTick(now); // baseline tick — no credit
	const tickMs = LADDER_TICK_CAP_SEC * 1000;
	for (let elapsed = 0; elapsed < sec; elapsed += LADDER_TICK_CAP_SEC) {
		now += tickMs;
		ladder.notePlayingTick(now);
	}
	return now;
}

describe('quality ladder — tier posture (fluent-first)', () => {
	it('Auto OFF restores the pre-ladder behaviour exactly (effectiveQuality passthrough)', () => {
		const l = new QualityLadder();
		l.noteHoldEnd('timeout'); // pressure must not matter while off
		expect(l.tierFor('320', false)).toBe('320');
		expect(l.tierFor('128', false)).toBe('128');
		expect(l.tierFor('lossless', false)).toBe('lossless');
		expect(l.tierFor('auto', false)).toBe('320'); // no connection info → fail-closed '320'
	});

	it("an explicit 'lossless' pref is a FORCE — the ladder never overrides it, even under pressure", () => {
		const l = new QualityLadder();
		l.noteGateOutcome('timeout');
		l.noteHoldEnd('timeout');
		expect(l.stepDown).toBe(1);
		expect(l.tierFor('lossless', true)).toBe('lossless');
		expect(l.shouldDowngradeCurrent('FLAC', 'lossless', true)).toBe(false);
	});

	it("'auto' on unmetered wifi homes at '320', NOT lossless — auto is not a force", () => {
		vi.stubGlobal('navigator', { connection: { type: 'wifi' } });
		const l = new QualityLadder();
		// effectiveQuality('auto') alone would say 'lossless' here (32-D-02);
		// the ladder's streaming posture caps the home at the light band.
		expect(l.tierFor('auto', true)).toBe('320');
		// …while Auto OFF keeps the old 32-D-02 answer untouched.
		expect(l.tierFor('auto', false)).toBe('lossless');
	});

	it("explicit '128' is the floor — pressure cannot push below it", () => {
		const l = new QualityLadder();
		l.noteHoldEnd('timeout');
		expect(l.tierFor('128', true)).toBe('128');
	});
});

describe('quality ladder — pressure steps down, recovery steps up', () => {
	it('a hold TIMEOUT steps 320 → 128 for the next resolves', () => {
		const l = new QualityLadder();
		expect(l.tierFor('320', true)).toBe('320');
		const stepped = l.noteHoldEnd('timeout');
		expect(stepped).toBe(true);
		expect(l.pressure).toBe('bad');
		expect(l.tierFor('320', true)).toBe('128');
		expect(l.tierFor('auto', true)).toBe('128');
	});

	it('a gate TIMEOUT is the same hard evidence', () => {
		const l = new QualityLadder();
		expect(l.noteGateOutcome('timeout')).toBe(true);
		expect(l.tierFor('320', true)).toBe('128');
	});

	it("gate 'ready' / 'error' outcomes are NOT pressure evidence", () => {
		const l = new QualityLadder();
		expect(l.noteGateOutcome('ready')).toBe(false);
		expect(l.noteGateOutcome('error')).toBe(false);
		expect(l.stepDown).toBe(0);
		expect(l.pressure).toBe('ok');
	});

	it("a hold that ends 'ready' is soft pressure only — no step, but the state reads tight", () => {
		const l = new QualityLadder();
		l.noteHoldStart();
		expect(l.noteHoldEnd('ready')).toBe(false);
		expect(l.stepDown).toBe(0);
		expect(l.pressure).toBe('tight');
		expect(l.tierFor('320', true)).toBe('320');
	});

	it('a second hard event while already down does not stack steps', () => {
		const l = new QualityLadder();
		l.noteHoldEnd('timeout');
		expect(l.noteHoldEnd('timeout')).toBe(false); // already down — no NEW step to report
		expect(l.stepDown).toBe(1);
	});

	it('sustained smooth play earns the step back up — and only sustained play does', () => {
		const l = new QualityLadder();
		l.noteHoldEnd('timeout');
		expect(l.tierFor('320', true)).toBe('128');
		playSmooth(l, LADDER_RECOVER_SMOOTH_SEC - LADDER_TICK_CAP_SEC);
		expect(l.tierFor('320', true)).toBe('128'); // not yet — hysteresis
		playSmooth(l, LADDER_TICK_CAP_SEC * 2, 2_000_000);
		expect(l.stepDown).toBe(0);
		expect(l.pressure).toBe('ok');
		expect(l.tierFor('320', true)).toBe('320');
	});

	it('a pressure event mid-recovery zeroes the banked smooth time (no flapping)', () => {
		const l = new QualityLadder();
		l.noteHoldEnd('timeout');
		playSmooth(l, LADDER_RECOVER_SMOOTH_SEC - 10);
		l.noteHoldStart(); // a fresh stall — the smooth run is broken
		playSmooth(l, 30, 3_000_000);
		expect(l.stepDown).toBe(1); // still down: only 30 fresh smooth seconds banked
	});

	it('one tick after a long gap credits at most the cap — suspensions cannot fake recovery', () => {
		const l = new QualityLadder();
		l.noteHoldEnd('timeout');
		const t0 = 5_000_000;
		l.notePlayingTick(t0);
		l.notePlayingTick(t0 + 10 * 60 * 1000); // 10 minutes later in one jump
		expect(l.stepDown).toBe(1); // only LADDER_TICK_CAP_SEC was credited
	});
});

describe('quality ladder — current-track downgrade decision + one-shot claim', () => {
	it('fires only when stepped down AND the playing tier is provably above the ladder tier', () => {
		const l = new QualityLadder();
		expect(l.shouldDowngradeCurrent('320K', '320', true)).toBe(false); // no pressure yet
		l.noteHoldEnd('timeout');
		expect(l.shouldDowngradeCurrent('320K', '320', true)).toBe(true);
		expect(l.shouldDowngradeCurrent('128K', '320', true)).toBe(false); // already at the floor tier
		expect(l.shouldDowngradeCurrent(null, '320', true)).toBe(false); // unknown tier — no swap on a guess
		expect(l.shouldDowngradeCurrent('320K', '320', false)).toBe(false); // Auto off — ladder disengaged
	});

	it('a FLAC stream under an auto/320 ceiling is downgradable; under a lossless force it is not', () => {
		const l = new QualityLadder();
		l.noteHoldEnd('timeout');
		expect(l.shouldDowngradeCurrent('FLAC', 'auto', true)).toBe(true);
		expect(l.shouldDowngradeCurrent('FLAC', 'lossless', true)).toBe(false);
	});

	it('the claim is one-per-track per episode, and recovery re-arms it', () => {
		const l = new QualityLadder();
		l.noteHoldEnd('timeout');
		expect(l.claimCurrentDowngrade('kuwo:1')).toBe(true);
		expect(l.claimCurrentDowngrade('kuwo:1')).toBe(false); // spent — no re-resolve loop
		expect(l.claimCurrentDowngrade('kuwo:2')).toBe(true); // a different track may still downgrade
		playSmooth(l, LADDER_RECOVER_SMOOTH_SEC + LADDER_TICK_CAP_SEC);
		l.noteHoldEnd('timeout'); // a NEW episode after proven recovery
		expect(l.claimCurrentDowngrade('kuwo:1')).toBe(true);
	});
});
