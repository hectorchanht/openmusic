// Aggregation layer (Phase 1, DATA-03 + DATA-04). Ports the monolith's
// `searchAllSources` (legacy/index.html:2216-2263), `getInterleavedSearchList`
// (1691-1707) and `ensureTrackDetails` (2506-2513) — generalized to the registry so
// NO source is ever named here. All DOM/render calls (dom.searchStatus,
// renderMiniSearchList, playFromList) are dropped — those are Phase 4.
import { SOURCES, getEnabledAdapters } from '$lib/sources/registry';
import type { SourceId, Track, SettledSourceResult } from '$lib/sources/types';
import type { DefaultQuality } from '$lib/stores/settings.svelte';
import { sleep } from '$lib/proxy/http';
import { cached, __clearSearchCache } from './ttl-cache';
import { matchKey } from './match-key';
import { scoreMatch } from './score-match';

/**
 * quick-260629-nyl Task 3: sources that genuinely have NO upstream lyrics. A lyric MISS on one of
 * these is expected (not the regression), so the cross-source lyric fallback must NOT fire for them
 * (neither as the track to backfill nor as a fallback candidate). The CN/JOOX sources DO carry lyrics.
 */
const LYRICLESS_SOURCES = new Set<SourceId>(['jamendo', 'audius', 'fivesing']);

// Re-exported so tests (and any future cache-busting caller) can reset the search
// cache between cases — the 3 existing fan-out spy tests rely on this in afterEach.
export { __clearSearchCache };

/**
 * GAPLESS-PREFETCH: inter-source stagger (ms). The concurrent fan-out used to hit every proxy in
 * the exact same instant — a burst that triggers rate-limits / transient 5xx on the slower sources.
 * Adapter at index N now starts ~`SEARCH_STAGGER_MS * N` after the first (adapter 0 fires
 * immediately). This is a STAGGERED START, not serialization: once launched the searches still
 * overlap, so total added latency for K sources is only ~`SEARCH_STAGGER_MS * (K-1)` (a few hundred
 * ms for the typical enabled count) and partial results keep streaming in via onPartial as each
 * source lands — first-search feel is preserved. A small single value in the 150-300ms band.
 */
export const SEARCH_STAGGER_MS = 200;

export interface SearchResult {
	/** Per-source outcome (DATA-03): one failure is isolated, not fatal. */
	perSource: SettledSourceResult[];
	/** Deduped (by colon uid), round-robin-interleaved in registry order. */
	interleaved: Track[];
}

/**
 * D-06 progressive snapshot — emitted via the optional `onPartial` callback as each
 * source settles. Shapes match `SearchResult` plus a `pending` countdown.
 */
export interface PartialSearchResult {
	/** Sources that have settled SO FAR this call (ok or error). */
	perSource: SettledSourceResult[];
	/** uid-deduped + round-robin interleave over ALL sources settled so far. */
	interleaved: Track[];
	/** Number of adapters still pending (0 on the final emit). */
	pending: number;
}

/**
 * D-04 search-result TTL (ms). Search/discovery metadata changes infrequently, so an
 * hour of memoization gives instant repeat responses + drops cold-fetch load to ~0
 * within the typical browsing session. This caches the SearchResult METADATA only —
 * never resolved (short-lived) audio URLs, which stay un-cached in `ensureTrackDetails`.
 * lry-followup: bumped 5min → 60min. A music catalogue's search ranking is stable for
 * hours, and the page already exposes a fresh load via the search button.
 */
const SEARCH_TTL_MS = 60 * 60 * 1000;

/**
 * Fan out a search across all enabled sources with per-source isolation, memoized at
 * the catalog seam (D-04). Every search/discovery-resolution path funnels through here
 * (`resolveStub`, `buildDiversePicks`, `buildSimilarQueue`, the search page), so the
 * single TTL wrap covers them all.
 *
 * Cache key = `${normQuery}|${enabledSources}|${page}` — it INCLUDES `page` so each
 * cumulative-superset page caches independently (D-04 Pitfall 3: a page-less key would
 * serve the wrong superset). The raw `keyword` (not the normalized key) is passed to
 * the adapters, so upstream calls are unchanged. Normalization (trim + lowercase) is
 * for the cache key ONLY, so "Jay" and "jay " share an entry. The cached value is the
 * resolved SearchResult; a HIT returns instantly (nothing in flight to abort, so the
 * AbortSignal is moot on a hit; a MISS still honors `signal`).
 *
 * D-06: the optional trailing `onPartial` callback streams progressive snapshots as each
 * source settles. Omitting it = byte-for-byte today's behavior (final SearchResult only).
 * On a cache HIT, `onPartial` (if passed) fires ONCE with the full set and `pending: 0`
 * so the page's streaming handler has one uniform code path.
 */
export async function searchAll(
	keyword: string,
	page = 1,
	prefs: Partial<Record<SourceId, boolean>> = {},
	signal?: AbortSignal,
	onPartial?: (partial: PartialSearchResult) => void
): Promise<SearchResult> {
	const enabledKey = getEnabledAdapters(prefs)
		.map((a) => a.id)
		.join(',');
	const key = `${keyword.trim().toLowerCase()}|${enabledKey}|${page}`;

	// On a MISS, thread onPartial through so partials stream during the cold fetch.
	// On a HIT, `cached` returns the resolved value WITHOUT invoking the factory, so we
	// fire onPartial once below with the full cached set (pending:0) for a uniform path.
	let wasMiss = false;
	const result = await cached(key, SEARCH_TTL_MS, () => {
		wasMiss = true;
		return searchAllUncached(keyword, page, prefs, signal, onPartial);
	});

	if (onPartial && !wasMiss && !signal?.aborted) {
		onPartial({ perSource: result.perSource, interleaved: result.interleaved, pending: 0 });
	}
	return result;
}

/**
 * The actual fan-out (un-memoized). Split out of `searchAll` so the exported function
 * is purely the D-04 cache wrapper.
 *
 * D-06: replaces the single `Promise.allSettled` with per-adapter `.then/.catch/.finally`
 * that each push into a running accumulator and re-interleave over the WHOLE accumulated
 * set, emitting via `onPartial` as each source lands. Because every promise is
 * `.catch`-guarded, `Promise.all` never rejects — preserving the DATA-03 "one failure
 * isolated" contract that `allSettled` gave. The `if (sig.aborted) return` guard inside
 * `.finally` suppresses partials after a new query aborts this call. The final return
 * shape is unchanged (`acc` ends holding all sources; `interleave` is registry-ordered by
 * source-id regardless of settle order, so membership + interleaved output match the old
 * behavior — verified against the existing fan-out tests).
 */
async function searchAllUncached(
	keyword: string,
	page = 1,
	prefs: Partial<Record<SourceId, boolean>> = {},
	signal?: AbortSignal,
	onPartial?: (partial: PartialSearchResult) => void
): Promise<SearchResult> {
	const adapters = getEnabledAdapters(prefs);
	const sig = signal ?? new AbortController().signal;

	const acc: SettledSourceResult[] = []; // grows as sources settle
	let pending = adapters.length;

	await Promise.all(
		adapters.map((a, idx) =>
			// Staggered START (GAPLESS-PREFETCH): wait ~SEARCH_STAGGER_MS * idx before launching
			// adapter idx so the proxies are not all hit in the same instant. `sleep` is the shared
			// native-Promise delay (no hand-rolled AbortController). After the sleep we re-check
			// `sig.aborted`: a query superseded DURING the stagger window must not keep launching
			// later searches — we skip the `.search()` call entirely and just settle the accounting
			// (decrement `pending`; the abort guard below suppresses the partial), so a superseded
			// query stops firing new requests while `pending` still reaches 0.
			sleep(SEARCH_STAGGER_MS * idx)
				.then(() => {
					if (sig.aborted) return; // aborted mid-stagger — do NOT launch this adapter
					return a.search(keyword, page, sig).then((tracks) => {
						acc.push({ source: a.id, status: 'ok', tracks });
					});
				})
				.catch((reason) => {
					acc.push({
						source: a.id,
						status: 'error',
						tracks: [],
						error: reason instanceof Error ? reason.message : String(reason)
					});
				})
				.finally(() => {
					pending--;
					if (sig.aborted) return; // ABORT GUARD — drop partials for a superseded query
					onPartial?.({ perSource: [...acc], interleaved: interleave(acc), pending });
				})
		)
	);

	return { perSource: acc, interleaved: interleave(acc) };
}

/**
 * Round-robin merge in registry order with uid dedupe. Generalized from the
 * monolith's hard-coded `order = ['netease','qq','kuwo','joox']` (legacy 1691) to
 * `Object.keys(SOURCES)` so a new source needs no edit here (DATA-04).
 */
function interleave(perSource: SettledSourceResult[]): Track[] {
	const order = Object.keys(SOURCES) as SourceId[];
	const queues = new Map<SourceId, Track[]>();
	for (const r of perSource) queues.set(r.source, [...r.tracks]);

	const seen = new Map<string, Track>(); // dedupe by colon uid (legacy trackMap, 1657)
	const out: Track[] = [];
	let progressed = true;
	while (progressed) {
		progressed = false;
		for (const sid of order) {
			const queue = queues.get(sid);
			if (!queue || queue.length === 0) continue;
			const track = queue.shift() as Track;
			progressed = true;
			if (seen.has(track.uid)) continue;
			seen.set(track.uid, track);
			out.push(track);
		}
	}
	return out;
}

/**
 * Lazily resolve a track's audioUrl + lyrics through its source adapter.
 *
 * Dispatches via `SOURCES[track.source]` (registry, no source named — DATA-04) and
 * preserves the monolith readiness guard VERBATIM (legacy 2507): a track that is
 * loaded, has an audioUrl, and either has lyrics or never had an `lrcUrl` is
 * already complete. Netease resolves `lrc` from a separate `lrcUrl`, so a track
 * with an unresolved `lrcUrl` still re-resolves.
 */
export async function ensureTrackDetails(
	track: Track,
	signal?: AbortSignal,
	quality?: DefaultQuality
): Promise<Track> {
	if (track.detailsLoaded && track.audioUrl && (track.lrc || !track.lrcUrl)) {
		return track;
	}
	const sig = signal ?? new AbortController().signal;
	// WR-07: `quality` threads an explicit per-call tier to the adapter (download path passes
	// settings.downloadQuality) so download resolves never mutate the global streaming default.
	const resolved = await SOURCES[track.source].resolve(track, sig, quality);

	// quick-260629-nyl Task 3: bounded cross-source lyric fallback. The readiness guard treats a
	// track with no lrcUrl and no lrc as "complete with no lyrics" and never re-resolves it, so a
	// single-source lyric miss surfaces "No lyrics" even when another source HAS the lyrics for the
	// same song. When the primary resolved to a PLAYABLE track that STILL has no lrc — and it is a
	// source that SHOULD have lyrics — do ONE cross-source lyric lookup and copy ONLY the lrc across.
	//
	// PLACEMENT (chosen over widening player.fillLyricsOffline): this is the ONE seam every caller
	// (play/prefetch/related) funnels through, so the fix is universal and lives with the readiness
	// guard it complements. The netease/qq extractor fix above makes a genuine miss RARE, so the added
	// latency only ever applies to the uncommon no-lrc case; it is strictly bounded (a single fallback
	// candidate resolve, AbortSignal-threaded, never-throw) and never overwrites the primary audioUrl.
	if (
		resolved.audioUrl &&
		!resolved.lrc &&
		!LYRICLESS_SOURCES.has(resolved.source) &&
		!sig.aborted
	) {
		const lrc = await crossSourceLyric(resolved, sig);
		if (lrc && !sig.aborted) {
			resolved.lrc = lrc;
		}
	}
	return resolved;
}

/**
 * quick-260629-nyl Task 3: best-effort cross-source lyric lookup for a track that resolved with no
 * lrc. Re-uses the EXISTING TTL-cached searchAll seam (cheap on a warm cache) + the existing
 * matchKey/scoreMatch helpers (no hand-rolled matching) to find the best-matching candidate from a
 * DIFFERENT, lyric-capable source, resolves AT MOST ONE such candidate, and returns its lrc (or null).
 * Strictly bounded + AbortSignal-honoring + never-throws (returns null on any failure).
 */
async function crossSourceLyric(track: Track, signal: AbortSignal): Promise<string | null> {
	try {
		const query = { artist: track.artist || '', title: track.title || '' };
		if (!query.artist && !query.title) return null;
		const sr = await searchAll(`${query.artist} ${query.title}`.trim(), 1, {}, signal);
		if (signal.aborted) return null;

		const wantKey = matchKey(query.artist, query.title);
		// Candidates from a DIFFERENT, lyric-capable source whose normalized identity matches the song.
		const candidates = sr.interleaved
			.filter(
				(c) =>
					c.source !== track.source &&
					!LYRICLESS_SOURCES.has(c.source) &&
					matchKey(c.artist || '', c.title || '') === wantKey
			)
			.sort((a, b) => scoreMatch(query, b) - scoreMatch(query, a));

		const best = candidates[0];
		if (!best) return null;

		// Resolve AT MOST ONE fallback candidate (the bound). If it already carries an inline lrc
		// (qq/kuwo return it in the detail body) use it without a second fetch.
		if (best.lrc && best.lrc.trim()) return best.lrc;
		const resolvedCand = await SOURCES[best.source].resolve(best, signal);
		if (signal.aborted) return null;
		return resolvedCand.lrc && resolvedCand.lrc.trim() ? resolvedCand.lrc : null;
	} catch {
		// Best-effort — any failure (abort, source throw, drift) leaves the primary track lyric-less.
		return null;
	}
}
