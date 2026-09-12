// THE READINESS GUARD — the single definition of "is this track's resolved state still trustworthy".
//
// WHY THIS FILE EXISTS (debug `slow-cold-start-first-playing`). This guard used to live as FIVE
// inline copies of `detailsLoaded && audioUrl && …`, spread across catalog, the player store, the
// prewarm service, the download service and a menu gate. NONE of them had an age check. CN audio
// urls are SIGNED and short-lived, so a url resolved minutes earlier was still treated as good:
//
//   - An on-device action log showed the guard "resolving" in 38ms with `hasUrl:true`, then burning
//     ~20s in stall → audio.error → strike → advance, because the url had expired upstream.
//   - Worse, `prefetchNext` kept marking the NEXT track "pre-warmed" off an already-dead url, so the
//     machinery whose entire job is to PREVENT a gap was the thing causing one.
//
// Adding the check to one copy would have left the other four wrong. Duplicated logic is exactly how
// the age check went missing from four of five places to begin with — so it is defined ONCE, here.
//
// Deliberately dependency-free (types + one constant). A pure predicate module, per the repo's
// "pure functions are extracted and exported for testability" convention, so a UI-level caller like
// `track-menu-gate` can ask the question without importing the whole catalog/registry/settings graph.

import { RESOLVE_URL_TTL_S } from '$lib/proxy/resolve-cache';
import type { Track } from '$lib/sources/types';

/**
 * How long an in-memory resolved `audioUrl` is trusted.
 *
 * REUSES `RESOLVE_URL_TTL_S` (15 min) rather than inventing a second number: that constant already
 * means exactly "how long a signed CN audio url is trusted", and the edge bakes the same window into
 * its `urlExp`. The client guard and the edge entry must not drift apart — one knob, both seams.
 */
const RESOLVED_URL_MAX_AGE_MS = RESOLVE_URL_TTL_S * 1000;

/**
 * `resolvedAt` is stamped ONLY by `ensureTrackDetails`, so `undefined` means "this url was never
 * age-validated" and is STALE by construction. Re-resolving costs ~100ms (measured); serving a dead
 * url costs ~8.4s per strike before the player routes past it. That asymmetry is the whole argument
 * for defaulting to stale.
 */
function isUrlFresh(track: Track): boolean {
	return (
		typeof track.resolvedAt === 'number' && Date.now() - track.resolvedAt < RESOLVED_URL_MAX_AGE_MS
	);
}

/**
 * "Can this track be handed to `<audio>` right now?" — it has a resolved url AND that url is still
 * inside the trust window.
 *
 * The question every PRE-WARM / REUSE path asks (player.warmAfter, prewarmTrack, the download
 * service's reuse-the-playing-track shortcut, the track-menu run-now-vs-resolve-first gate). None of
 * them care whether lyrics have landed.
 */
export function hasFreshAudioUrl(track: Track): boolean {
	return Boolean(track.detailsLoaded && track.audioUrl) && isUrlFresh(track);
}

/**
 * "Is there nothing left to resolve for this track?" — `hasFreshAudioUrl` PLUS a settled lyric layer.
 *
 * The question the RESOLVE paths ask (the `ensureTrackDetails` short-circuit, the prefetch candidate
 * walk). Netease resolves `lrc` from a separate `lrcUrl`, so a track with an unresolved `lrcUrl` is
 * NOT ready even when its audio url is perfectly good — that is the legacy-2507 monolith behavior,
 * preserved.
 */
export function isTrackReady(track: Track): boolean {
	return hasFreshAudioUrl(track) && Boolean(track.lrc || !track.lrcUrl);
}
