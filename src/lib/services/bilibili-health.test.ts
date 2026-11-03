import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bilibiliHealth, DRY_THRESHOLD, GATE_WINDOW_MS } from './bilibili-health';

// Instance tests for the Bilibili health gate (universal-gate rollout, 2026-11-01). The shared
// state machine is covered exhaustively by source-health.test + netease-health.test; what is
// per-instance is that THIS module's counter is its own (a Bilibili dry spell must never gate a
// sibling source) and that its exported vocabulary trips/recovers with the documented shape.
// Reset between cases so state never leaks (the ttl-cache __clear idiom).
beforeEach(() => bilibiliHealth.__reset());
afterEach(() => {
	bilibiliHealth.__reset();
	vi.useRealTimers();
});

describe('bilibiliHealth (per-source health gate instance)', () => {
	it('is not gated on a fresh tracker', () => {
		expect(bilibiliHealth.isGated()).toBe(false);
	});

	it('trips after DRY_THRESHOLD consecutive dry responses, not before', () => {
		for (let i = 0; i < DRY_THRESHOLD - 1; i++) {
			bilibiliHealth.recordDry();
			expect(bilibiliHealth.isGated()).toBe(false);
		}
		bilibiliHealth.recordDry();
		expect(bilibiliHealth.isGated()).toBe(true);
	});

	it('recordFail counts on the same counter as recordDry', () => {
		bilibiliHealth.recordDry();
		bilibiliHealth.recordFail();
		bilibiliHealth.recordFail();
		expect(bilibiliHealth.isGated()).toBe(true);
	});

	it('recordOk() clears the gate immediately (instant recovery on a real hit)', () => {
		for (let i = 0; i < DRY_THRESHOLD; i++) bilibiliHealth.recordDry();
		expect(bilibiliHealth.isGated()).toBe(true);
		bilibiliHealth.recordOk();
		expect(bilibiliHealth.isGated()).toBe(false);
		bilibiliHealth.recordDry();
		expect(bilibiliHealth.isGated()).toBe(false); // streak was genuinely reset
	});

	it('auto-opens for one probe after GATE_WINDOW_MS; a still-dry probe re-trips at once', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DRY_THRESHOLD; i++) bilibiliHealth.recordDry();
		expect(bilibiliHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(GATE_WINDOW_MS - 1);
		expect(bilibiliHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(2);
		expect(bilibiliHealth.isGated()).toBe(false); // probe window
		bilibiliHealth.recordDry(); // the probe was still dry
		expect(bilibiliHealth.isGated()).toBe(true); // re-tripped on ONE failure, not a fresh run
	});

	it('a successful probe after the window recovers permanently', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DRY_THRESHOLD; i++) bilibiliHealth.recordDry();
		vi.advanceTimersByTime(GATE_WINDOW_MS + 1);
		expect(bilibiliHealth.isGated()).toBe(false);
		bilibiliHealth.recordOk();
		expect(bilibiliHealth.isGated()).toBe(false);
		for (let i = 0; i < DRY_THRESHOLD - 1; i++) bilibiliHealth.recordDry();
		expect(bilibiliHealth.isGated()).toBe(false);
	});

	it('never throws on any entry point', () => {
		expect(() => {
			bilibiliHealth.recordDry();
			bilibiliHealth.recordFail();
			bilibiliHealth.recordOk();
			bilibiliHealth.isGated();
			bilibiliHealth.__reset();
		}).not.toThrow();
	});
});
