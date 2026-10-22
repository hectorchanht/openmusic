import { describe, it, expect, vi } from 'vitest';
import { swipeRemove, type SwipeRemoveOpts } from './swipeRemove';

// swipeRemove is the horizontal axis-locked swipe-to-REMOVE Svelte action (Phase 17, QUEUE-05),
// a structural X-axis mirror of dragClose.ts. It shares an Up-Next row with the vertical
// GripVertical reorder, so the LOAD-BEARING behaviour is the gesture arbitration:
//   - sub-slop movement stays a TAP (onclick still reaches the row → tap-to-play preserved),
//   - vertical-dominant movement YIELDS (goes passive so the grip/scroll runs),
//   - horizontal-dominant past a distance threshold OR a fast flick REMOVES,
//   - below threshold + slow release SPRINGS BACK,
//   - setPointerCapture happens ONLY after the horizontal commit in move(), never on pointerdown.
// The action only touches a tiny DOM surface (addEventListener / setPointerCapture / style + an
// .style sink), so we drive it headless with a fake node + synthetic PointerEvent records — the
// same node-project style as dragReorder.test.ts / velocity.test.ts (no jsdom).

/** A synthetic PointerEvent — only the fields the action reads. */
function pe(clientX: number, clientY: number, timeStamp: number, pointerId = 1) {
	return { clientX, clientY, timeStamp, pointerId } as unknown as PointerEvent;
}

/**
 * A fake HTMLElement capturing the pieces the action uses: an event-listener registry
 * so a test can `fire()` a named pointer event, a recording `style` object, and a
 * setPointerCapture spy so we can assert WHEN capture happens.
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

function mount(opts: SwipeRemoveOpts) {
	const h = makeNode();
	const action = swipeRemove(h.node, opts);
	return { ...h, action };
}

describe('swipeRemove — horizontal axis-locked swipe-to-remove (Phase 17 QUEUE-05)', () => {
	it('sub-slop movement then release does NOT remove and leaves the transform reset (tap preserved)', () => {
		const onremove = vi.fn();
		const m = mount({ onremove });
		// down → tiny move (< 8px on both axes) → up = a tap, not a swipe.
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(104, 52, 16)); // ddx=4, ddy=2 — both below SLOP
		m.fire('pointerup', pe(104, 52, 32));
		expect(onremove).not.toHaveBeenCalled();
		expect(m.captureCalls).toHaveLength(0); // never captured → trailing click reaches onclick
		// No live non-zero slide applied: the row rests at translateX(0) (or unset), never offset.
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? '');
	});

	it('vertical-dominant movement past slop goes PASSIVE: no remove, no capture (grip/scroll wins)', () => {
		const onremove = vi.fn();
		const m = mount({ onremove });
		m.fire('pointerdown', pe(100, 50, 0));
		// |ddy| (40) > |ddx| (4) → vertical wins, action goes passive.
		m.fire('pointermove', pe(104, 90, 16));
		// Even a further move stays passive (dragging was cancelled).
		m.fire('pointermove', pe(108, 140, 32));
		m.fire('pointerup', pe(108, 140, 48));
		expect(onremove).not.toHaveBeenCalled();
		expect(m.captureCalls).toHaveLength(0); // never captured → lets the vertical grip run
	});

	it('horizontal-dominant drag past the distance threshold then release REMOVES once', () => {
		const onremove = vi.fn();
		const m = mount({ onremove, threshold: 96 });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 52, 16)); // commit horizontal (ddx 12 > ddy 2, past slop)
		m.fire('pointermove', pe(220, 54, 200)); // dx = 120 > threshold 96, slow (no flick)
		m.fire('pointerup', pe(220, 54, 220));
		expect(onremove).toHaveBeenCalledTimes(1);
	});

	it('a fast horizontal flick past slop but BELOW the distance threshold still REMOVES', () => {
		const onremove = vi.fn();
		const m = mount({ onremove, threshold: 96 });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 50, 0)); // commit horizontal at t=0
		// dx = 40 (< threshold 96) but velocity = (140-112)/(20-0) = 1.4 px/ms > FLICK_V 0.5.
		m.fire('pointermove', pe(140, 50, 20));
		m.fire('pointerup', pe(140, 50, 20));
		expect(onremove).toHaveBeenCalledTimes(1);
	});

	it('horizontal drag below threshold + slow release SPRINGS BACK (no remove, transform → 0)', () => {
		const onremove = vi.fn();
		const m = mount({ onremove, threshold: 96 });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 50, 100)); // commit horizontal, slow
		m.fire('pointermove', pe(140, 50, 400)); // dx = 40 < threshold, velocity ~0.09 < FLICK_V
		m.fire('pointerup', pe(140, 50, 700));
		expect(onremove).not.toHaveBeenCalled();
		// quick-261022-spring: the spring settles instantly in node (no rAF) and onSettled clears
		// the inline styles, so rest is '' — the '' / 'translateX(0)' duality matches the other
		// resting-state assertions in this file.
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? '');
		expect(['', '1']).toContain(m.style.opacity ?? '');
	});

	it('captures the pointer ONLY in move() after the horizontal commit, never on pointerdown', () => {
		const onremove = vi.fn();
		const m = mount({ onremove });
		m.fire('pointerdown', pe(100, 50, 0));
		expect(m.captureCalls).toHaveLength(0); // pointerdown must NOT capture (tap-preservation)
		m.fire('pointermove', pe(120, 51, 16)); // horizontal commit
		expect(m.captureCalls).toEqual([1]); // captured exactly once, in move(), with the pointerId
	});

	it('sets touch-action: pan-y on attach and clears it on destroy (yield horizontal, keep scroll)', () => {
		const m = mount({ onremove: vi.fn() });
		expect(m.style.touchAction).toBe('pan-y');
		m.action?.destroy?.();
		expect(m.style.touchAction).toBe('');
	});

	it('enabled:false makes the action inert (no drag, no remove)', () => {
		const onremove = vi.fn();
		const m = mount({ onremove, enabled: false });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(300, 50, 16)); // a large horizontal drag
		m.fire('pointerup', pe(300, 50, 32));
		expect(onremove).not.toHaveBeenCalled();
		expect(m.captureCalls).toHaveLength(0);
	});

	/** A synthetic click with preventDefault/stopPropagation spies (WR-01 suppression). */
	function clickEvent() {
		return {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn()
		} as unknown as PointerEvent & { preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> };
	}

	it('a committed drag past threshold SUPPRESSES the trailing click (no remove-then-replay) (WR-01)', () => {
		const onremove = vi.fn();
		const m = mount({ onremove, threshold: 96 });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 52, 16)); // horizontal commit (captured)
		m.fire('pointermove', pe(220, 54, 200)); // dx 120 > threshold
		m.fire('pointerup', pe(220, 54, 220));
		expect(onremove).toHaveBeenCalledTimes(1);
		// The trailing click (mouse input fires one after every mousedown→mouseup) is swallowed.
		const click = clickEvent();
		m.fire('click', click);
		expect(click.preventDefault).toHaveBeenCalledTimes(1);
		expect(click.stopPropagation).toHaveBeenCalledTimes(1);
		expect(m.has('click')).toBe(false); // one-shot: suppressor removed itself
	});

	it('a spring-back partial drag ALSO suppresses the trailing click (a drag is never a tap) (WR-01)', () => {
		const onremove = vi.fn();
		const m = mount({ onremove, threshold: 96 });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 50, 100)); // horizontal commit (captured)
		m.fire('pointermove', pe(140, 50, 400)); // dx 40 < threshold, slow → spring back
		m.fire('pointerup', pe(140, 50, 700));
		expect(onremove).not.toHaveBeenCalled();
		const click = clickEvent();
		m.fire('click', click);
		expect(click.preventDefault).toHaveBeenCalledTimes(1);
		expect(click.stopPropagation).toHaveBeenCalledTimes(1);
	});

	it('a TAP (sub-slop) arms NO click suppressor — tap-to-play keeps firing (WR-01)', () => {
		const onremove = vi.fn();
		const m = mount({ onremove });
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(104, 52, 16)); // below slop on both axes — never captured
		m.fire('pointerup', pe(104, 52, 32));
		expect(m.has('click')).toBe(false); // the row's own onclick receives the click untouched
	});
});
