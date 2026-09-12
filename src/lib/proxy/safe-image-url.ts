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
