import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { archiveHealth } from './archive-health';
import { DEFAULT_THRESHOLD, DEFAULT_WINDOW_MS } from './source-health';

// Instance tests for the Internet Archive health gate (universal-gate rollout, 2026-11-01). The shared
// state machine is covered exhaustively by source-health.test + netease-health.test; what is
// per-instance is that THIS module's counter is its own (a Internet Archive outage must never gate a
// sibling source) and that it trips/recovers with the shared defaults.
// Reset between cases so state never leaks (the ttl-cache __clear idiom).
beforeEach(() => archiveHealth.__reset());
afterEach(() => {
	archiveHealth.__reset();
	vi.useRealTimers();
});

describe('archiveHealth (per-source health gate instance)', () => {
	it('is not gated on a fresh tracker', () => {
		expect(archiveHealth.isGated()).toBe(false);
	});

	it('trips after DEFAULT_THRESHOLD consecutive failures, not before', () => {
		for (let i = 0; i < DEFAULT_THRESHOLD - 1; i++) {
			archiveHealth.recordFail();
			expect(archiveHealth.isGated()).toBe(false);
		}
		archiveHealth.recordFail();
		expect(archiveHealth.isGated()).toBe(true);
	});

	it('recordOk() clears the gate immediately (instant recovery on a real hit)', () => {
		for (let i = 0; i < DEFAULT_THRESHOLD; i++) archiveHealth.recordFail();
		expect(archiveHealth.isGated()).toBe(true);
		archiveHealth.recordOk();
		expect(archiveHealth.isGated()).toBe(false);
		archiveHealth.recordFail();
		expect(archiveHealth.isGated()).toBe(false); // streak was genuinely reset
	});

	it('auto-opens for one probe after the window; a failing probe re-trips at once', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DEFAULT_THRESHOLD; i++) archiveHealth.recordFail();
		expect(archiveHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(DEFAULT_WINDOW_MS - 1);
		expect(archiveHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(2);
		expect(archiveHealth.isGated()).toBe(false); // probe window
		archiveHealth.recordFail(); // the probe failed too
		expect(archiveHealth.isGated()).toBe(true); // re-tripped on ONE failure, not a fresh run
	});

	it('a successful probe after the window recovers permanently', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DEFAULT_THRESHOLD; i++) archiveHealth.recordFail();
		vi.advanceTimersByTime(DEFAULT_WINDOW_MS + 1);
		expect(archiveHealth.isGated()).toBe(false);
		archiveHealth.recordOk();
		expect(archiveHealth.isGated()).toBe(false);
		for (let i = 0; i < DEFAULT_THRESHOLD - 1; i++) archiveHealth.recordFail();
		expect(archiveHealth.isGated()).toBe(false);
	});

	it('never throws on any entry point', () => {
		expect(() => {
			archiveHealth.recordFail();
			archiveHealth.recordOk();
			archiveHealth.isGated();
			archiveHealth.__reset();
		}).not.toThrow();
	});
});
