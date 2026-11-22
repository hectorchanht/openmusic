// quick-261122-pageog (folds the `pageog-hardcoded-site-origin` todo, follow-up to OG-PAGE-01).
//
// src/app.html carries a STATIC site-default SEO block (title / description / canonical / og:* /
// twitter:* / JSON-LD) AFTER the %sveltekit.head% placeholder, so the ssr=false shell pages still
// give non-JS crawlers a card (D-11). But app.html is emitted verbatim on EVERY page, including the
// SSR entity routes (song / album / artist) whose PageOg.svelte already injected per-page tags at
// the placeholder. Live result before this fix, on an openmusic.pages.dev song link:
//   - two <title>s, two og:type (music.song + website), two og:url — the second one CROSS-ORIGIN
//     (https://openmusic.lol/) — and two canonicals, the second claiming the song page's canonical
//     is the homepage.
// The server hook runs every page response through `rewriteSiteFallback`:
//   - per-page OG present in the head ABOVE the block → drop the whole block (one of each tag);
//   - otherwise (shell page) → keep it, but rebase og:url / og:image / twitter:image onto the
//     request origin so a pages.dev / preview share is same-origin. <link rel=canonical> and the
//     JSON-LD `url` deliberately STAY on the primary domain — canonical across mirrors SHOULD point
//     at the primary (SEO), unlike og:url which crawlers re-fetch.
// Pure + string-only so it is node-testable and safe on workerd.

export const FALLBACK_START = '<!--om:site-fallback-->';
export const FALLBACK_END = '<!--/om:site-fallback-->';
export const PRIMARY_ORIGIN = 'https://openmusic.lol';

const OG_URL_IN_HEAD = /<meta\s+property="og:url"/i;
const REBASED_TAG =
	/(<meta\s+(?:property="og:(?:url|image)"|name="twitter:image")\s+content=")https:\/\/openmusic\.lol(\/)/gi;

/** Only a real http(s) origin may replace the primary one (never `null`, never a non-web scheme). */
function isWebOrigin(origin: string): boolean {
	return /^https?:\/\/[^/\s"<>]+$/i.test(origin);
}

export function rewriteSiteFallback(html: string, origin: string): string {
	const start = html.indexOf(FALLBACK_START);
	if (start === -1) return html;
	const end = html.indexOf(FALLBACK_END, start);
	if (end === -1) return html; // a split chunk — leave it untouched rather than guess
	const blockEnd = end + FALLBACK_END.length;

	// Anything above the start marker inside <head> is the SSR head payload (%sveltekit.head%).
	if (OG_URL_IN_HEAD.test(html.slice(0, start))) {
		return html.slice(0, start) + html.slice(blockEnd);
	}

	if (!isWebOrigin(origin) || origin === PRIMARY_ORIGIN) return html;
	const block = html.slice(start, blockEnd).replace(REBASED_TAG, `$1${origin}$2`);
	return html.slice(0, start) + block + html.slice(blockEnd);
}
