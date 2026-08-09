// Aggregation layer (Phase 1, DATA-03 + DATA-04). Ports the monolith's
// `searchAllSources` (legacy/index.html:2216-2263), `getInterleavedSearchList`
// (1691-1707) and `ensureTrackDetails` (2506-2513) — generalized to the registry so
// NO source is ever named here. All DOM/render calls (dom.searchStatus,
// renderMiniSearchList, playFromList) are dropped — those are Phase 4.
import { SOURCES, getEnabledAdapters } from '$lib/sources/registry';
import { makeUid, type SourceId, type Track, type SettledSourceResult } from '$lib/sources/types';
import type { DefaultQuality } from '$lib/stores/settings.svelte';
import { sleep } from '$lib/proxy/http';
import { cached, __clearSearchCache } from './ttl-cache';
import { matchKey } from './match-key';
import { scoreMatch } from './score-match';
import { dedupeBest, sameSongKey } from './dedupe';
import { readResolveCache } from './resolve-cache-client';

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
 * Per-source prefs that restrict a `searchAll` to a SINGLE source id (RESOLVE-02). Mirrors
 * fallback.ts's `onlySource` — deliberately DUPLICATED here (not imported) to avoid a
 * catalog↔fallback import cycle (fallback.ts imports searchAll/ensureTrackDetails FROM here). Every
 * registered source is explicitly set false so none falls through `getEnabledAdapters` to "enabled";
 * only `id` is flipped true, so the resolve/lyric walk fans out to exactly ONE source per step,
 * never all 7 (D-08 isolation).
 */
function onlySource(id: SourceId): Partial<Record<SourceId, boolean>> {
	const out: Partial<Record<SourceId, boolean>> = {};
	for (const sourceId of Object.keys(SOURCES) as SourceId[]) out[sourceId] = false;
	out[id] = true;
	return out;
}

/**
 * RESOLVE-02 (POLICY.md / spikes 001+002+004): resolve a sourceless name-only stub (`{artist,title}`
 * — the shape Plan 26-03's Last.fm `track.getSimilar` Up-Next emits) to a playable Track by walking
 * the kuwo-FIRST source order ONE source at a time. For each source: a SINGLE-source `searchAll`
 * (`onlySource` prefs — never an all-enabled fan-out), `dedupeBest` the results, adopt only a
 * candidate that is the SAME song via `sameSongKey` (WR-06 — a fuzzy upstream search can return a
 * different track), `ensureTrackDetails` it, and return the FIRST that yields a truthy `audioUrl`.
 * Never-throws (per-source failures are swallowed), AbortSignal-honoring (bails after every await),
 * and stops at the first playable hit — so ~all plays resolve in ONE kuwo call (the ~59→~3 floor).
 */
export async function resolveNameStub(
	artist: string,
	title: string,
	signal?: AbortSignal,
	avail?: Record<string, 'ok' | 'dry'>
): Promise<Track | null> {
	const query = `${artist} ${title}`.trim();
	if (!query) return null;
	const sig = signal ?? new AbortController().signal;
	// kuwo-first order inherited from the registry (RESOLVE-01 reorder) — no source named here.
	// Plan 27-04 (YT-RESILIENCE-01): exclude sources flagged off the auto-resolve floor
	// (autoResolveEligible === false → ytmusic) so an Up-Next name stub NEVER auto-resolves to a
	// searchable-but-off-the-hot-path source. Registry-flag-driven — no source named here either.
	const eligible = getEnabledAdapters({})
		.map((a) => a.id)
		.filter((id) => SOURCES[id].autoResolveEligible !== false);
	// 31-D-06(c): the edge entry remembers which sources came up DRY for this song. Searching a
	// known-dry source is a wasted call, and skipping it is the entire point of caching the
	// availability hint. Applied ONLY when at least one source survives — an all-dry (or stale)
	// hint must degrade to the full walk, never to an empty one that resolves nothing.
	const kept = avail ? eligible.filter((id) => avail[id] !== 'dry') : eligible;
	const order = kept.length ? kept : eligible;
	// A minimal comparison target for sameSongKey (reads title+artist only). Fully typed, no cast.
	const want: Track = {
		uid: '',
		source: order[0] ?? 'kuwo',
		songid: '',
		title,
		artist,
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: query,
		displayIndex: 1
	};
	for (const src of order) {
		if (sig.aborted) return null;
		try {
			const result = await searchAll(query, 1, onlySource(src), sig);
			if (sig.aborted) return null;
			const candidates = dedupeBest(result.interleaved, src);
			const stub = candidates.find((c) => sameSongKey(c, want));
			if (!stub) continue;
			const resolved = await ensureTrackDetails(stub, sig);
			if (sig.aborted) return null;
			if (resolved.audioUrl) return resolved;
		} catch {
			/* this source dry / threw — walk on to the next (never-throw) */
		}
	}
	return null;
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

	// ─── 31-D-08 CACHE-FIRST READ ────────────────────────────────────────────────────────────────
	// This is the ONE seam every resolve caller (play, prefetch, warmAfter, download, fallback)
	// funnels through, so one read here makes every one of them cache-aware. It costs each COLD
	// resolve one governed own-origin GET — 31-D-05 explicitly accepts spending an extra call to
	// make a play feel instant — bounded at 400ms inside the client, deduped + concurrency-capped by
	// the apiFetch governor, and skipped entirely by the readiness guard above for a resolved track.
	// NO second throttle is added here: composing local bounds is the named `api-fetch-flood-freeze`
	// root cause.
	//
	// The cache is ADVISORY (31-D-08): readResolveCache maps a miss, a 404, a 500, malformed JSON,
	// an abort, its own timeout and an open circuit breaker ALL to null, so every one of those
	// leaves the pre-existing path below byte-identical and the user sees nothing.
	//
	// LYRIC RE-RESOLVE BYPASS (31-D-08): a track marked `lrcUnresolved` already HAS a url this cache
	// (or an offline blob) supplied and is being re-resolved for the one thing the entry does not
	// store — lyrics. Reading the cache again would hand back the same lrc-less url and the pane would
	// stay empty, so skip straight to the source walk (+ crossSourceLyric) below.
	const cachedEntry =
		track.lrcUnresolved && !track.lrc
			? null
			: await readResolveCache(track.artist, track.title, sig);
	if (sig.aborted) return track; // C-09: re-check after EVERY await — a newer play superseded us
	if (cachedEntry?.url) {
		if (track.resolveByName && !track.detailsLoaded) {
			// The big win: a name-only stub skips the whole search+resolve walk for ONE round-trip.
			// Lyrics are deliberately not cached — a stub resolved this way plays instantly and the
			// lyric pane fills from the player's own offline/lyric path.
			const source = (cachedEntry.source ?? '') as SourceId;
			const songid = cachedEntry.songid ?? '';
			if (songid && SOURCES[source]) {
				return {
					...track,
					source,
					songid,
					uid: makeUid(source, songid),
					audioUrl: cachedEntry.url,
					detailsLoaded: true,
					// 31-D-08: url only, no lyrics — mark it so the player back-fills the pane off the
					// critical path. A cache HIT must never render worse than a MISS.
					lrcUnresolved: true
				};
			}
		} else if (cachedEntry.source === track.source && cachedEntry.songid === track.songid) {
			// The source+songid equality check is LOAD-BEARING (T-31-04-01): the entry is keyed on
			// normalized artist+title, so a cached hit can legitimately belong to a DIFFERENT version
			// of the same song. Adopting it for a mismatched songid would silently play something
			// other than the version the user picked in the VersionPicker.
			// `lrcUnresolved` for the same reason as the name-stub branch above (31-D-08): the entry
			// carries a url and no lrc, and the readiness guard would otherwise call this track complete.
			return { ...track, audioUrl: cachedEntry.url, detailsLoaded: true, lrcUnresolved: true };
		}
	}
	// Any other outcome (null, no url, a stored known-none, a mismatched identity) falls straight
	// through with no side effect — the `named ?? track` fall-through shape already in this function.
	// There is deliberately NO client-side cache WRITE: the edge fills its own entry out of band
	// (31-03), because a client-supplied URL write would let one crafted request change what every
	// other user in the PoP plays.
	// ─────────────────────────────────────────────────────────────────────────────────────────────

	// RESOLVE-02: a lazy name-only stub (Plan 26-03's Up-Next) carries the `resolveByName` marker and
	// no real source/songid. Resolve it kuwo-first through ONE source at a time via resolveNameStub —
	// NEVER dispatch SOURCES[placeholder].resolve on it. On a null return (every source missed or the
	// signal aborted) fall through by returning the unresolved stub: the caller (player.play) treats
	// an audioUrl-less result as a failed resolve and routes to its existing error/fallback path
	// (never-throw). A normal source-bearing, detailsLoaded track skips this branch unchanged.
	if (track.resolveByName && !track.detailsLoaded) {
		// 31-D-06(c): thread the cached availability hints so the walk can skip a known-dry source.
		const named = await resolveNameStub(track.artist, track.title, sig, cachedEntry?.avail);
		return named ?? track;
	}

	// WR-07: `quality` threads an explicit per-call tier to the adapter (download path passes
	// settings.downloadQuality) so download resolves never mutate the global streaming default.
	const resolved = await SOURCES[track.source].resolve(track, sig, quality);

	// quick-260629-nyl Task 3: bounded cross-source lyric fallback. The readiness guard treats a
	// track with no lrcUrl and no lrc as "complete with no lyrics" and never re-resolves it, so a
	// single-source lyric miss surfaces "No lyrics" even when another source HAS the lyrics for the
	// same song. When the primary resolved to a PLAYABLE track that STILL has no lrc — and it is a
	// source that SHOULD have lyrics — do ONE cross-source lyric lookup and copy ONLY the lrc across.
	//
	// PLACEMENT (chosen over widening player.backfillLyrics): this is the ONE seam every caller
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
 * quick-260629-nyl Task 3 + RESOLVE-02: best-effort cross-source lyric lookup for a track that
 * resolved with no lrc. Reworked from a single all-enabled `searchAll` fan-out to a SINGLE-SOURCE
 * kuwo-first WALK (POLICY.md): step through `getEnabledAdapters({})` order, SKIP the track's own
 * source (already resolved lyric-less) and every `LYRICLESS_SOURCES` (no upstream lyrics), and for
 * each remaining source issue ONE single-source `searchAll` (`onlySource` prefs — never all 7). Per
 * step, pick the best name-matching candidate (`matchKey` identity + `scoreMatch` ranking, no
 * hand-rolled matching), use its inline lrc or resolve AT MOST that ONE candidate, and STOP at the
 * first source that yields an lrc. Strictly bounded (one resolved candidate per step), single-source
 * (never a fan-out), AbortSignal-honoring, and never-throws (returns null on any failure).
 */
async function crossSourceLyric(track: Track, signal: AbortSignal): Promise<string | null> {
	try {
		const artist = track.artist || '';
		const title = track.title || '';
		if (!artist && !title) return null;
		const query = `${artist} ${title}`.trim();
		const wantKey = matchKey(artist, title);
		const q = { artist, title };
		// kuwo-first order inherited from the registry (RESOLVE-01) — one lyric-capable source per step.
		const order = getEnabledAdapters({}).map((a) => a.id);
		for (const src of order) {
			if (signal.aborted) return null;
			if (src === track.source || LYRICLESS_SOURCES.has(src)) continue;
			try {
				const sr = await searchAll(query, 1, onlySource(src), signal);
				if (signal.aborted) return null;
				const best = sr.interleaved
					.filter((c) => matchKey(c.artist || '', c.title || '') === wantKey)
					.sort((a, b) => scoreMatch(q, b) - scoreMatch(q, a))[0];
				if (!best) continue;
				// Use an inline lrc (qq/kuwo return it in the detail body) or resolve this ONE candidate.
				if (best.lrc && best.lrc.trim()) return best.lrc;
				const resolvedCand = await SOURCES[best.source].resolve(best, signal);
				if (signal.aborted) return null;
				if (resolvedCand.lrc && resolvedCand.lrc.trim()) return resolvedCand.lrc;
				// resolved but still lyric-less — advance to the next lyric-capable source (bounded walk).
			} catch {
				/* this source dry / threw — try the next source's single search */
			}
		}
		return null;
	} catch {
		// Best-effort — any failure (abort, source throw, drift) leaves the primary track lyric-less.
		return null;
	}
}
