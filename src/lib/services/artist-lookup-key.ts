// quick-261122-artisthyphen — which string the /artist/{name} page RESOLVES against.
//
// The problem: OG-PATH-01's share encoder (`encodePathSegment`) writes every space as '-', so a
// carrier-free share of "Post Malone" arrives as `/artist/Post-Malone`. The loader decodes that for
// the CARD (`decodePathSegment` → "Post Malone"), but the page used the raw param as its lookup key,
// so the page's own data resolved off "Post-Malone". A blind decode is NOT safe either: the in-app
// nav emits the literal name (`/artist/Jay-Z` via encodeURIComponent), and a genuine hyphen must
// keep resolving — and keep keying favourites / records — as itself.
//
// LIVE PROBE, 2026-11-22 (openmusic.lol, both hosts) — decision ref ART-HYPHEN-01:
//   Deezer `/api/deezer/artist?name=` — hyphen-INSENSITIVE: "Post Malone" == "Post-Malone"
//     (same picture, 4.2M fans) and "Jay-Z" == "Jay Z" (same picture, 3.6M fans).
//   Last.fm `artist.getinfo` — hyphen-SIGNIFICANT: "Post-Malone" → a separate junk entity
//     (14 listeners, no bio, no tags) vs "Post Malone" → 3,752,210 listeners + bio; while
//     "Jay-Z" and "Jay Z" both land on the real Jay-Z (autocorrect).
// So the todo's "hyphen is significant" branch applies: try BOTH spellings and keep the one Last.fm
// actually knows, defaulting to the raw (legacy) literal whenever the evidence doesn't clearly
// favour the decoded form.
//
// The probe calls enrichArtist, whose client cache (6h, keyed by params) means the page's own
// enrichment effect reuses the winning call for free — net cost is ONE extra Last.fm call, and only
// for an ambiguous param (hyphen present, no whitespace).

import { decodePathSegment } from '$lib/services/share';

/** Decoded must beat raw by this factor to win — an order of magnitude, so an autocorrect tie
 *  ("Jay-Z" vs "Jay Z": same entity, same count) or a near-tie always keeps the legacy literal. */
export const DECODED_WIN_FACTOR = 10;

/**
 * The two candidate lookup keys for a route param, or null when the param is unambiguous.
 *
 * Unambiguous (use the param verbatim): no '-' at all, OR the param already contains whitespace —
 * `encodePathSegment` collapses ALL whitespace to '-', so a param with a space can only have come
 * from the in-app nav (`encodeURIComponent`), whose hyphens are therefore genuine.
 */
export function artistLookupCandidates(param: string): { raw: string; decoded: string } | null {
	const raw = (param ?? '').trim();
	if (!raw.includes('-') || /\s/.test(raw)) return null;
	const decoded = decodePathSegment(raw);
	if (!decoded || decoded === raw) return null; // e.g. a bare '-' (encodePathSegment's empty token)
	return { raw, decoded };
}

/** Pick between the candidates by Last.fm listener counts (null/undefined = unknown entity). */
export function pickArtistLookupKey(
	c: { raw: string; decoded: string },
	rawListeners: number | null | undefined,
	decodedListeners: number | null | undefined
): string {
	const r = typeof rawListeners === 'number' && rawListeners > 0 ? rawListeners : 0;
	const d = typeof decodedListeners === 'number' && decodedListeners > 0 ? decodedListeners : 0;
	return d > 0 && d > r * DECODED_WIN_FACTOR ? c.decoded : c.raw;
}

/**
 * Resolve the lookup key for an /artist/{param} route. Never throws: any probe failure keeps the
 * raw literal (today's behaviour). `listenersOf` is injected for testability; the page passes a
 * thin wrapper over `enrichArtist`.
 */
export async function resolveArtistLookupKey(
	param: string,
	listenersOf: (name: string) => Promise<number | null | undefined>
): Promise<string> {
	const c = artistLookupCandidates(param);
	if (!c) return (param ?? '').trim();
	const safe = (n: string) => listenersOf(n).catch(() => null);
	const [r, d] = await Promise.all([safe(c.raw), safe(c.decoded)]);
	return pickArtistLookupKey(c, r, d);
}
