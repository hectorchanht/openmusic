import { describe, it, expect, vi } from 'vitest';
import { coverSwipe, type CoverSwipeOpts } from './coverSwipe';

// coverSwipe is the reusable horizontal axis-locked prev/next swipe Svelte action (Phase 20,
// NP-01 cover carousel + NP-05 nowbar slide), a structural X-axis mirror of swipeRemove.ts.
// The LOAD-BEARING behaviour is the same gesture arbitration (ROADMAP Pitfall 7):
//   - sub-slop movement stays a TAP (onclick still reaches the host → tap-to-collapse/expand preserved),
//   - vertical-dominant movement YIELDS (goes passive so the host's vertical-collapse handler runs),
//   - horizontal-dominant past the PROPORTIONAL commit (0.28 × width) OR a fast flick fires onprev/onnext,
//   - below the commit + slow release SPRINGS BACK,
//   - setPointerCapture happens ONLY after the horizontal commit in move(), never on pointerdown,
//   - at a TRUE BOUNDARY (hasPrev:false / hasNext:false) the gesture rubber-bands and ALWAYS springs
//     back, ignoring flick.
// Direction mapping (D-03): drag RIGHT (dx > 0) = onprev; drag LEFT (dx < 0) = onnext.
// The action only touches a tiny DOM surface (addEventListener / setPointerCapture / style + an
// .style sink + getBoundingClientRect), so we drive it headless with a fake node + synthetic
// PointerEvent records — the same node-project style as swipeRemove.test.ts (no jsdom).

/** A synthetic PointerEvent — only the fields the action reads. */
function pe(clientX: number, clientY: number, timeStamp: number, pointerId = 1) {
	return { clientX, clientY, timeStamp, pointerId } as unknown as PointerEvent;
}

/**
 * A fake HTMLElement capturing the pieces the action uses: an event-listener registry
 * so a test can `fire()` a named pointer event, a recording `style` object, a
 * setPointerCapture spy so we can assert WHEN capture happens, and a getBoundingClientRect
 * returning a fixed width so the proportional 0.28×width commit is deterministic.
 */
function makeNode(width = 300) {
	const handlers = new Map<string, (e: PointerEvent) => void>();
	const style: Record<string, string> = {};
	const captureCalls: number[] = [];
	const releaseCalls: number[] = [];
	const node = {
		style,
		setPointerCapture: vi.fn((id: number) => captureCalls.push(id)),
		releasePointerCapture: vi.fn((id: number) => releaseCalls.push(id)),
		getBoundingClientRect: () => ({ width }) as DOMRect,
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
		releaseCalls,
		fire(type: string, e: PointerEvent) {
			handlers.get(type)?.(e);
		},
		has: (type: string) => handlers.has(type)
	};
}

function mount(opts: CoverSwipeOpts, width = 300) {
	const h = makeNode(width);
	const action = coverSwipe(h.node, opts);
	return { ...h, action };
}

/** Default opts factory so each test only overrides what it cares about. */
function opts(over: Partial<CoverSwipeOpts> = {}): CoverSwipeOpts {
	return { onprev: vi.fn(), onnext: vi.fn(), ...over };
}

/** A synthetic click with preventDefault/stopPropagation spies (trailing-click suppression). */
function clickEvent() {
	return {
		preventDefault: vi.fn(),
		stopPropagation: vi.fn()
	} as unknown as PointerEvent & {
		preventDefault: ReturnType<typeof vi.fn>;
		stopPropagation: ReturnType<typeof vi.fn>;
	};
}

// width 300 → commitDist = 0.28 × 300 = 84px, maxPull = 0.18 × 300 = 54px.

describe('coverSwipe — horizontal axis-locked prev/next swipe (Phase 20 NP-01/NP-05)', () => {
	it('sub-slop tap then release does NOT fire onprev/onnext, never captures, arms NO click suppressor', () => {
		const o = opts();
		const m = mount(o);
		// down → tiny move (< 8px on both axes) → up = a tap, not a swipe.
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(104, 52, 16)); // ddx=4, ddy=2 — both below SLOP
		m.fire('pointerup', pe(104, 52, 32));
		expect(o.onprev).not.toHaveBeenCalled();
		expect(o.onnext).not.toHaveBeenCalled();
		expect(m.captureCalls).toHaveLength(0); // never captured → trailing click reaches the host onclick
		expect(m.has('click')).toBe(false); // no suppressor armed → host tap-to-collapse/expand still fires
		// No live non-zero slide applied: the surface rests at translateX(0) (or unset), never offset.
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? '');
	});

	it('vertical-dominant movement past slop goes PASSIVE: no prev/next, no capture (collapse handler wins)', () => {
		const o = opts();
		const m = mount(o);
		m.fire('pointerdown', pe(100, 50, 0));
		// |ddy| (40) > |ddx| (4) → vertical wins, action goes passive so the host vertical-collapse runs.
		m.fire('pointermove', pe(104, 90, 16));
		// Even a further move stays passive (dragging was cancelled).
		m.fire('pointermove', pe(108, 140, 32));
		m.fire('pointerup', pe(108, 140, 48));
		expect(o.onprev).not.toHaveBeenCalled();
		expect(o.onnext).not.toHaveBeenCalled();
		expect(m.captureCalls).toHaveLength(0); // never captured → lets the vertical collapse handler run
	});

	it('horizontal drag RIGHT past 0.28×width (84px), slow → onprev once, onnext not called (D-03)', () => {
		const o = opts();
		const m = mount(o);
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 52, 16)); // commit horizontal (ddx 12 > ddy 2, past slop)
		m.fire('pointermove', pe(200, 54, 400)); // dx = 100 > commitDist 84, slow (no flick)
		m.fire('pointerup', pe(200, 54, 700));
		expect(o.onprev).toHaveBeenCalledTimes(1);
		expect(o.onnext).not.toHaveBeenCalled();
	});

	it('horizontal drag LEFT past 0.28×width (84px), slow → onnext once, onprev not called (D-03)', () => {
		const o = opts();
		const m = mount(o);
		m.fire('pointerdown', pe(200, 50, 0));
		m.fire('pointermove', pe(188, 52, 16)); // commit horizontal LEFT (ddx -12, past slop)
		m.fire('pointermove', pe(100, 54, 400)); // dx = -100, |dx| > commitDist 84, slow (no flick)
		m.fire('pointerup', pe(100, 54, 700));
		expect(o.onnext).toHaveBeenCalledTimes(1);
		expect(o.onprev).not.toHaveBeenCalled();
	});

	it('a fast horizontal flick RIGHT past slop but BELOW the distance commit still fires onprev', () => {
		const o = opts();
		const m = mount(o);
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 50, 0)); // commit horizontal at t=0
		// dx = 40 (< commitDist 84) but velocity = (140-112)/(20-0) = 1.4 px/ms > FLICK_V 0.5.
		m.fire('pointermove', pe(140, 50, 20));
		m.fire('pointerup', pe(140, 50, 20));
		expect(o.onprev).toHaveBeenCalledTimes(1);
		expect(o.onnext).not.toHaveBeenCalled();
	});

	it('a fast horizontal flick LEFT past slop but BELOW the distance commit still fires onnext', () => {
		const o = opts();
		const m = mount(o);
		m.fire('pointerdown', pe(200, 50, 0));
		m.fire('pointermove', pe(188, 50, 0)); // commit horizontal LEFT at t=0
		// dx = -40 (|dx| < commitDist 84) but velocity = (160-188)/(20-0) = -1.4 px/ms, |v| > FLICK_V.
		m.fire('pointermove', pe(160, 50, 20));
		m.fire('pointerup', pe(160, 50, 20));
		expect(o.onnext).toHaveBeenCalledTimes(1);
		expect(o.onprev).not.toHaveBeenCalled();
	});

	it('horizontal drag below the distance commit + slow release SPRINGS BACK (no prev/next, transform → 0)', () => {
		const o = opts();
		const m = mount(o);
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 50, 100)); // commit horizontal, slow
		m.fire('pointermove', pe(140, 50, 400)); // dx = 40 < commitDist 84, velocity ~0.09 < FLICK_V
		m.fire('pointerup', pe(140, 50, 700));
		expect(o.onprev).not.toHaveBeenCalled();
		expect(o.onnext).not.toHaveBeenCalled();
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? ''); // quick-261022-spring: node settles instantly, onSettled clears inline styles
	});

	it('captures the pointer ONLY in move() after the horizontal commit, never on pointerdown (Pitfall 7)', () => {
		const m = mount(opts());
		m.fire('pointerdown', pe(100, 50, 0));
		expect(m.captureCalls).toHaveLength(0); // pointerdown must NOT capture (tap-preservation)
		m.fire('pointermove', pe(120, 51, 16)); // horizontal commit
		expect(m.captureCalls).toEqual([1]); // captured exactly once, in move(), with the pointerId
	});

	it('reports the running dx to ondrag during a committing move (live carousel/nowbar follow)', () => {
		const ondrag = vi.fn();
		const m = mount(opts({ ondrag }));
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(150, 51, 16)); // horizontal commit, dx = 50
		expect(ondrag).toHaveBeenCalled();
		// the last ondrag call carries the running, non-zero dx (50) so the host can translate its strip.
		const lastDx = ondrag.mock.calls.at(-1)?.[0];
		expect(lastDx).toBe(50);
	});

	it('a committed drag SUPPRESSES the trailing click one-shot (no commit-then-replay)', () => {
		const o = opts();
		const m = mount(o);
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 52, 16)); // horizontal commit (captured)
		m.fire('pointermove', pe(200, 54, 400)); // dx 100 > commitDist 84
		m.fire('pointerup', pe(200, 54, 700));
		expect(o.onprev).toHaveBeenCalledTimes(1);
		// The trailing click (mouse input fires one after every mousedown→mouseup) is swallowed.
		const click = clickEvent();
		m.fire('click', click);
		expect(click.preventDefault).toHaveBeenCalledTimes(1);
		expect(click.stopPropagation).toHaveBeenCalledTimes(1);
		expect(m.has('click')).toBe(false); // one-shot: suppressor removed itself
	});

	it('sets touch-action: pan-y on attach and clears it on destroy (yield horizontal, keep scroll)', () => {
		const m = mount(opts());
		expect(m.style.touchAction).toBe('pan-y');
		m.action?.destroy?.();
		expect(m.style.touchAction).toBe('');
	});

	it('enabled:false makes the action inert (no commit, no capture)', () => {
		const o = opts({ enabled: false });
		const m = mount(o);
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(300, 50, 16)); // a large horizontal drag
		m.fire('pointerup', pe(300, 50, 32));
		expect(o.onprev).not.toHaveBeenCalled();
		expect(o.onnext).not.toHaveBeenCalled();
		expect(m.captureCalls).toHaveLength(0);
	});

	it('boundary: hasPrev:false + hard prev (RIGHT) flick → onprev NOT called, springs back to translateX(0)', () => {
		const o = opts({ hasPrev: false });
		const m = mount(o);
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 50, 0)); // commit horizontal RIGHT at t=0
		// dx well past commitDist AND a hard flick (velocity 1.4 px/ms > FLICK_V): both ignored at a true boundary.
		m.fire('pointermove', pe(250, 50, 100)); // dx 150 > 84, fast
		m.fire('pointerup', pe(250, 50, 100));
		expect(o.onprev).not.toHaveBeenCalled();
		expect(o.onnext).not.toHaveBeenCalled();
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? ''); // quick-261022-spring: rubber-band always springs back (node: instant settle)
	});

	it('boundary: hasNext:false + hard next (LEFT) flick → onnext NOT called, springs back to translateX(0)', () => {
		const o = opts({ hasNext: false });
		const m = mount(o);
		m.fire('pointerdown', pe(250, 50, 0));
		m.fire('pointermove', pe(238, 50, 0)); // commit horizontal LEFT at t=0
		m.fire('pointermove', pe(100, 50, 100)); // dx -150, |dx| > 84, fast flick
		m.fire('pointerup', pe(100, 50, 100));
		expect(o.onnext).not.toHaveBeenCalled();
		expect(o.onprev).not.toHaveBeenCalled();
		expect(['', 'translateX(0)']).toContain(m.style.transform ?? ''); // quick-261022-spring: rubber-band always springs back (node: instant settle)
	});

	it('a resisted boundary gesture clamps the live translate below the raw dx (rubber-band damping)', () => {
		const o = opts({ hasPrev: false });
		const m = mount(o, 300); // maxPull = 0.18 × 300 = 54px
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 50, 16)); // commit horizontal RIGHT
		m.fire('pointermove', pe(300, 50, 200)); // raw dx = 200, but damping clamps it well below maxPull 54
		const tx = m.style.transform;
		const applied = Number(/translateX\(([-\d.]+)px\)/.exec(tx ?? '')?.[1]);
		expect(applied).toBeGreaterThan(0); // some travel (feels the wall)
		expect(applied).toBeLessThan(54); // asymptotes toward maxPull, never reaching it
		expect(applied).toBeLessThan(200); // far below the raw finger travel — clearly resisting
	});

	it('a non-boundary (hasPrev/hasNext default true) prev drag follows the finger 1:1 and commits', () => {
		const o = opts(); // hasPrev/hasNext default to true
		const m = mount(o);
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(150, 50, 16)); // commit horizontal RIGHT, dx 50 (1:1, no damping)
		expect(m.style.transform).toBe('translateX(50px)'); // 1:1 lockstep follow (UI-SPEC §1)
		m.fire('pointermove', pe(200, 50, 400)); // dx 100 > commitDist 84
		m.fire('pointerup', pe(200, 50, 700));
		expect(o.onprev).toHaveBeenCalledTimes(1);
	});

	it('a COMMITTED drag clears the inline transform so the swapped cover is not left frozen off-centre (CR-01)', () => {
		const o = opts();
		const m = mount(o);
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 52, 16)); // commit horizontal
		m.fire('pointermove', pe(200, 54, 400)); // dx 100 > commitDist 84 → live translateX(100px)
		expect(m.style.transform).toBe('translateX(100px)'); // mid-drag 1:1 follow
		m.fire('pointerup', pe(200, 54, 700));
		expect(o.onprev).toHaveBeenCalledTimes(1);
		// The strip PERSISTS across the player.prev()/next() track swap, so the action must drop its
		// inline transform + transition:none — otherwise the new current cover renders frozen
		// ~commitDist off-centre. Resting state returns to the host CSS translateX(0).
		expect(m.style.transform).toBe('');
		expect(m.style.transition).toBe('');
	});

	it('a vertical-dominant yield clears the inline transition:none set on pointerdown (CR-02)', () => {
		const m = mount(opts());
		m.fire('pointerdown', pe(100, 50, 0)); // down() sets transition:none for the 1:1 drag follow
		expect(m.style.transition).toBe('none');
		m.fire('pointermove', pe(104, 90, 16)); // |ddy| 40 > |ddx| 4 → vertical wins, action yields
		// The transition:none MUST be cleared on yield, else a vertical-collapse gesture that starts
		// on this node permanently defeats the host's CSS settle + reduced-motion transition.
		expect(m.style.transition).toBe('');
	});

	it('reports the CLAMPED rubber-band offset to ondrag at a boundary, not the raw dx (WR-02)', () => {
		const ondrag = vi.fn();
		const m = mount(opts({ ondrag, hasPrev: false }), 300); // maxPull = 0.18 × 300 = 54
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 50, 16)); // commit horizontal RIGHT (prev) at a true boundary
		m.fire('pointermove', pe(300, 50, 200)); // raw dx 200, but resisting → damped well below maxPull
		const lastDx = ondrag.mock.calls.at(-1)?.[0] as number;
		const appliedTx = Number(/translateX\(([-\d.]+)px\)/.exec(m.style.transform ?? '')?.[1]);
		// ondrag must equal the value WRITTEN to transform (the damped offset), never the raw 200 —
		// a host driving its own surface off ondrag must not disagree with the node at a boundary.
		expect(lastDx).toBeCloseTo(appliedTx, 5);
		expect(lastDx).toBeLessThan(54);
		expect(lastDx).toBeLessThan(200);
	});

	it('enabled flipped to false mid-drag (via update) ABORTS the gesture: releases capture, resets, no commit (WR-03)', () => {
		const o = opts({ enabled: true });
		const m = mount(o);
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(200, 50, 16)); // commit + capture, dx 100 (would commit on release)
		expect(m.captureCalls).toEqual([1]);
		// Host disables the action mid-swipe (e.g. a track resolve starts → enabled:!resolving flips).
		m.action?.update?.({ ...o, enabled: false });
		expect(m.releaseCalls).toEqual([1]); // capture released
		expect(m.style.transform).toBe(''); // live transform dropped
		expect(m.style.transition).toBe('');
		// Subsequent move/up are inert (dragging cleared) — no track change fires.
		m.fire('pointermove', pe(260, 50, 32));
		m.fire('pointerup', pe(260, 50, 48));
		expect(o.onprev).not.toHaveBeenCalled();
		expect(o.onnext).not.toHaveBeenCalled();
	});

	it('releases the pointer capture on a normal committed release (WR-04)', () => {
		const o = opts();
		const m = mount(o);
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(112, 52, 16)); // commit + capture
		m.fire('pointermove', pe(200, 54, 400)); // dx 100 > commitDist 84
		expect(m.captureCalls).toEqual([1]);
		m.fire('pointerup', pe(200, 54, 700));
		expect(o.onprev).toHaveBeenCalledTimes(1);
		expect(m.releaseCalls).toEqual([1]); // explicitly released, not left to UA auto-release
	});

	it('the trailing-click suppressor self-expires ~350ms after a click-less touch commit (WR-05)', () => {
		vi.useFakeTimers();
		try {
			const o = opts();
			const m = mount(o);
			m.fire('pointerdown', pe(100, 50, 0));
			m.fire('pointermove', pe(112, 52, 16)); // commit + capture
			m.fire('pointermove', pe(200, 54, 400)); // dx 100 > commitDist 84
			m.fire('pointerup', pe(200, 54, 700)); // commit → suppressor armed (touch produces no click)
			expect(m.has('click')).toBe(true); // armed
			vi.advanceTimersByTime(350);
			// Self-expired, so a genuine LATER tap on this tap-target is not swallowed.
			expect(m.has('click')).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('destroy() mid-drag releases a held capture and resets the surface (WR-03/WR-04)', () => {
		const m = mount(opts());
		m.fire('pointerdown', pe(100, 50, 0));
		m.fire('pointermove', pe(200, 50, 16)); // commit + capture (NowPlaying can unmount mid-drag)
		expect(m.captureCalls).toEqual([1]);
		m.action?.destroy?.();
		expect(m.releaseCalls).toEqual([1]); // capture released on unmount
		expect(m.style.transform).toBe('');
		expect(m.style.touchAction).toBe('');
	});
});
