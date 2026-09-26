import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shouldSuppressClickAfterLongpress, longpress } from './longpress';

// longpress is a hold-to-fire Svelte action (quick-260606-tmh). After the ~450ms hold it
// dispatches a `longpress` CustomEvent, but the OS still emits a trailing native `click` once
// the finger lifts — and at every call site that click runs an `onclick` that starts playback,
// so the menu opens AND a song plays (it looks like "the menu didn't open"). The fix arms a
// one-shot capture-phase click suppressor when the longpress fires. Only the pure decision
// helper is unit-tested here (the DOM capture-phase flow is verified manually — the node vitest
// project has no jsdom). Mirrors dragScroll.test.ts's shouldSuppressClick style.
describe('shouldSuppressClickAfterLongpress — longpress-fired vs short-tap (quick-260606-tmh)', () => {
	it('a fired longpress suppresses the trailing click (so play does not also fire)', () => {
		expect(shouldSuppressClickAfterLongpress(true)).toBe(true);
	});

	it('a short tap (no longpress) lets the click through (tap-to-play preserved)', () => {
		expect(shouldSuppressClickAfterLongpress(false)).toBe(false);
	});
});

// quick-260926-mzn: the suppressor's self-disarm window. No jsdom, so the node is a plain Node 22
// EventTarget and `document` is a minimal fake. NOT an EventTarget: Node's EventTarget fails to
// REMOVE a listener added with boolean `capture=true` (browsers do remove it), which would make every
// disarm look broken. The handlers only read clientX/clientY, so a plain Event carrying those stands
// in for PointerEvent.
function fakeDocument() {
	const listeners = new Set<(e: Event) => void>();
	return {
		addEventListener: (_t: string, fn: (e: Event) => void) => void listeners.add(fn),
		removeEventListener: (_t: string, fn: (e: Event) => void) => void listeners.delete(fn),
		dispatchEvent: (e: Event) => {
			for (const fn of [...listeners]) fn(e);
			return !e.defaultPrevented;
		}
	};
}

describe('longpress self-disarm starts at finger-lift (quick-260926-mzn)', () => {
	let doc: ReturnType<typeof fakeDocument>;
	let node: EventTarget;
	let destroy: () => void;
	const ptr = (type: string) => Object.assign(new Event(type), { clientX: 0, clientY: 0 });
	/** Dispatch a trailing click on `document`; true = the armed guard ate it. */
	const clickEaten = () => {
		const e = new Event('click', { cancelable: true });
		doc.dispatchEvent(e);
		return e.defaultPrevented;
	};

	beforeEach(() => {
		vi.useFakeTimers();
		doc = fakeDocument();
		vi.stubGlobal('document', doc);
		node = new EventTarget();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		destroy = (longpress(node as any, undefined) as { destroy: () => void }).destroy;
	});
	afterEach(() => {
		destroy();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('no trailing click after the hold → the guard disarms 700ms after lift (the next real tap is NOT eaten)', () => {
		node.dispatchEvent(ptr('pointerdown'));
		vi.advanceTimersByTime(500); // hold fires at 450ms
		node.dispatchEvent(ptr('pointerup'));
		vi.advanceTimersByTime(800);
		expect(clickEaten()).toBe(false);
	});

	it('the trailing click right after lift is still eaten (menu opens, row does not also play)', () => {
		node.dispatchEvent(ptr('pointerdown'));
		vi.advanceTimersByTime(500);
		node.dispatchEvent(ptr('pointerup'));
		expect(clickEaten()).toBe(true);
		expect(clickEaten()).toBe(false); // one-shot
	});

	it('a LONG hold keeps the guard armed until lift, so its trailing click is still eaten', () => {
		node.dispatchEvent(ptr('pointerdown'));
		vi.advanceTimersByTime(3000); // finger down well past 450 + 700ms
		node.dispatchEvent(ptr('pointerup'));
		expect(clickEaten()).toBe(true);
	});

	it('a short tap never arms the guard', () => {
		node.dispatchEvent(ptr('pointerdown'));
		vi.advanceTimersByTime(200);
		node.dispatchEvent(ptr('pointerup'));
		expect(clickEaten()).toBe(false);
	});
});
