import { describe, it, expect } from 'vitest';
import { transportAction, type TransportKeyTarget } from '$lib/services/transport-keys';

const NOTHING: TransportKeyTarget = { tag: '', role: '', editable: false };
const el = (tag: string, role = '', editable = false): TransportKeyTarget => ({ tag, role, editable });

const SPACE = { key: ' ', code: 'Space' };
const LEFT = { key: 'ArrowLeft' };
const RIGHT = { key: 'ArrowRight' };

describe('transportAction — the three transport keys', () => {
	it('maps Space/Left/Right on the bare document', () => {
		expect(transportAction(SPACE, NOTHING)).toBe('toggle');
		expect(transportAction(LEFT, NOTHING)).toBe('prev');
		expect(transportAction(RIGHT, NOTHING)).toBe('next');
	});

	it('accepts Space by `code` even when `key` is not a literal space', () => {
		expect(transportAction({ key: 'Spacebar', code: 'Space' }, NOTHING)).toBe('toggle');
	});

	it('ignores every other key', () => {
		for (const key of ['a', 'Enter', 'ArrowUp', 'ArrowDown', 'Escape', 'Tab']) {
			expect(transportAction({ key }, NOTHING)).toBeNull();
		}
	});
});

describe('invariant 1 — typing is never hijacked', () => {
	it('yields Space and arrows to real form controls', () => {
		for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
			expect(transportAction(SPACE, el(tag))).toBeNull();
			expect(transportAction(LEFT, el(tag))).toBeNull();
			expect(transportAction(RIGHT, el(tag))).toBeNull();
		}
	});

	it('yields to contenteditable and to text-taking roles', () => {
		expect(transportAction(SPACE, el('DIV', '', true))).toBeNull();
		for (const role of ['textbox', 'searchbox', 'combobox', 'spinbutton']) {
			expect(transportAction(SPACE, el('DIV', role))).toBeNull();
			expect(transportAction(RIGHT, el('DIV', role))).toBeNull();
		}
	});

	it('yields every key while an IME composition is active', () => {
		expect(transportAction({ ...SPACE, isComposing: true }, NOTHING)).toBeNull();
		expect(transportAction({ ...RIGHT, isComposing: true }, NOTHING)).toBeNull();
	});
});

describe('invariant 2 — Space still activates a focused control (WR-08)', () => {
	it('yields Space to buttons and button-ish roles', () => {
		expect(transportAction(SPACE, el('BUTTON'))).toBeNull();
		expect(transportAction(SPACE, el('SUMMARY'))).toBeNull();
		for (const role of ['button', 'checkbox', 'switch', 'radio', 'menuitem', 'option', 'tab', 'slider']) {
			expect(transportAction(SPACE, el('DIV', role))).toBeNull();
		}
	});

	it('still toggles on a focused link — a link activates on Enter, not Space', () => {
		expect(transportAction(SPACE, el('A'))).toBe('toggle');
	});

	it('a focused BUTTON keeps prev/next on the arrows (a button has no arrow contract)', () => {
		expect(transportAction(LEFT, el('BUTTON'))).toBe('prev');
		expect(transportAction(RIGHT, el('BUTTON'))).toBe('next');
	});
});

describe('invariant 3 — the +-5s seek slider keeps its arrows', () => {
	it('yields arrows to role="slider" (the `.scrubber`) but not Space-as-transport rules', () => {
		expect(transportAction(LEFT, el('DIV', 'slider'))).toBeNull();
		expect(transportAction(RIGHT, el('DIV', 'slider'))).toBeNull();
	});

	it('yields arrows to the standard composite widgets', () => {
		for (const role of ['listbox', 'option', 'tablist', 'tab', 'menu', 'menuitem', 'radiogroup', 'tree', 'grid']) {
			expect(transportAction(LEFT, el('DIV', role))).toBeNull();
		}
	});
});

describe('the browser keeps its own keys', () => {
	it('drops chords (Cmd+Left is Back on macOS)', () => {
		expect(transportAction({ ...LEFT, metaKey: true }, NOTHING)).toBeNull();
		expect(transportAction({ ...RIGHT, ctrlKey: true }, NOTHING)).toBeNull();
		expect(transportAction({ ...SPACE, altKey: true }, NOTHING)).toBeNull();
	});

	it('drops auto-repeat so a held arrow cannot walk the queue', () => {
		expect(transportAction({ ...RIGHT, repeat: true }, NOTHING)).toBeNull();
		expect(transportAction({ ...SPACE, repeat: true }, NOTHING)).toBeNull();
	});
});
