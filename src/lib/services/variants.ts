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
import { collapseVariants, groupVariants, sameSongKey } from './dedupe';

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

/**
 * The "Download from…" picker's row list: the song's OWN source first, then one row per other
 * source that has it (quick-260916-0d9).
 *
 * Two jobs, both borrowed rather than reinvented (Q1 — no third copy of song identity anywhere):
 *   - the own track is ALWAYS present, even when `fetchVariants` returned [] (CN blocked, offline,
 *     no match) — the picker must never open with zero rows for a song that is right there;
 *   - `collapseVariants` (the SAME intra-source collapse VersionPicker applies at render) folds a
 *     source's ten near-identical hits into one row, so the list reads one-row-per-source.
 *
 * Slot 0 of the collapsed list is always the own track's bucket (collapseVariants preserves
 * first-appearance bucket order and `track` is input[0]), but its WINNER may be a same-source /
 * same-album search hit that `better()` outranked it with. We force our own object back into that
 * slot: the caller seeds its probe map by the ORIGINAL uid and records the download under the
 * ORIGINAL identity, so a swapped uid would leave that row a permanent skeleton and save the song
 * under a uid the menu never opened on.
 *
 * Pure, never throws, no network.
 */
export function versionsIncludingOwn(track: Track, variants: Track[]): Track[] {
	const collapsed = collapseVariants([track, ...variants]);
	const rows = collapsed[0]?.uid === track.uid ? collapsed : [track, ...collapsed.slice(1)];
	// Belt-and-braces uid dedupe: collapse buckets by source|album|tag, so two rows COULD in
	// principle share a uid only if the caller passed the own track in twice under different albums.
	const seen = new Set<string>();
	return rows.filter((v) => {
		if (seen.has(v.uid)) return false;
		seen.add(v.uid);
		return true;
	});
}
