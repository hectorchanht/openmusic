// quick-260919-2jo — the ONE read+write mechanism for a URL-addressable tab set (F2).
//
// The Library page already READ `?tab=` (D-13) but never wrote it back, so a tab switch was
// invisible in the address bar and unlinkable. Rather than complete that half in place and then
// re-inline the same three lines on the next tab set, the read, the write and the D-5 default
// rule live here once. Two call sites today: `/library` and `/artist/[name]/albums`.
//
// PURE .ts (no runes): `pickTab` / `tabHref` are total functions over a URL, node-testable with
// no DOM. `syncTabUrl` is the single impure line and is browser-guarded.
import { browser } from '$app/environment';

/**
 * Read a tab from the URL, VALIDATED against an explicit allowlist (T-2jo-01). An unknown,
 * empty, absent or tampered value falls back — it never reaches component state. This is the
 * Library page's own T-23-10 guarantee, now shared rather than re-inlined.
 *
 * Wrapped in try/catch: a caller handing us a malformed URL-like object degrades to the fallback
 * instead of throwing into the render tree.
 */
export function pickTab<T extends string>(
	url: URL,
	param: string,
	valid: ReadonlySet<string>,
	fallback: T
): T {
	try {
		const v = url.searchParams.get(param);
		return v && valid.has(v) ? (v as T) : fallback;
	} catch {
		return fallback;
	}
}

/**
 * The href `url` would have with `param` set to `value` — or with `param` DELETED when `value`
 * is the default (D-5: `?tab=liked` is noise on the canonical URL, so only a non-default tab is
 * written and switching back strips it). Every OTHER query param survives, which is what keeps
 * the Library's `?playlist=<id>` deep-link alive across a tab switch.
 *
 * Pure: operates on a COPY, so the caller's `page.url` is never mutated.
 */
export function tabHref(url: URL, param: string, value: string, defaultValue: string): string {
	const next = new URL(url.href);
	if (value === defaultValue) next.searchParams.delete(param);
	else next.searchParams.set(param, value);
	return next.href;
}

/**
 * Write the tab into the address bar. The only impure line in this module.
 *
 * RAW `history.replaceState`, deliberately NOT SvelteKit's shallow-routing replaceState/pushState
 * from $app/navigation — overlays.svelte.ts documents the reason at length: a shallow-routing
 * entry desyncs the router index and makes a later goto() a silent no-op. `replace` also adds no
 * history entry, so the overlay depth == history depth invariant NowPlaying relies on is
 * untouched, and Back still leaves the page instead of walking back through tab switches.
 *
 * quick-260926-hze: built from the LIVE address bar (`location.href`), not the caller's
 * `page.url`. The (app) layout's script-lock rewrite uses the same raw replaceState, so after it
 * `page.url` is still the PRE-rewrite URL; building from that would put the unlocked name back
 * on the first tab switch.
 *
 * Browser-guarded + try/catch: under SSR / the node test project this is a no-op, and a hostile
 * or rate-limited history API can never break a tab switch.
 */
export function syncTabUrl(param: string, value: string, defaultValue: string): void {
	if (!browser) return;
	try {
		history.replaceState(history.state, '', tabHref(new URL(location.href), param, value, defaultValue));
	} catch {
		/* history unavailable / throttled — the tab still switched, only the URL lagged */
	}
}
