// On-demand cross-source variant fetch (Phase 26-08, VERSIONS-01 / Gap 4 foundation).
//
// A played/queued song carries only its OWN source, so discovering the other sources'
// variants outside the search page needs an explicit lookup. This is that lookup — but
// deliberately LAZY: it fires EXACTLY ONE all-source `searchAll`, and ONLY when the caller
// invokes it (the 26-10 mount plan gates it behind a picker-open tap). It never loops
// per-source and never runs as a background prefetch — the UAT's explicit API-cost
// constraint (T-26-08-01). searchAll's own D-04 TTL memoization makes a repeat open free.
//
// Pure `.ts` (node-testable): reuses `searchAll` + `groupVariants` + `sameSongKey` — it does
// NOT re-implement song identity and does NOT import a `*.svelte.ts`. Never-throw — any
// failure, an aborted signal, a blank query, or a no-match all map to [].
import type { Track } from '$lib/sources/types';
import { searchAll } from './catalog';
import { groupVariants, sameSongKey } from './dedupe';

/**
 * Fetch the cross-source variants of ONE song on demand.
 *
 * Issues a SINGLE all-source `searchAll` (prefs {} = every enabled source) for
 * `${track.artist} ${track.title}`, groups the interleaved hits by song identity via
 * `groupVariants`, and returns the group that matches `track` — the same-song variant list
 * across sources, including the track's own source when present. Returns [] on a blank
 * query, an aborted signal, any error, or when no group matches — NEVER throws.
 *
 * The returned list is variant rows suitable for VersionPicker: length > 1 means a real
 * cross-source choice; length ≤ 1 lets the caller decide whether to surface the control.
 */
export async function fetchVariants(track: Track, signal?: AbortSignal): Promise<Track[]> {
	const query = `${track.artist ?? ''} ${track.title ?? ''}`.trim();
	if (!query) return [];
	try {
		// The ONE deliberate cross-source fan-out — prefs {} = all enabled sources (D-04 memoized).
		const result = await searchAll(query, 1, {}, signal);
		// Supersedence/timeout: a newer caller (or a cancel) aborted mid-flight → drop this result.
		if (signal?.aborted) return [];
		// Group by the SAME normalized identity dedupeBest/groupVariants use (one source of truth),
		// then return the group that IS this song. sameSongKey guards a blank/untitled key so a
		// no-title stub never matches a garbage group.
		for (const variants of groupVariants(result.interleaved).values()) {
			if (variants.some((v) => sameSongKey(v, track))) return variants;
		}
		return [];
	} catch {
		// Never-throw: a transient upstream/proxy failure must not break the picker-open path.
		return [];
	}
}
