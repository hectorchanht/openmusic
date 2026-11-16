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

// quick-261116-lyrux (Fix 1): per-line PENDING state, aligned to the FULL lines array.
// A position is pending from the moment its chunk is fired until that chunk SETTLES
// (genuine result, soft-fail echo, or hard failure — all three end the wait; only a
// STALE chunk, superseded by a newer song/lang/skip run, leaves the set untouched
// because the newer run rebuilds it from scratch). The pane renders a skeleton in
// the translation slot of a pending line (show-below mode) instead of the duplicate
// original the progressive placeholder array would otherwise show twice.

/** Pending flags for a fresh run: exactly the sent positions start pending. */
export function initialPending(lineCount: number, positions: readonly number[]): boolean[] {
	const pending = new Array<boolean>(lineCount).fill(false);
	for (const pos of positions) {
		if (pos >= 0 && pos < lineCount) pending[pos] = true;
	}
	return pending;
}

/**
 * Return a NEW pending array with one settled chunk's positions cleared:
 * `positions[chunkStart .. chunkEnd)` mapped through the send-position → line-index
 * map. Positions outside the chunk stay as they were, so concurrent chunks settling
 * out of order can never clear each other's lines. `pending` is never mutated.
 */
export function clearChunkPending(
	pending: readonly boolean[],
	positions: readonly number[],
	chunkStart: number,
	chunkEnd: number
): boolean[] {
	const next = pending.slice();
	for (let j = chunkStart; j < chunkEnd; j++) {
		const pos = positions[j];
		if (pos === undefined) break;
		if (pos >= 0 && pos < next.length) next[pos] = false;
	}
	return next;
}

// Deterministic skeleton widths for a pending translation slot (the LoadingState
// WIDTHS idiom: no Math.random in render, the pane must not reshuffle between
// paints). Scaled below LoadingState's line widths — a translation line is a
// secondary, shorter row. Picked by a char-code hash of the ORIGINAL line's text,
// so the same line always gets the same bar and neighbouring lines differ.
const SKELETON_PCTS = [62, 74, 55, 81, 68, 48, 77, 58];

/** Width (%) of the pending-skeleton bar standing in for `text`'s translation. */
export function skeletonWidthPct(text: string): number {
	let h = 0;
	for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
	return SKELETON_PCTS[h % SKELETON_PCTS.length];
}
