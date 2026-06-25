// artist-split — split a combined artist string into individual artist names.
//
// Pure module: no runes, no `$state`, no `$app/*`, no DOM — node-Vitest-testable
// like src/lib/services/match-key.ts. Used by NowPlaying to render one tappable
// link PER artist (each navigating to that sole artist's page).
//
// Connectors recognised (order-preserving, deduped, empties dropped):
//   - comma `,`
//   - ampersand `&` (and the HTML entity `&amp;`, normalised first)
//   - Chinese enumeration comma `、`
//   - slash `/`  (an EXPLICIT connector — "AC/DC" -> ["AC","DC"] is intentional)
//   - the words `feat.` / `feat` / `ft.` / `ft` (case-insensitive, word-boundaried
//     so they never match INSIDE a name)
//   - the standalone collab tokens `x` / `×` (whitespace-bounded so embedded letters
//     like "Maxwell" / "Sixx" are NOT split)

// Single alternation of connectors. Each alternative is whitespace/word-boundary
// guarded so it only fires as a SEPARATOR, never inside a name:
//   - `[,、/&]`        — punctuation connectors (always separators)
//   - `\s+(?:feat\.?|ft\.?)\s+` — feat./ft. surrounded by whitespace
//   - `\s+[x×]\s+`     — collab x / × surrounded by whitespace (so "Maxwell" survives)
const CONNECTORS = /[,、/&]|\s+(?:feat\.?|ft\.?)\s+|\s+[x×]\s+/giu;

/**
 * Split a combined artist string into individual artist names.
 * Returns `[]` for empty / whitespace-only input. Trims each part, drops empties,
 * and dedupes exact duplicates while preserving first-seen order.
 */
export function splitArtists(raw: string): string[] {
	if (!raw) return [];
	// Normalise the HTML ampersand entity BEFORE splitting so `A &amp; B` -> ["A","B"].
	const normalised = raw.replace(/&amp;/gi, '&');
	const out: string[] = [];
	const seen = new Set<string>();
	for (const part of normalised.split(CONNECTORS)) {
		const name = (part ?? '').trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out;
}
