// match-key — the reusable {artist}+{title} normalization primitive.
//
// SINGLE SOURCE OF TRUTH for the normalized identity used to align Last.fm names
// with local tracks (Phase 8 enrichment) and — reused — by Phase 13 loved-sync
// reconciliation. It is a standalone exported helper taking RAW STRINGS (not a
// Track) so Last.fm's `{ artist, name }` payloads — which are not Tracks — can be
// keyed directly.
//
// Canonical output order is `normalize(artist) + '|' + normalize(title)`
// (ARTIST-FIRST per ARCHITECTURE.md Pitfall 9). NOTE: this differs from
// dedupe.ts `key()` which keeps a legacy `title|artist` order for backward compat;
// dedupe.ts is intentionally left untouched (it has its own consumers + no test
// coupling here). Do not delegate one to the other — the orders differ on purpose.
//
// CJK Traditional/Simplified folding is EXPLICITLY OUT OF SCOPE here (deferred to
// Phase 13). Phase 8 ships only lowercasing / whitespace / punctuation / bracketed-
// & feat.-suffix folding — the exact `norm()` regex chain mirrored from dedupe.ts.
//
// Pure module: no runes, no `$state`, no `$app/*` — node-Vitest-testable like
// dedupe.ts / history-logic.ts.

/** Normalize one component (artist or title): case/space/punct-insensitive, bracket + feat./remaster/live suffixes dropped. */
// Exported (quick-260925-wa7) so name-rescue.ts reuses this ONE normalizer instead of re-inlining it.
export function norm(s: string): string {
	return (s || '')
		.toLowerCase()
		.replace(/[（(【\[].*?[)）\]】]/g, ' ') // drop (Live) / [Remaster] / 【...】
		.replace(/\s*-\s*(remaster|live|acoustic|explicit|feat\.?|ft\.?).*$/i, ' ')
		.replace(/[^\p{L}\p{N}]+/gu, '') // strip all punctuation/space (keeps CJK + latin + digits)
		.trim();
}

/**
 * Build the canonical match key for an {artist, title} pair.
 * Returns `${norm(artist)}|${norm(title)}` (artist-first). Empty/undefined inputs
 * yield the empty components (e.g. matchKey('', '') === '|').
 */
export function matchKey(artist: string, title: string): string {
	return `${norm(artist)}|${norm(title)}`;
}
