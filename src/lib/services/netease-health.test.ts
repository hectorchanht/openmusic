import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { neteaseHealth, DRY_THRESHOLD, GATE_WINDOW_MS } from './netease-health';

// Reset the in-memory tracker between cases so state never leaks (mirrors ttl-cache's
// __clearSearchCache / cover-backfill's __resetCoverMissCache reset-for-tests idiom).
beforeEach(() => {
	neteaseHealth.__reset();
});
afterEach(() => {
	neteaseHealth.__reset();
	vi.useRealTimers();
});

describe('neteaseHealth (pure, in-memory, never-throw health gate)', () => {
	it('is not gated on a fresh tracker', () => {
		expect(neteaseHealth.isGated()).toBe(false);
	});

	it('trips the gate after DRY_THRESHOLD consecutive dry responses', () => {
		// Below the threshold the gate stays open (calls still go through).
		for (let i = 0; i < DRY_THRESHOLD - 1; i++) {
			neteaseHealth.recordDry();
			expect(neteaseHealth.isGated()).toBe(false);
		}
		// The threshold-th consecutive dry trips it.
		neteaseHealth.recordDry();
		expect(neteaseHealth.isGated()).toBe(true);
	});

	it('recordOk() clears the gate immediately (instant recovery on a real hit)', () => {
		for (let i = 0; i < DRY_THRESHOLD; i++) neteaseHealth.recordDry();
		expect(neteaseHealth.isGated()).toBe(true);

		neteaseHealth.recordOk();
		expect(neteaseHealth.isGated()).toBe(false);
	});

	it('recordOk() mid-streak resets the dry counter (needs a fresh run to trip)', () => {
		neteaseHealth.recordDry();
		neteaseHealth.recordOk(); // resets the streak before it reaches the threshold
		// A single dry after the reset must NOT trip a threshold >= 2.
		neteaseHealth.recordDry();
		expect(neteaseHealth.isGated()).toBe(false);
	});

	it('auto-expires the gate after GATE_WINDOW_MS so a probe call is allowed', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DRY_THRESHOLD; i++) neteaseHealth.recordDry();
		expect(neteaseHealth.isGated()).toBe(true);

		// Still gated just before the window closes.
		vi.advanceTimersByTime(GATE_WINDOW_MS - 1);
		expect(neteaseHealth.isGated()).toBe(true);

		// After the window the gate opens so the adapter can issue one probe.
		vi.advanceTimersByTime(2);
		expect(neteaseHealth.isGated()).toBe(false);
	});

	it('a still-dry probe after the window re-trips immediately (1 wasted call per window)', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DRY_THRESHOLD; i++) neteaseHealth.recordDry();
		vi.advanceTimersByTime(GATE_WINDOW_MS + 1);
		expect(neteaseHealth.isGated()).toBe(false); // probe window open

		neteaseHealth.recordDry(); // the probe was still dry
		expect(neteaseHealth.isGated()).toBe(true); // re-tripped after a single dry probe
	});

	it('a successful probe after the window recovers permanently', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DRY_THRESHOLD; i++) neteaseHealth.recordDry();
		vi.advanceTimersByTime(GATE_WINDOW_MS + 1);
		expect(neteaseHealth.isGated()).toBe(false);

		neteaseHealth.recordOk(); // probe hit
		expect(neteaseHealth.isGated()).toBe(false);
		// And the counter is clear — it takes a full fresh run to trip again.
		for (let i = 0; i < DRY_THRESHOLD - 1; i++) neteaseHealth.recordDry();
		expect(neteaseHealth.isGated()).toBe(false);
	});

	it('never throws on any entry point', () => {
		expect(() => {
			neteaseHealth.recordDry();
			neteaseHealth.recordOk();
			neteaseHealth.isGated();
			neteaseHealth.__reset();
		}).not.toThrow();
	});
});
