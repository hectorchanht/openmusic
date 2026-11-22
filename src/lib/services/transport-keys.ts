// quick-260919-npfix (Fix 2) — the app-wide Space / ArrowLeft / ArrowRight transport mapping.
// quick-260919-keys — EXTENDED here (one module, one mapping, one listener) with:
//   Shift+Left / Shift+Right  -5s / +5s     ArrowUp (only at the top of the page) open now-playing
//   Escape  dismiss the innermost open layer      /  focus the search field
// ArrowDown is intentionally UNBOUND and there are no single-letter shortcuts: both were declined
// so page scrolling and future typing stay untouched.
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
//   1. Never hijack typing. Gated on the EVENT TARGET being a text-entry surface, never on a
//      global "is an input focused" flag — a recorded incident has a mobile dropdown vanishing
//      because it was gated on an `inputFocused` flag that Android Chrome dropped mid-type. The
//      target is a property of the event itself, so it cannot go stale.
//   2. Space ALWAYS toggles play/pause (Hector 2026-11-22, superseding WR-08). The old WR-08
//      rule yielded Space to any focused <button>/role="button", so Space's meaning depended on
//      whatever happened to hold focus — play/pause on the bare page, re-clicking Like/Next/a
//      settings toggle after any tap. Focus must never change what Space means: outside text
//      entry (invariant 1), EVERY Space is play/pause. Focused controls keep Enter as their
//      activation key, and the shell swallows the Space keyup so the native button activation
//      (which fires on keyup) cannot ALSO click the focused control — one press, one toggle.
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
	/**
	 * quick-260919-keys: Shift is the ONE modifier this module claims rather than hands back
	 * (see the chord guard below) — Shift+Left/Right is the +-5s seek.
	 */
	shiftKey?: boolean;
};

/** The structural slice of the event TARGET the decision needs (see `describeTarget`). */
export type TransportKeyTarget = {
	/** Uppercase tag name, '' when the target is not an element (document/window). */
	tag: string;
	/** Lowercased explicit `role` attribute, '' when absent. */
	role: string;
	/** `HTMLElement.isContentEditable`. */
	editable: boolean;
	/**
	 * Lowercased `type` attribute for an `<input>` target ('' when absent — a typeless input IS
	 * a text input), '' for every other tag. This is what separates a text field (Space is a
	 * character, invariant 1) from a range/checkbox/radio input (Space is play/pause,
	 * invariant 2, while its arrows stay its own).
	 */
	inputType?: string;
};

/**
 * quick-260919-keys: the ambient facts two of the new shortcuts need but a KeyboardEvent cannot
 * carry. Kept as a plain struct (not a store read) so the decision stays node-testable, and both
 * fields default to the SAFE answer — `atScrollTop: false` means ArrowUp scrolls, which is the
 * documented fallback for "the scroll position could not be determined".
 */
export type TransportKeyContext = {
	/**
	 * Is ANY dismissible layer open (now-playing, TrackMenu, a picker sheet, the metadata editor)?
	 * Read from `overlays.depth` by the caller. Gates Escape ON and gates ArrowUp/`/` OFF: with a
	 * layer open, ArrowUp must not open a second one and `/` must not navigate out from under it.
	 */
	overlayOpen: boolean;
	/**
	 * Is the document scroller already at the very top? The WINDOW is the scroller on every route
	 * of this app (`.app`/`.content` are in normal flow; the only `overflow-y:auto` boxes in the
	 * codebase are overlay sheets, which are excluded by `overlayOpen` anyway), so the caller reads
	 * one number: `window.scrollY <= 0`.
	 */
	atScrollTop: boolean;
};

const NO_CONTEXT: TransportKeyContext = { overlayOpen: false, atScrollTop: false };

export type TransportAction =
	| 'toggle'
	| 'prev'
	| 'next'
	/** Shift+ArrowLeft / Shift+ArrowRight — the same +-5s nudge the focused `.scrubber` does. */
	| 'seek-back'
	| 'seek-fwd'
	/** ArrowUp at the top of the page — expand the now-playing sheet. */
	| 'open-now-playing'
	/** Escape — dismiss the INNERMOST open layer (never the one underneath it). */
	| 'close-overlay'
	/** `/` — focus the search field (navigating to /search first if we are not there). */
	| 'focus-search';

/** The +-5s step shared by the `.scrubber`'s own arrow keys and the global Shift+arrows. */
export const SEEK_STEP_SECONDS = 5;

/**
 * The fraction `player.seekFraction()` should be given to move `delta` seconds from `currentTime`.
 * Returns null when there is no seekable duration yet, so the caller skips the seek entirely.
 *
 * This exists so the scrubber's `seekKey` and the global Shift+arrows compute the SAME target from
 * the SAME step — there is one seek API (`seekFraction`) and now one expression feeding it.
 * Clamping is deliberately left to `seekFraction`, which already clamps [0,1] internally.
 */
export function seekTargetFraction(
	currentTime: number,
	duration: number,
	delta: number
): number | null {
	if (!(duration > 0)) return null;
	return (currentTime + delta) / duration;
}

/**
 * Input types whose field takes typed characters — Space is a character there (invariant 1).
 * '' is in the set because a typeless `<input>` defaults to type="text". Every OTHER input
 * type (range, checkbox, radio, file, button, …) takes no typed space: Space on it is
 * play/pause like everywhere else, while its ARROWS stay its own (see the arrow branches).
 */
const TEXT_INPUT_TYPES = new Set([
	'',
	'text',
	'search',
	'email',
	'password',
	'url',
	'tel',
	'number',
	'date',
	'month',
	'week',
	'time',
	'datetime-local'
]);
/** ARIA widgets that take free text; same treatment as a text <input>. */
const EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

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

/**
 * Invariant 1's test: is this target a surface where keys are TEXT (or a text-like form
 * value)? Textarea/contenteditable/text-roles unconditionally; a `<select>` because Space is
 * its open gesture and its value is chosen text; an `<input>` only when its type takes typed
 * characters. A range/checkbox/radio input is NOT text entry — but it still keeps its arrows,
 * which the arrow branches guard separately on the raw tag.
 */
function isTextEntry(t: TransportKeyTarget): boolean {
	if (t.editable || t.tag === 'TEXTAREA' || t.tag === 'SELECT') return true;
	if (t.tag === 'INPUT') return TEXT_INPUT_TYPES.has((t.inputType ?? '').toLowerCase());
	return EDITABLE_ROLES.has(t.role);
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
	target: TransportKeyTarget,
	ctx: TransportKeyContext = NO_CONTEXT
): TransportAction | null {
	// An IME composition owns every key until it commits.
	if (e.isComposing) return null;
	// A chord is the browser's (Cmd+Left = Back, Ctrl+Space = IME toggle, ...). Shift is NOT listed:
	// Shift+Space toggles like plain Space (invariant 2 — Shift must not change its meaning
	// either), and since quick-260919-keys Shift+Left/Right IS ours (the +-5s seek), which only
	// works because Shift was never dropped here.
	if (e.ctrlKey || e.metaKey || e.altKey) return null;
	// Auto-repeat: one press, one action. A held ArrowRight must not walk the queue.
	if (e.repeat) return null;

	// quick-260919-keys — Escape is decided BEFORE the editable guard, and it is the only key that
	// is. Invariant 1 protects TYPING; Escape inserts no text, and the layer it dismisses (the
	// metadata editor, a picker sheet) is frequently the very thing that owns the focused input, so
	// yielding it to that input would make Esc dead exactly where it is most expected. It is still
	// inert whenever nothing is open, so it never steals a browser Escape on a plain page.
	if (e.key === 'Escape' || e.key === 'Esc') {
		return ctx.overlayOpen ? 'close-overlay' : null;
	}

	// Invariant 1 — text entry always wins, decided from the event's own target.
	if (isTextEntry(target)) return null;

	if (e.key === ' ' || e.code === 'Space') {
		// Invariant 2 (Hector 2026-11-22) — Space toggles playback on EVERY other target:
		// a focused button, tab, menuitem, slider, range/checkbox input — focus never changes
		// its meaning. The shell's keyup swallow stops the focused control's native Space
		// activation from firing alongside this toggle.
		return 'toggle';
	}
	if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
		// Invariant 3 — arrows on a slider are that slider's own (the +-5s seek on `.scrubber`).
		// Checked BEFORE the Shift split on purpose: a focused scrubber keeps BOTH its plain and its
		// shifted arrows, so Shift+Right there runs the scrubber's seek once, never seek-twice.
		// A non-text <input> (range) keeps its arrows on the same principle — text inputs already
		// returned above.
		if (ARROW_ROLES.has(target.role) || target.tag === 'INPUT') return null;
		// quick-260919-keys: Shift turns prev/next into the +-5s seek. The two cannot collide
		// because this is the same branch — one arrow press resolves to exactly one of them.
		if (e.shiftKey) return e.key === 'ArrowLeft' ? 'seek-back' : 'seek-fwd';
		return e.key === 'ArrowLeft' ? 'prev' : 'next';
	}

	// quick-260919-keys — ArrowUp opens now-playing ONLY at the top of the page, the pull-to-refresh
	// bargain: anywhere else Up is still scrolling, which is why ArrowDown is deliberately NOT bound
	// at all (there is no equivalent "already at the end" moment that isn't just the bottom of a
	// list). Shift+Up is left alone too — it extends a selection, and volume keys were declined.
	if (e.key === 'ArrowUp') {
		if (e.shiftKey) return null;
		if (ARROW_ROLES.has(target.role) || target.tag === 'INPUT') return null;
		if (ctx.overlayOpen || !ctx.atScrollTop) return null;
		return 'open-now-playing';
	}

	// quick-260919-keys — `/` focuses search, the convention every search-shaped app shares. The
	// editable guard above is what makes typing a literal slash still work. Shift+/ is '?' on a US
	// layout, so it cannot be caught here by accident.
	if (e.key === '/') {
		if (e.shiftKey || ctx.overlayOpen) return null;
		return 'focus-search';
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
		editable: el instanceof HTMLElement && el.isContentEditable,
		inputType: el.tagName === 'INPUT' ? (el.getAttribute('type') ?? '').toLowerCase() : ''
	};
}
