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
 */
export function shuffle<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}
