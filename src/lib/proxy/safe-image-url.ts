// safe-image-url — validate a remote image URL before echoing it to a client.
//
// SECURITY CONTROL, and it existed as FOUR copies (two Deezer routes, two Last.fm routes) differing
// only in their host allowlist. Four copies of a guard means a hardening fix reaches one and
// silently misses three — the same failure mode that left the freshness check out of four of five
// readiness guards earlier in this session, except here the blast radius is an SSRF / injection
// surface rather than a stale url.
//
// Every check is load-bearing:
//  - The character screen runs BEFORE parsing. These urls are interpolated into CSS
//    `url(...)` and into JSON, so a quote, paren, backslash or whitespace must never survive even
//    if `new URL()` would happily accept it.
//  - `new URL()` in a try/catch: a value that does not parse is not a url, it is an attack or junk.
//  - https ONLY: an http image is blocked as mixed content on the deployed origin anyway.
//  - Host ALLOWLIST, exact-match plus a dot-anchored suffix. The leading dot matters —
//    `endsWith('.dzcdn.net')` rejects `evil-dzcdn.net` while `endsWith('dzcdn.net')` would accept it.
//
// Returns the PARSED `u.href` rather than the raw input, so what ships is the normalised form the
// validator actually approved.

/**
 * An allowlist, split so a dedup cannot quietly widen it. `exact` matches the host verbatim;
 * `suffix` matches dot-anchored subdomains ONLY (`.last.fm` allows `img.last.fm`, and allows
 * neither `last.fm` itself nor `nolast.fm`). Kept as two lists rather than one clever rule because
 * the four call sites this replaced did NOT all permit their apex domain, and a refactor is the
 * wrong moment to change what a security guard accepts.
 */
export interface ImageHostAllowlist {
	exact?: readonly string[];
	suffix: readonly string[];
}

/** `null` unless `raw` is an https URL whose host passes `allowed`. */
export function safeImageUrl(
	raw: string | null | undefined,
	allowed: ImageHostAllowlist
): string | null {
	if (!raw) return null;
	if (/[)\s"'\\(]/.test(raw)) return null;
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.toLowerCase();
		const ok =
			(allowed.exact?.includes(host) ?? false) ||
			allowed.suffix.some((h) => host.endsWith(h));
		return ok ? u.href : null;
	} catch {
		return null;
	}
}

/** Deezer art: cdn-images.dzcdn.net and sibling *.dzcdn.net shards. Apex not permitted (as before). */
export const DEEZER_IMAGE_HOSTS: ImageHostAllowlist = {
	exact: ['cdn-images.dzcdn.net'],
	suffix: ['.dzcdn.net']
};

/** Last.fm art: last.fm itself, its subdomains, and its Fastly CDN. Fastly apex not permitted. */
export const LASTFM_IMAGE_HOSTS: ImageHostAllowlist = {
	exact: ['last.fm'],
	suffix: ['.last.fm', '.fastly.net']
};

// 39-D-01: chart shelf art from Apple Music RSS / legacy iTunes RSS, KKBOX kma and YouTube Charts.

/** Apple art: Apple RSS `artworkUrl100` + legacy iTunes `im:image`, on is1-ssl.mzstatic.com and sibling shards. Apex not permitted. */
export const APPLE_IMAGE_HOSTS: ImageHostAllowlist = {
	suffix: ['.mzstatic.com']
};

/** KKBOX art: every cover is i.kfs.io/…/fit/500x500.jpg. Exact host only, so neither `kfs.io` nor `notkfs.io` passes. */
export const KKBOX_IMAGE_HOSTS: ImageHostAllowlist = {
	exact: ['i.kfs.io'],
	suffix: []
};

/**
 * YouTube Charts art: yt3/lh3.googleusercontent.com (square), i.ytimg.com (16:9 video frames) and
 * yt3.ggpht.com. Apex `googleusercontent.com` not permitted.
 */
export const YOUTUBE_IMAGE_HOSTS: ImageHostAllowlist = {
	exact: ['i.ytimg.com', 'yt3.ggpht.com'],
	suffix: ['.googleusercontent.com']
};

// Phase 40 D-18, hardened by 40-CR-01: the /api/cover-pick VOTE screen.
//
// Votes are untrusted, anonymous INPUT, so this list is NOT composed from the per-source RESPONSE
// allowlists above. Those screen urls a trusted upstream body hands us; reused here they let one
// vote publish `https://attacker.global.ssl.fastly.net/x.jpg` (any Fastly customer) or a
// third-party redirector to every listener — an IP/UA beacon on an attacker origin. So: exact hosts
// of the cover CDNs the "Change cover" picker actually shows, plus dot-anchored suffixes ONLY where
// the whole zone is the CDN's own first-party image shards. NO `.fastly.net`, NO
// `.googleusercontent.com`, NO `api.qijieya.cn` (a netease redirector url is resolved server-side to
// its `*.music.126.net` target before the vote is stored — see cover-pick.ts).
//  - iTunes: is1-ssl…is5-ssl.mzstatic.com shards (Apple's own zone).
//  - Deezer: cdn-images / e-cdns-images.dzcdn.net.
//  - QQ: y.gtimg.cn. Kuwo: img1-img4.kuwo.cn. Netease: p1-p4.music.126.net (Netease's own zone).
//  - YT Music: yt3/lh3.googleusercontent.com + i.ytimg.com, exact. Residual: lh3 also serves
//    user-uploaded Google content, but on a Google origin (no attacker-run server, no IP beacon) and
//    the WR-01 quorum still has to agree on it.
//  - Last.fm: lastfm.freetls.fastly.net, the ONE Fastly host its art uses.
/** Phase 40 D-18 / 40-CR-01: hosts a crowd-voted cover may live on. Exact first, first-party zones only. */
export const COVER_PICK_IMAGE_HOSTS: ImageHostAllowlist = {
	exact: [
		'cdn-images.dzcdn.net',
		'e-cdns-images.dzcdn.net',
		'y.gtimg.cn',
		'img1.kuwo.cn',
		'img2.kuwo.cn',
		'img3.kuwo.cn',
		'img4.kuwo.cn',
		'yt3.googleusercontent.com',
		'lh3.googleusercontent.com',
		'i.ytimg.com',
		'lastfm.freetls.fastly.net'
	],
	suffix: ['.mzstatic.com', '.music.126.net']
};
