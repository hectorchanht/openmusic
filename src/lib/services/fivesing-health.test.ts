import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fivesingHealth, DRY_THRESHOLD, GATE_WINDOW_MS } from './fivesing-health';

// Instance tests for the 5sing health gate (universal-gate rollout, 2026-11-01). The shared
// state machine is covered exhaustively by source-health.test + netease-health.test; what is
// per-instance is that THIS module's counter is its own (a 5sing dry spell must never gate a
// sibling source) and that its exported vocabulary trips/recovers with the documented shape.
// Reset between cases so state never leaks (the ttl-cache __clear idiom).
beforeEach(() => fivesingHealth.__reset());
afterEach(() => {
	fivesingHealth.__reset();
	vi.useRealTimers();
});

describe('fivesingHealth (per-source health gate instance)', () => {
	it('is not gated on a fresh tracker', () => {
		expect(fivesingHealth.isGated()).toBe(false);
	});

	it('trips after DRY_THRESHOLD consecutive dry responses, not before', () => {
		for (let i = 0; i < DRY_THRESHOLD - 1; i++) {
			fivesingHealth.recordDry();
			expect(fivesingHealth.isGated()).toBe(false);
		}
		fivesingHealth.recordDry();
		expect(fivesingHealth.isGated()).toBe(true);
	});

	it('recordFail counts on the same counter as recordDry', () => {
		fivesingHealth.recordDry();
		fivesingHealth.recordFail();
		fivesingHealth.recordFail();
		expect(fivesingHealth.isGated()).toBe(true);
	});

	it('recordOk() clears the gate immediately (instant recovery on a real hit)', () => {
		for (let i = 0; i < DRY_THRESHOLD; i++) fivesingHealth.recordDry();
		expect(fivesingHealth.isGated()).toBe(true);
		fivesingHealth.recordOk();
		expect(fivesingHealth.isGated()).toBe(false);
		fivesingHealth.recordDry();
		expect(fivesingHealth.isGated()).toBe(false); // streak was genuinely reset
	});

	it('auto-opens for one probe after GATE_WINDOW_MS; a still-dry probe re-trips at once', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DRY_THRESHOLD; i++) fivesingHealth.recordDry();
		expect(fivesingHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(GATE_WINDOW_MS - 1);
		expect(fivesingHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(2);
		expect(fivesingHealth.isGated()).toBe(false); // probe window
		fivesingHealth.recordDry(); // the probe was still dry
		expect(fivesingHealth.isGated()).toBe(true); // re-tripped on ONE failure, not a fresh run
	});

	it('a successful probe after the window recovers permanently', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DRY_THRESHOLD; i++) fivesingHealth.recordDry();
		vi.advanceTimersByTime(GATE_WINDOW_MS + 1);
		expect(fivesingHealth.isGated()).toBe(false);
		fivesingHealth.recordOk();
		expect(fivesingHealth.isGated()).toBe(false);
		for (let i = 0; i < DRY_THRESHOLD - 1; i++) fivesingHealth.recordDry();
		expect(fivesingHealth.isGated()).toBe(false);
	});

	it('never throws on any entry point', () => {
		expect(() => {
			fivesingHealth.recordDry();
			fivesingHealth.recordFail();
			fivesingHealth.recordOk();
			fivesingHealth.isGated();
			fivesingHealth.__reset();
		}).not.toThrow();
	});
});
