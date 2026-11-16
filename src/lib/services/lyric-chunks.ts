// quick-261116-kvprog: pure helpers for NpLyrics' PROGRESSIVE lyric translation.
//
// The old flow sent the WHOLE song to translateLinesEx in one call and rendered
// nothing until the full batch resolved — with the server fixed a cold full song is
// still ~15s of staring at untranslated lyrics. These helpers let the component
// split the send-list into ordered chunks, fire them with bounded concurrency
// (chunk 0 first — the early lines the user is actually reading), and stitch each
// chunk's results into the aligned render array the moment it lands.
//
// PURE .ts (house style): no runes, no browser globals — node-testable. The
// component owns the effect, the staleness guard and the caches; this module owns
// only the arithmetic.

/** Lines per translateLinesEx call. 10 keeps a chunk's cold latency to a few
 * seconds (the server parallelises 5-line groups inside the chunk) while keeping
 * the request count for a 60-line song at 6. */
export const LYRICS_CHUNK_SIZE = 10;

/** Max chunks in flight at once. 3 balances first-paint speed against bursting
 * the provider cascade (each chunk fans out internally on the server). */
export const LYRICS_CHUNK_CONCURRENCY = 3;

/** Ordered [start, end) ranges covering `count` items in slices of `size`. */
export function chunkRanges(count: number, size: number): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	for (let start = 0; start < count; start += size) {
		ranges.push({ start, end: Math.min(count, start + size) });
	}
	return ranges;
}

/**
 * Return a NEW array equal to `base` with one chunk's outputs applied:
 * `out[j]` lands at `positions[chunkStart + j]`, where `positions` is the
 * send-position → line-index map (NpLyrics' sendIdx). An output slot that is
 * `undefined` (short/misaligned reply) keeps the base value — the original
 * line — so a partial chunk can never blank a lyric. `base` is never mutated
 * (the component reassigns the result to its $state for reactivity).
 */
export function applyChunkResult(
	base: readonly string[],
	positions: readonly number[],
	chunkStart: number,
	out: readonly string[]
): string[] {
	const next = base.slice();
	for (let j = 0; j < out.length; j++) {
		const pos = positions[chunkStart + j];
		if (pos === undefined) break;
		if (out[j] !== undefined) next[pos] = out[j];
	}
	return next;
}
