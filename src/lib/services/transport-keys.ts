// quick-260919-npfix (Fix 2) — the app-wide Space / ArrowLeft / ArrowRight transport mapping.
//
// PURE (no runes, no `$app/environment`, no store import), so the branchy "may I steal this key?"
// decision is node-Vitest-testable and the shell holds only a five-line listener — the same
// split media-session.ts / lrc.ts / score-match.ts already use.
//
// WHY THIS MODULE EXISTS AT ALL: the shortcuts used to live in a `window` keydown `$effect` inside
// NowPlaying.svelte, so they worked ONLY while the overlay was mounted. Moving that listener to the
// app shell makes them global — but a global listener has to be far more careful about whose key it
// is, which is what `transportAction` encodes. It resolves an existing conflict rather than adding a
// third binding: NowPlaying has TWO ArrowLeft/ArrowRight meanings — `seekKey` on the `.scrubber`
// (role="slider") nudges +-5s, and the window listener does prev/next. The window listener guarded
// only its SPACE branch by target, so with the scrubber focused an ArrowRight ran BOTH (+5s AND
// next()). The arrow branches are now target-guarded on the same principle the Space branch already
// was, which is what makes the two meanings coexist: the focused control wins, the document is the
// fallback.
//
// THE THREE INVARIANTS, and what enforces each:
//   1. Never hijack typing. Gated on the EVENT TARGET being editable, never on a global
//      "is an input focused" flag — a recorded incident has a mobile dropdown vanishing because it
//      was gated on an `inputFocused` flag that Android Chrome dropped mid-type. The target is a
//      property of the event itself, so it cannot go stale.
//   2. Never break Space-activates-a-focused-control (WR-08). Space on a <button>/role="button" is
//      the platform convention and the focusTrap deliberately parks focus on NowPlaying controls;
//      only an UNFOCUSED-control Space toggles playback.
//   3. Never fight the +-5s seek. Arrows on a slider/spinbutton belong to that widget.
// Plus: a chord (Cmd/Ctrl/Alt) is always the browser's — Cmd+ArrowLeft is Back on macOS — and an
// auto-repeat is dropped so a held ArrowRight cannot machine-gun next().

/** The structural slice of a KeyboardEvent the decision needs. Keeps the fn node-testable. */
export type TransportKeyEvent = {
	key: string;
	code?: string;
	repeat?: boolean;
	isComposing?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
};

/** The structural slice of the event TARGET the decision needs (see `describeTarget`). */
export type TransportKeyTarget = {
	/** Uppercase tag name, '' when the target is not an element (document/window). */
	tag: string;
	/** Lowercased explicit `role` attribute, '' when absent. */
	role: string;
	/** `HTMLElement.isContentEditable`. */
	editable: boolean;
};

export type TransportAction = 'toggle' | 'prev' | 'next';

/** Natively editable form controls — Space/arrows are theirs unconditionally. */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
/** ARIA widgets that take free text; same treatment as a real <input>. */
const EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

/**
 * Elements/roles for which Space is an ACTIVATION, not a scroll (WR-08). `<a href>` is
 * deliberately absent: a link activates on Enter, not Space, so a focused nav link keeps letting
 * Space reach playback.
 */
const SPACE_TAGS = new Set(['BUTTON', 'SUMMARY']);
const SPACE_ROLES = new Set([
	'button',
	'checkbox',
	'switch',
	'radio',
	'menuitem',
	'menuitemcheckbox',
	'menuitemradio',
	'option',
	'tab',
	'slider'
]);

/**
 * Roles whose own keyboard contract is "arrows move me" — the seek scrubber (role="slider") is the
 * one this app actually ships, the rest are the standard composite widgets so a future one is right
 * by default rather than silently stolen from.
 */
const ARROW_ROLES = new Set([
	'slider',
	'listbox',
	'option',
	'tablist',
	'tab',
	'menu',
	'menubar',
	'menuitem',
	'radiogroup',
	'radio',
	'tree',
	'grid'
]);

function isEditable(t: TransportKeyTarget): boolean {
	return t.editable || EDITABLE_TAGS.has(t.tag) || EDITABLE_ROLES.has(t.role);
}

/**
 * Decide what (if anything) a global keydown should do to the transport.
 *
 * Returns null whenever the key belongs to the focused control, to the browser, or is not one of
 * the three transport keys — the caller then does nothing at all (no preventDefault), so the key
 * behaves exactly as it did before this module existed.
 */
export function transportAction(
	e: TransportKeyEvent,
	target: TransportKeyTarget
): TransportAction | null {
	// An IME composition owns every key until it commits.
	if (e.isComposing) return null;
	// A chord is the browser's (Cmd+Left = Back, Ctrl+Space = IME toggle, ...). Shift is NOT listed:
	// Shift+Space is "page up" in a scroller, which is still not a transport key we claim.
	if (e.ctrlKey || e.metaKey || e.altKey) return null;
	// Auto-repeat: one press, one action. A held ArrowRight must not walk the queue.
	if (e.repeat) return null;
	// Invariant 1 — typing always wins, decided from the event's own target.
	if (isEditable(target)) return null;

	if (e.key === ' ' || e.code === 'Space') {
		// Invariant 2 (WR-08) — a focused control that activates on Space keeps it.
		if (SPACE_TAGS.has(target.tag) || SPACE_ROLES.has(target.role)) return null;
		return 'toggle';
	}
	if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
		// Invariant 3 — arrows on a slider are that slider's (the +-5s seek on `.scrubber`).
		if (ARROW_ROLES.has(target.role)) return null;
		return e.key === 'ArrowLeft' ? 'prev' : 'next';
	}
	return null;
}

/**
 * DOM adapter: read the three fields `transportAction` needs off an event target. Separate from the
 * decision so the decision stays node-testable; `instanceof Element` also makes a non-element target
 * (document/window, which is what a keydown with nothing focused reports) degrade to the neutral
 * shape rather than throwing.
 */
export function describeTarget(el: EventTarget | null): TransportKeyTarget {
	if (typeof Element === 'undefined' || !(el instanceof Element)) {
		return { tag: '', role: '', editable: false };
	}
	return {
		tag: el.tagName,
		role: (el.getAttribute('role') ?? '').toLowerCase(),
		editable: el instanceof HTMLElement && el.isContentEditable
	};
}
