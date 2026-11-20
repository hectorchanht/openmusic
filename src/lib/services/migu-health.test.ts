import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { miguHealth, DRY_THRESHOLD, GATE_WINDOW_MS } from './migu-health';

// Instance tests for the Migu health gate (universal-gate rollout, 2026-11-01). The shared
// state machine is covered exhaustively by source-health.test + netease-health.test; what is
// per-instance is that THIS module's counter is its own (a Migu dry spell must never gate a
// sibling source) and that its exported vocabulary trips/recovers with the documented shape.
// Reset between cases so state never leaks (the ttl-cache __clear idiom).
beforeEach(() => miguHealth.__reset());
afterEach(() => {
	miguHealth.__reset();
	vi.useRealTimers();
});

describe('miguHealth (per-source health gate instance)', () => {
	it('is not gated on a fresh tracker', () => {
		expect(miguHealth.isGated()).toBe(false);
	});

	it('trips after DRY_THRESHOLD consecutive dry responses, not before', () => {
		for (let i = 0; i < DRY_THRESHOLD - 1; i++) {
			miguHealth.recordDry();
			expect(miguHealth.isGated()).toBe(false);
		}
		miguHealth.recordDry();
		expect(miguHealth.isGated()).toBe(true);
	});

	it('recordFail counts on the same counter as recordDry', () => {
		miguHealth.recordDry();
		miguHealth.recordFail();
		miguHealth.recordFail();
		expect(miguHealth.isGated()).toBe(true);
	});

	it('recordOk() clears the gate immediately (instant recovery on a real hit)', () => {
		for (let i = 0; i < DRY_THRESHOLD; i++) miguHealth.recordDry();
		expect(miguHealth.isGated()).toBe(true);
		miguHealth.recordOk();
		expect(miguHealth.isGated()).toBe(false);
		miguHealth.recordDry();
		expect(miguHealth.isGated()).toBe(false); // streak was genuinely reset
	});

	it('auto-opens for one probe after GATE_WINDOW_MS; a still-dry probe re-trips at once', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DRY_THRESHOLD; i++) miguHealth.recordDry();
		expect(miguHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(GATE_WINDOW_MS - 1);
		expect(miguHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(2);
		expect(miguHealth.isGated()).toBe(false); // probe window
		miguHealth.recordDry(); // the probe was still dry
		expect(miguHealth.isGated()).toBe(true); // re-tripped on ONE failure, not a fresh run
	});

	it('a successful probe after the window recovers permanently', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DRY_THRESHOLD; i++) miguHealth.recordDry();
		vi.advanceTimersByTime(GATE_WINDOW_MS + 1);
		expect(miguHealth.isGated()).toBe(false);
		miguHealth.recordOk();
		expect(miguHealth.isGated()).toBe(false);
		for (let i = 0; i < DRY_THRESHOLD - 1; i++) miguHealth.recordDry();
		expect(miguHealth.isGated()).toBe(false);
	});

	it('never throws on any entry point', () => {
		expect(() => {
			miguHealth.recordDry();
			miguHealth.recordFail();
			miguHealth.recordOk();
			miguHealth.isGated();
			miguHealth.__reset();
		}).not.toThrow();
	});
});
