import { describe, it, expect } from 'vitest';
import {
	transportAction,
	seekTargetFraction,
	SEEK_STEP_SECONDS,
	type TransportKeyTarget,
	type TransportKeyContext
} from '$lib/services/transport-keys';

const NOTHING: TransportKeyTarget = { tag: '', role: '', editable: false };
const el = (tag: string, role = '', editable = false): TransportKeyTarget => ({ tag, role, editable });

const SPACE = { key: ' ', code: 'Space' };
const LEFT = { key: 'ArrowLeft' };
const RIGHT = { key: 'ArrowRight' };
const UP = { key: 'ArrowUp' };
const ESC = { key: 'Escape' };
const SLASH = { key: '/' };

/** quick-260919-keys: the ambient facts. Named so each test reads as its own scenario. */
const ctx = (overlayOpen: boolean, atScrollTop: boolean): TransportKeyContext => ({
	overlayOpen,
	atScrollTop
});
const TOP_OF_PAGE = ctx(false, true);
const SCROLLED = ctx(false, false);
const LAYER_OPEN = ctx(true, true);

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

// ---- quick-260919-keys ---------------------------------------------------------------------

describe('Shift+arrows seek +-5s without colliding with prev/next', () => {
	it('splits the arrow branch on Shift — one press, exactly one meaning', () => {
		expect(transportAction({ ...LEFT, shiftKey: true }, NOTHING)).toBe('seek-back');
		expect(transportAction({ ...RIGHT, shiftKey: true }, NOTHING)).toBe('seek-fwd');
		expect(transportAction(LEFT, NOTHING)).toBe('prev');
		expect(transportAction(RIGHT, NOTHING)).toBe('next');
	});

	it('still yields BOTH shifted and plain arrows to a focused .scrubber (role="slider")', () => {
		// The scrubber runs its own +-5s seekKey; returning an action here would seek twice.
		expect(transportAction({ ...LEFT, shiftKey: true }, el('DIV', 'slider'))).toBeNull();
		expect(transportAction({ ...RIGHT, shiftKey: true }, el('DIV', 'slider'))).toBeNull();
	});

	it('still yields to typing and to real chords', () => {
		expect(transportAction({ ...RIGHT, shiftKey: true }, el('INPUT'))).toBeNull();
		expect(transportAction({ ...RIGHT, shiftKey: true, metaKey: true }, NOTHING)).toBeNull();
	});
});

describe('seekTargetFraction — one step, one expression, shared with the scrubber', () => {
	it('moves +-SEEK_STEP_SECONDS as a fraction of duration', () => {
		expect(seekTargetFraction(50, 100, SEEK_STEP_SECONDS)).toBeCloseTo(0.55);
		expect(seekTargetFraction(50, 100, -SEEK_STEP_SECONDS)).toBeCloseTo(0.45);
	});

	it('returns null with no seekable duration (0, NaN, Infinity live stream)', () => {
		expect(seekTargetFraction(0, 0, 5)).toBeNull();
		expect(seekTargetFraction(0, NaN, 5)).toBeNull();
	});

	it('does NOT clamp — seekFraction owns clamping [0,1]', () => {
		expect(seekTargetFraction(1, 100, -SEEK_STEP_SECONDS)).toBeLessThan(0);
	});
});

describe('ArrowUp opens now-playing only at the top of the page', () => {
	it('opens at the top, scrolls everywhere else', () => {
		expect(transportAction(UP, NOTHING, TOP_OF_PAGE)).toBe('open-now-playing');
		expect(transportAction(UP, NOTHING, SCROLLED)).toBeNull();
	});

	it('defaults to scrolling when the caller supplies no context (undeterminable scroll)', () => {
		expect(transportAction(UP, NOTHING)).toBeNull();
	});

	it('never opens a second layer over an open one', () => {
		expect(transportAction(UP, NOTHING, LAYER_OPEN)).toBeNull();
	});

	it('yields to typing, to arrow widgets, and to Shift (selection / declined volume)', () => {
		expect(transportAction(UP, el('INPUT'), TOP_OF_PAGE)).toBeNull();
		expect(transportAction(UP, el('DIV', 'listbox'), TOP_OF_PAGE)).toBeNull();
		expect(transportAction({ ...UP, shiftKey: true }, NOTHING, TOP_OF_PAGE)).toBeNull();
	});

	it('leaves ArrowDown completely unbound — Down stays pure scrolling', () => {
		for (const c of [TOP_OF_PAGE, SCROLLED, LAYER_OPEN]) {
			expect(transportAction({ key: 'ArrowDown' }, NOTHING, c)).toBeNull();
			expect(transportAction({ key: 'ArrowDown', shiftKey: true }, NOTHING, c)).toBeNull();
		}
	});
});

describe('Escape dismisses only when something is open', () => {
	it('is inert on a plain page and live with a layer open', () => {
		expect(transportAction(ESC, NOTHING, TOP_OF_PAGE)).toBeNull();
		expect(transportAction(ESC, NOTHING, LAYER_OPEN)).toBe('close-overlay');
	});

	it('works from inside a focused field — the sheet that owns the field is what closes', () => {
		expect(transportAction(ESC, el('INPUT'), LAYER_OPEN)).toBe('close-overlay');
		expect(transportAction(ESC, el('DIV', '', true), LAYER_OPEN)).toBe('close-overlay');
	});

	it('still yields to an IME composition (Esc cancels the candidate window)', () => {
		expect(transportAction({ ...ESC, isComposing: true }, el('INPUT'), LAYER_OPEN)).toBeNull();
	});
});

describe('`/` focuses search', () => {
	it('fires on a plain page', () => {
		expect(transportAction(SLASH, NOTHING, TOP_OF_PAGE)).toBe('focus-search');
		expect(transportAction(SLASH, NOTHING, SCROLLED)).toBe('focus-search');
	});

	it('types a literal slash instead of hijacking, whenever a field has focus', () => {
		expect(transportAction(SLASH, el('INPUT'), TOP_OF_PAGE)).toBeNull();
		expect(transportAction(SLASH, el('TEXTAREA'), TOP_OF_PAGE)).toBeNull();
		expect(transportAction(SLASH, el('DIV', 'searchbox'), TOP_OF_PAGE)).toBeNull();
		expect(transportAction(SLASH, el('DIV', '', true), TOP_OF_PAGE)).toBeNull();
	});

	it('does not navigate out from under an open layer', () => {
		expect(transportAction(SLASH, NOTHING, LAYER_OPEN)).toBeNull();
	});

	it('leaves Shift+/ (= "?") and chords to the browser', () => {
		expect(transportAction({ ...SLASH, shiftKey: true }, NOTHING, TOP_OF_PAGE)).toBeNull();
		expect(transportAction({ ...SLASH, metaKey: true }, NOTHING, TOP_OF_PAGE)).toBeNull();
	});
});
