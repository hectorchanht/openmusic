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

export const SOURCES: Record<SourceId, SourceAdapter> = { netease, qq, kuwo, joox, fivesing, jamendo, audius };

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
