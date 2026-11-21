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

// quick-261120-maxsave (spec Addendum 2 — repeat lines are translated ONCE,
// client-side too): a chorus block repeated 3–4× used to occupy 3–4 slots of
// the send list and of every chunk's payload. The component now collapses the
// send list to UNIQUE texts before chunking, and each settled unique result
// fans back out to every occurrence. Exact string identity — the same key
// discipline as the server's sha256(line) line-KV; punctuation/whitespace
// variants stay distinct lines (no extra normalisation).

/** Collapse `texts` to unique entries in first-appearance order, plus a map
 * from each original index to its unique index. */
export function dedupeSendList(texts: readonly string[]): { unique: string[]; uniqOf: number[] } {
	const seen = new Map<string, number>();
	const unique: string[] = [];
	const uniqOf = texts.map((t) => {
		let u = seen.get(t);
		if (u === undefined) {
			u = unique.length;
			seen.set(t, u);
			unique.push(t);
		}
		return u;
	});
	return { unique, uniqOf };
}

/**
 * Return a NEW array equal to `base` with one settled UNIQUE chunk's outputs
 * applied to EVERY line position that sent that unique line: `out[j]` belongs
 * to unique index `chunkStart + j`, and each send position `s` with
 * `uniqOf[s] === chunkStart + j` lands at line index `positions[s]`. An output
 * slot that is `undefined` keeps the base value — the original line — so a
 * partial chunk can never blank a lyric.
 */
export function applyUniqueChunkResult(
	base: readonly string[],
	positions: readonly number[],
	uniqOf: readonly number[],
	chunkStart: number,
	out: readonly string[]
): string[] {
	const next = base.slice();
	for (let j = 0; j < out.length; j++) {
		if (out[j] === undefined) continue;
		const uniqIdx = chunkStart + j;
		for (let s = 0; s < uniqOf.length; s++) {
			if (uniqOf[s] !== uniqIdx) continue;
			const pos = positions[s];
			if (pos !== undefined) next[pos] = out[j];
		}
	}
	return next;
}

/**
 * quick-261121-trfix: the GENUINE-flag twin of applyUniqueChunkResult. A settled
 * chunk's per-unique-line `flags` (true = the server genuinely translated that
 * line, false = it fell back to the original / echo) fan back out to EVERY line
 * position that sent that unique line, so the pane can tell a real translation
 * from an echo at render time. Positions the chunk does not cover keep their
 * base value — the component seeds the base with false for sent positions and
 * false for pass-through positions (a skipped line's slot holds its original by
 * construction; it is not a genuine translation either).
 */
export function applyUniqueChunkFlags(
	base: readonly boolean[],
	positions: readonly number[],
	uniqOf: readonly number[],
	chunkStart: number,
	flags: readonly boolean[]
): boolean[] {
	const next = base.slice();
	for (let j = 0; j < flags.length; j++) {
		const uniqIdx = chunkStart + j;
		for (let s = 0; s < uniqOf.length; s++) {
			if (uniqOf[s] !== uniqIdx) continue;
			const pos = positions[s];
			if (pos !== undefined && pos >= 0 && pos < next.length) next[pos] = Boolean(flags[j]);
		}
	}
	return next;
}

/**
 * Return a NEW pending array with one settled UNIQUE chunk's line positions
 * cleared — every occurrence of each unique line in [chunkStart, chunkEnd),
 * mirroring applyUniqueChunkResult's fan-out. Occurrences outside the settled
 * chunk's unique range stay pending, so concurrent chunks can never clear
 * each other's lines.
 */
export function clearUniqueChunkPending(
	pending: readonly boolean[],
	positions: readonly number[],
	uniqOf: readonly number[],
	chunkStart: number,
	chunkEnd: number
): boolean[] {
	const next = pending.slice();
	for (let s = 0; s < uniqOf.length; s++) {
		if (uniqOf[s] < chunkStart || uniqOf[s] >= chunkEnd) continue;
		const pos = positions[s];
		if (pos !== undefined && pos >= 0 && pos < next.length) next[pos] = false;
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
