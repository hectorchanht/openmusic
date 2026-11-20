// cover-gradient — the deterministic placeholder gradient shown wherever a track or album has no art.
//
// Moved here from `discography.ts` (where it was `fallbackCoverSeed`) because it is not a
// discography concern: it was already used by the artist pages AND re-implemented, verbatim, by
// EIGHT other files under the name `fallbackCover` — every list page, the home grid, NowPlaying.
// A cover-placeholder helper buried in a discography module is a helper nobody finds, which is why
// each new surface inlined its own instead. Findable name, findable file, one definition.
//
// The maths is identical across all nine former copies, so this is a pure consolidation with no
// visual change: the same seed produces the same colour it did before, on every surface.
//
// Callers differ only in what they SEED it with (a uid, a row key, an album name) — that is genuine
// per-surface variation and stays at the call site.

/**
 * A stable `linear-gradient` derived from `seed`.
 *
 * Deterministic by design: the same song must get the same placeholder every time and on every
 * surface, or a list appears to reshuffle its colours as tiles re-render. Hue is a cheap character
 * sum — this runs per tile on render paths, so it is deliberately not a real hash.
 */
export function coverGradient(seed: string): string {
	const h = (seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
	return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
}
