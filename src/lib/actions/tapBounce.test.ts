import { describe, it, expect, beforeEach } from 'vitest';
import { tapBounce } from './tapBounce';
import { settings } from '$lib/stores/settings.svelte';

// tapBounce is the one-shot press-feedback action (quick-260701-0aa): pointerdown adds
// `tap-bouncing`, whose 0.22s keyframe scales the node to 0.94 and back, and animationend removes
// it again.
//
// THE REGRESSION THIS FILE GUARDS (quick-260919-l9e). pointerdown BUBBLES. On a CONTAINER that
// also holds real controls — SongRow's `.srow`, which carries Like, Download and the ⋮ — an
// unscoped bounce scaled the whole row for a press on any of them. The scale slid each control
// inward by 0.06 * (its distance from the row's centre): ~6px for Like, ~9px for Download, ~12px
// for the ⋛. The browser hit-tests pointerup at the ORIGINAL screen coords, so the release could
// land in the gap beside the control the press started on; `click` then fired on their common
// ancestor — the inert `.srow` div — and the tap was SWALLOWED. Browser-measured before the fix:
// a click at 90% of the Like button's width, and at 70% of the ⋮'s, retargeted to `DIV.srow`.
//
// `only` is the fix, so the two facts below are load-bearing:
//   1. a leaf control (no `only`) still bounces for every press — ~150 call sites depend on it;
//   2. a container with `only` bounces ONLY for a press on its own tap target, so a press on a
//      sibling control leaves it at rest and nothing moves under the finger.
// Driven headless with a fake node (no jsdom), mirroring swipeAction.test.ts / longpress.test.ts.

/** A fake HTMLElement exposing only what the action touches: a classList and a listener registry. */
function makeNode() {
	const classes = new Set<string>();
	const handlers = new Map<string, (e: never) => void>();
	const node = {
		offsetWidth: 0,
		classList: {
			add: (c: string) => classes.add(c),
			remove: (c: string) => classes.delete(c),
			contains: (c: string) => classes.has(c)
		},
		addEventListener(type: string, cb: (e: never) => void) {
			handlers.set(type, cb);
		},
		removeEventListener(type: string) {
			handlers.delete(type);
		}
	};
	return {
		node: node as unknown as HTMLElement,
		bouncing: () => classes.has('tap-bouncing'),
		fire: (type: string, e: unknown) => handlers.get(type)?.(e as never),
		has: (type: string) => handlers.has(type)
	};
}

/**
 * A synthetic pointerdown whose target is an element matching `matches` — a stand-in for
 * `Element.closest(sel)`, which is the only DOM call the `only` gate makes.
 */
function pressOn(...matches: string[]) {
	return {
		target: { closest: (sel: string) => (matches.includes(sel) ? { sel } : null) }
	} as unknown as PointerEvent;
}

describe('tapBounce — one-shot press feedback', () => {
	beforeEach(() => {
		settings.reduceMotion = false;
	});

	it('with no `only`, ANY press bounces the node (the ~150 leaf-button call sites)', () => {
		const m = makeNode();
		tapBounce(m.node, undefined);
		m.fire('pointerdown', pressOn('.something-else'));
		expect(m.bouncing()).toBe(true);
	});

	it('reduceMotion still suppresses the bounce entirely', () => {
		settings.reduceMotion = true;
		const m = makeNode();
		tapBounce(m.node, undefined);
		m.fire('pointerdown', pressOn('.hit'));
		expect(m.bouncing()).toBe(false);
	});

	it('animationend clears the class only for the tap-bounce keyframe (never latches)', () => {
		const m = makeNode();
		tapBounce(m.node, undefined);
		m.fire('pointerdown', pressOn('.hit'));
		m.fire('animationend', { animationName: 'marquee-scroll' });
		expect(m.bouncing()).toBe(true); // a descendant's animation must not clear it early
		m.fire('animationend', { animationName: 'tap-bounce' });
		expect(m.bouncing()).toBe(false);
	});

	describe('`only` — a container must not bounce for its children (the swallowed-tap regression)', () => {
		it('bounces when the press is on the container’s own tap target', () => {
			const m = makeNode();
			tapBounce(m.node, { only: '.hit' });
			m.fire('pointerdown', pressOn('.hit'));
			expect(m.bouncing()).toBe(true); // a row tap still gets its feedback
		});

		it('stays at rest for a press on a sibling control (Like / Download / ⋮)', () => {
			for (const control of ['.ract', '.dc', '.opt']) {
				const m = makeNode();
				tapBounce(m.node, { only: '.hit' });
				m.fire('pointerdown', pressOn(control));
				// No scale ⇒ the control cannot slide out from under the finger between pointerdown
				// and pointerup ⇒ the click reaches the control instead of retargeting to the row.
				expect(m.bouncing(), `press on ${control} must not bounce the row`).toBe(false);
			}
		});

		it('update() swaps the gate reactively', () => {
			const m = makeNode();
			const a = tapBounce(m.node, { only: '.hit' });
			a?.update?.(undefined);
			m.fire('pointerdown', pressOn('.ract'));
			expect(m.bouncing()).toBe(true); // gate removed → back to bouncing on anything
		});

		it('destroy() unhooks both listeners', () => {
			const m = makeNode();
			const a = tapBounce(m.node, { only: '.hit' });
			a?.destroy?.();
			expect(m.has('pointerdown')).toBe(false);
			expect(m.has('animationend')).toBe(false);
		});
	});
});
