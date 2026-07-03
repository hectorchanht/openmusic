// cover-version — the REACTIVE wrapper for the pure cover-cache (quick-260615-hep, LOCKED decision #2).
//
// WHY: cover-cache.ts MUST stay a plain `.ts` of pure localStorage functions so cover-cache.test.ts /
// cover-backfill.test.ts remain node-runnable (no rune-compiled `$state` pulled into node vitest). This
// `.svelte.ts` adds the ONE global reactive cache-version signal on top, without touching the pure store
// — "wrap, don't rewrite". Every cover WRITE bumps the signal; every mounted tile that READS through the
// helpers here re-evaluates the instant any cover lands anywhere (now-playing, lazyCover, backfill), so a
// cover "resolved once → shown everywhere, live."
//
// The normalized name key (matchKey, via getCachedCover) is the cross-surface bridge: a homepage stub and
// the now-playing track can carry different uids for the same song, so the name layer is what makes reuse
// work. Read order is uid-first → name → null (LOCKED decision; mirrors cover-cache/lazyCover D-13).
//
// SSR-safety: this module imports only pure functions + runes; it touches NO browser globals at module
// top level (the underlying cover-cache setters already guard localStorage in try/catch). No $effect, no
// DOM access here — the runes compile fine under SvelteKit SSR because this is a `.svelte.ts` file.

import {
	getCachedCover,
	getCachedCoverByUid,
	getCachedArtistCover,
	setCachedCover,
	setCachedCoverByUid,
	removeCachedCoverByUid,
	removeCachedCover
} from '$lib/services/cover-cache';

// Module-scoped reactive counter. Held in a small object because top-level `$state` reassignment must be
// on a `$state` rune target; callers CALL coverVersion() inside a $derived/template to take the dependency
// (mirrors the old homepage `void coverVer` idiom, but GLOBAL).
const _v = $state({ n: 0 });

// Coalescing latch (quick-260704-45c, optimization backlog #5): true while a rAF-batched bump is
// pending for the current frame, so any further bumps this frame are dropped (they'd land in the
// same repaint anyway). Reset to false inside the rAF callback BEFORE the increment, so the flag
// only stays set for the duration of one frame — a leaked latch (T-45c-01) is impossible.
let bumpScheduled = false;

/** Read the current cover cache-version. CALL this inside a $derived/template to depend on cover writes. */
export function coverVersion(): number {
	return _v.n;
}

/**
 * Bump the global cover cache-version — called after EVERY cover write so all mounted tiles repaint.
 *
 * COALESCING (quick-260704-45c): a burst of N bumps within a single animation frame collapses to ONE
 * `_v.n` increment via requestAnimationFrame. On a cold home visit, backfillCovers / backfillArtistCovers
 * resolve up to N covers and each fires this synchronously → without batching that is N full grid
 * re-evaluations; batched, it is one grid re-render per frame.
 *
 * RATIONALE (why deferring the bump is safe): the reactive READS (readCoverByUidOrName / readCoverByName /
 * readArtistCover) pull the cover URL DIRECTLY from the cache via getCachedCover*, and only call
 * coverVersion() to TAKE the dependency — so a one-frame-deferred bump merely defers the repaint
 * (imperceptible), it never serves stale or missing data. rAF naturally pauses while the tab is hidden,
 * so the single pending bump fires once on foreground (intended).
 *
 * SYNC FALLBACK: where requestAnimationFrame is undefined (node/vitest — no jsdom — and SSR) we increment
 * synchronously, preserving the exact prior behavior so the real player suite + SSR keep working. This is
 * non-negotiable: player.svelte.test.ts drives the real bumpCoverVersion through this fallback.
 *
 * DEFERRED ALTERNATIVE: a per-key SvelteMap version signal (repaint only the tiles whose cover actually
 * changed) is a bigger/riskier rewrite — out of scope for this quick task.
 */
export function bumpCoverVersion(): void {
	if (typeof requestAnimationFrame === 'undefined') {
		// node/vitest + SSR: no rAF — increment synchronously (preserves exact prior behavior).
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
 * Reactive read of a Track cover, uid-first then name (LOCKED read order). Depends on coverVersion() so it
 * recomputes the instant any cover lands anywhere. Returns null on a total miss (caller falls back to gradient).
 */
export function readCoverByUidOrName(uid: string, artist: string, title: string): string | null {
	coverVersion(); // reactive dependency — recompute when any cover lands
	return getCachedCoverByUid(uid) ?? getCachedCover(artist, title);
}

/** Reactive read of a {artist,title} name-key cover (discovery tiles carry no uid). Depends on coverVersion(). */
export function readCoverByName(artist: string, title: string): string | null {
	coverVersion();
	return getCachedCover(artist, title);
}

/** Reactive read of an ARTIST-only cover. Depends on coverVersion(). */
export function readArtistCover(artist: string): string | null {
	coverVersion();
	return getCachedArtistCover(artist);
}

/**
 * The canonical BOTH-layers writer (LOCKED decision #1): write the uid layer AND the name layer, then bump
 * the global signal so the pair-with-write invariant lives in ONE place. Callers use this instead of two
 * separate setters + a manual bump. The underlying setters no-op on empty/whitespace and never throw.
 */
export function writeCoverBoth(uid: string, artist: string, title: string, url: string): void {
	setCachedCoverByUid(uid, url);
	setCachedCover(artist, title, url);
	bumpCoverVersion();
}

/**
 * The canonical BOTH-layers EVICTOR (quick-260630-ey2) — mirrors writeCoverBoth: evict the uid layer
 * AND the name layer, then bump so the affected tile repaints once a fresh cover lands. Keeps the bump
 * in this reactive wrapper so cover-cache stays pure (LOCKED decision #2). Used by lazyCover when a
 * cache-HIT url probes dead, so the stale cover is dropped before the re-resolve chain re-caches.
 *
 * The uid layer is evicted ONLY for a truthy uid — the same charts-tags-same-cover guard writeCoverBoth
 * honors: an empty stub uid would otherwise touch the SHARED `'uid:'` slot (one slot for every distinct
 * stub row), so an empty uid evicts ONLY the per-song {artist,title} name layer. Never throws.
 */
export function removeCoverBoth(uid: string, artist: string, title: string): void {
	if (uid) removeCachedCoverByUid(uid);
	removeCachedCover(artist, title);
	bumpCoverVersion();
}
