import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSpringSnap } from './springSnap';
import { settings } from '$lib/stores/settings.svelte';

// springSnap is the shared Apple-style spring snap-back for gesture releases
// (quick-261022-spring). These tests pin the contracts the gesture actions rely on:
//   - reduce-motion (or a frame-less env like this node project) settles INSTANTLY —
//     apply(to) + onSettled fire synchronously, no rAF involved;
//   - with a rAF scheduler present, snap() starts the pump from the seeded value and
//     cancel() stops it (Svelte's own loop is a noop in node, so the spring never
//     advances here — the pump mechanics are what we own and test);
//   - snap() is interruptible: re-seeding mid-flight never throws and never jumps.
describe('createSpringSnap', () => {
	beforeEach(() => {
		settings.reduceMotion = false;
	});

	afterEach(() => {
		settings.reduceMotion = false;
		delete (globalThis as Record<string, unknown>).requestAnimationFrame;
		delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
	});

	it('reduceMotion settles instantly: apply(to) + onSettled fire synchronously', () => {
		settings.reduceMotion = true;
		const seen: number[] = [];
		let settled = 0;
		const snap = createSpringSnap((v) => seen.push(v), { onSettled: () => settled++ });
		snap.snap(100, 0);
		expect(seen).toEqual([0]);
		expect(settled).toBe(1);
		expect(snap.active).toBe(false);
	});

	it('frame-less env (node: no rAF) also settles instantly', () => {
		expect(typeof requestAnimationFrame).toBe('undefined');
		const seen: number[] = [];
		let settled = 0;
		const snap = createSpringSnap((v) => seen.push(v), { onSettled: () => settled++ });
		snap.snap(64, 0);
		expect(seen).toEqual([0]);
		expect(settled).toBe(1);
		expect(snap.active).toBe(false);
	});

	it('snap(from === to) is a no-op settle', () => {
		const seen: number[] = [];
		const snap = createSpringSnap((v) => seen.push(v));
		snap.snap(0, 0);
		expect(seen).toEqual([0]);
		expect(snap.active).toBe(false);
	});

	it('with rAF present the pump starts from the seeded value; cancel() stops it', () => {
		const frames: FrameRequestCallback[] = [];
		// minimal rAF stub: queue callbacks, ids are 1-based indexes
		(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) => {
			frames.push(cb);
			return frames.length;
		};
		// minimal cancel stub: dropping the queue is enough here
		(globalThis as Record<string, unknown>).cancelAnimationFrame = () => {
			frames.length = 0;
		};
		const seen: number[] = [];
		const snap = createSpringSnap((v) => seen.push(v));
		snap.snap(100, 0);
		expect(snap.active).toBe(true);
		// First pumped frame applies the SEEDED release point (100) — no jump from the finger.
		// (Svelte's internal loop is a noop in node, so the spring never advances past the seed;
		// the pump mechanics — not Svelte's physics — are what this asserts.)
		frames.shift()?.(16);
		expect(seen[0]).toBe(100);
		snap.cancel();
		expect(snap.active).toBe(false);
		expect(frames.length).toBe(0);
	});

	it('a second snap() mid-flight re-seeds without throwing', () => {
		const frames: FrameRequestCallback[] = [];
		// test-only rAF stub
		(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) => {
			frames.push(cb);
			return frames.length;
		};
		// test-only cancel stub
		(globalThis as Record<string, unknown>).cancelAnimationFrame = () => {
			frames.length = 0;
		};
		const seen: number[] = [];
		const snap = createSpringSnap((v) => seen.push(v));
		snap.snap(100, 0);
		frames.shift()?.(16);
		expect(() => snap.snap(40, 0)).not.toThrow();
		expect(snap.active).toBe(true);
		frames.shift()?.(16);
		// Re-seeded from 40 — the latest snap wins, no jump back to the old flight.
		expect(seen.at(-1)).toBe(40);
		snap.cancel();
	});
});
