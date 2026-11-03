import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { swipeAction, type SwipeActionOpts } from './swipeAction';

// swipeAction is the DIRECTIONAL, full-commit-then-spring-back swipe Svelte action (Phase 23,
// UX-04 / D-01/D-02), generalized verbatim from swipeRemove.ts. The LOAD-BEARING behaviour is the
// SAME gesture arbitration (Phase 15/20 invariants), only the COMMIT semantics differ:
//   - sub-slop movement stays a TAP (onclick still reaches the row → tap-to-play preserved),
//   - vertical-dominant movement YIELDS (goes passive so scroll/longpress runs),
//   - horizontal-dominant past threshold OR a fast flick COMMITS per-direction
//       (dx > 0 → onSwipeRight, dx < 0 → onSwipeLeft),
//   - the row ALWAYS springs back to translateX(0) afterward — it is NEVER removed (D-02),
//   - setPointerCapture happens ONLY after the horizontal commit in move(), never on pointerdown.
// Driven headless with a fake node + synthetic PointerEvent records (no jsdom), mirroring
// swipeRemove.test.ts.

/** A synthetic PointerEvent — only the fields the action reads. */
function pe(clientX: number, clientY: number, timeStamp: number, pointerId = 1) {
	return { clientX, clientY, timeStamp, pointerId } as unknown as PointerEvent;
}

/**
 * A fake HTMLElement capturing the pieces the action uses: an event-listener registry so a test
 * can `fire()` a named pointer event, a recording `style` object, and a setPointerCapture spy so
 * we can assert WHEN capture happens.
 */
function makeNode() {
	const handlers = new Map<string, (e: PointerEvent) => void>();
	const style: Record<string, string> = {};
	const captureCalls: number[] = [];
	const node = {
		style,
		setPointerCapture: vi.fn((id: number) => captureCalls.push(id)),
		addEventListener(type: string, cb: (e: PointerEvent) => void) {
			handlers.set(type, cb);
		},
		removeEventListener(type: string) {
			handlers.delete(type);
		}
	};
	return {
		node: node as unknown as HTMLElement,
		style,
		captureCalls,
		fire(type: string, e: PointerEvent) {
			handlers.get(type)?.(e);
		},
		has: (type: string) => handlers.has(type)
	};
}

function mount(opts: SwipeActionOpts) {
	const h = makeNode();
	const action = swipeAction(h.node, opts);
	return { ...h, action };
}

describe('swipeAction — directional full-commit-then-spring-back swipe (Phase 23 UX-04 D-02)', () => {
	it('sub-slop movement then release does NOT commit and leaves the transform reset (tap preserved)', () => {
		const onSwipeRight = vi.fn();
		const onSwipeLeft = vi.fn();
		const m = mount({ onSwipeRight, onSwipeLeft });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(104, 52, 16)); // ddx=4, ddy=2 — both below SLOP
		m.fire('pointerup', pe(104, 52, 32));
		expect(onSwipeRight).not.toHaveBeenCalled();
		expect(onSwipeLeft).not.toHaveBeenCalled();
		expect(m.captureCalls).toHaveLength(0); // never captured → trailing click reaches onclick
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? '');
	});

	it('vertical-dominant movement past slop goes PASSIVE: no commit, no capture (scroll/longpress wins)', () => {
		const onSwipeRight = vi.fn();
		const onSwipeLeft = vi.fn();
		const m = mount({ onSwipeRight, onSwipeLeft });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(104, 90, 16)); // |ddy| 40 > |ddx| 4 → vertical wins, passive
		m.fire('pointermove', pe(108, 140, 32)); // stays passive (dragging cancelled)
		m.fire('pointerup', pe(108, 140, 48));
		expect(onSwipeRight).not.toHaveBeenCalled();
		expect(onSwipeLeft).not.toHaveBeenCalled();
		expect(m.captureCalls).toHaveLength(0);
	});

	it('right drag past the distance threshold then release commits onSwipeRight once, then springs back', () => {
		const onSwipeRight = vi.fn();
		const onSwipeLeft = vi.fn();
		const m = mount({ onSwipeRight, onSwipeLeft, threshold: 96 });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 52, 16)); // commit horizontal (ddx 12 > ddy 2, past slop)
		m.fire('pointermove', pe(220, 54, 200)); // dx = 120 > threshold 96, slow (no flick)
		m.fire('pointerup', pe(220, 54, 220));
		expect(onSwipeRight).toHaveBeenCalledTimes(1);
		expect(onSwipeLeft).not.toHaveBeenCalled();
		// ALWAYS springs back — the row is never removed (D-02).
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? ''); // quick-261022-spring: node settles instantly, onSettled clears inline styles
	});

	it('left drag past the distance threshold then release commits onSwipeLeft once, then springs back', () => {
		const onSwipeRight = vi.fn();
		const onSwipeLeft = vi.fn();
		const m = mount({ onSwipeRight, onSwipeLeft, threshold: 96 });
		m.fire('pointerdown', pe(220, 50, 0));
		m.fire('pointermove', pe(208, 52, 16)); // commit horizontal leftward
		m.fire('pointermove', pe(100, 54, 200)); // dx = -120, |dx| > threshold, slow
		m.fire('pointerup', pe(100, 54, 220));
		expect(onSwipeLeft).toHaveBeenCalledTimes(1);
		expect(onSwipeRight).not.toHaveBeenCalled();
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? ''); // quick-261022-spring: node settles instantly, onSettled clears inline styles
	});

	it('a fast RIGHT flick past slop but BELOW the distance threshold still commits onSwipeRight', () => {
		const onSwipeRight = vi.fn();
		const onSwipeLeft = vi.fn();
		const m = mount({ onSwipeRight, onSwipeLeft, threshold: 96 });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 50, 0)); // commit horizontal at t=0
		// dx = 40 (< threshold 96) but velocity = (140-112)/(20-0) = 1.4 px/ms > FLICK_V 0.5.
		m.fire('pointermove', pe(140, 50, 20));
		m.fire('pointerup', pe(140, 50, 20));
		expect(onSwipeRight).toHaveBeenCalledTimes(1);
		expect(onSwipeLeft).not.toHaveBeenCalled();
	});

	it('a fast LEFT flick past slop but BELOW the distance threshold still commits onSwipeLeft', () => {
		const onSwipeRight = vi.fn();
		const onSwipeLeft = vi.fn();
		const m = mount({ onSwipeRight, onSwipeLeft, threshold: 96 });
		m.fire('pointerdown', pe(140, 50, 0));
		m.fire('pointermove', pe(128, 50, 0)); // commit horizontal leftward at t=0
		// dx = -40 (|dx| < threshold) but |velocity| = 28/20 = 1.4 > FLICK_V.
		m.fire('pointermove', pe(100, 50, 20));
		m.fire('pointerup', pe(100, 50, 20));
		expect(onSwipeLeft).toHaveBeenCalledTimes(1);
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it('horizontal drag below threshold + slow release SPRINGS BACK (no commit, transform → 0)', () => {
		const onSwipeRight = vi.fn();
		const onSwipeLeft = vi.fn();
		const m = mount({ onSwipeRight, onSwipeLeft, threshold: 96 });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 50, 100)); // commit horizontal, slow
		m.fire('pointermove', pe(140, 50, 400)); // dx = 40 < threshold, velocity ~0.09 < FLICK_V
		m.fire('pointerup', pe(140, 50, 700));
		expect(onSwipeRight).not.toHaveBeenCalled();
		expect(onSwipeLeft).not.toHaveBeenCalled();
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? ''); // quick-261022-spring: node settles instantly, onSettled clears inline styles // animated back to rest
	});

	it('captures the pointer ONLY in move() after the horizontal commit, never on pointerdown', () => {
		const m = mount({ onSwipeRight: vi.fn(), onSwipeLeft: vi.fn() });
		m.fire('pointerdown', pe(100, 50, 0));
		expect(m.captureCalls).toHaveLength(0); // pointerdown must NOT capture (tap-preservation)
		m.fire('pointermove', pe(120, 51, 16)); // horizontal commit
		expect(m.captureCalls).toEqual([1]); // captured exactly once, in move(), with the pointerId
	});

	it('sets touch-action: pan-y on attach and clears it on destroy (yield horizontal, keep scroll)', () => {
		const m = mount({ onSwipeRight: vi.fn(), onSwipeLeft: vi.fn() });
		expect(m.style.touchAction).toBe('pan-y');
		m.action?.destroy?.();
		expect(m.style.touchAction).toBe('');
	});

	it('enabled:false makes the action inert (no drag, no commit)', () => {
		const onSwipeRight = vi.fn();
		const onSwipeLeft = vi.fn();
		const m = mount({ onSwipeRight, onSwipeLeft, enabled: false });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(300, 50, 16)); // a large horizontal drag
		m.fire('pointerup', pe(300, 50, 32));
		expect(onSwipeRight).not.toHaveBeenCalled();
		expect(onSwipeLeft).not.toHaveBeenCalled();
		expect(m.captureCalls).toHaveLength(0);
	});

	/** A synthetic click with preventDefault/stopPropagation spies (WR-01 suppression). */
	function clickEvent() {
		return {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn()
		} as unknown as PointerEvent & {
			preventDefault: ReturnType<typeof vi.fn>;
			stopPropagation: ReturnType<typeof vi.fn>;
		};
	}

	it('a committed drag SUPPRESSES the trailing click once (no commit-then-tap-to-play) (WR-01)', () => {
		const onSwipeRight = vi.fn();
		const m = mount({ onSwipeRight, onSwipeLeft: vi.fn(), threshold: 96 });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 52, 16)); // horizontal commit (captured)
		m.fire('pointermove', pe(220, 54, 200)); // dx 120 > threshold
		m.fire('pointerup', pe(220, 54, 220));
		expect(onSwipeRight).toHaveBeenCalledTimes(1);
		const click = clickEvent();
		m.fire('click', click);
		expect(click.preventDefault).toHaveBeenCalledTimes(1);
		expect(click.stopPropagation).toHaveBeenCalledTimes(1);
		expect(m.has('click')).toBe(false); // one-shot: suppressor removed itself
	});

	it('a spring-back partial drag ALSO suppresses the trailing click (a drag is never a tap) (WR-01)', () => {
		const m = mount({ onSwipeRight: vi.fn(), onSwipeLeft: vi.fn(), threshold: 96 });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 50, 100)); // horizontal commit (captured)
		m.fire('pointermove', pe(140, 50, 400)); // dx 40 < threshold, slow → spring back
		m.fire('pointerup', pe(140, 50, 700));
		const click = clickEvent();
		m.fire('click', click);
		expect(click.preventDefault).toHaveBeenCalledTimes(1);
		expect(click.stopPropagation).toHaveBeenCalledTimes(1);
	});

	it('a TAP (sub-slop) arms NO click suppressor — tap-to-play keeps firing (WR-01)', () => {
		const m = mount({ onSwipeRight: vi.fn(), onSwipeLeft: vi.fn() });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(104, 52, 16)); // below slop on both axes — never captured
		m.fire('pointerup', pe(104, 52, 32));
		expect(m.has('click')).toBe(false); // the row's own onclick receives the click untouched
	});

	it('does NOT fade opacity during a drag (these rows are never removed — no FADE_DISTANCE)', () => {
		const m = mount({ onSwipeRight: vi.fn(), onSwipeLeft: vi.fn() });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(180, 50, 16)); // big horizontal drag
		expect(['', undefined]).toContain(m.style.opacity); // opacity never written
	});

	it('update(opts) swaps the callbacks and threshold reactively', () => {
		const firstRight = vi.fn();
		const m = mount({ onSwipeRight: firstRight, onSwipeLeft: vi.fn(), threshold: 96 });
		const secondRight = vi.fn();
		m.action?.update?.({ onSwipeRight: secondRight, onSwipeLeft: vi.fn(), threshold: 96 });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 52, 16));
		m.fire('pointermove', pe(220, 54, 200));
		m.fire('pointerup', pe(220, 54, 220));
		expect(firstRight).not.toHaveBeenCalled();
		expect(secondRight).toHaveBeenCalledTimes(1);
	});
});

// quick-261102-settle — the settle must be UNCONDITIONAL. Regression coverage for Hector's
// desktop report "swiping a song row does not snap back when the mouse leaves": when pointer
// capture is lost mid-gesture, NEITHER pointerup NOR pointercancel is delivered to the node,
// so the old code never ran up() and the row latched at its drag offset (reproduced in
// headless Chromium by stealing capture mid-drag). These tests drive the abandonment paths:
// lostpointercapture, a release heard only on window, window blur, a throwing
// setPointerCapture (window fallback tracking), and a button-less move.
describe('swipeAction — unconditional settle (quick-261102-settle)', () => {
	/** A synthetic PointerEvent WITH the buttons bitmask the settle guard reads. */
	function peb(clientX: number, clientY: number, timeStamp: number, pointerId = 1, buttons = 1) {
		return { clientX, clientY, timeStamp, pointerId, buttons } as unknown as PointerEvent;
	}

	/** A minimal fake `window` event registry for the action's safety-net listeners. */
	function makeWindow() {
		const handlers = new Map<string, Set<(e: PointerEvent) => void>>();
		return {
			addEventListener(type: string, cb: (e: PointerEvent) => void) {
				if (!handlers.has(type)) handlers.set(type, new Set());
				handlers.get(type)?.add(cb);
			},
			removeEventListener(type: string, cb: (e: PointerEvent) => void) {
				handlers.get(type)?.delete(cb);
			},
			fire(type: string, e: PointerEvent) {
				for (const cb of [...(handlers.get(type) ?? [])]) cb(e);
			},
			fireBlur() {
				for (const cb of [...(handlers.get('blur') ?? [])]) (cb as () => void)();
			},
			count(type: string) {
				return handlers.get(type)?.size ?? 0;
			}
		};
	}

	let fakeWin: ReturnType<typeof makeWindow>;
	beforeEach(() => {
		fakeWin = makeWindow();
		vi.stubGlobal('window', fakeWin);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('lostpointercapture mid-drag SPRINGS BACK (no commit below threshold, transform reset)', () => {
		const onSwipeRight = vi.fn();
		const m = mount({ onSwipeRight, onSwipeLeft: vi.fn(), threshold: 96 });
		m.fire('pointerdown', peb(100, 50, 0));
		m.fire('pointermove', peb(112, 50, 100)); // horizontal commit (captured)
		m.fire('pointermove', peb(140, 50, 400)); // dx = 40 < threshold, slow
		expect(m.style.transform).toBe('translateX(40px)'); // row is displaced mid-drag
		m.fire('lostpointercapture', peb(140, 50, 450)); // capture stolen — no up/cancel follows
		expect(onSwipeRight).not.toHaveBeenCalled();
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? ''); // settled to origin
		expect(fakeWin.count('pointerup')).toBe(0); // safety net disarmed after the settle
	});

	it('lostpointercapture PAST the threshold commits like a release (pointercancel parity)', () => {
		const onSwipeRight = vi.fn();
		const m = mount({ onSwipeRight, onSwipeLeft: vi.fn(), threshold: 96 });
		m.fire('pointerdown', peb(100, 50, 0));
		m.fire('pointermove', peb(112, 52, 16));
		m.fire('pointermove', peb(220, 54, 200)); // dx = 120 > threshold
		m.fire('lostpointercapture', peb(220, 54, 220));
		expect(onSwipeRight).toHaveBeenCalledTimes(1);
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? '');
	});

	it('a release heard ONLY on window (pointer released off-row, no node pointerup) still settles', () => {
		const onSwipeRight = vi.fn();
		const m = mount({ onSwipeRight, onSwipeLeft: vi.fn(), threshold: 96 });
		m.fire('pointerdown', peb(100, 50, 0));
		m.fire('pointermove', peb(112, 50, 100));
		m.fire('pointermove', peb(140, 50, 400)); // dx = 40, displaced
		expect(m.style.transform).toBe('translateX(40px)');
		fakeWin.fire('pointerup', peb(140, 470, 500)); // released far below the row
		expect(onSwipeRight).not.toHaveBeenCalled();
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? '');
	});

	it('window blur mid-drag settles the gesture (abandoned swipe = abandoned touch swipe)', () => {
		const m = mount({ onSwipeRight: vi.fn(), onSwipeLeft: vi.fn(), threshold: 96 });
		m.fire('pointerdown', peb(100, 50, 0));
		m.fire('pointermove', peb(112, 50, 100));
		m.fire('pointermove', peb(150, 50, 400)); // dx = 50, displaced
		expect(m.style.transform).toBe('translateX(50px)');
		fakeWin.fireBlur();
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? '');
	});

	it('a button-less move mid-drag settles instead of hover-dragging', () => {
		const m = mount({ onSwipeRight: vi.fn(), onSwipeLeft: vi.fn(), threshold: 96 });
		m.fire('pointerdown', peb(100, 50, 0));
		m.fire('pointermove', peb(112, 50, 100));
		m.fire('pointermove', peb(140, 50, 400)); // dx = 40
		m.fire('pointermove', peb(200, 50, 500, 1, 0)); // press ended unseen — buttons 0
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? '');
	});

	it('when setPointerCapture THROWS, window listeners keep tracking and the release settles', () => {
		const handlers = new Map<string, (e: PointerEvent) => void>();
		const style: Record<string, string> = {};
		const node = {
			style,
			setPointerCapture: vi.fn(() => {
				throw new Error('NotFoundError');
			}),
			addEventListener(type: string, cb: (e: PointerEvent) => void) {
				handlers.set(type, cb);
			},
			removeEventListener(type: string) {
				handlers.delete(type);
			}
		};
		const onSwipeRight = vi.fn();
		swipeAction(node as unknown as HTMLElement, { onSwipeRight, onSwipeLeft: vi.fn(), threshold: 96 });
		const fire = (type: string, e: PointerEvent) => handlers.get(type)?.(e);
		fire('pointerdown', peb(100, 50, 0));
		fire('pointermove', peb(112, 50, 100)); // commit attempt — capture throws here
		// The pointer is now OFF the node: only window hears the rest of the gesture.
		fakeWin.fire('pointermove', peb(160, 50, 400)); // dx = 60 tracked via the fallback
		expect(style.transform).toBe('translateX(60px)');
		fakeWin.fire('pointerup', peb(160, 300, 500)); // released outside — settles via window
		expect(onSwipeRight).not.toHaveBeenCalled(); // 60 < threshold, slow → spring back
		expect(['', 'translateX(0)']).toContain(style.transform ?? '');
	});
});
