// quick-260919-oc6 — the library tab allowlist, its default, and the nav's active-match rule.
//
// The allowlist and the 'liked' default used to live ONLY inside `library/+page.svelte`. The
// desktop rail now carries six `/library?tab=<id>` entries and has to decide which one is lit,
// which needs the same allowlist and the same default — so they move here ONCE rather than being
// re-inlined in the layout. Same rung-2 reasoning as url-tab.ts: the dependency the page was
// avoiding is a RUNES STORE, not a shared helper, so a pure `.ts` is free to hold this.
//
// quick-260927-2cy: 'radio' (Your Radio) is a real tab, not a separate /radio route, so the rail
// lit-state, the pill row, the stored-tab restore and the T-23-10 `?tab=` sanitising all cover it
// unchanged. It sits LAST, after 'history', because the radio draw is seeded from history.
//
// quick-261122-books: 'books' (廣播劇 / 有聲書 / 說書 — resume + discover long-form listening) is the
// seventh, LAST after radio, by the same precedent: a library tab, not a new bottom-bar
// destination (the mobile bar stays Home / Search / Library).
//
// PURE .ts: no runes, no `$app/*`, no DOM. Total functions over a URL, node-testable.
import { pickTab } from './url-tab';

export type LibraryTab = 'liked' | 'playlists' | 'downloads' | 'fav-artists' | 'history' | 'radio' | 'books';

/**
 * The tabs in DISPLAYED order — the library page's pill row, the desktop rail, and
 * (quick-261116-libcycle) the re-tap cycle all walk this one list, so the three can never
 * drift apart. The set below is built FROM it to keep a single source of truth.
 */
export const LIBRARY_TAB_ORDER: readonly LibraryTab[] = [
	'liked',
	'playlists',
	'downloads',
	'fav-artists',
	'history',
	'radio',
	'books'
];

/** Rail order == the page's pill-row order (== LIBRARY_TAB_ORDER). */
export const LIBRARY_TAB_SET: ReadonlySet<LibraryTab> = new Set<LibraryTab>(LIBRARY_TAB_ORDER);

/**
 * quick-261116-libcycle — the tab AFTER `current` in displayed order, wrapping from the
 * last ('books') back to the first ('liked'). An out-of-order value (unreachable through
 * the LibraryTab type, but the function is total) restarts at the first tab.
 */
export function nextLibraryTab(current: LibraryTab): LibraryTab {
	const i = LIBRARY_TAB_ORDER.indexOf(current);
	return LIBRARY_TAB_ORDER[(i + 1) % LIBRARY_TAB_ORDER.length];
}

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

/** The subset of a MouseEvent the interception rule reads. Keeps the rule node-testable —
 *  callers pass the real event, tests pass a literal. */
export interface NavClickLike {
	defaultPrevented: boolean;
	button: number;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

/**
 * quick-260920-m0l — should a tab/rail click be intercepted and routed through
 * `overlays.navigateAway` instead of letting the plain <a> navigate?
 *
 * TRUE only when an overlay is actually open. A tap on the rail while the now-playing sheet is
 * up used to navigate UNDERNEATH it and leave it open; navigateAway navigates first and then
 * closes every open overlay, which is what collapses the sheet.
 *
 * FALSE for a modified or non-primary click — open-in-new-tab belongs to the browser, and the
 * current tab is not navigating anyway, so the overlay must stay exactly as it is. FALSE at depth
 * 0 as well, so the ordinary no-overlay path keeps native anchor behaviour and pays no JS.
 */
/** A plain primary click with no modifier and no prior handler — the only click shape the
 *  nav ever acts on in JS; everything else belongs to the browser (new tab, etc.). */
function isPlainNavClick(e: NavClickLike): boolean {
	if (e.defaultPrevented) return false;
	if (e.button !== 0) return false;
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
	return true;
}

export function shouldInterceptNavClick(e: NavClickLike, overlayDepth: number): boolean {
	return isPlainNavClick(e) && overlayDepth > 0;
}

/** What a bottom-nav / rail RE-TAP (tapping the entry for the page you are already on)
 *  should do instead of navigating: 'search' focuses the search field, 'library' cycles
 *  to the next library tab, null keeps the ordinary navigation path. */
export type NavRetapAction = 'search' | 'library';

/**
 * quick-261116-srchfocus / quick-261116-libcycle — the re-tap rule.
 *
 * TRUE (an action) only when ALL of these hold:
 *  - a plain primary click (same carve-outs as shouldInterceptNavClick — a modified or
 *    middle click is the browser's, and the anchor must be left alone);
 *  - NO overlay is open. While one is, `shouldInterceptNavClick` + navigateAway own the
 *    tap (it navigates and closes the sheet); focusing a field UNDER the sheet or cycling
 *    a tab the user cannot see would both be wrong, so the re-tap defers to that path;
 *  - the href is a TAB-LESS entry whose pathname is EXACTLY the current pathname. The
 *    desktop rail's six `/library?tab=…` entries are real destinations (tapping Downloads
 *    while on Liked must navigate, never cycle), so any href carrying `?tab=` is excluded;
 *    the subpath arm of navActive is excluded too — only an exact same-page tap counts.
 *
 * Only '/search' and '/library' have a re-tap behaviour; a Home re-tap stays null
 * (ordinary same-route navigation, unchanged). try/catch → null, like navActive.
 */
export function navRetapAction(
	e: NavClickLike,
	url: URL,
	href: string,
	overlayDepth: number
): NavRetapAction | null {
	if (!isPlainNavClick(e)) return null;
	if (overlayDepth > 0) return null;
	try {
		const target = new URL(href, url.origin);
		if (target.searchParams.has('tab')) return null;
		if (url.pathname !== target.pathname) return null;
		if (target.pathname === '/search') return 'search';
		if (target.pathname === '/library') return 'library';
		return null;
	} catch {
		return null;
	}
}
