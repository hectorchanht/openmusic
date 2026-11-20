import { describe, it, expect } from 'vitest';
import { computeDropIndex } from './dragReorder';

// dragReorder is a vertical drag-to-REORDER Svelte action (quick-260606-w87), mirroring
// dragScroll. The DOM pointer wiring is exercised manually; the LOAD-BEARING logic is the
// pure index math — given the pointer Y and each row's top/height, which slot should the
// dragged row drop into? computeDropIndex compares the pointer against sibling row
// midpoints and clamps at the list ends. Mirrors the velocity.test.ts / dragScroll.test.ts
// node style.
describe('computeDropIndex — vertical reorder target math (w87)', () => {
	// Four 40px rows stacked from y=0: [0,40), [40,80), [80,120), [120,160). Midpoints at
	// 20 / 60 / 100 / 140.
	const tops = [0, 40, 80, 120];
	const heights = [40, 40, 40, 40];

	it('a pointer resting inside the original row → the same index (no-op move)', () => {
		// from=1, pointer at 60 (its own midpoint) → stays 1.
		expect(computeDropIndex(60, tops, heights, 1)).toBe(1);
	});

	it('dragging DOWN past the next row midpoint → index + 1', () => {
		// from=1, pointer at 105 (past row 2 midpoint 100) → 2.
		expect(computeDropIndex(105, tops, heights, 1)).toBe(2);
	});

	it('dragging UP into the previous row span → index - 1', () => {
		// from=2, pointer at 50 (inside row 1 span [40,80)) → 1.
		expect(computeDropIndex(50, tops, heights, 2)).toBe(1);
	});

	it('dragging UP into the first row span → index 0', () => {
		// from=2, pointer at 35 (inside row 0 span [0,40)) → 0.
		expect(computeDropIndex(35, tops, heights, 2)).toBe(0);
	});

	it('dragging far DOWN clamps at the last index', () => {
		// from=0, pointer way past the list → last index 3.
		expect(computeDropIndex(9999, tops, heights, 0)).toBe(3);
	});

	it('dragging far UP clamps at the first index', () => {
		// from=3, pointer way above the list → 0.
		expect(computeDropIndex(-9999, tops, heights, 3)).toBe(0);
	});

	it('dropping on itself (pointer within own row) is a no-op (returns from)', () => {
		// from=2, pointer at 100 (its own midpoint) → 2.
		expect(computeDropIndex(100, tops, heights, 2)).toBe(2);
	});

	it('handles a single-row list (only valid index is 0)', () => {
		expect(computeDropIndex(0, [0], [40], 0)).toBe(0);
		expect(computeDropIndex(500, [0], [40], 0)).toBe(0);
	});

	it('an empty geometry falls back to the from index (degrade, never NaN)', () => {
		expect(computeDropIndex(50, [], [], 0)).toBe(0);
	});
});
