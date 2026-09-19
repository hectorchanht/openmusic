// lyric-pins (reactive) — the REACTIVE wrapper for the pure lyric-pin store (quick-260919-1we).
//
// Same "wrap, don't rewrite" split as cover-cache.ts / cover-version.svelte.ts, and for the same
// reason: `services/lyric-pins.ts` MUST stay a plain `.ts` of pure localStorage functions so its test
// file stays node-runnable (no rune-compiled `$state` pulled into node vitest). This `.svelte.ts`
// adds the ONE global reactive version signal on top. Every pin WRITE bumps it; every surface that
// READS through `readLyrics` re-evaluates the instant a pick lands, so choosing lyrics in the
// TrackMenu picker repaints the now-playing pane with no replay and no player surgery.
//
// SSR-safety: imports only pure functions + runes, touches NO browser globals at module top level
// (the underlying setters own the localStorage try/catch). No $effect, no DOM access here.

import type { Track } from '$lib/sources/types';
import { getPinnedLyrics, setPinnedLyrics, removePinnedLyrics } from '$lib/services/lyric-pins';

// Module-scoped reactive counter, held in a small object because top-level `$state` reassignment must
// be on a `$state` rune target. Callers CALL lyricVersion() inside a $derived/template to take the
// dependency (mirrors cover-version.svelte.ts `_v`).
const _v = $state({ n: 0 });

// Coalescing latch — true while a rAF-batched bump is pending for the current frame. Reset inside the
// rAF callback BEFORE the increment so a leaked latch is impossible.
let bumpScheduled = false;

/** Read the current lyric-pin version. CALL this inside a $derived/template to depend on pin writes. */
export function lyricVersion(): number {
	return _v.n;
}

/**
 * Bump the global lyric-pin version — called after EVERY pin write so all mounted lyric surfaces
 * repaint (the NowPlaying pane, the Nowbar line, the picker's own tick mark).
 *
 * SYNC FALLBACK: where requestAnimationFrame is undefined (node/vitest — this project runs vitest
 * with NO jsdom — and SSR) we increment synchronously. Non-negotiable: without it the bump would
 * silently never happen under test.
 *
 * Deferring the bump is safe for the same reason it is in cover-version: `readLyrics` pulls the text
 * DIRECTLY from the pure store and only calls lyricVersion() to TAKE the dependency, so a
 * one-frame-deferred bump defers the repaint, it never serves stale data.
 */
export function bumpLyricVersion(): void {
	if (typeof requestAnimationFrame === 'undefined') {
		_v.n++;
		return;
	}
	if (bumpScheduled) return; // a bump is already pending this frame — coalesce into it.
	bumpScheduled = true;
	requestAnimationFrame(() => {
		bumpScheduled = false;
		_v.n++;
	});
}

/**
 * THE lyrics read for every surface. Read order is **pin → track.lrc → null**, one definition, three
 * call sites (NowPlaying's pane, the Nowbar line, TrackMenu's tick + retag prop).
 *
 * D-4 — the pin is applied at READ time, never by mutating `player.current`. player.svelte.ts has
 * seven `this.current = …` sites and four of them assign a whole fresh object, so a pin written into
 * the track would be clobbered by any of the other three. Layering it into a reactive READ (exactly
 * what readCoverByUidOrName does for cover pins) fixes every surface at once with zero player
 * surgery.
 *
 * It is also WHY the pin beats Phase 37's embedded-LRC enrichment BY CONSTRUCTION: enrichFromLocalFile
 * writes `current.lrc` from the downloaded file's tag, and `current.lrc` is the SECOND rung here. A
 * user who explicitly fixed the lyrics of a downloaded song keeps their choice however the file is
 * tagged.
 */
export function readLyrics(track: Track | null | undefined): string | null {
	lyricVersion(); // reactive dependency — recompute when any pin lands
	return getPinnedLyrics(track?.uid ?? '') ?? track?.lrc ?? null;
}

/** The ONLY sanctioned pin WRITER: persist the user's choice and bump so every reader repaints. */
export function pinLyrics(uid: string, lrc: string): void {
	setPinnedLyrics(uid, lrc);
	bumpLyricVersion();
}

/** Drop the pin + bump — "use automatic lyrics" falls the read back to `track.lrc`. */
export function unpinLyrics(uid: string): void {
	removePinnedLyrics(uid);
	bumpLyricVersion();
}
