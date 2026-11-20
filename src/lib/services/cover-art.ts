// Cover Art Archive (CAA) client-side cover URL builder (Phase 9 quick-260606-nza, FIX-B).
//
// Last.fm dropped track-level art, so discovery tiles were bare color gradients. CAA is a
// public, read-only image host keyed by MusicBrainz ids: a release-group cover lives at
//   https://coverartarchive.org/release-group/{mbid}/front-250
// which 307-redirects to the image, or 404s when there is no art. CAA has NO rate limit and
// needs NO User-Agent, so a per-visible-tile <img loading="lazy"> request is fine — no
// fan-out, off the render critical path (T-nza-03).
//
// This module only BUILDS the URL; it never fetches. The browser <img> performs the request
// and an onerror handler hides the img on 404 so the existing gradient shows through (no
// broken-image icon). The URL is set as an <img src> ATTRIBUTE — NOT a CSS `url()` — and the
// mbid is encodeURIComponent'd, so there is no CSS-injection surface and the last.fm/fastly
// safeImageUrl allow-list on the edge is deliberately NOT widened for CAA (T-nza-02).

const CAA_BASE = 'https://coverartarchive.org/release-group';

/**
 * Build a Cover Art Archive release-group cover URL (front-250) for a MusicBrainz id.
 * Returns null for an empty / whitespace-only / undefined / null mbid — the caller then
 * renders no <img> and the color gradient shows (always graceful).
 */
export function caaReleaseGroupCover(mbid: string | null | undefined): string | null {
	const id = (mbid ?? '').trim();
	if (!id) return null;
	return `${CAA_BASE}/${encodeURIComponent(id)}/front-250`;
}
