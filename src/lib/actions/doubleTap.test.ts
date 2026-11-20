import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { doubleTap } from './doubleTap';
import { DOUBLE_TAP_WINDOW_MS } from '$lib/gestures/tapGate';

// quick-261116-dtap: use:doubleTap — the cover-only double-tap gate (Car Mode plan Phase 3).
// Driven headless with a fake node (no jsdom), mirroring tapBounce.test.ts. The load-bearing
// facts pinned here:
//   1. a single cover tap runs the host action ONCE, only after the window (never instantly,
//      never twice) — the Nowbar expand pays ≤260ms on cover taps only;
//   2. a second tap inside the window cancels the single and fires the dive immediately;
//   3. clicks the action does not claim (disabled, nested control) are NOT stopPropagation'd,
//      so the host's own handlers see them exactly as before this action existed;
//   4. destroy drops a pending single — Nowbar's cover remounts per track, and a deferred
//      expand from a dead node would be a ghost action.

type Handler = (e: never) => void;

function makeNode() {
	const classes = new Set<string>();
	const handlers = new Map<string, Handler>();
	const contained = new Set<unknown>();
	const node = {
		classList: {
			add: (c: string) => classes.add(c),
			remove: (c: string) => classes.delete(c),
			contains: (c: string) => classes.has(c)
		},
		addEventListener(type: string, cb: Handler) {
			handlers.set(type, cb);
		},
		removeEventListener(type: string) {
			handlers.delete(type);
		},
		contains: (el: unknown) => contained.has(el)
	};
	return {
		node: node as unknown as HTMLElement,
		classes,
		contained,
		fire: (type: string, e: unknown) => handlers.get(type)?.(e as never),
		has: (type: string) => handlers.has(type)
	};
}

function clickEvent(target: unknown, timeStamp: number) {
	return {
		target,
		timeStamp,
		stopPropagation: vi.fn(),
		preventDefault: vi.fn()
	};
}

describe('doubleTap action', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	function setup(opts?: { enabled?: boolean }) {
		const h = makeNode();
		const onsingletap = vi.fn();
		const ondoubletap = vi.fn();
		const action = doubleTap(h.node, {
			onsingletap,
			ondoubletap,
			enabled: opts?.enabled ?? true
		});
		return { h, onsingletap, ondoubletap, action };
	}

	it('single tap: host action fires once, after the window, and the click is claimed', () => {
		const { h, onsingletap, ondoubletap } = setup();
		const e = clickEvent(h.node, 1000);
		h.fire('click', e);
		expect(e.stopPropagation).toHaveBeenCalledTimes(1);
		expect(onsingletap).not.toHaveBeenCalled();
		vi.advanceTimersByTime(DOUBLE_TAP_WINDOW_MS - 1);
		expect(onsingletap).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onsingletap).toHaveBeenCalledTimes(1);
		expect(ondoubletap).not.toHaveBeenCalled();
	});

	it('double tap: dive fires on the second tap, the pending single never runs, pulse class is added', () => {
		const { h, onsingletap, ondoubletap } = setup();
		h.fire('click', clickEvent(h.node, 1000));
		h.fire('click', clickEvent(h.node, 1150));
		expect(ondoubletap).toHaveBeenCalledTimes(1);
		expect(h.classes.has('dtap-pulse')).toBe(true);
		vi.advanceTimersByTime(DOUBLE_TAP_WINDOW_MS + 50);
		expect(onsingletap).not.toHaveBeenCalled();
	});

	it('two taps OUTSIDE the window are two singles (the gate re-pends)', () => {
		const { h, onsingletap, ondoubletap } = setup();
		h.fire('click', clickEvent(h.node, 0));
		vi.advanceTimersByTime(DOUBLE_TAP_WINDOW_MS + 10);
		expect(onsingletap).toHaveBeenCalledTimes(1);
		h.fire('click', clickEvent(h.node, 2000));
		vi.advanceTimersByTime(DOUBLE_TAP_WINDOW_MS + 10);
		expect(onsingletap).toHaveBeenCalledTimes(2);
		expect(ondoubletap).not.toHaveBeenCalled();
	});

	it('disabled: clicks are not claimed and nothing is scheduled', () => {
		const { h, onsingletap, ondoubletap } = setup({ enabled: false });
		const e = clickEvent(h.node, 0);
		h.fire('click', e);
		expect(e.stopPropagation).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1000);
		expect(onsingletap).not.toHaveBeenCalled();
		expect(ondoubletap).not.toHaveBeenCalled();
	});

	it('a click on a nested control inside the cover is not claimed', () => {
		const { h, onsingletap, ondoubletap } = setup();
		const button = { closest: () => button };
		h.contained.add(button);
		const target = { closest: () => button };
		const e = clickEvent(target, 0);
		h.fire('click', e);
		expect(e.stopPropagation).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1000);
		expect(onsingletap).not.toHaveBeenCalled();
		expect(ondoubletap).not.toHaveBeenCalled();
	});

	it('an interactive ANCESTOR (role=button host) does not disqualify the cover tap', () => {
		const { h, onsingletap } = setup();
		// target.closest finds the host .cover (role=button) — NOT contained in the node.
		const host = { closest: () => host };
		const target = { closest: () => host };
		const e = clickEvent(target, 0);
		h.fire('click', e);
		expect(e.stopPropagation).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(DOUBLE_TAP_WINDOW_MS + 10);
		expect(onsingletap).toHaveBeenCalledTimes(1);
	});

	it('destroy drops the pending single and unhooks the listeners', () => {
		const { h, onsingletap, action } = setup();
		h.fire('click', clickEvent(h.node, 0));
		action?.destroy?.();
		expect(h.has('click')).toBe(false);
		vi.advanceTimersByTime(1000);
		expect(onsingletap).not.toHaveBeenCalled();
	});

	it('update disabling mid-window drops the pending single', () => {
		const { h, onsingletap, ondoubletap, action } = setup();
		h.fire('click', clickEvent(h.node, 0));
		action?.update?.({ onsingletap, ondoubletap, enabled: false });
		vi.advanceTimersByTime(1000);
		expect(onsingletap).not.toHaveBeenCalled();
	});
});
