import { describe, it, expect } from 'vitest';
import { isGatedReady, shouldStartResolve } from './track-menu-gate';
import type { Track } from '$lib/sources/types';

// track-menu-gate holds the two PURE decisions lifted out of TrackMenu.svelte (Phase 19,
// MENU-01 / D-01..D-03) so they are node-testable without a DOM — mirroring marquee.ts's
// `isOverflowing` / longpress.ts's `shouldSuppressClickAfterLongpress` idiom.
//
//  - isGatedReady: the literal `detailsLoaded && uid && audioUrl` readiness test (mirrors
//    catalog.ts:186) — true means a gated action (Download / Detail / Remix) can run on the
//    track immediately; false means it must resolve first (resolve-then-act).
//  - shouldStartResolve: the in-flight dedupe — a second tap while the same action key is
//    already resolving is a no-op (D-03), and per-action keys are independent.
//
// The reassign-for-reactivity discipline (`new Set(inFlight)` on add/delete) stays in the
// COMPONENT (19-02); these helpers only DECIDE, they never mutate.

/** A fully-resolved track stub for the readiness assertions. */
function resolved(overrides: Partial<Track> = {}): Track {
	return {
		uid: 'netease:1',
		source: 'netease',
		songid: '1',
		title: 'Song',
		artist: 'Artist',
		album: '',
		cover: null,
		audioUrl: 'https://cdn.example.com/a.mp3',
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		// The gate now delegates to the shared readiness guard, which requires a FRESH url —
		// so the "resolved" fixture has to carry a resolve stamp to be resolved at all.
		resolvedAt: Date.now(),
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1,
		...overrides
	};
}

describe('isGatedReady — gated-action readiness predicate (MENU-01 / D-02)', () => {
	it('a resolved track (detailsLoaded && uid && audioUrl) is ready → action may run immediately', () => {
		expect(isGatedReady(resolved())).toBe(true);
	});

	// debug slow-cold-start-first-playing: the gate used to be an inline copy of the readiness guard
	// and drifted when freshness was added — it kept calling a track with a long-expired signed url
	// "ready", so a gated action ran immediately on a dead url instead of resolving first.
	it('a STALE url → not ready (must re-resolve before the action runs)', () => {
		expect(isGatedReady(resolved({ resolvedAt: Date.now() - 16 * 60 * 1000 }))).toBe(false);
	});

	it('an unstamped url → not ready (never age-validated)', () => {
		expect(isGatedReady(resolved({ resolvedAt: undefined }))).toBe(false);
	});

	it('detailsLoaded:false → not ready (must resolve first)', () => {
		expect(isGatedReady(resolved({ detailsLoaded: false }))).toBe(false);
	});

	it('a null audioUrl → not ready (the seed has no playable URL yet)', () => {
		expect(isGatedReady(resolved({ audioUrl: null }))).toBe(false);
	});

	it('a missing (empty) uid → not ready', () => {
		expect(isGatedReady(resolved({ uid: '' }))).toBe(false);
	});

	it('a null track → not ready (no track open)', () => {
		expect(isGatedReady(null)).toBe(false);
	});
});

describe('shouldStartResolve — in-flight dedupe + failure-clear (MENU-01 / D-03)', () => {
	it('no resolve in flight for the key → start one', () => {
		expect(shouldStartResolve(new Set(), 'remix')).toBe(true);
	});

	it('the same key already in flight → a second tap is a NO-OP (dedupe)', () => {
		expect(shouldStartResolve(new Set(['remix']), 'remix')).toBe(false);
	});

	it('a DIFFERENT key in flight → still start (per-action keys are independent)', () => {
		expect(shouldStartResolve(new Set(['download']), 'remix')).toBe(true);
	});

	it('failure-clear: after the key is removed it resolves to true again (never a stuck spinner)', () => {
		const inFlight = new Set(['remix']);
		expect(shouldStartResolve(inFlight, 'remix')).toBe(false);
		// The component clears the key in its `finally` on resolve OR failure; once cleared,
		// the action is tappable again — proving "never a stuck spinner" is structurally possible.
		inFlight.delete('remix');
		expect(shouldStartResolve(inFlight, 'remix')).toBe(true);
	});
});
