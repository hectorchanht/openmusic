import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chipReorder, chipSlotForIndex, nearestChipIndex } from './chipReorder';

describe('nearestChipIndex', () => {
	const centers = [
		{ index: 0, cx: 10, cy: 10 },
		{ index: 1, cx: 50, cy: 10 },
		{ index: 2, cx: 90, cy: 10 },
		{ index: 3, cx: 10, cy: 50 } // wrapped to the next row
	];

	it('returns the index of the chip whose center is nearest the pointer', () => {
		expect(nearestChipIndex(52, 12, centers, 0)).toBe(1);
		expect(nearestChipIndex(88, 8, centers, 0)).toBe(2);
	});

	it('is wrap-aware (picks a chip on a different row when nearer in 2D)', () => {
		expect(nearestChipIndex(12, 48, centers, 0)).toBe(3);
	});

	it('falls back to fromIndex when there are no candidates', () => {
		expect(nearestChipIndex(100, 100, [], 2)).toBe(2);
	});

	it('can resolve to the same position when the pointer is over its own slot', () => {
		// self is excluded by the caller; here every candidate is far → nearest is index 0
		expect(nearestChipIndex(11, 9, centers, 3)).toBe(0);
	});
});

// quick-261102-chipflip: chipSlotForIndex drives the LIVE sibling reflow — the slot each chip
// will occupy under splice-move semantics (remove at `from`, insert at `to`).
describe('chipSlotForIndex — live reflow slot math (quick-261102-chipflip)', () => {
	it('the moved chip takes the target slot', () => {
		expect(chipSlotForIndex(0, 0, 2)).toBe(2);
		expect(chipSlotForIndex(2, 2, 0)).toBe(0);
	});

	it('a forward move shifts the in-between chips one slot toward the vacated slot', () => {
		expect(chipSlotForIndex(1, 0, 2)).toBe(0);
		expect(chipSlotForIndex(2, 0, 2)).toBe(1);
		expect(chipSlotForIndex(3, 0, 2)).toBe(3); // past the target — untouched
	});

	it('a backward move shifts the in-between chips one slot the other way', () => {
		expect(chipSlotForIndex(0, 2, 0)).toBe(1);
		expect(chipSlotForIndex(1, 2, 0)).toBe(2);
		expect(chipSlotForIndex(3, 2, 0)).toBe(3); // past the origin — untouched
	});

	it('a no-op move (from === to) leaves every slot unchanged', () => {
		for (let i = 0; i < 4; i++) expect(chipSlotForIndex(i, 1, 1)).toBe(i);
	});
});

// quick-261102-chipflip — the action itself, driven on a fake DOM in the swipeAction.test.ts
// style. Layout: 4 chips in a strip, each 80px wide with an 8px gap at lefts 0/88/176/264,
// top 0, height 32 (centers x = 40/128/216/304, cy = 16). In the node test env there is no
// requestAnimationFrame, so springSnap settles instantly — the settle's LANDING point is
// asserted from the recorded transform writes (the spring's final apply before the clear).
describe('chipReorder — drag behaviour (quick-261102-chipflip)', () => {
	class FakeElement {}

	interface FakeChip {
		dataset: { chipIndex: string };
		style: Record<string, string>;
		classList: {
			add: (c: string) => void;
			remove: (c: string) => void;
			contains: (c: string) => boolean;
		};
		getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
		closest: (sel: string) => unknown;
		transformWrites: string[];
	}

	function makeChip(index: number, left: number): FakeChip {
		const classes = new Set<string>();
		const transformWrites: string[] = [];
		const style: Record<string, string> = {};
		// Record every transform write so a test can see where the settle spring LANDED.
		Object.defineProperty(style, 'transform', {
			get: () => transformWrites[transformWrites.length - 1] ?? '',
			set: (v: string) => {
				transformWrites.push(v);
			},
			enumerable: true,
			configurable: true
		});
		const chip = Object.assign(new FakeElement(), {
			dataset: { chipIndex: String(index) },
			style,
			classList: {
				add: (c: string) => void classes.add(c),
				remove: (c: string) => void classes.delete(c),
				contains: (c: string) => classes.has(c)
			},
			getBoundingClientRect: () => ({ left, top: 0, width: 80, height: 32 }),
			closest: (sel: string) => (sel === '[data-chip-index]' ? chip : null),
			transformWrites
		}) as unknown as FakeChip;
		return chip;
	}

	function makeContainer(chips: FakeChip[]) {
		const handlers = new Map<string, Set<(e: PointerEvent) => void>>();
		const node = {
			setPointerCapture: vi.fn(),
			addEventListener(type: string, cb: (e: PointerEvent) => void) {
				if (!handlers.has(type)) handlers.set(type, new Set());
				handlers.get(type)?.add(cb);
			},
			removeEventListener(type: string, cb: (e: PointerEvent) => void) {
				handlers.get(type)?.delete(cb);
			},
			querySelectorAll: () => chips
		};
		return {
			node: node as unknown as HTMLElement,
			fire(type: string, e: PointerEvent) {
				for (const cb of [...(handlers.get(type) ?? [])]) cb(e);
			}
		};
	}

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
			}
		};
	}

	function pev(x: number, y: number, target: FakeChip, buttons = 1) {
		return {
			clientX: x,
			clientY: y,
			target,
			pointerId: 1,
			buttons,
			button: 0,
			preventDefault: vi.fn()
		} as unknown as PointerEvent;
	}

	let fakeWin: ReturnType<typeof makeWindow>;
	beforeEach(() => {
		fakeWin = makeWindow();
		vi.stubGlobal('window', fakeWin);
		vi.stubGlobal('HTMLElement', FakeElement);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function setup() {
		const chips = [makeChip(0, 0), makeChip(1, 88), makeChip(2, 176), makeChip(3, 264)];
		const container = makeContainer(chips);
		const onReorder = vi.fn();
		chipReorder(container.node, { onReorder });
		return { chips, container, onReorder };
	}

	it('the dragged chip is GLUED to the pointer: transform equals the raw pointer delta', () => {
		const { chips, container } = setup();
		container.fire('pointerdown', pev(40, 16, chips[0]));
		container.fire('pointermove', pev(52, 16, chips[0])); // dx 12 > THRESHOLD — drag starts
		container.fire('pointermove', pev(100, 20, chips[0]));
		expect(chips[0].style.transform).toBe('translate(60px, 4px)'); // exact delta, no lag/offset
		expect(chips[0].style.transition).toBe('none'); // no transition may chase the pointer
		expect(chips[0].classList.contains('chip-dragging')).toBe(true);
	});

	it('siblings GLIDE to their post-move slots as the pointer crosses chip boundaries', () => {
		const { chips, container } = setup();
		container.fire('pointerdown', pev(40, 16, chips[0]));
		container.fire('pointermove', pev(52, 16, chips[0])); // drag starts
		container.fire('pointermove', pev(130, 16, chips[0])); // nearest center: chip 1 (128) → target 1
		expect(chips[1].style.transform).toBe('translate(-88px, 0px)'); // chip 1 slides into slot 0
		expect(chips[2].style.transform ?? '').toBe(''); // untouched
		container.fire('pointermove', pev(220, 16, chips[0])); // nearest: chip 2 (216) → target 2
		expect(chips[1].style.transform).toBe('translate(-88px, 0px)'); // now heading for slot 0
		expect(chips[2].style.transform).toBe('translate(-88px, 0px)'); // chip 2 slides into slot 1
		expect(chips[3].style.transform ?? '').toBe('');
	});

	it('drop SPRINGS the chip into the target slot, then fires onReorder(from, to) once', () => {
		const { chips, container, onReorder } = setup();
		container.fire('pointerdown', pev(40, 16, chips[0]));
		container.fire('pointermove', pev(52, 16, chips[0]));
		container.fire('pointermove', pev(220, 20, chips[0])); // target 2, dy = 4
		container.fire('pointerup', pev(220, 20, chips[0]));
		expect(onReorder).toHaveBeenCalledTimes(1);
		expect(onReorder).toHaveBeenCalledWith(0, 2);
		// The settle's final landing write is the target slot's offset (176, 0)…
		const writes = chips[0].transformWrites;
		const nonEmpty = writes.filter((w) => w !== '');
		expect(nonEmpty[nonEmpty.length - 1]).toBe('translate(176px, 0px)');
		// …and the last write clears the transform as the re-render takes over.
		expect(writes[writes.length - 1]).toBe('');
		expect(chips[1].style.transform).toBe(''); // sibling reflow cleared with the commit
		expect(chips[2].style.transform).toBe('');
		expect(chips[0].classList.contains('chip-dragging')).toBe(false);
	});

	it('pointercancel returns the chip to its ORIGINAL slot and never reorders', () => {
		const { chips, container, onReorder } = setup();
		container.fire('pointerdown', pev(40, 16, chips[0]));
		container.fire('pointermove', pev(52, 16, chips[0]));
		container.fire('pointermove', pev(220, 16, chips[0])); // target would be 2
		container.fire('pointercancel', pev(220, 16, chips[0]));
		expect(onReorder).not.toHaveBeenCalled();
		const writes = chips[0].transformWrites;
		const nonEmpty = writes.filter((w) => w !== '');
		expect(nonEmpty[nonEmpty.length - 1]).toBe('translate(0px, 0px)'); // sprang home, not to slot 2
		expect(writes[writes.length - 1]).toBe('');
		expect(chips[1].style.transform).toBe(''); // siblings glided back / cleared
		expect(chips[2].style.transform).toBe('');
	});

	it('lostpointercapture mid-drag cancels home (no reorder, transforms cleared)', () => {
		const { chips, container, onReorder } = setup();
		container.fire('pointerdown', pev(40, 16, chips[0]));
		container.fire('pointermove', pev(52, 16, chips[0]));
		container.fire('pointermove', pev(130, 16, chips[0])); // target 1
		container.fire('lostpointercapture', pev(130, 16, chips[0]));
		expect(onReorder).not.toHaveBeenCalled();
		expect(chips[0].style.transform).toBe('');
		expect(chips[1].style.transform).toBe('');
	});

	it('a release heard only on window still completes the drop', () => {
		const { chips, container, onReorder } = setup();
		container.fire('pointerdown', pev(40, 16, chips[0]));
		container.fire('pointermove', pev(52, 16, chips[0]));
		container.fire('pointermove', pev(220, 16, chips[0])); // target 2
		fakeWin.fire('pointerup', pev(220, 300, chips[0])); // released off-container
		expect(onReorder).toHaveBeenCalledWith(0, 2);
		expect(chips[0].style.transform).toBe('');
	});

	it('a plain tap does NOT drag, capture, or reorder (tap-to-toggle preserved)', () => {
		const { chips, container, onReorder } = setup();
		container.fire('pointerdown', pev(40, 16, chips[0]));
		container.fire('pointermove', pev(43, 17, chips[0])); // 3px — below THRESHOLD
		container.fire('pointerup', pev(43, 17, chips[0]));
		expect(onReorder).not.toHaveBeenCalled();
		expect(chips[0].transformWrites).toHaveLength(0); // transform never written
	});
});
