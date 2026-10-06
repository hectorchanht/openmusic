// score-context — the PURE per-result-set summary scoreMatch reads for set-relative boosts
// (Phase 21, SRCH-01 / D-05 / D-06).
//
// A single candidate's score (score-match.ts) cannot know how the WHOLE result set looks:
// whether the candidate's artist shows up under several DISTINCT sources (a strong "this is
// the real artist" signal) and how long the user's query was (for the short-title proximity
// boost). computeSetContext folds the set once into a cheap summary that scoreMatch consults
// per candidate — so the O(set) work happens ONCE, not per candidate per signal.
//
// artistSources is keyed ARTIST-ONLY via `matchKey(artist, '')` (mirroring cover-cache's
// artistCoverCacheKey) so two different titles by the same artist collapse to one entry, and
// its value is the SET of distinct SourceIds — D-05 rewards cross-source PRESENCE, never raw
// row count (5 rows from one source is still size 1).
//
// PURE + import-light (only matchKey + the SourceId/Track types): no $state, no $app/*, no I/O.
// node-Vitest-testable exactly like score-match.ts / match-key.ts.
import { matchKey } from '$lib/services/match-key';
import { titleKey } from '$lib/services/dedupe';
import type { SourceId, Track } from '$lib/sources/types';

export interface SetContext {
	/** matchKey(artist,'') → the set of DISTINCT sources that artist appears under (D-05). */
	artistSources: Map<string, Set<SourceId>>;
	/** Trimmed length of the user's query string (D-06 short-title proximity). */
	queryLen: number;
	/**
	 * quick-261006-lyr LYRIC-01: the query reads as a pasted LYRIC line, not a title/artist.
	 * True when the trimmed query carries >= LYRIC_MIN_HAN Han chars — CJK song titles are
	 * rarely that long, while a lyric line usually is. Latin-only queries never engage (a long
	 * latin "title" searched verbatim, e.g. Bohemian Rhapsody, must keep its exact-title credit).
	 */
	lyricMode: boolean;
	/**
	 * quick-261006-lyr LYRIC-02: the title-only canonical key (titleKey) shared by the MOST
	 * candidates — the song the lyric-matching upstreams agree on. Null when lyricMode is off,
	 * or when no title is shared by >= 2 candidates (a consensus of one is no consensus).
	 * scoreMatch boosts consensus members and demotes the pasted-lyric mislabel (LYRIC-03).
	 */
	lyricConsensus: string | null;
}

/** quick-261006-lyr LYRIC-01: Han-char count at/above which a query is lyric-like, not title-like. */
export const LYRIC_MIN_HAN = 7;
const HAN_CHAR = /\p{Script=Han}/gu;

/** Count the Han (CJK) characters in a string. */
function hanCount(s: string): number {
	return (s.match(HAN_CHAR) ?? []).length;
}

/**
 * quick-261006-lyr LYRIC-02: elect the consensus title for a lyric-mode result set — the
 * titleKey shared by the most candidates. qq/kuwo match lyrics server-side and return every
 * cover whose lyrics contain the line, so the true song's canonical title (木纹 here, not the
 * lyric text itself) is the runaway winner by count. A track whose title IS the lyric (the
 * mislabeled upload) forms a bucket of one and can never win. Requires >= 2 sharers so a set
 * of all-unique titles yields null (no boost, no demotion — graceful degradation).
 */
function electLyricConsensus(rows: Track[]): string | null {
	const counts = new Map<string, number>();
	const firstSeen: string[] = [];
	for (const r of rows) {
		const k = titleKey(r.title);
		if (!k) continue;
		if (!counts.has(k)) {
			counts.set(k, 1);
			firstSeen.push(k);
		} else {
			counts.set(k, (counts.get(k) as number) + 1);
		}
	}
	let best: string | null = null;
	let bestCount = 0;
	for (const k of firstSeen) {
		const c = counts.get(k) as number;
		if (c > bestCount) {
			bestCount = c;
			best = k;
		}
	}
	return bestCount >= 2 ? best : null;
}

/**
 * Fold a result set + query into the cheap summary scoreMatch reads for set-relative boosts.
 * Pure: no I/O, no mutation of inputs. Deterministic.
 */
export function computeSetContext(rows: Track[], query: string): SetContext {
	const artistSources = new Map<string, Set<SourceId>>();
	for (const r of rows) {
		const key = matchKey(r.artist, ''); // artist-only key (D-05): titles must not split it
		let set = artistSources.get(key);
		if (!set) {
			set = new Set<SourceId>();
			artistSources.set(key, set);
		}
		set.add(r.source); // Set de-dupes: 5 rows from one source stays size 1 (rows != sources)
	}
	const trimmed = (query || '').trim();
	// quick-261006-lyr LYRIC-01/02: the consensus election is meaningful only in lyric mode —
	// skip the O(set) titleKey pass for every normal title/artist search.
	const lyricMode = hanCount(trimmed) >= LYRIC_MIN_HAN;
	return {
		artistSources,
		queryLen: trimmed.length,
		lyricMode,
		lyricConsensus: lyricMode ? electLyricConsensus(rows) : null
	};
}
