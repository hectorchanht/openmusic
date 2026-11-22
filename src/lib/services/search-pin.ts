// search-pin — STANDING RULE (Hector 2026-11-21, quick-261122-rules): in search results, any
// song the user has DOWNLOADED or LIKED is pinned to the TOP of the results, immediately — on
// the first streamed partial, not after the final merge.
//
// A STABLE partition, nothing more: owned rows keep the ranker's relative order among
// themselves, and every other row keeps its rank order below them. The ranker (rankPool +
// scoreMatch) still decides everything inside each band; this only lifts the user's own
// songs above it. Pure and generic so the song list and the typeahead's song rows share the
// one rule (and the test pins both).
//
// Artist tiles are deliberately NOT pinned: there is no downloaded/liked signal on an artist
// (the rule forbids inventing one). Typeahead artist/album rows likewise carry no such signal;
// callers pass a predicate that returns false for them, so they stay in place relative to
// each other.

/** Rows the user owns (`owned(row)` true) first, in their original order; the rest after, in theirs. */
export function pinOwned<T>(rows: readonly T[], owned: (row: T) => boolean): T[] {
	const pinned: T[] = [];
	const rest: T[] = [];
	for (const r of rows) {
		let hit = false;
		try {
			hit = owned(r);
		} catch {
			hit = false; // a broken predicate must never drop or reorder a row into chaos
		}
		(hit ? pinned : rest).push(r);
	}
	return pinned.length ? [...pinned, ...rest] : rows.slice();
}
