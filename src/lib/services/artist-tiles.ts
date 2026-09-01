// Artist-tile identity merging for the search results row (quick-260831-s0c). PURE — no store, no
// fetch, no DOM — so the rules are node-testable and the search page stays a thin caller.
//
// THE PROBLEM: the tiles are derived from the raw `track.artist` strings the sources return, and
// different sources spell the same artist differently. A search for "jay chow" produced THREE
// tiles — 周傑倫, Jay Chou, 周杰倫 — for one person.
//
// THE KEY: Last.fm already resolves every spelling to ONE entity, and the search page ALREADY
// calls artist.getinfo per tile to fetch its avatar. Measured 2026-09-01: 周傑倫 / 周杰倫 / 周杰伦 /
// "Jay Chou" all return the same record (122,572 listeners), as do 陳奕迅 / "Eason Chan" (69,834).
// So exposing that canonical name turns the merge into a free grouping step — zero extra requests.
//
// Falling back to the lowercased raw name when Last.fm has no canonical keeps an unknown artist
// exactly as it renders today (one tile per distinct spelling) instead of over-merging.
import { detectLang } from '$lib/i18n/detect';

/** One artist tile as the search page renders it. */
export interface ArtistTile {
	name: string;
	image: string | null;
	trackCount: number;
	/** Last.fm's canonical entity name, when the enrichment call returned one. */
	canonical?: string | null;
}

/**
 * Choose which spelling to DISPLAY for a merged artist.
 *
 * The user's artist-language setting decides: with `zh-Hant` the group shows 周傑倫, with `en` it
 * shows Jay Chou — the same rule the artist page applies via MusicBrainz aliases, but resolved
 * locally here from the spellings the search results already contain (a per-tile MusicBrainz
 * lookup would cost one request each against a ~1 req/s budget).
 *
 * Order: a candidate whose detected script matches the setting → the Last.fm canonical → the
 * most-represented spelling. Ties inside a script break on track count, so the dominant spelling
 * in the actual results wins.
 *
 * `'auto'` and `'off'` are app sentinels, not language tags — they skip straight to the
 * most-represented spelling, leaving today's behaviour untouched for users who never set a
 * preference.
 */
export function pickTileName(
	candidates: { name: string; trackCount: number }[],
	canonical: string | null | undefined,
	artistLang: string | null | undefined
): string {
	if (!candidates.length) return (canonical ?? '').trim();
	// Most-represented first; every branch below inherits this ordering as its tie-break.
	const ranked = [...candidates].sort((a, b) => b.trackCount - a.trackCount);
	const tag = (artistLang ?? '').trim();

	if (tag && tag !== 'auto' && tag !== 'off') {
		const match = ranked.find((c) => detectLang(c.name) === tag);
		if (match) return match.name;
		// The setting asks for a script none of the spellings use. Last.fm's canonical is the
		// best remaining guess at a "proper" name (it is the romanized form for CJK artists).
		const canon = (canonical ?? '').trim();
		if (canon && tag === 'en' && detectLang(canon) === 'en') return canon;
	}
	return ranked[0].name;
}

/**
 * Merge tiles that Last.fm resolved to the same artist.
 *
 * Grouping key is the lowercased canonical name; a tile with no canonical falls back to its own
 * lowercased name, so unknown artists never collapse into each other. Track counts sum (the
 * merged tile is genuinely more represented than any single spelling), the first non-null image
 * wins, and the merged list is re-sorted by the summed count so the row still leads with the
 * most-represented artist.
 */
export function mergeArtistTiles(tiles: ArtistTile[], artistLang: string | null | undefined): ArtistTile[] {
	const groups = new Map<string, { members: ArtistTile[]; canonical: string | null; firstIdx: number }>();

	tiles.forEach((t, idx) => {
		const canon = (t.canonical ?? '').trim();
		const key = (canon || t.name).toLowerCase();
		const g = groups.get(key);
		if (g) {
			g.members.push(t);
			if (!g.canonical && canon) g.canonical = canon;
		} else {
			groups.set(key, { members: [t], canonical: canon || null, firstIdx: idx });
		}
	});

	const merged: (ArtistTile & { firstIdx: number })[] = [];
	for (const g of groups.values()) {
		const trackCount = g.members.reduce((sum, m) => sum + m.trackCount, 0);
		merged.push({
			name: pickTileName(g.members, g.canonical, artistLang),
			// First real avatar wins — the members are the same artist, so any of their images works,
			// and a null must not shadow a resolved one.
			image: g.members.find((m) => m.image)?.image ?? null,
			trackCount,
			canonical: g.canonical,
			firstIdx: g.firstIdx
		});
	}

	// Same ordering contract the unmerged row had: count desc, first-seen as the tie-break.
	return merged
		.sort((a, b) => b.trackCount - a.trackCount || a.firstIdx - b.firstIdx)
		.map(({ firstIdx: _drop, ...tile }) => tile);
}
