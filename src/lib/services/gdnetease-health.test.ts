import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gdneteaseHealth } from './gdnetease-health';
import { DEFAULT_THRESHOLD, DEFAULT_WINDOW_MS } from './source-health';

// Instance tests for the GD Netease health gate (universal-gate rollout, 2026-11-01). The shared
// state machine is covered exhaustively by source-health.test + netease-health.test; what is
// per-instance is that THIS module's counter is its own (a GD Netease outage must never gate a
// sibling source) and that it trips/recovers with the shared defaults.
// Reset between cases so state never leaks (the ttl-cache __clear idiom).
beforeEach(() => gdneteaseHealth.__reset());
afterEach(() => {
	gdneteaseHealth.__reset();
	vi.useRealTimers();
});

describe('gdneteaseHealth (per-source health gate instance)', () => {
	it('is not gated on a fresh tracker', () => {
		expect(gdneteaseHealth.isGated()).toBe(false);
	});

	it('trips after DEFAULT_THRESHOLD consecutive failures, not before', () => {
		for (let i = 0; i < DEFAULT_THRESHOLD - 1; i++) {
			gdneteaseHealth.recordFail();
			expect(gdneteaseHealth.isGated()).toBe(false);
		}
		gdneteaseHealth.recordFail();
		expect(gdneteaseHealth.isGated()).toBe(true);
	});

	it('recordOk() clears the gate immediately (instant recovery on a real hit)', () => {
		for (let i = 0; i < DEFAULT_THRESHOLD; i++) gdneteaseHealth.recordFail();
		expect(gdneteaseHealth.isGated()).toBe(true);
		gdneteaseHealth.recordOk();
		expect(gdneteaseHealth.isGated()).toBe(false);
		gdneteaseHealth.recordFail();
		expect(gdneteaseHealth.isGated()).toBe(false); // streak was genuinely reset
	});

	it('auto-opens for one probe after the window; a failing probe re-trips at once', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DEFAULT_THRESHOLD; i++) gdneteaseHealth.recordFail();
		expect(gdneteaseHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(DEFAULT_WINDOW_MS - 1);
		expect(gdneteaseHealth.isGated()).toBe(true);
		vi.advanceTimersByTime(2);
		expect(gdneteaseHealth.isGated()).toBe(false); // probe window
		gdneteaseHealth.recordFail(); // the probe failed too
		expect(gdneteaseHealth.isGated()).toBe(true); // re-tripped on ONE failure, not a fresh run
	});

	it('a successful probe after the window recovers permanently', () => {
		vi.useFakeTimers();
		for (let i = 0; i < DEFAULT_THRESHOLD; i++) gdneteaseHealth.recordFail();
		vi.advanceTimersByTime(DEFAULT_WINDOW_MS + 1);
		expect(gdneteaseHealth.isGated()).toBe(false);
		gdneteaseHealth.recordOk();
		expect(gdneteaseHealth.isGated()).toBe(false);
		for (let i = 0; i < DEFAULT_THRESHOLD - 1; i++) gdneteaseHealth.recordFail();
		expect(gdneteaseHealth.isGated()).toBe(false);
	});

	it('never throws on any entry point', () => {
		expect(() => {
			gdneteaseHealth.recordFail();
			gdneteaseHealth.recordOk();
			gdneteaseHealth.isGated();
			gdneteaseHealth.__reset();
		}).not.toThrow();
	});
});
