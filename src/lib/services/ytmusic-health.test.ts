import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ytmusicHealth, DRY_THRESHOLD, GATE_WINDOW_MS } from './ytmusic-health';

// Instance tests for the YouTube Music health gate (universal-gate rollout, 2026-11-01). The shared
// state machine is covered exhaustively by source-health.test + netease-health.test; what is
// per-instance is that THIS module's counter is its own (a YouTube Music dry spell must never gate a
// sibling source) and that its exported vocabulary trips/recovers with the documented shape.
// Reset between cases so state never leaks (the ttl-cache __clear idiom).
beforeEach(() => ytmusicHealth.__reset());
afterEach(() => {
	ytmusicHealth.__reset();
	vi.useRealTimers();
});

describe('ytmusicHealth (per-source health gate instance)', () => {
	it('is not gated on a fresh tracker', () => {
		expect(ytmusicHealth.isGated()).toBe(false);
	});

	it('trips after DRY_THRESHOLD consecutive dry responses, not before', () => {
		for (let i = 0; i < DRY_THRESHOLD - 1; i++) {
			ytmusicHealth.recordDry();
			expect(ytmusicHealth.isGated()).toBe(false);
		}
		ytmusicHealth.recordDry();
		expect(ytmusicHealth.isGated()).toBe(true);
	});

	it('recordFail counts on the same counter as recordDry', () => {
		ytmusicHealth.recordDry();
		ytmusicHealth.recordFail();
		ytmusicHealth.recordFail();
		expect(ytmusicHealth.isGated()).toBe(true);
	});

	it('recordOk() clears the gate immediately (instant recovery on a real hit)', () => {
		for (let i = 0; i < DRY_THRESHOLD; i++) ytmusicHealth.recordDry();
		expect(ytmusicHealth.isGated()).toBe(true);
		ytmusicHealth.recordOk();
		expect(ytmusicHealth.isGated()).toBe(false);
		ytmusicHealth.recordDry();
		expect(ytmusicHealth.isGated()).toBe(false); // streak was genuinely reset
	});

	it('auto-opens for one probe after GATE_WINDOW_MS; a still-dry probe re-trips at once', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DRY_THRESHOLD; i++) ytmusicHealth.recordDry();
		expect(ytmusicHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(GATE_WINDOW_MS - 1);
		expect(ytmusicHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(2);
		expect(ytmusicHealth.isGated()).toBe(false); // probe window
		ytmusicHealth.recordDry(); // the probe was still dry
		expect(ytmusicHealth.isGated()).toBe(true); // re-tripped on ONE failure, not a fresh run
	});

	it('a successful probe after the window recovers permanently', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DRY_THRESHOLD; i++) ytmusicHealth.recordDry();
		vi.advanceTimersByTime(GATE_WINDOW_MS + 1);
		expect(ytmusicHealth.isGated()).toBe(false);
		ytmusicHealth.recordOk();
		expect(ytmusicHealth.isGated()).toBe(false);
		for (let i = 0; i < DRY_THRESHOLD - 1; i++) ytmusicHealth.recordDry();
		expect(ytmusicHealth.isGated()).toBe(false);
	});

	it('never throws on any entry point', () => {
		expect(() => {
			ytmusicHealth.recordDry();
			ytmusicHealth.recordFail();
			ytmusicHealth.recordOk();
			ytmusicHealth.isGated();
			ytmusicHealth.__reset();
		}).not.toThrow();
	});
});
