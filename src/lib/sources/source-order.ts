// source-order — THE source priority tables (quick-261102-sqn, DECISIONS.md §5).
//
// One declared table per purpose; no feature file carries its own order literal. Pure and
// dependency-free (type import only) so edge code (dedupe → jbsou/resolve-edge) can read it
// without pulling the registry's adapters or the settings store. registry.ts builds SOURCES in
// PLAYBACK_ORDER and re-exports these.
import type { SourceId } from '$lib/sources/types';

/**
 * Playback resolve order (product truth, user 2026-11-02): joox, kuwo, kugou, qq, netease, migu,
 * suyin last among the auto-resolvable sources. gdnetease (a second Netease pipe) sits behind
 * netease; the UGC/indie floor (fivesing, jamendo, audius) ahead of suyin; the search-only sources
 * (autoResolveEligible:false) after everything, ytmusic in its load-bearing LAST seat.
 * Drives: the cross-source fallback ladder, the name-stub walk, the search fan-out start order +
 * interleave, the tier-1 search set, and dedupe's source tie-break.
 */
export const PLAYBACK_ORDER: readonly SourceId[] = [
	'joox', 'kuwo', 'kugou', 'qq', 'netease', 'gdnetease', 'migu',
	'fivesing', 'jamendo', 'audius', 'suyin',
	'archive', 'ccmixter', 'bilibili', 'ytmusic'
];

/** Higher = earlier in PLAYBACK_ORDER (unknown → -1). A tie-break, never a filter. */
export function playbackRank(id: SourceId): number {
	const i = PLAYBACK_ORDER.indexOf(id);
	return i < 0 ? -1 : PLAYBACK_ORDER.length - i;
}

/** How many leading auto-resolvable sources the tier-1 search covers (quick-261020-speed). */
export const TIER_1_SIZE = 5;

/** CN catalog cover preference (user: JOOX/Migu covers are the most accurate). */
export const COVER_ORDER: readonly SourceId[] = ['joox', 'migu', 'qq', 'netease', 'kuwo'];

/** Sources whose covers are skipped by auto-resolve (quick-261021-cov5: seldom good). */
export const COVER_SKIP: readonly SourceId[] = ['gdnetease', 'suyin'];

/** The parallel cover race's tiers, best first (iTunes → JOOX/Migu CN tier → QQ → Deezer → YTM). */
export const COVER_RACE_TIERS = ['itunes', 'cn', 'qq', 'deezer', 'ytmusic'] as const;
export type CoverRaceTier = (typeof COVER_RACE_TIERS)[number];

/**
 * The priority window shared by every first-past-the-post race (cover race, fallback race): once
 * the first result lands, wait this long for a higher-priority one before taking the best so far.
 */
export const PRIORITY_WINDOW_MS = 300;
