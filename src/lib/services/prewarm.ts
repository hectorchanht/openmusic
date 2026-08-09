// prewarm — speculative resolve fired on a user gesture, BEFORE the tap that plays (31-D-03).
//
// WHY IT WINS: `ensureTrackDetails`' readiness guard (catalog.ts:293) returns the track untouched
// once it is `detailsLoaded` with an `audioUrl`, so a track pre-warmed here makes the later
// `player.play()` short-circuit with ZERO network work. The click-to-play win comes from doing the
// resolve before the tap, not from failing over sooner (31-D-01 leaves every timeout alone).
//
// WHY IT IS A SERVICE AND NOT TWO INLINE COMPONENT EFFECT BODIES: there is no jsdom test project in this
// repo (vite.config.ts defines a single node `server` project), so logic living inside a `.svelte`
// file is unverifiable. Both triggers — the top search result and TrackMenu open — call this one
// seam, so the decision is asserted once here instead of twice, untested, in components.
//
// POSTURE (mirrors the never-throw service boundary in deezer.ts:10-24):
//  - returns void, never awaits, NEVER throws: pre-warm is speculative work, so a failure must be
//    completely invisible — no error surfaced, no generation counter bumped, no effect on what plays.
//  - EXACTLY the one track handed in. No walking the result list, no depth-2 lookahead (31-D-19
//    keeps the prefetch walk at next-1), no cross-source fan-out (the never-fan-out-on-click rule).
//  - all state is PLAIN — this is a pure `.ts`, not a runes store; the UI never reads any of it.

import { ensureTrackDetails } from '$lib/services/catalog';
import type { Track } from '$lib/sources/types';

/** Cap on the remembered-uid set so a long browsing session cannot grow it without bound. A
 *  clear-on-overflow (rather than an LRU) is deliberate: the only cost of forgetting a uid is one
 *  redundant `ensureTrackDetails`, which `apiFetch`'s GET dedupe and the readiness guard both absorb. */
const MAX_TRACKED_UIDS = 300;

/** Uids already pre-warmed this session. PLAIN Set (house idiom: an internal guard the UI never
 *  reads is never a reactive rune) — the search page reassigns `results` 4-8× per query and the identity of
 *  `results[0]` changes across every partial, so without this a single search issues 4-8 resolves. */
const warmed = new Set<string>();

/**
 * Speculatively resolve ONE track. Idempotent per uid, silent on every failure.
 *
 * 31-D-03: the dedupe is a uid Set and NOTHING else. `apiFetch`'s in-flight GET dedupe plus its
 * MAX_CONCURRENT_REQUESTS cap are the second line of defence, and adding a coalescing delay or a
 * local queue here would compose a fresh local bound with the governor — exactly the shape
 * api-base.ts:31-51 names as the root cause of the `api-fetch-flood-freeze` class of bug. No timer,
 * no queue, no concurrency cap lives in this file.
 */
export function prewarmTrack(track: Track | null | undefined): void {
	if (!track?.uid) return;
	// Already complete — the readiness guard would make this a no-op anyway; short-circuiting makes
	// the intent explicit and keeps the uid out of the Set.
	if (track.detailsLoaded && track.audioUrl) return;
	if (warmed.has(track.uid)) return;
	if (warmed.size >= MAX_TRACKED_UIDS) warmed.clear();
	warmed.add(track.uid);
	// Fire-and-forget. Recorded BEFORE the call so a second trigger during the in-flight resolve
	// (a re-rank, a re-opened menu) is suppressed by the Set rather than racing it.
	void ensureTrackDetails(track).catch(() => {});
}

/** TEST-ONLY: drop the dedupe state between cases (mirrors api-base.ts's `__resetGovernor`). */
export function __resetPrewarm(): void {
	warmed.clear();
}
