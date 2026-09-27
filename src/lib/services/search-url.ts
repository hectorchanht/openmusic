// quick-260927-dh5: the search page's mount-time decision for a `/search?q=<term>` link — run the
// URL query, restore the in-memory searchSession, or do nothing. PURE (no runes, no $app) so the
// node Vitest project covers it; the page passes `location.search` + the searchSession singleton.

// quick-260927-dh5: `?q=` is untrusted link input that flows into searchAll's upstream fan-out.
// The page's text bindings already escape it; this cap only bounds the upstream query size.
export const MAX_URL_QUERY = 200;

export type InitialSearch = { action: 'run'; q: string } | { action: 'restore' } | { action: 'none' };

export function initialSearch(
	search: string,
	prior: { hasPrior: boolean; q: string }
): InitialSearch {
	const raw = new URLSearchParams(search).get('q') ?? '';
	// Spread-then-slice so the cap counts code points and never splits a surrogate pair (emoji).
	const q = [...raw.trim()].slice(0, MAX_URL_QUERY).join('');
	if (q) {
		// quick-260927-dh5: the same query as the prior session RESTORES instead of refetching, so a
		// back-navigation to the same link keeps the instant restore + scroll.
		if (prior.hasPrior && q === prior.q.trim()) return { action: 'restore' };
		return { action: 'run', q };
	}
	// A blank ?q= (e.g. `?q=%20`) is the same as no ?q= at all.
	return prior.hasPrior ? { action: 'restore' } : { action: 'none' };
}
