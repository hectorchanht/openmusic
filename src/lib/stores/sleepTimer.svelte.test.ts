import { describe, it, expect, beforeEach } from 'vitest';
import { sleepTimer } from './sleepTimer.svelte';

// Headless runes (node project) — mirrors searchHistory.svelte.test.ts. The store is
// in-memory only (D-13), so there is no localStorage to guard. beforeEach(cancel)
// resets state AND clears any leaked live interval between tests.
describe('sleepTimer store (TIMER-01)', () => {
	beforeEach(() => {
		sleepTimer.cancel();
	});

	it("set('minutes', 30) activates with mode/deadline/selectedMinutes set", () => {
		sleepTimer.set('minutes', 30);
		expect(sleepTimer.active).toBe(true);
		expect(sleepTimer.mode).toBe('minutes');
		expect(sleepTimer.deadline).not.toBeNull();
		expect(sleepTimer.selectedMinutes).toBe(30);
		expect(sleepTimer.remaining).toBeGreaterThan(0);
	});

	it("set('minutes', m) holds an ABSOLUTE deadline ~ now + m*60_000 (D-14)", () => {
		const before = Date.now();
		sleepTimer.set('minutes', 10);
		const after = Date.now();
		// deadline is wall-clock absolute, within the window of the set() call
		expect(sleepTimer.deadline).toBeGreaterThanOrEqual(before + 10 * 60_000);
		expect(sleepTimer.deadline).toBeLessThanOrEqual(after + 10 * 60_000);
	});

	it("set('end-of-track') activates with deadline === null and no countdown", () => {
		sleepTimer.set('end-of-track');
		expect(sleepTimer.active).toBe(true);
		expect(sleepTimer.mode).toBe('end-of-track');
		expect(sleepTimer.deadline).toBeNull();
		expect(sleepTimer.selectedMinutes).toBeNull();
		expect(sleepTimer.remaining).toBe(0);
	});

	it('cancel() after a minutes timer returns mode to off and clears the deadline', () => {
		sleepTimer.set('minutes', 30);
		sleepTimer.cancel();
		expect(sleepTimer.active).toBe(false);
		expect(sleepTimer.mode).toBe('off');
		expect(sleepTimer.deadline).toBeNull();
		expect(sleepTimer.selectedMinutes).toBeNull();
		expect(sleepTimer.remaining).toBe(0);
	});

	it('restart() after set(minutes,15) produces a fresh deadline >= the original (D-11)', () => {
		sleepTimer.set('minutes', 15);
		const first = sleepTimer.deadline as number;
		sleepTimer.restart();
		expect(sleepTimer.mode).toBe('minutes');
		expect(sleepTimer.selectedMinutes).toBe(15);
		expect(sleepTimer.deadline as number).toBeGreaterThanOrEqual(first);
	});

	it('restart() is a no-op when no minutes duration was ever selected', () => {
		// fresh state (beforeEach cancel) → selectedMinutes is null
		sleepTimer.restart();
		expect(sleepTimer.active).toBe(false);
		expect(sleepTimer.mode).toBe('off');
		expect(sleepTimer.deadline).toBeNull();
	});

	it('switching from end-of-track to a minutes timer sets a deadline', () => {
		sleepTimer.set('end-of-track');
		expect(sleepTimer.deadline).toBeNull();
		sleepTimer.set('minutes', 45);
		expect(sleepTimer.mode).toBe('minutes');
		expect(sleepTimer.deadline).not.toBeNull();
		expect(sleepTimer.selectedMinutes).toBe(45);
	});
});
