// PURE attached-cover helpers — NO runes, NO `$state`, NO `$app/environment`, NEVER throws.
//
// WHAT (quick-260910-piz): the album-SCOPED generalisation of quick-260831-t2g's single-song
// `attachedCover`. t2g attached one `{ key, url }` for the ONE song a caller tapped; this module
// turns that into a whole-LIST attachment plus the queue seeding that goes with it. The runes
// player store (src/lib/stores/player.svelte.ts) thinly WRAPS these two helpers at its queue-install
// seams (setQueue / setListQueue) — the same "extract a pure helper module the runes store thinly
// wraps" precedent as player-persist.ts / media-session.ts / sleep-timer.ts. The `Track` import is
// TYPE-ONLY (erased at runtime), and this module never imports the player — no cycle.
//
// WHY TWO HELPERS — both are needed, neither alone is sufficient:
//  - `seedCover` writes `track.cover` on every queued entry so the Up Next TILES paint. Gap 3
//    (26-10) deliberately REMOVED the per-tile lazyCover resolve chain (it caused a
//    /api/deezer/search flood), so a tile now renders `resolvedCovers[uid] ?? track.cover` and
//    nothing else — an unseeded entry stays a gradient forever.
//  - `buildAttachment` is what makes the album art OUTRANK the source's own inline cover inside
//    play(): the synchronous `resolvedCover` read and the re-apply just before `this.current =
//    resolved`. Seeding ALONE was tried first (superseded plan fa4ec76/ac4d1fc) and is NOT enough:
//    `ensureTrackDetails` returns a track carrying the SOURCE thumbnail, and `this.current =
//    resolved` silently overwrites the seed unless the attachment matches that song. That is the
//    hero "flip to a qq y.gtimg.cn thumbnail on track 2+" bug.
//
// DECISION — OVERRIDE, not fill-in-when-null. t2g's contract is "every song on an album shows the
// album's art, siblings must never disagree". The album cover is the merged best-quality art
// (Deezer/Last.fm enriched); CN inline covers are per-track thumbnails, often plain http
// y.gtimg.cn. Accepted trade-off: a rare per-track image that is legitimately better than the
// album art gets replaced.
//
// NULL / NON-HTTPS GUARD: the album page's `heroImg` is null until the async Deezer/Last.fm enrich
// lands, and can be non-https from Last.fm. In that case `seedCover` is a pass-through (returns the
// SAME array — never blanks a cover a track already carries) and `buildAttachment` returns null
// ("this list has no album art"). https-only mirrors the store's `httpsOnly` / cover-backfill
// isSolidCover guard (T-0bb-01, T-piz-01) — the only thing safe to cache/render.
//
// IDENTITY: `uid` is untouched, so setListQueue's re-anchor (uid first, then same-song key —
// album-and-next-song-bug) is unaffected. Zero network — pure data.
import type { Track } from '$lib/sources/types';
import { matchKey } from '$lib/services/match-key';

/** SOLID = a non-empty https URL (mirrors player.svelte.ts httpsOnly / cover-backfill isSolidCover). */
const httpsOnly = (u?: string | null): u is string => typeof u === 'string' && u.startsWith('https:');

/**
 * One cover for a whole installed list, with SONG-keyed membership.
 *
 * Keyed by `matchKey(artist, title)` and NOT by uid, inherited from t2g: a tap resolves to one
 * source and cross-source fallback then replays the SAME song under a DIFFERENT uid — a uid-keyed
 * marker is lost at that hop. The art belongs to the song, so the key must too.
 */
export type AttachedCover = { url: string; keys: Set<string> };

/**
 * Stamp the list's cover onto every entry (override). Returns the SAME array reference untouched
 * when there is no usable (https) cover, and NEW element objects otherwise — the input is never
 * mutated.
 */
export function seedCover(tracks: Track[], cover: string | null | undefined): Track[] {
	if (!httpsOnly(cover)) return tracks;
	return tracks.map((t) => ({ ...t, cover }));
}

/**
 * Build the list-scoped attachment: one url, one key per distinct song in the list. Null when the
 * cover is missing/non-https — the caller reads that as "clear the attachment".
 */
export function buildAttachment(tracks: Track[], cover: string | null | undefined): AttachedCover | null {
	if (!httpsOnly(cover)) return null;
	return { url: cover, keys: new Set(tracks.map((t) => matchKey(t.artist, t.title))) };
}
