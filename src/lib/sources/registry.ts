// The ONLY place client source adapters are enumerated (DATA-04). Aggregation and
// dispatch code resolve adapters through SOURCES / getEnabledAdapters — they never
// name a source. Adding a source = a new adapter file + one import line here.
import type { SourceAdapter, SourceId } from './types';
import { netease } from './netease';
import { qq } from './qq';
import { kuwo } from './kuwo';
import { joox } from './joox';
import { fivesing } from './fivesing';
import { jamendo } from './jamendo';
import { audius } from './audius';
import { settings } from '$lib/stores/settings.svelte';

// Enumeration ORDER is load-bearing (D-08 / POLICY.md, spikes 001+004): getEnabledAdapters walks
// SOURCES in this order, and fallbackOrder (fallback.ts) + resolveNameStub/crossSourceLyric
// (catalog.ts) + interleave (catalog.ts) all inherit it. kuwo is FIRST because it is empirically
// 100% playable + cover-inline across all 14 language/region×genre segments — so cross-source
// failover and lazy name-stub resolution try kuwo first and stop in one call. netease drops out of
// the primary seat: its upstream (api.qijieya.cn) is intermittent, so it is a rich-but-unreliable
// fallback #3, never the default floor. The `SourceId` union, adapter contracts, enabledByDefault
// flags, and dedupe's separate SOURCE_RANK tie-break are all UNCHANGED — only the resolve floor moves.
export const SOURCES: Record<SourceId, SourceAdapter> = { kuwo, qq, netease, joox, fivesing, jamendo, audius };

/**
 * The enabled adapters for a search fan-out. Precedence (highest first):
 *   1. explicit `prefs[id]` (true/false) — passed by a caller that wants ONE source
 *      (e.g. cross-source fallback's per-source retry).
 *   2. `settings.enabledSources[id]` — the user's persisted override (ii6).
 *   3. adapter's own `enabledByDefault`.
 * The chain stops at the first non-undefined value.
 */
export const getEnabledAdapters = (
	prefs: Partial<Record<SourceId, boolean>> = {}
): SourceAdapter[] => {
	const userPrefs = settings.enabledSources;
	return Object.values(SOURCES).filter((a) => {
		if (prefs[a.id] !== undefined) return prefs[a.id];
		if (userPrefs[a.id] !== undefined) return userPrefs[a.id];
		return a.enabledByDefault;
	});
};
