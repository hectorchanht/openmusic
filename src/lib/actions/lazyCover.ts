import type { Action } from 'svelte/action';
import type { Track } from '$lib/sources/types';
import {
	getCachedCoverByUid,
	getCachedCover,
	coverAgeByUidOrName
} from '$lib/services/cover-cache';
import { resolveCoverForTrack } from '$lib/services/cover-backfill';
import { removeCoverBoth, bumpCoverVersion } from '$lib/stores/cover-version.svelte';
import { hasHttpsScheme } from '$lib/services/url-safety';

// use:lazyCover — resolve a track-row cover ONLY when the row scrolls into view (COVER-02).
//
// WHY (Phase 21): a search / list surface renders dozens of rows; eagerly resolving every cover
// would fan out a network storm and refetch the same song on every re-render. This action defers
// the resolve to first intersection, reads the two-layer cache first (uid → name, D-13), repairs a
// broken existing cover via an Image() probe (D-15), and reuses the SHARED single-item tier chain
// (resolveCoverForTrack — Deezer→iTunes→CN, never a new resolver). It fires AT MOST ONCE per row
// (unobserve-after-first + one-shot done flag), de-dupes concurrent resolves for the same uid via a
// module-level in-flight Set (Pitfall 5), and disconnects the observer on destroy (T-21-05 DoS).
//
// EMPTY-UID STUB ROWS (charts-tags-same-cover fix): discovery surfaces (charts/tags/{tag},
// charts/countries/{country}) feed synthetic stub Tracks whose uid is ''. The uid cache layer is a
// SHARED flat record keyed by `'uid:' + uid`, so an empty uid collapses every distinct row onto the
// single `'uid:'` slot — the first resolved row's cover then reads back for ALL rows (the "same
// cover for every song" bug). The two guards below make an empty uid skip the uid layer entirely
// (read AND in-flight de-dupe), falling back to the {artist,title} name layer / a per-name de-dupe
// key so each distinct song resolves and caches under its own identity. resolveCoverForTrack applies
// the matching write-side guard (it does not write the uid layer for an empty uid).
//
// SECURITY (T-0bb-01): only the SOLID https URLs the cache/chain already gate ever reach onResolved;
// the resolved string is consumed by the caller as an `<img src>` ATTRIBUTE (never CSS url()).
//
// The action mirrors longpress.ts: a classic Action<HTMLElement, Param> closure that returns
// { destroy }. It is browser-only — the IntersectionObserver + Image() are guarded for SSR.

export interface LazyCoverParam {
	track: Track;
	/** Called with (uid, url) when a SOLID cover is available (cache hit, good existing cover, or resolved). */
	onResolved: (uid: string, url: string) => void;
	/**
	 * Default true. `false` = the action observes nothing and resolves nothing — the row keeps
	 * whatever cover its host already knows. This is the OPT-OUT for a surface where a per-row
	 * chain is forbidden or pointless: the album tracklist (every row legitimately shares the one
	 * album cover, so N per-row chains would buy nothing) and, should they ever consume a shared
	 * row, the Up-Next / Related panes, where per-row chains WERE the observed /api/deezer/search
	 * flood (T-26-10-01) and are replaced by one capped backfillCovers pool.
	 *
	 * Read ONCE at mount (an opt-out is a per-surface constant, not a runtime toggle) — flipping it
	 * later does not start observing a row that mounted disabled.
	 */
	enabled?: boolean;
}

// Module-level de-dupe: a uid currently resolving anywhere on the page is in this Set, so two
// observers for the same song (e.g. the row + a duplicate) run the chain only once (Pitfall 5).
const inFlight = new Set<string>();

// quick-260704-4fr (backlog #8): the "confirmed-fresh" window for skipping the cache-HIT probe. A
// browsing-session + same-day-revisit horizon — a cover URL written < 24h ago is overwhelmingly
// still live (CDN cover URLs expire on the order of days-to-weeks; the cover-cache's 14d TTL is the
// OUTER bound). Trusting a <24h entry paints it instantly with zero image load, while anything older
// (or of unknown age) still takes the probe self-heal. Deliberately far TIGHTER than the 14d TTL so
// the accepted trade-off (a cover dying WITHIN this window won't self-heal via lazyCover until it
// ages out) stays small and bounded.
const FRESH_MS = 24 * 60 * 60 * 1000; // 24h


/**
 * The in-flight de-dupe key for a row. A real song uses its stable uid; a synthetic stub row (uid
 * '') has no uid identity, so it de-dupes by its {artist,title} name instead — never by the empty
 * uid (which would collapse EVERY distinct stub row onto one slot, so only the first ever resolved).
 *
 * The name-layer composite uses `JSON.stringify([artist, title])` so two distinct field pairs can
 * never alias (the escaping keeps `["a","bc"]` ≠ `["ab","c"]`) — a git-text-safe replacement for the
 * prior literal NUL-byte separator, which made this file register as BINARY to git (no line
 * diffs/blame). Exported for a direct unit test of that distinctness invariant.
 */
export function inFlightKey(track: Track): string {
	return track.uid ? track.uid : `name:${JSON.stringify([track.artist, track.title])}`;
}

/**
 * Resolve a row's cover, never throwing. Read order (D-13): uid-first then name. On a cache HIT that
 * is CONFIRMED FRESH (write-time age < FRESH_MS), paint it immediately with ZERO probe (quick-260704-4fr).
 * Otherwise probe the cached url with new Image() — keep it on load (the fast path, zero network), but on
 * error EVICT both layers (removeCoverBoth) + bump and fall through to the chain so a stale dead-CDN
 * cover self-heals instead of being painted from localStorage forever (quick-260630-ey2). Else if the
 * track already carries a non-empty https cover, probe it — onload keeps it (no chain), onerror treats
 * it as broken and runs the chain (D-15). On empty / broken / cache-miss, run the shared single-item
 * resolve helper; a SOLID result fires onResolved (the helper already wrote both cache layers).
 *
 * An empty uid SKIPS the uid cache layer (the shared `'uid:'` slot is identity-less for a stub —
 * reading it would surface another row's cover) and reads only the {artist,title} name layer.
 * removeCoverBoth applies the matching empty-uid eviction guard (it evicts only the name layer).
 */
async function resolveCoverForRow(track: Track, onResolved: (uid: string, url: string) => void) {
	try {
		// (1) Cache-first — uid layer (only for a real uid), then the {artist,title} name layer (D-13).
		// An empty uid must NOT read the shared 'uid:' slot (charts-tags fix).
		//
		// CONFIRMED-FRESH FAST PATH (quick-260704-4fr, backlog #8): if the hitting entry's write-time
		// confirms it is fresh (age != null && age < FRESH_MS), PAINT IT IMMEDIATELY with ZERO new
		// Image() probe — a <24h cover URL is overwhelmingly still live. ONLY a confirmed-fresh
		// timestamp skips; a null age (miss / legacy bare-string / expired / unknown) OR age >= FRESH_MS
		// (older-but-valid) falls through to the UNCHANGED probe self-heal below.
		//
		// SELF-HEAL (quick-260630-ey2, preserved for every non-confirmed-fresh hit): the HIT is PROBED —
		// good keeps the zero-network fast path; a dead url evicts BOTH layers + bump and falls through
		// so the chain re-resolves a fresh cover.
		//
		// ACCEPTED TRADE-OFF (T-4fr-02): a fresh entry whose CDN url dies WITHIN the FRESH_MS window will
		// not self-heal via lazyCover until it ages past FRESH_MS — but player.healCover (now-playing)
		// and later visits still catch it. This is the intended cost of skipping the warm-row probe.
		const byUid = track.uid ? getCachedCoverByUid(track.uid) : null;
		const cached = byUid ?? getCachedCover(track.artist, track.title);
		if (hasHttpsScheme(cached)) {
			const age = coverAgeByUidOrName(track.uid, track.artist, track.title);
			if (age !== null && age < FRESH_MS) {
				onResolved(track.uid, cached); // confirmed-fresh → paint now, SKIP the probe (zero image)
				return;
			}
			const keep = await probeImage(cached);
			if (keep) {
				onResolved(track.uid, cached); // fast path preserved — healthy cache, zero network
				return;
			}
			// Dead cached url → evict BOTH layers + bump, then fall through to re-resolve (self-heal).
			removeCoverBoth(track.uid, track.artist, track.title);
		}

		// (2) An existing non-empty https cover → probe it; keep on load, repair on error (D-15).
		if (hasHttpsScheme(track.cover)) {
			const keep = await probeImage(track.cover);
			if (keep) {
				onResolved(track.uid, track.cover);
				return;
			}
			// onerror → fall through to the chain (broken-URL repair).
		}

		// (3) Empty / broken / cache-miss → run the shared tier chain (de-duped per uid, or per
		// {artist,title} name for an empty-uid stub so distinct rows are NOT collapsed to one key).
		const key = inFlightKey(track);
		if (inFlight.has(key)) return;
		inFlight.add(key);
		try {
			const url = await resolveCoverForTrack(track);
			// quick-260910-qwt — the missing WRITE-SIDE SIGNAL. resolveCoverForTrack wrote BOTH cache
			// layers already, but by LOCKED design it never bumps (it is a pure `.ts`, kept runes-free so
			// cover-backfill stays node-testable — see its doc comment): the bump is the CALLER's job, and
			// lazyCover is that caller for search / library / artist / CompactRow / charts. Without it a
			// cover resolved by one row was cached SILENTLY — no other mounted surface (home, Up Next,
			// Related, the now-playing hero) repainted until its next fresh render. The home page passes
			// its own `onResolved: () => bumpCoverVersion()`, so it now double-bumps: harmless, the two
			// collapse into ONE increment via the rAF latch (quick-260704-45c) — do NOT edit the home page.
			// Only this branch bumps: a cache HIT / a kept probe adds nothing new to the cache, and a null
			// result cached nothing at all.
			if (hasHttpsScheme(url)) {
				bumpCoverVersion();
				onResolved(track.uid, url);
			}
		} finally {
			inFlight.delete(key);
		}
	} catch {
		// Best-effort — a failure leaves the gradient (never a broken image, never throws).
	}
}

/**
 * Probe a cover URL with new Image(). Resolves true if it loads (keep it), false on error (treat as
 * broken → repair). SSR guard: when Image is undefined, resolve false so the chain repairs it via
 * the (also-guarded) network path. Never rejects.
 */
function probeImage(url: string): Promise<boolean> {
	if (typeof Image === 'undefined') return Promise.resolve(false);
	return new Promise<boolean>((resolve) => {
		try {
			const img = new Image();
			img.decoding = 'async';
			img.referrerPolicy = 'no-referrer';
			img.onload = () => resolve(true);
			img.onerror = () => resolve(false);
			img.src = url;
		} catch {
			resolve(false);
		}
	});
}

export const lazyCover: Action<HTMLElement, LazyCoverParam> = (node, param) => {
	let current = param;
	let done = false; // one-shot: a row resolves at most once

	// SSR / no-IO guard, and the explicit `enabled: false` opt-out — the action is a no-op (the
	// caller keeps whatever cover it has). Checked BEFORE the observer is built so a disabled row
	// costs no IntersectionObserver at all, not just no fetch.
	if (typeof IntersectionObserver === 'undefined' || param.enabled === false) {
		return {
			update(next: LazyCoverParam) {
				current = next;
			},
			destroy() {
				/* nothing observed — no-op */
			}
		};
	}

	const io = new IntersectionObserver(
		(entries) => {
			if (done) return;
			if (entries[0]?.isIntersecting) {
				done = true;
				io.unobserve(node); // fire at most once — stop observing after the first intersection
				void resolveCoverForRow(current.track, current.onResolved);
			}
		},
		// rootMargin 200px: prefetch slightly before the row is truly on-screen for a smoother scroll
		// (discretion — tighter than the search sentinel's 400px since covers are cheaper than a page).
		{ root: null, rootMargin: '200px 0px' }
	);
	io.observe(node);

	return {
		update(next: LazyCoverParam) {
			current = next;
		},
		destroy() {
			io.disconnect();
		}
	};
};
