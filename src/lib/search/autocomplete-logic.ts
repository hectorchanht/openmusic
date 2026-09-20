// PURE typeahead-autocomplete logic (quick-260611-ql0) — NO runes, NO `$state`, NO DOM,
// NO fetch, NO timers-over-runes, NO `$app/environment`. This is the Node-Vitest-testable
// core; the search `+page.svelte` component merely WRAPS these helpers (it owns the runes
// state, the debounced fetch via `deezerSearchTopN`, the AbortController, and the render),
// exactly as `search-history-logic.ts` is wrapped by the searchHistory runes store.
//
// Why a separate pure module: the suggestion derivation (dedupe / cap / group) and the
// debounce primitive are framework-free algorithms. Keeping them out of the `.svelte` file
// lets them be unit-tested in the node Vitest project without a DOM and keeps the component
// thin — same split discipline the repo already uses for search history.

import type { DeezerHit } from '$lib/services/deezer';

/** Minimum trimmed query length before any suggestion is produced. Below this we return []
 *  (a 1-char query is too noisy to suggest on and would hammer the proxy for nothing). */
export const MIN_QUERY_LEN = 2;

/** Default debounce window (ms) for the component's suggestion fetch. A typing pause shorter
 *  than this never triggers a network call — the component cancels + restarts the timer on
 *  each keystroke so only the trailing pause fetches. */
export const SUGGEST_DEBOUNCE_MS = 300;

/** Maximum number of combined (artist + album + song) suggestions surfaced at once. Keeps the
 *  typeahead list short on a mobile screen and bounds the render. */
export const SUGGEST_CAP = 8;

/** Ceiling on ARTIST rows (quick-260919-pid). Measured live queries produce up to 8 distinct
 *  artists within 8 hits, which unbounded would consume the whole cap and leave zero songs. */
export const ARTIST_ROWS = 2;

/** Ceiling on ALBUM rows (quick-260919-pid). Same reason — 7-8 distinct album|artist pairs per
 *  8 hits is the norm. 2 + 2 leaves at least 4 song slots under SUGGEST_CAP. */
export const ALBUM_ROWS = 2;

/**
 * A single typeahead suggestion. `kind` distinguishes a song row (carries the performing
 * `artist` for muted secondary display), an artist row (the artist name is the `title`), and
 * an album row (quick-260712-gm4 — the album name is the `title`, carrying its `artist` for the
 * muted sub-line like a song). `key` is stable + unique within a derived list, suitable for a
 * Svelte `{#each (key)}`.
 */
export interface Suggestion {
	kind: 'song' | 'artist' | 'album';
	/** The primary text + the text the component fills the input with on tap. */
	title: string;
	/** Present for `kind:'song'` and `kind:'album'` — the performing/album artist, shown as muted secondary text. */
	artist?: string;
	/** Stable, unique-within-the-list key for keyed `{#each}` rendering. */
	key: string;
}

/**
 * Derive a deduped, capped, song+artist+album suggestion list from Deezer hits for `query`.
 *
 * Rules:
 *  - An empty/whitespace `query` OR a trimmed length `< MIN_QUERY_LEN` → `[]` (never suggest
 *    on too-short input).
 *  - SONG suggestions: one per hit (kind:'song', title=hit.title, artist=hit.artist),
 *    preserving Deezer's relevance order; hits with an empty/whitespace title are skipped;
 *    duplicates are dropped case-insensitively on `${title}|${artist}` (first wins).
 *  - ARTIST suggestions: the DISTINCT artist names across the hits (case-insensitive dedupe,
 *    first-seen casing + order preserved); empty artist names are skipped.
 *  - ALBUM suggestions (quick-260712-gm4): the DISTINCT album names across the hits
 *    (kind:'album', title=hit.album, artist=hit.artist for the muted sub), case-insensitively
 *    deduped on `${album}|${artist}` with first-seen casing + order; empty album names skipped.
 *    Deezer already returns `hit.album` on every search hit, so albums cost ZERO extra network.
 *  - The combined list is GROUPED (quick-260919-pid): up to `ARTIST_ROWS` artists, then up to
 *    `ALBUM_ROWS` albums, then songs filling the rest, capped at `SUGGEST_CAP` — see the
 *    in-body decision record. `key` is `song:${title}|${artist}` /
 *    `artist:${name}` / `album:${title}|${artist}`, guaranteed unique because each kind is
 *    deduped first AND the kind prefix keeps a same-named song/artist/album from colliding.
 *
 * Pure: tolerates missing/nullish `title`/`artist`/`album` fields (treats them as empty →
 * skipped), never throws, never touches the network/DOM/timers.
 */
export function deriveSuggestions(hits: DeezerHit[], query: string): Suggestion[] {
	const q = (query ?? '').trim();
	if (q.length < MIN_QUERY_LEN) return [];
	if (!Array.isArray(hits) || hits.length === 0) return [];

	// --- songs: preserve relevance order, drop empty-title, case-insensitive dedupe on title|artist
	const songs: Suggestion[] = [];
	const seenSong = new Set<string>();
	for (const h of hits) {
		const title = (h?.title ?? '').trim();
		if (!title) continue;
		const artist = (h?.artist ?? '').trim();
		const dedupeKey = `${title.toLowerCase()}|${artist.toLowerCase()}`;
		if (seenSong.has(dedupeKey)) continue;
		seenSong.add(dedupeKey);
		songs.push({ kind: 'song', title, artist, key: `song:${title}|${artist}` });
	}

	// --- artists: distinct names, first-seen casing + order, skip empty
	const artists: Suggestion[] = [];
	const seenArtist = new Set<string>();
	for (const h of hits) {
		const name = (h?.artist ?? '').trim();
		if (!name) continue;
		const norm = name.toLowerCase();
		if (seenArtist.has(norm)) continue;
		seenArtist.add(norm);
		artists.push({ kind: 'artist', title: name, key: `artist:${name}` });
	}

	// --- albums (gm4): distinct album names, first-seen casing + order, skip empty. Carry the
	// hit's artist for the muted sub-line; dedupe on album|artist so a common album title
	// ("Greatest Hits") stays distinct across artists.
	const albums: Suggestion[] = [];
	const seenAlbum = new Set<string>();
	for (const h of hits) {
		const title = (h?.album ?? '').trim();
		if (!title) continue;
		const artist = (h?.artist ?? '').trim();
		const dedupeKey = `${title.toLowerCase()}|${artist.toLowerCase()}`;
		if (seenAlbum.has(dedupeKey)) continue;
		seenAlbum.add(dedupeKey);
		albums.push({ kind: 'album', title, artist, key: `album:${title}|${artist}` });
	}

	// --- bounded grouped concat (quick-260919-pid): artists (<= ARTIST_ROWS), then albums
	// (<= ALBUM_ROWS), then songs fill every remaining slot up to SUGGEST_CAP. The locked decision
	// is GROUPED BY KIND in that order — no headings and no i18n keys, because the page already
	// marks kind with the glyphs ♪ artist / ◎ album / ♫ song.
	//
	// Why the two LEADING groups are bounded. The page fetches only SUGGEST_CAP hits and `artists`
	// derives from the SAME hit list as `songs`, so an UNBOUNDED concat starves the songs. Measured
	// against live Deezer through the app's own proxy, with [...artists, ...albums, ...songs]:
	//
	//   query        | distinct artists | distinct album|artist | song rows unbounded would show
	//   love         | 8                | 8                     | 0
	//   happy        | 8                | 8                     | 0
	//   hello        | 8                | 8                     | 0
	//   jay chou     | 1                | 7                     | 0
	//   周杰倫        | 2                | 7                     | 0
	//   tame impala  | 1                | 5                     | 2
	//
	// Five of six render ZERO song rows — including artist-name queries — and a song row is the
	// only directly playable kind. 2 + 2 guarantees >= 4 song slots whenever 4+ distinct songs exist.
	//
	// Backfill / asymmetry rule — do NOT "fix" the short list. A short leading group lets songs
	// expand into the unused slots, so the output still reaches SUGGEST_CAP whenever enough total
	// suggestions exist (no holes). But with NO songs the output is legitimately SHORT: the caps are
	// ceilings on artist/album rows, NEVER a floor to backfill from. Asymmetric on purpose —
	// artist/album rows are navigation, song rows are the product.
	//
	// SUPERSEDED (was ql0/gm4 interleave): "a few songs first, then a couple artists, then a couple
	// albums near the top, then round-robin the remainder across all three kinds so none is starved
	// below the cap. Guarantees song/artist/album rows all surface near the top when present."
	// Grouping revokes that guarantee for artists/albums beyond their caps, by choice.
	return [
		...artists.slice(0, ARTIST_ROWS),
		...albums.slice(0, ALBUM_ROWS),
		...songs
	].slice(0, SUGGEST_CAP);
}

/**
 * The search keyword committed when a SONG (♫) suggestion is tapped (quick-260919-pbs).
 *
 * Form is `"<title> <artist>"` — the user's locked decision, not a tunable. The tap both PLAYS
 * the stub and commits this query, so the input text and the results below it always agree.
 *
 * The falsy/whitespace-artist fallback (→ the trimmed title alone) is load-bearing, not
 * defensive padding: `deriveSuggestions` emits `artist: ''` for a hit with no artist, so
 * naively joining would commit a query with a trailing space and search for the title plus
 * nothing. Takes `Pick<Suggestion, 'title' | 'artist'>` rather than the full `Suggestion` —
 * only these two fields matter, and callers/tests need not fabricate `kind`/`key`.
 */
export function suggestionKeyword(s: Pick<Suggestion, 'title' | 'artist'>): string {
	const title = (s.title ?? '').trim();
	const artist = (s.artist ?? '').trim();
	return artist ? `${title} ${artist}` : title;
}

/** A debounced callable: invoking it (re)schedules `fn`; `.cancel()` drops any pending call. */
export interface Debounced<F extends (...args: never[]) => void> {
	(...args: Parameters<F>): void;
	/** Cancel a pending invocation (e.g. on submit, on too-short query, on destroy). */
	cancel(): void;
}

/**
 * Framework-free debounce: returns a callable that delays `fn` by `delayMs`, restarting the
 * timer on every call so only the trailing call within a quiet window fires. `.cancel()`
 * clears any pending invocation. Plain setTimeout/clearTimeout — no runes, no DOM. Used by
 * the component to throttle suggestion fetches to at most one per typing pause.
 */
export function debounce<F extends (...args: never[]) => void>(
	fn: F,
	delayMs: number
): Debounced<F> {
	let timer: ReturnType<typeof setTimeout> | null = null;

	const debounced = (...args: Parameters<F>): void => {
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			fn(...args);
		}, delayMs);
	};

	debounced.cancel = (): void => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	return debounced;
}
