// furigana-pins (reactive) — the REACTIVE wrapper for the pure reading-pin
// store (quick-261120-furi). Same "wrap, don't rewrite" split as
// lyric-pins.svelte.ts, for the same reason: services/furigana-pins.ts stays a
// plain `.ts` of pure localStorage functions (node-testable), and this file
// adds the ONE reactive version signal on top. Every pin WRITE bumps it; every
// surface that applies pins through applyFuriganaPins re-evaluates the instant
// a pick lands, so choosing a reading in the chooser repaints the ruby in
// place. SSR-safe: no browser globals at module top level.

import { getReadingPin, setReadingPin } from '$lib/services/furigana-pins';
import type { FuriganaSpan } from '$lib/services/furigana';

const _v = $state({ n: 0 });
let bumpScheduled = false;

/** Read the current reading-pin version. CALL inside a $derived/template to depend on pin writes. */
export function furiganaPinVersion(): number {
	return _v.n;
}

/** Bump the reading-pin version after EVERY pin write (rAF-coalesced; sync where rAF is absent). */
export function bumpFuriganaPinVersion(): void {
	if (typeof requestAnimationFrame === 'undefined') {
		_v.n++;
		return;
	}
	if (bumpScheduled) return;
	bumpScheduled = true;
	requestAnimationFrame(() => {
		bumpScheduled = false;
		_v.n++;
	});
}

/** A span with the user's pin applied: `pinned` marks the override so the UI can style it. */
export type PinnedFuriganaSpan = FuriganaSpan & { pinned?: boolean };

/**
 * Apply this song's reading pins to one line's annotated spans — the pin WINS
 * over the engine's `chosen` (Addendum 6). A pin whose reading is no longer in
 * the span's variants (data drift) is still honoured and PREPENDED to the
 * variants, so the chooser can show the user's own pick. Spans without a pin
 * are returned by identity. CALL inside a $derived: reads furiganaPinVersion()
 * to take the dependency.
 */
export function applyFuriganaPins(
	uid: string,
	lineText: string,
	spans: FuriganaSpan[]
): PinnedFuriganaSpan[] {
	furiganaPinVersion(); // reactive dependency — recompute when any pin lands
	if (!uid) return spans;
	return spans.map((s) => {
		if (!s.chosen) return s;
		const pin = getReadingPin(uid, lineText, s.surface);
		if (!pin || pin === s.chosen) return pin ? { ...s, pinned: true } : s;
		return {
			...s,
			variants: s.variants.includes(pin) ? s.variants : [pin, ...s.variants],
			chosen: pin,
			pinned: true
		};
	});
}

/** The ONLY sanctioned reading-pin WRITER: persist the user's pick and bump so every reader repaints. */
export function pinReading(uid: string, lineText: string, surface: string, reading: string): void {
	setReadingPin(uid, lineText, surface, reading);
	bumpFuriganaPinVersion();
}
