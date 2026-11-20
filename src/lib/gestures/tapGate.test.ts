import { describe, it, expect } from 'vitest';
import { classifyTap, createTapGate, DOUBLE_TAP_WINDOW_MS } from './tapGate';

// quick-261116-dtap: the pure tap-timing rule behind use:doubleTap. The action is a thin
// timer shell; every timing decision that could mis-fire the Nowbar expand or the random
// dive lives here and is pinned by these cases.
describe('classifyTap', () => {
	it('no previous tap → pending', () => {
		expect(classifyTap(null, 1000)).toBe('pending');
	});
	it('second tap inside the window → double', () => {
		expect(classifyTap(1000, 1000 + DOUBLE_TAP_WINDOW_MS - 1)).toBe('double');
	});
	it('second tap exactly at the window edge → double (inclusive)', () => {
		expect(classifyTap(1000, 1000 + DOUBLE_TAP_WINDOW_MS)).toBe('double');
	});
	it('second tap after the window → pending (a fresh single)', () => {
		expect(classifyTap(1000, 1000 + DOUBLE_TAP_WINDOW_MS + 1)).toBe('pending');
	});
	it('clock skew backwards → pending, never a manufactured double', () => {
		expect(classifyTap(1000, 500)).toBe('pending');
	});
	it('honours a custom window', () => {
		expect(classifyTap(0, 100, 50)).toBe('pending');
		expect(classifyTap(0, 100, 150)).toBe('double');
	});
});

describe('createTapGate', () => {
	it('first tap pends, second inside the window doubles and consumes the pair', () => {
		const gate = createTapGate();
		expect(gate.tap(0)).toBe('pending');
		expect(gate.pending()).toBe(true);
		expect(gate.tap(120)).toBe('double');
		expect(gate.pending()).toBe(false);
		// Third tap starts a FRESH pending cycle — it cannot pair with the consumed first.
		expect(gate.tap(200)).toBe('pending');
		expect(gate.tap(300)).toBe('double');
	});
	it('expire() spends the pending tap (the single-tap timer fired)', () => {
		const gate = createTapGate();
		expect(gate.tap(0)).toBe('pending');
		gate.expire();
		expect(gate.pending()).toBe(false);
		// A tap after expiry is a new single, not a double off the expired one.
		expect(gate.tap(100)).toBe('pending');
	});
	it('a tap after the window pairs with nothing — it becomes the new pending tap', () => {
		const gate = createTapGate();
		expect(gate.tap(0)).toBe('pending');
		expect(gate.tap(DOUBLE_TAP_WINDOW_MS + 50)).toBe('pending');
		expect(gate.tap(DOUBLE_TAP_WINDOW_MS + 80)).toBe('double');
	});
	it('reset() drops a pending tap silently', () => {
		const gate = createTapGate();
		gate.tap(0);
		gate.reset();
		expect(gate.pending()).toBe(false);
		expect(gate.tap(50)).toBe('pending');
	});
});
