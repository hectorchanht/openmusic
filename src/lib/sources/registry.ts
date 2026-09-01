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
import { ytmusic } from './ytmusic';
import { settings } from '$lib/stores/settings.svelte';

// Enumeration ORDER is load-bearing (D-08 / POLICY.md, spikes 001+004): getEnabledAdapters walks
// SOURCES in this order, and fallbackOrder (fallback.ts) + resolveNameStub/crossSourceLyric
// (catalog.ts) + interleave (catalog.ts) all inherit it.
//
// debug/upnext-diverse-fallback-kuwo-dead (2026-08-31): kuwo was FIRST under D-08 because it was
// empirically 100% playable + cover-inline across all 14 language/region×genre segments. That
// premise is DEAD: its upstream `kw-api.cenguigui.cn` (proxy/kuwo.ts KUWO_BASE) serves a TLS
// certificate that expired 2026-04-14, so Cloudflare returns 526 for every /api/kuwo/* request and
// kuwo.search() throws contract-drift on every call. Left in the primary seat it poisoned every
// consumer of this order — most visibly similar.ts, whose two fallback paths pin to
// getEnabledAdapters({})[0] and therefore returned EMPTY for every track, collapsing Up-Next to the
// buildDiversePicks grab-bag whenever Last.fm track.getSimilar was dry.
//
// qq takes the primary seat (proven: it is what actually resolves and plays today). netease is #2 —
// rich, and its intermittent upstream (api.qijieya.cn) is an acceptable RUNNER-UP even though the
// old comment rightly kept it out of the primary seat. kuwo is demoted to #3 rather than removed:
// the `SourceId` union, adapter contract, and enabledByDefault flag are untouched, so if the cert is
// renewed the only change needed to restore it is moving `kuwo` back to the front of this literal.
//
// This reorder is the stop-the-bleeding half. The durable half lives in similar.ts, which no longer
// pins to a SINGLE source — see `sourceLadder()` there. The `SourceId` union, adapter contracts,
// enabledByDefault flags, and dedupe's separate SOURCE_RANK tie-break are all UNCHANGED.
//
// ytmusic (Plan 27, YT-SRC-01) is appended LAST and is OFF the kuwo-first resolve floor: it is
// enabledByDefault:true (discoverable in the search fan-out) but carries autoResolveEligible:false,
// so cross-source failover / name-stub resolution must never pick it as a TARGET for a non-ytmusic
// track (mirrors how audius/jamendo are searchable-but-off-the-hot-path). That flag is unaffected by
// the 2026-08-31 reorder above — the resolve floor is now qq→netease→kuwo→joox; the code that honors
// the flag lands in Plan 27-04.
export const SOURCES: Record<SourceId, SourceAdapter> = { qq, netease, kuwo, joox, fivesing, jamendo, audius, ytmusic };

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
