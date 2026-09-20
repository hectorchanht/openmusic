// share-arrival — the PURE decisions a shared link makes on the way in.
//
// The two song landing routes (`/song/[artist]/[title]` and the legacy `/song/[slug]`) carried
// character-for-character identical `resolveAndPlay` bodies, and the Android deep-link handler was
// about to become a third copy of the same reasoning. Three copies of "is this device already
// listening, and is this URL one of ours" is the same failure mode the repo already paid for with
// the readiness guard (four of five copies silently lacked a freshness check) — except two of these
// three are SECURITY gates, so a copy that drifts is a hole, not a stale value.
//
// This is a plain `.ts`, not `.svelte.ts`, deliberately: the decisions are pure functions of their
// inputs, so they run under the node-only Vitest project with zero mocks, and the store stays a
// thin caller (CLAUDE.md — pure logic is extracted and exported for testability). It imports NO
// store. The landing pages `await import()` it inside `onMount`, so it is SSR-safe by construction.
//
// Implements 38-D-01 / D-23 / D-27 / D-30 and mitigates T-38-01 / T-38-02.
import { parseEntityParam, stubToTrack } from '$lib/services/share';
import type { SourceId, Track } from '$lib/sources/types';

/** Is the recipient's device already producing (or about to produce) sound? */
export type ArrivalMode = 'cold' | 'warm';

/**
 * COLD = nothing is coming out of the speaker, so the shared song may take the seat.
 *
 * D-01: a seated-but-PAUSED song is COLD. `player.restore()` runs on every route and never calls
 * `play()`, so `playing` is false for the restored session a share link almost always lands on —
 * which is exactly the case D-01 rules should be re-seated.
 *
 * D-27: `loading` counts as WARM. A user with a resolve in flight has already committed to
 * listening; arming over them would silently kill the track they just started.
 *
 * Do NOT reach for the player's private `hasPlayedSinceSrc`. It looks like the more honest "real
 * output" signal, but it stays TRUE across a pause (it is reset only in `play()`), so it would
 * classify a paused track as warm — the precise opposite of what D-01 asks for.
 */
export function arrivalMode(s: { playing: boolean; loading: boolean }): ArrivalMode {
	return s.playing || s.loading ? 'warm' : 'cold';
}

/**
 * Decode the `?u=` share carrier into an unresolved `Track`, or `null` to fall back to the name
 * resolve (D-10). Never throws — the carrier is a fast path, never the only path.
 *
 * T-38-01: this is the validation gate. `u` is an attacker-controllable query string whose decoded
 * `source` selects which adapter gets dispatched, so it goes through `parseEntityParam`, whose
 * regex is the closed source enum (kept equal to the `SourceId` union by 38-D-30). A value that
 * does not match yields `null` here and nothing downstream ever performs a `SOURCES[untrusted]`
 * lookup. The `as SourceId` narrowing is safe for that reason and ONLY that reason: the alternation
 * the value just matched IS the union.
 *
 * `title`/`artist` come from the URL's own path segments — with them the carrier is a complete
 * stub, so the recipient does one direct detail resolve instead of a search fan-out (D-08).
 * `stubToTrack` is imported rather than re-inlined so the field set cannot drift from the one
 * `isTrackReady` and the resolver expect.
 */
export function stubFromUidParam(
	u: string | null | undefined,
	artist: string,
	title: string
): Track | null {
	const p = parseEntityParam(u ?? '');
	if (!p) return null;
	return stubToTrack({
		uid: p.uid,
		source: p.source as SourceId,
		songid: p.id,
		title,
		artist,
		album: '',
		cover: null
	});
}

/** D-23: the ONE host `shareOrigin()` emits and the only one App Links claims. `pages.dev` is deliberately not claimed. */
export const APP_LINK_HOST = 'openmusic.lol';

/**
 * An incoming deep-link URL reduced to the in-app path `goto()` can take, or `null` to ignore it.
 *
 * T-38-02: a hostile app can hand the activity ANY `VIEW` intent URL. The manifest's
 * host/pathPrefix filter is the OS's gate and it is not ours — an `appUrlOpen` payload must be
 * re-checked here before it can steer navigation. Two checks, both load-bearing:
 *  - `https:` only. Blocks `javascript:`, `file:` and a plaintext downgrade.
 *  - EXACT host equality, lowercased. Deliberately NOT a trailing/suffix match: an un-anchored
 *    suffix test would accept `evil-openmusic.lol`, the exact dot-anchoring mistake the allowlist
 *    in `safe-image-url.ts` documents. There is one host, so equality is also the smaller check.
 *
 * Returning `pathname + search` (never the absolute URL) is what keeps this from being an open
 * redirect: the value handed to the router is same-origin by construction. The hash is dropped —
 * no share surface uses one.
 */
export function deepLinkPath(raw: string | null | undefined): string | null {
	if (!raw) return null;
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		if (u.hostname.toLowerCase() !== APP_LINK_HOST) return null;
		return u.pathname + u.search;
	} catch {
		// Not a URL — junk or an attack, never something to navigate to.
		return null;
	}
}
