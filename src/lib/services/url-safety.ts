// url-safety — the shared https predicate used by every cover/art path.
//
// This existed as SIX byte-identical copies under four different names: `httpsOnly`
// (player.svelte.ts, attached-cover.ts), `isHttps` (lazyCover.ts, upnext-covers.ts, similar.ts) and
// `isSolidCover` (cover-backfill.ts). Each carried a comment explaining why it was inline — some
// variant of "kept inline so this module stays a PURE, node-testable .ts with no store import".
//
// That reasoning was sound about the DEPENDENCY and wrong about the REMEDY: what those modules
// needed to avoid was importing from `player.svelte.ts` (a runes store), not sharing a predicate.
// A dependency-free `.ts` — this file — satisfies both. Four names for one boolean also meant a
// reader had to check each one to know whether `isSolidCover` and `httpsOnly` agreed.
//
// NOT merged in here: `share.ts` `isHttpsUrl`, which tests `/^https:\/\/\S+$/`. That is a STRICTER
// check — a complete URL with a host and no whitespace, not merely an https scheme — because a share
// link is handed to other apps. Folding it into this looser predicate would silently weaken it, so
// it deliberately stays separate. Same-looking is not same.

/**
 * True when `url` is a string whose scheme is https.
 *
 * The cover pipeline's meaning of "usable": an http or protocol-relative image is blocked as mixed
 * content on the deployed https origin, and a null/empty cover means "no art" (the caller renders a
 * gradient). Deliberately a PREFIX test, not a URL parse — this runs per tile on render paths.
 */
export function hasHttpsScheme(url: string | null | undefined): url is string {
	return typeof url === 'string' && url.startsWith('https:');
}

/** A base64 `data:` URL whose MIME is an image. Anchored, so only the scheme position matches. */
const DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

/**
 * 37-D-02: true when a surface can DISPLAY `url` — https, or an inline base64 image.
 *
 * TWO predicates, one definition each, and they are NOT interchangeable:
 *
 * - `isRenderableCover` = DISPLAYABLE. Use it where the question is "can this be shown" — the
 *   `buildArtwork` gate and the player's full-chain skip gate. Those two disagreeing is the exact
 *   shape of the `media-card-shows-app-icon` bug, where a truthy-but-not-https cover fell through
 *   both branches and could never reach the media card.
 * - `hasHttpsScheme` = CACHEABLE / PROBE-ABLE. It deliberately stays the predicate at
 *   `writeCoverBoth` call sites, `library.adoptCover`, `upgradeCoverAsync` and `healCover`. The
 *   cover cache is localStorage sized for ~80-150-byte entries with no scheme or length guard in its
 *   writer and a swallowed QuotaExceededError — one ~100 KB `data:` URL in there silently kills ALL
 *   cover caching. A local file's embedded art also cannot 404, so it is not a heal/probe target.
 *
 * The `image/` allowlist is a security control, not tidiness: an embedded picture's MIME comes from
 * an UNTRUSTED user file (T-37-01), so `data:text/html;base64,...` must never pass. A non-base64
 * `data:` URL is rejected too — the only producer in this app emits base64.
 */
export function isRenderableCover(url: string | null | undefined): url is string {
	return hasHttpsScheme(url) || (typeof url === 'string' && DATA_IMAGE_RE.test(url));
}
