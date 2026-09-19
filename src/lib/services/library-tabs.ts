// quick-260919-oc6 — the library tab allowlist, its default, and the nav's active-match rule.
//
// The allowlist and the 'liked' default used to live ONLY inside `library/+page.svelte`. The
// desktop rail now carries five `/library?tab=<id>` entries and has to decide which one is lit,
// which needs the same allowlist and the same default — so they move here ONCE rather than being
// re-inlined in the layout. Same rung-2 reasoning as url-tab.ts: the dependency the page was
// avoiding is a RUNES STORE, not a shared helper, so a pure `.ts` is free to hold this.
//
// PURE .ts: no runes, no `$app/*`, no DOM. Total functions over a URL, node-testable.
import { pickTab } from './url-tab';

export type LibraryTab = 'liked' | 'playlists' | 'downloads' | 'fav-artists' | 'history';

/** Rail order == the page's pill-row order. */
export const LIBRARY_TAB_SET: ReadonlySet<LibraryTab> = new Set<LibraryTab>([
	'liked',
	'playlists',
	'downloads',
	'fav-artists',
	'history'
]);

/** The D-5 default: `tabHref` strips `?tab=liked` from the canonical URL. */
export const DEFAULT_LIBRARY_TAB: LibraryTab = 'liked';

/**
 * Is `href` the nav entry for `url`?
 *
 * For a TAB-LESS href this is byte-for-byte the expression that lived at `+layout.svelte:380`:
 *
 *     page.url.pathname === tab.href || page.url.pathname.startsWith(tab.href + '/')
 *
 * so the three mobile tabs and Settings are provably unchanged (pinned in library-tabs.test.ts):
 * '/' can never match '//', and the subpath arm keeps Settings lit on /settings/general.
 *
 * For a href that CARRIES `?tab=` the pathname gate runs first, then the tab is compared through
 * `pickTab` with the liked default rather than a raw `searchParams.get`. Two reasons, both load-
 * bearing: the canonical URL for Liked is a plain `/library` (D-5 — `tabHref` omits the default),
 * and a tampered `?tab=` must fall back to the default rather than light nothing or light a bogus
 * entry (T-23-10, against the same allowlist the page validates with). Together those give the
 * "exactly one library entry lit, never zero, never two" invariant.
 *
 * try/catch → false: a malformed URL-like object degrades instead of throwing into the render tree.
 */
export function navActive(url: URL, href: string): boolean {
	try {
		const target = new URL(href, url.origin);
		if (!(url.pathname === target.pathname || url.pathname.startsWith(target.pathname + '/')))
			return false;
		const want = target.searchParams.get('tab');
		// No tab constraint on the href — the generic entries (Home, Search, mobile Library,
		// Settings) light on the pathname alone, exactly as before.
		if (want === null) return true;
		return pickTab(url, 'tab', LIBRARY_TAB_SET, DEFAULT_LIBRARY_TAB) === want;
	} catch {
		return false;
	}
}
