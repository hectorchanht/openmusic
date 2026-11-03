// Deezer-boosted dedupe (quick-260607-jip). Async wrapper around the sync dedupeBest:
// when a same-song group has >1 candidate (CN sources surfacing the same track), fire one
// `deezerSearchTopN(title+artist, 1)` and re-rank candidates by similarity to Deezer's
// canonical metadata. Singleton groups skip the network call.
//
// Deezer is METADATA-ONLY (their audio needs `arl`); we use the top hit's title / artist /
// album as a "ground truth" reference. The candidate with the best combined similarity score
// wins. On Deezer miss (no key required, but the proxy returns empty on timeout / rate-limit)
// the chain falls back to the existing `better()` logic.
//
// This is OPT-IN — existing callers keep using sync `dedupeBest`. The search page uses this
// wrapper after first-paint to improve quality picks without blocking the first frame.

import { deezerSearchTopN, type DeezerHit } from './deezer';
import { mapWithConcurrency } from './discovery';
import type { SourceId, Track } from '$lib/sources/types';
import { dedupeBest, songKey, normField as sharedNormField } from './dedupe';

// Concurrency cap for Deezer enrichment lookups (mirrors the home-page FANOUT_CAP and stays
// well under the 50 req / 5s Deezer rate limit).
const DEEZER_FANOUT = 3;

// quick-261102-sjg (DECISIONS.md §1): the local copy of dedupe's key() (which had drifted — no
// script fold, no translation strip, no own-artist prefix) is gone; groups are matched with the
// SAME songKey dedupeBest merged them by, and fields compare via the shared normField.
const key = (t: Track): string => songKey(t.artist, t.title);
const normField = (s: string | null | undefined): string => sharedNormField(s ?? '');

/**
 * Score how closely a candidate Track's metadata matches a Deezer "ground truth" hit.
 * Higher is better. Uses normalized substring + exact-match heuristics weighted by field.
 * Exported pure for testability.
 */
export function scoreAgainstDeezer(track: Track, deezer: DeezerHit): number {
	const ti = normField(track.title);
	const ar = normField(track.artist);
	const al = normField(track.album);
	const dti = normField(deezer.title);
	const dar = normField(deezer.artist);
	const dal = normField(deezer.album);
	let score = 0;
	// Title match: 3 for exact, 2 for substring containment in either direction, 0 otherwise.
	if (ti && dti) {
		if (ti === dti) score += 3;
		else if (ti.includes(dti) || dti.includes(ti)) score += 2;
	}
	// Artist match (highest signal): 4 exact, 2 substring, 0 otherwise. Artist disagrees
	// → likely a wrong-track-match in Deezer; lean conservative.
	if (ar && dar) {
		if (ar === dar) score += 4;
		else if (ar.includes(dar) || dar.includes(ar)) score += 2;
	}
	// Album match: a strong tie-breaker between two CN sources with the same song.
	if (al && dal) {
		if (al === dal) score += 3;
		else if (al.includes(dal) || dal.includes(al)) score += 1;
	}
	return score;
}

/**
 * Async dedupe with Deezer enrichment.
 *
 * Steps:
 * 1. Run sync `dedupeBest(tracks, preferred)` to get the baseline winners + the dedup order.
 * 2. Re-group the INPUT tracks by matchKey (preserves all candidates per group).
 * 3. For groups with >1 candidate: fire `deezerSearchTopN(title+artist, 1)`. If a hit
 *    exists, replace the group's winner with the highest-scored candidate (ties → keep the
 *    sync winner so today's quality/source ranking stays the tiebreak floor).
 * 4. Singleton groups → keep the sync winner (no network call).
 * 5. Return the boosted list in the original dedup order.
 *
 * NEVER throws. On Deezer miss / abort / no key configured, the sync result is returned.
 */
export async function dedupeBestWithDeezer(
	tracks: Track[],
	preferred?: SourceId,
	signal?: AbortSignal
): Promise<Track[]> {
	const baseline = dedupeBest(tracks, preferred);
	if (signal?.aborted) return baseline;

	// Re-group the INPUT by matchKey to get full candidate sets per group.
	const groups = new Map<string, Track[]>();
	for (const t of tracks) {
		const k = key(t);
		if (!k || k === '|') continue; // untitled — singleton in baseline; can't enrich
		const arr = groups.get(k);
		if (arr) arr.push(t);
		else groups.set(k, [t]);
	}

	// Only multi-candidate groups need Deezer; singletons are already final.
	const multiKeys = [...groups.entries()].filter(([, arr]) => arr.length > 1).map(([k]) => k);
	if (!multiKeys.length) return baseline;

	const replacements = new Map<string, Track>();
	await mapWithConcurrency(multiKeys, DEEZER_FANOUT, async (k) => {
		if (signal?.aborted) return;
		const candidates = groups.get(k);
		if (!candidates) return;
		// One Deezer call per group, using the FIRST candidate's title/artist as the query
		// (all candidates in the group normalize to the same key, so picking one is safe).
		// NOTE: limit MUST be >1 — the proxy only populates `results[]` when limit>1
		// (limit=1 is the cover-only backcompat path). We only read [0].
		const q = `${candidates[0].artist} ${candidates[0].title}`.trim();
		const hits = await deezerSearchTopN(q, 2, signal);
		const hit = hits[0];
		if (!hit) return; // Deezer miss → baseline winner stays
		// Score each candidate against the Deezer hit. Highest score wins; ties → keep baseline.
		const baselineWinner = baseline.find((t) => key(t) === k);
		let best: Track | undefined;
		let bestScore = -Infinity;
		for (const c of candidates) {
			const s = scoreAgainstDeezer(c, hit);
			if (s > bestScore) {
				bestScore = s;
				best = c;
			}
		}
		if (best && baselineWinner && best.uid !== baselineWinner.uid) {
			replacements.set(k, best);
		}
	});

	if (signal?.aborted) return baseline;
	if (!replacements.size) return baseline;

	// Substitute the boosted winners in the baseline's order. Untitled tracks (singletons by
	// uid) pass through unchanged since they have no key entry in `replacements`.
	return baseline.map((t) => {
		const k = key(t);
		const swap = k ? replacements.get(k) : undefined;
		return swap ?? t;
	});
}
