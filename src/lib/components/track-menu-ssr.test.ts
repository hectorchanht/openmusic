import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// quick-261119-sharecard — STRUCTURAL gate for the SSR share-card outage of 2026-11-19.
// Svelte 5 runs `onDestroy` at the end of a SERVER render too (onMount/$effect do not run
// server-side; onDestroy does). TrackMenu registers `onDestroy(mAbortDrag)`, and mAbortDrag →
// mDisarmWindow touched `window.removeEventListener` unguarded — so every SSR entity route
// (/song/*, /artist/*, /album/* — the routes that bake the per-song OG media card crawlers
// read) threw `ReferenceError: window is not defined` and returned HTTP 500 with only the
// generic fallback head. WhatsApp showed NO media card for any shared song. The bug was
// invisible to the unit suite because nothing rendered TrackMenu server-side; this source
// pin (the settings-ui / loading-state technique — no jsdom in this project) is the gate:
// the two window-listener helpers on the destroy path must keep their `browser` guard as
// their FIRST statement, so a future edit cannot silently re-break every share card.
const read = (p: string) => readFileSync(p, 'utf-8');

describe('TrackMenu SSR safety (quick-261119-sharecard)', () => {
	const src = read('src/lib/components/TrackMenu.svelte');

	it('mDisarmWindow (the onDestroy path) opens with the browser guard', () => {
		expect(src).toMatch(/function mDisarmWindow\(\) \{\s*\n\s*if \(!browser\) return;/);
	});

	it('mArmWindow opens with the browser guard (symmetry — no window touch without it)', () => {
		expect(src).toMatch(/function mArmWindow\(\) \{\s*\n\s*if \(!browser\) return;/);
	});

	it('the destroy registration that makes the guard load-bearing is still present', () => {
		expect(src).toContain('onDestroy(mAbortDrag)');
	});
});
