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
