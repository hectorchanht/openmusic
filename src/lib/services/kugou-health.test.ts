import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { kugouHealth, DRY_THRESHOLD, GATE_WINDOW_MS } from './kugou-health';

// Instance tests for the Kugou health gate (universal-gate rollout, 2026-11-01). The shared
// state machine is covered exhaustively by source-health.test + netease-health.test; what is
// per-instance is that THIS module's counter is its own (a Kugou dry spell must never gate a
// sibling source) and that its exported vocabulary trips/recovers with the documented shape.
// Reset between cases so state never leaks (the ttl-cache __clear idiom).
beforeEach(() => kugouHealth.__reset());
afterEach(() => {
	kugouHealth.__reset();
	vi.useRealTimers();
});

describe('kugouHealth (per-source health gate instance)', () => {
	it('is not gated on a fresh tracker', () => {
		expect(kugouHealth.isGated()).toBe(false);
	});

	it('trips after DRY_THRESHOLD consecutive dry responses, not before', () => {
		for (let i = 0; i < DRY_THRESHOLD - 1; i++) {
			kugouHealth.recordDry();
			expect(kugouHealth.isGated()).toBe(false);
		}
		kugouHealth.recordDry();
		expect(kugouHealth.isGated()).toBe(true);
	});

	it('recordFail counts on the same counter as recordDry', () => {
		kugouHealth.recordDry();
		kugouHealth.recordFail();
		kugouHealth.recordFail();
		expect(kugouHealth.isGated()).toBe(true);
	});

	it('recordOk() clears the gate immediately (instant recovery on a real hit)', () => {
		for (let i = 0; i < DRY_THRESHOLD; i++) kugouHealth.recordDry();
		expect(kugouHealth.isGated()).toBe(true);
		kugouHealth.recordOk();
		expect(kugouHealth.isGated()).toBe(false);
		kugouHealth.recordDry();
		expect(kugouHealth.isGated()).toBe(false); // streak was genuinely reset
	});

	it('auto-opens for one probe after GATE_WINDOW_MS; a still-dry probe re-trips at once', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DRY_THRESHOLD; i++) kugouHealth.recordDry();
		expect(kugouHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(GATE_WINDOW_MS - 1);
		expect(kugouHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(2);
		expect(kugouHealth.isGated()).toBe(false); // probe window
		kugouHealth.recordDry(); // the probe was still dry
		expect(kugouHealth.isGated()).toBe(true); // re-tripped on ONE failure, not a fresh run
	});

	it('a successful probe after the window recovers permanently', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DRY_THRESHOLD; i++) kugouHealth.recordDry();
		vi.advanceTimersByTime(GATE_WINDOW_MS + 1);
		expect(kugouHealth.isGated()).toBe(false);
		kugouHealth.recordOk();
		expect(kugouHealth.isGated()).toBe(false);
		for (let i = 0; i < DRY_THRESHOLD - 1; i++) kugouHealth.recordDry();
		expect(kugouHealth.isGated()).toBe(false);
	});

	it('never throws on any entry point', () => {
		expect(() => {
			kugouHealth.recordDry();
			kugouHealth.recordFail();
			kugouHealth.recordOk();
			kugouHealth.isGated();
			kugouHealth.__reset();
		}).not.toThrow();
	});
});
