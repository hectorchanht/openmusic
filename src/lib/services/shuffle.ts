// shuffle — a dependency-free Fisher-Yates permutation (39-D-19).
//
// Moved out of discovery.ts because home-charts.ts must stay store-free: discovery.ts imports
// `settings` (inside resolveStub) and `catalog`, so a pure module importing it would drag the whole
// source registry into a node test. discovery.ts re-exports this, so every existing importer is
// unchanged.

/**
 * Return a NEW array that is a uniformly-shuffled permutation of `arr` (copy-then-
 * Fisher-Yates — identical algorithm to picks.ts `sample()` but keeping the FULL
 * permutation instead of slicing). MUST NOT mutate the input. `[]` → `[]`, `[x]` → `[x]`.
 * Used to reshuffle within-shelf tile order AND the order of the tag/country shelves so
 * Randomize is visibly different even when a fetched page returns overlapping tracks.
 *
 * quick-260926-lw8: optional trailing `rng` (default Math.random, so every existing caller is
 * unchanged). Inject `seededRng(seed)` for a replayable order, or a constant stub in tests:
 * `() => 0.999` is the IDENTITY rng for any array shorter than 1000 (j = floor(0.999*(i+1)) = i),
 * `() => 0` always reorders a length >= 2 input.
 */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/**
 * quick-260926-lw8 — mulberry32: a tiny seeded PRNG returning floats in [0, 1). The home radio
 * shelf must be REPRODUCIBLE within a session (a tab switch re-mounts home and must not reshuffle
 * it), which Math.random cannot replay; the same seed always yields the same sequence. NOT crypto —
 * it only orders recommendations.
 */
export function seededRng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), a | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
