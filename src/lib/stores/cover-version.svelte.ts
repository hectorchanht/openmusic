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
	setCachedCoverByUid
} from '$lib/services/cover-cache';

// Module-scoped reactive counter. Held in a small object because top-level `$state` reassignment must be
// on a `$state` rune target; callers CALL coverVersion() inside a $derived/template to take the dependency
// (mirrors the old homepage `void coverVer` idiom, but GLOBAL).
const _v = $state({ n: 0 });

/** Read the current cover cache-version. CALL this inside a $derived/template to depend on cover writes. */
export function coverVersion(): number {
	return _v.n;
}

/** Bump the global cover cache-version — called after EVERY cover write so all mounted tiles repaint. */
export function bumpCoverVersion(): void {
	_v.n++;
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
