import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHealthGate } from './source-health';

// The state machine itself is already exercised through the netease instance (netease-health.test).
// What is NEW here is that it is a FACTORY: the reason it was extracted is that a second source
// (kuwo, 526 from a broken upstream TLS cert) needed the same gate. Two sources sharing one
// counter would be worse than the duplication it replaced — a netease dry spell would gate kuwo.

afterEach(() => vi.useRealTimers());

describe('createHealthGate — per-instance isolation', () => {
	it('keeps two gates completely independent', () => {
		const a = createHealthGate(3);
		const b = createHealthGate(3);

		a.recordFail();
		a.recordFail();
		a.recordFail();

		expect(a.isGated()).toBe(true);
		expect(b.isGated()).toBe(false); // b never saw a failure
	});
});

describe('createHealthGate — trip / recover', () => {
	it('does not gate below the threshold, gates at it', () => {
		const g = createHealthGate(3);
		g.recordFail();
		g.recordFail();
		expect(g.isGated()).toBe(false);
		g.recordFail();
		expect(g.isGated()).toBe(true);
	});

	it('recordOk clears streak AND trip immediately', () => {
		const g = createHealthGate(2);
		g.recordFail();
		g.recordFail();
		expect(g.isGated()).toBe(true);

		g.recordOk();

		expect(g.isGated()).toBe(false);
		g.recordFail(); // streak was reset, so one failure is not enough to re-trip
		expect(g.isGated()).toBe(false);
	});

	// The gate must NEVER hide a source permanently — after the window it opens for exactly one
	// probe, and that probe's outcome re-decides.
	it('auto-opens for one probe once the window elapses', () => {
		vi.useFakeTimers();
		const g = createHealthGate(2, 60_000);
		g.recordFail();
		g.recordFail();
		expect(g.isGated()).toBe(true);

		vi.advanceTimersByTime(59_000);
		expect(g.isGated()).toBe(true); // still inside the window

		vi.advanceTimersByTime(2_000);
		expect(g.isGated()).toBe(false); // opened for the probe
	});

	// The failure counter is deliberately LEFT at/above threshold on expiry, so a still-dead upstream
	// costs exactly ONE wasted call per window rather than `threshold` of them.
	it('a failing probe re-trips on a single recordFail', () => {
		vi.useFakeTimers();
		const g = createHealthGate(3, 60_000);
		g.recordFail();
		g.recordFail();
		g.recordFail();
		vi.advanceTimersByTime(61_000);
		expect(g.isGated()).toBe(false); // probe window

		g.recordFail(); // the probe failed too

		expect(g.isGated()).toBe(true); // re-tripped immediately, not after 3 more
	});

	it('a succeeding probe restores the source', () => {
		vi.useFakeTimers();
		const g = createHealthGate(2, 60_000);
		g.recordFail();
		g.recordFail();
		vi.advanceTimersByTime(61_000);

		g.recordOk();

		expect(g.isGated()).toBe(false);
		g.recordFail();
		expect(g.isGated()).toBe(false); // streak genuinely cleared
	});

	it('__reset clears everything', () => {
		const g = createHealthGate(1);
		g.recordFail();
		expect(g.isGated()).toBe(true);
		g.__reset();
		expect(g.isGated()).toBe(false);
	});
});
