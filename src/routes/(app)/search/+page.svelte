<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { searchAll } from '$lib/services/catalog';
	import { prewarmTrack } from '$lib/services/prewarm';
	import { dedupeBest, groupVariants } from '$lib/services/dedupe';
	import { dedupeBestWithDeezer } from '$lib/services/dedupe-deezer';
	import { scoreMatch } from '$lib/services/score-match';
	import { computeSetContext } from '$lib/services/score-context';
	import { lazyCover } from '$lib/actions/lazyCover';
	import { enrichArtist } from '$lib/services/lastfm';
	import { deezerArtistCover, deezerSearchTopN, type DeezerHit } from '$lib/services/deezer';
	import {
		deriveSuggestions,
		debounce,
		MIN_QUERY_LEN,
		SUGGEST_CAP,
		type Suggestion
	} from '$lib/search/autocomplete-logic';
	import { mapWithConcurrency } from '$lib/services/discovery';
	import { settings } from '$lib/stores/settings.svelte';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { searchSession } from '$lib/stores/searchSession.svelte';
	import { searchHistory } from '$lib/stores/searchHistory.svelte';
	import { online } from '$lib/stores/online.svelte';
	import { t } from '$lib/i18n';
	import { LoaderCircle, ListEnd, ListStart, Layers, X, Trash2, Search } from '@lucide/svelte';
	import { longpress } from '$lib/actions/longpress';
	import { swipeAction } from '$lib/actions/swipeAction';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { dragScroll } from '$lib/actions/dragScroll';
	import { toast } from '$lib/stores/toast.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import VersionPicker from '$lib/components/VersionPicker.svelte';
	import type { Track } from '$lib/sources/types';

	// UX-04 / D-03/D-04: swipe-right = add to queue (TrackMenu addQueue semantics — append to
	// end via player.addToQueue), swipe-left = play next (TrackMenu playNext() semantics — splice
	// after current via player.playNext). Both fire the global toast + a commit-tier haptic tick.
	// The reveal layer renders BEHIND the row and the row's translateX (driven by swipeAction)
	// slides to expose it; the row springs back on release.
	function swipeQueue(track: Track) {
		player.addToQueue(track);
		toast.show(t('toast.addedToQueue'));
		hapticTick();
	}
	function swipeNext(track: Track) {
		player.playNext(track);
		toast.show(t('toast.playingNext'));
		hapticTick();
	}

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);

	// VERSIONS-01: the version picker consumes the RETAINED pre-dedupe variants. `variantGroups`
	// maps EVERY variant uid → its same-song cross-source group (built from the interleaved
	// pre-dedupe set via groupVariants). A displayed (deduped) row's uid is a member of its own
	// group, so `variantGroups[row.uid]` yields the full source list for that song — no private
	// identity key needed here. Zero new API calls: the data is already in the search result set.
	let variantGroups = $state<Record<string, Track[]>>({});
	let pickerVersions = $state<Track[]>([]);
	let pickerOpen = $state(false);
	// aria-label for the trigger, resolved OUTSIDE the {#each results as t} block where `t` is the
	// loop's Track (shadowing the i18n `t()`); $derived so it re-resolves on appLang change.
	const verOpenLabel = $derived(t('versions.open'));

	// Build the uid → variant-group lookup from the interleaved pre-dedupe set. Pure/local.
	function buildVariantGroups(interleaved: Track[]): Record<string, Track[]> {
		const byUid: Record<string, Track[]> = {};
		for (const group of groupVariants(interleaved).values()) {
			for (const v of group) byUid[v.uid] = group;
		}
		return byUid;
	}

	let q = $state('');
	let queryInputEl = $state<HTMLInputElement | null>(null);
	let results = $state<Track[]>([]);
	// SRCH-02 / COVER-02: lazily-resolved covers keyed by track.uid. lazyCover fires onResolved
	// with a SOLID https URL (Plan 02 isSolidCover gate) when a row scrolls into view and its
	// cover is empty/broken; reassigning the object triggers a reactive repaint of that row's
	// .art background-image. The resolve helper never refetches (cache-first + in-flight dedupe).
	let resolvedCovers = $state<Record<string, string>>({});
	let loading = $state(false);
	let searched = $state(false);
	let ac: AbortController | null = null;

	// BUGFIX (search-skeleton-not-showing): the D-01 first-load and load-more skeletons
	// were gated directly on `loading`/`loadingMore`, which on a D-04 cache HIT (or any
	// fast settle) flip true→false within a single microtask — BEFORE the browser ever
	// paints a frame. `await searchAll(...)` resolves a cached value via Promise.resolve(),
	// whose continuation fires onPartial (overwriting `results`) in the NEXT MICROTASK; a
	// paint only happens on a macrotask/animation-frame boundary, so zero paints occurred
	// while the skeleton gate was true. The skeleton DOM was created and torn down inside a
	// single frame and was never visible (a genuinely slow cache-miss search DID show it).
	// Fix: hold a dedicated skeleton flag for a minimum on-screen DWELL so it always
	// survives ≥1 paint frame, then yields to results. A slow search already exceeds the
	// floor, so it gets ZERO added delay — D-06 progressive streaming + D-04 caching stay
	// intact; only a near-instant cache hit now flashes the skeleton for the floor.
	const SKELETON_MIN_MS = 280;
	let showFirstSkeleton = $state(false); // first-load skeleton visibility (dwell-floored)
	let showMoreSkeleton = $state(false); // load-more skeleton visibility (dwell-floored)

	// Resolve after the remainder of the dwell floor (0 if the floor already elapsed). A
	// near-instant cache hit gets the full floor; a slow search (elapsed ≥ floor) resolves
	// immediately and adds nothing. Called in run()/loadMore() finally blocks before the
	// skeleton flag is cleared.
	function minDwell(startedAt: number): Promise<void> {
		const remaining = SKELETON_MIN_MS - (Date.now() - startedAt);
		return remaining > 0 ? new Promise((r) => setTimeout(r, remaining)) : Promise.resolve();
	}

	// D-05: focus tracking for the past-search suggestion list (idle pre-query state).
	let inputFocused = $state(false);

	// ql0: typeahead suggestions (live Deezer song + artist suggestions under the bar). The
	// pure dedupe/cap/interleave + debounce primitive live in autocomplete-logic.ts; this
	// component owns the runes state, the AbortController, and the render. `suggestAc` is a
	// PAGE-LOCAL transient (never lifted into searchSession — same discipline as `ac`/`moreAc`).
	let suggestions = $state<Suggestion[]>([]);
	let suggestAc: AbortController | null = null;

	// Debounced suggestion fetch: at most one network call per ~300ms typing pause. A fresh
	// keystroke restarts the timer (in oninput) so only the trailing pause fetches. Inside, we
	// abort any in-flight request before issuing the next, then guard against a stale query
	// before committing results (mirrors the run()/loadMore() race guards).
	const fetchSuggestions = debounce((kw: string) => {
		suggestAc?.abort();
		suggestAc = new AbortController();
		const sig = suggestAc.signal;
		// deezerSearchTopN never throws (returns [] on abort/non-ok/malformed JSON), so no
		// try/catch is needed — a failure degrades silently to no suggestions.
		void deezerSearchTopN(kw, SUGGEST_CAP, sig).then((hits: DeezerHit[]) => {
			if (sig.aborted || kw !== q.trim()) return; // stale-query / aborted guard
			suggestions = deriveSuggestions(hits, kw);
		});
	}, 300);

	// oninput handler: clear + cancel when below the min length, else (re)schedule a fetch.
	function onSuggestInput() {
		const kw = q.trim();
		if (kw.length < MIN_QUERY_LEN) {
			fetchSuggestions.cancel();
			suggestAc?.abort();
			suggestions = [];
			// quick-260711-sm7: typing the input back to empty collapses the content area to the
			// recent-keywords idle state (clears any prior result set / "no results" message).
			if (kw.length === 0) resetResults();
			return;
		}
		fetchSuggestions(kw);
	}

	// Commit a suggestion: fill the input with its query text and run the full search.
	function pickSuggestion(s: Suggestion) {
		q = s.title; // both kinds fill the input with their `title` (song title / artist name)
		inputFocused = false;
		suggestions = [];
		fetchSuggestions.cancel();
		suggestAc?.abort();
		run();
	}

	// quick-260711-sm7: reset the content area back to the idle (pre-search) state without
	// touching the query string. Clears the result set + all its derived UI (variant groups,
	// artist tiles, pagination, "some failed" flag) so an emptied input renders ONLY the
	// recent-keywords list. Shared by clearSearch() (the X button) and onSuggestInput()
	// (typing back to empty).
	function resetResults() {
		results = [];
		lastPrewarmedUid = ''; // 31-D-03: a fresh query may pre-warm its own top row
		variantGroups = {};
		artistTiles = [];
		artistTilesFor = '';
		hasMore = false;
		page = 1;
		searched = false;
	}

	// quick-260711-sm7 (req 1+2): the clear (X) button empties the input and collapses content
	// to the recent-keywords state. Cancels the typeahead + any in-flight search/load-more,
	// resets the result set, and wipes the in-memory session (searchSession.reset) so a
	// tab-return does NOT restore the prior results (D-02). Keeps focus so the user can retype.
	function clearSearch() {
		q = '';
		fetchSuggestions.cancel();
		suggestAc?.abort();
		suggestions = [];
		ac?.abort();
		moreAc?.abort();
		resetResults();
		searchSession.reset();
		inputFocused = true;
		queryInputEl?.focus();
	}

	// quick-260711-sm7 (req 3): remove a single recent keyword, gated by a native confirm —
	// the app-wide destructive-action idiom (mirrors settings/data clearLibraryConfirm).
	function removeRecent(query: string) {
		if (confirm(t('search.confirmRemoveRecent', { q: query }))) {
			searchHistory.remove(query);
		}
	}

	// kyf + ljl-followup: artist tiles row above the song list. Every UNIQUE artist that
	// appears in the result set becomes a tile (no count threshold, no name-match filter, no
	// limit — the row is horizontally scrollable so all of them ride together). Sorted by how
	// often the artist appears in the results so the most-represented are first / above the
	// fold. Avatars resolve via LF-primary → Deezer-fallback (race-guarded on the active query).
	type ArtistTile = { name: string; image: string | null; trackCount: number };
	let artistTiles = $state<ArtistTile[]>([]);
	let artistTilesFor = '';

	function deriveArtistTiles(rows: Track[], query: string): ArtistTile[] {
		if (!query.trim() || rows.length === 0) return [];
		// Group by case-insensitive artist key; preserve the FIRST seen casing as the display
		// name (the case the source actually returned).
		const groups = new Map<string, { name: string; count: number; firstIdx: number }>();
		rows.forEach((row, idx) => {
			const display = (row.artist ?? '').trim();
			if (!display) return;
			const key = display.toLowerCase();
			const existing = groups.get(key);
			if (existing) existing.count++;
			else groups.set(key, { name: display, count: 1, firstIdx: idx });
		});
		// Sort: track count desc (most-represented first); tie-break on first-seen order so the
		// row mirrors the song-list relevance ranking when counts are equal.
		const sorted = [...groups.values()].sort((a, b) =>
			b.count - a.count || a.firstIdx - b.firstIdx
		);
		return sorted.map((g) => ({ name: g.name, image: null, trackCount: g.count }));
	}

	async function refreshArtistTiles(query: string, rows: Track[]) {
		const tiles = deriveArtistTiles(rows, query);
		const tag = query.trim().toLowerCase();
		artistTilesFor = tag;
		artistTiles = tiles; // immediate paint with name + gradient fallback (zero-network)
		if (!tiles.length) return;
		// Concurrency-capped LF-primary → Deezer-fallback (cap 6 — higher than kyf's 3 to keep
		// the longer tile list filling in promptly). Both helpers are ttl-cached client-side, so
		// repeat-query runs hit cache for free.
		const withCovers = await mapWithConcurrency(tiles, 6, async (tile) => {
			const lf = await enrichArtist(tile.name).catch(() => null);
			const img = lf?.lastfmArt ?? (await deezerArtistCover(tile.name).catch(() => null));
			return { ...tile, image: img };
		});
		if (artistTilesFor !== tag) return; // race guard — newer query took over
		artistTiles = withCovers;
	}

	function fallbackArtistCover(name: string): string {
		const h = (name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	// Infinite-scroll pagination state.
	let page = $state(1); // last page successfully loaded
	let loadingMore = $state(false); // true ONLY while a NEXT-page batch is in flight
	let hasMore = $state(false); // whether another batch might yield net-new tracks
	let moreAc: AbortController | null = null; // separate controller for load-more requests

	// Sentinel + observer (sentinel binding/observer creation live in the template/$effect).
	// ac/moreAc/io/sentinelEl are PAGE-LOCAL transients — never lifted into searchSession.
	let sentinelEl = $state<HTMLLIElement | null>(null);
	let io: IntersectionObserver | null = null;

	// D-02: persist the live result set into the in-memory session so a tab return
	// restores instantly. Called after run()/loadMore() settle (browser-side only).
	function persistSession() {
		searchSession.save({
			q: q.trim(),
			results,
			page,
			hasMore,
			searched,
			artistTiles,
			artistTilesFor
		});
	}

	function fallbackCover(t: Track): string {
		const h = (t.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	// SRCH-01 / D-01 + D-02: full score-based re-sort of the (already-deduped) result set.
	// Computes the per-set context ONCE (cross-source artist map + query length), then sorts a
	// COPY descending by scoreMatch. Per researcher Q2/A4, the raw trimmed keyword is fed into
	// BOTH the artist and title query slots: the similarity term degrades to token-overlap (still
	// useful) while the new short-title / artist-frequency boosts + the sub-60s 試聽 penalty are
	// the dominant search-list signals. scoreMatch is deterministic, so equal scores keep
	// dedupeBest's appearance order (the tie-break) — the sort is stable in practice.
	function rankList(rows: Track[], query: string): Track[] {
		const ctx = computeSetContext(rows, query);
		const qObj = { artist: query, title: query };
		return [...rows].sort((a, b) => scoreMatch(qObj, b, ctx) - scoreMatch(qObj, a, ctx));
	}

	// 31-D-03 PRE-WARM (trigger 1 of the phase's two; trigger 2 is TrackMenu open). Speculatively
	// resolve the TOP result of a SETTLED search, so the most-likely tap plays without a cold
	// resolve — the click-to-play win comes from resolving BEFORE the tap, not from failing over
	// sooner (31-D-01 leaves every timeout alone).
	//
	// FIRED IMPERATIVELY AT THE TERMINAL RANKING EVENT, NOT REACTIVELY (quick-260809-cyk). This was
	// an `$effect` reading `results[0]`; `results` is reassigned 4-8× per query — once per source
	// partial inside onPartial (:373), once on the authoritative settle (:378), and again when the
	// Deezer-boosted re-rank lands — and the IDENTITY of results[0] changes across them, so a uid
	// compare could not collapse them. MEASURED on the workerd preview build: 5 `/api/resolve`
	// calls for one search, 2 for another. Firing from the tail of the boost chain instead makes it
	// 1 — that chain is the last thing that can reassign `results` for a query, so the top row is
	// only known there. Gating on `!loading` does NOT work: the boost is fire-and-forget and lands
	// AFTER the `finally` clears `loading`.
	//
	// `lastPrewarmedUid` is PLAIN, not $state (the UI never reads it; the house idiom is TrackMenu's
	// versionGen). It is the per-query bound — reset in resetResults() and at the top of run() so a
	// genuinely new query gets its own single pre-warm — and the first of three composed-free bounds:
	// prewarmTrack's own uid Set is the second and apiFetch's in-flight GET dedupe is the third. NO
	// timer here — composing a fresh local bound with the governor is the documented root cause of
	// the api-fetch-flood-freeze class of bug.
	//
	// Deliberately gesture-only: nothing pre-warms on scroll. A viewport-observer trigger over the
	// visible rows is the exact traffic shape behind that freeze and is a deferred idea, not a
	// stretch goal — the two triggers above are the whole feature.
	let lastPrewarmedUid = '';

	async function run(e?: Event) {
		e?.preventDefault();
		const kw = q.trim();
		if (!kw) return;
		// OFFL-03 / D-10: SHORT-CIRCUIT when offline — never enter the loading state / fire
		// searchAll (which would hang on a dead network and strand a spinner). The inline offline
		// state renders instead (gated on !online.isOnline in the markup). No redirect (D-09).
		if (!online.isOnline) return;
		ac?.abort();
		moreAc?.abort(); // cancel any in-flight load-more from a previous query
		// ql0: committing a search closes the typeahead — cancel a pending debounced fetch,
		// abort any in-flight suggestion request, and clear the list.
		fetchSuggestions.cancel();
		suggestAc?.abort();
		suggestions = [];
		queryInputEl?.blur();
		ac = new AbortController();
		const myAc = ac; // capture for the onPartial stale-guard (survives a later ac swap)
		// D-05: record the user-intent query on submit (even a zero-result one, so a
		// typo'd query the user wants to retry is still listed). De-dupe/cap are in the store.
		searchHistory.add(kw);
		// D-02: a NEW query resets pagination AND clears the prior result set so the
		// D-01 first-load skeleton shows immediately.
		results = [];
		lastPrewarmedUid = ''; // 31-D-03: the new query's top row is a new pre-warm candidate
		variantGroups = {}; // VERSIONS-01: drop the prior query's variant groups too
		inputFocused = false;
		loading = true;
		// BUGFIX: raise the dwell-floored skeleton flag and stamp the start so the finally
		// block can guarantee a minimum visible window even on an instant cache hit.
		showFirstSkeleton = true;
		const startedAt = Date.now();
		searched = true;
		try {
			// D-06: stream partials so results render as each source settles. The first-load
			// skeleton (showFirstSkeleton) yields to results once the dwell floor elapses.
			// Two-layer abort guard (mirrors the loadMore race guard) drops a superseded
			// query's partials.
			const { interleaved } = await searchAll(kw, 1, {}, ac.signal, (partial) => {
				if (myAc.signal.aborted || kw !== q.trim()) return;
				// SRCH-01/D-02: re-sort by score INSIDE the race guard (Pitfall 3 — a superseded
				// partial returns above before ever reaching here).
				results = rankList(dedupeBest(partial.interleaved, settings.preferredSource), kw);
				// VERSIONS-01: retain the pre-dedupe variants alongside the displayed rows.
				variantGroups = buildVariantGroups(partial.interleaved);
			});
			// Final value is authoritative — re-derive from the complete superset, then re-sort.
			results = rankList(dedupeBest(interleaved, settings.preferredSource), kw);
			variantGroups = buildVariantGroups(interleaved); // VERSIONS-01
			// kyf: derive artist tiles from the settled result set (race-guarded inside).
			void refreshArtistTiles(kw, results);
			// Reset pagination: assume more may exist whenever page 1 returned anything;
			// loadMore() flips hasMore off once a page stops growing.
			page = 1;
			hasMore = results.length > 0;
			persistSession(); // D-02: store the fresh set (overwrites the prior session)
			// jip: Deezer-boosted re-rank AFTER first paint. Runs in background; the sync
			// `dedupeBest` result is already on-screen, this just swaps in better picks for
			// groups where >1 CN source returned the same song. Aborts on supersede.
			void dedupeBestWithDeezer(interleaved, settings.preferredSource, ac.signal)
				.then((boosted) => {
					if (myAc.signal.aborted || kw !== q.trim()) return;
					// SRCH-01/D-02: re-rank the Deezer-boosted set inside the supersede guard.
					results = rankList(boosted, kw);
					persistSession();
				})
				// The boost NEVER throws (dedupe-deezer.ts:87 — it returns the baseline on Deezer
				// miss / abort / no key), so this only fires on a defect in the handler above.
				// Swallowing it keeps the pre-warm below alive on the pre-boost ranking instead of
				// losing it: an abort/reject/miss must still leave the search pre-warmed exactly once.
				.catch(() => {})
				// TERMINAL RANKING EVENT (31-D-03, quick-260809-cyk): nothing can reassign `results`
				// for this query after this point, so this is the single place the settled top row is
				// known. Same supersede guard as above — a query the user has already replaced must
				// never pre-warm its stale top result.
				.then(() => {
					if (myAc.signal.aborted || kw !== q.trim()) return;
					const top = results[0];
					if (!top || top.uid === lastPrewarmedUid) return;
					lastPrewarmedUid = top.uid;
					prewarmTrack(top);
				});
		} catch (err) {
			// WR-01: a superseded query (AbortError) must NOT clobber state.
			if (err instanceof DOMException && err.name === 'AbortError') return;
			// Genuine failure: reset to the empty state (no results, no more pages).
			results = [];
			hasMore = false;
		} finally {
			loading = false;
			// BUGFIX: hold the skeleton for the remainder of the dwell floor, then clear —
			// but only if THIS query still owns the screen (a newer run() may have raised the
			// flag again; clearing it then would hide that newer query's skeleton).
			await minDwell(startedAt);
			if (myAc === ac) showFirstSkeleton = false;
		}
	}

	async function loadMore() {
		// Guards: no concurrent batch, no firing during initial search, past the end,
		// or before any search has run.
		if (loadingMore || loading || !hasMore || !searched) return;
		const kw = q.trim(); // capture BEFORE awaiting (race guard)
		if (!kw) return;
		loadingMore = true;
		// BUGFIX: dwell-floored load-more skeleton (same microtask-collapse fix as run()).
		showMoreSkeleton = true;
		const startedAt = Date.now();
		const next = page + 1;
		moreAc?.abort();
		moreAc = new AbortController();
		const myMoreAc = moreAc; // capture for the dwell ownership guard below
		try {
			const { interleaved } = await searchAll(kw, next, {}, moreAc.signal);
			// SRCH-01/D-02: re-sort the cumulative superset by score. rankList is pure; the
			// race guard below still prevents a superseded batch from assigning to `results`.
			const merged = rankList(dedupeBest(interleaved, settings.preferredSource), kw);
			// Race guard: user searched something else mid-fetch — bail without touching state.
			if (kw !== q.trim()) return;
			if (merged.length <= results.length) {
				// Sources exhausted: no net-new unique tracks.
				hasMore = false;
			} else {
				// REPLACE with the cumulative superset (never concatenate — see pagination_mechanism).
				results = merged;
				variantGroups = buildVariantGroups(interleaved); // VERSIONS-01: grow the variant groups too
				page = next;
				persistSession(); // D-02: keep the session fresh so a mid-scroll nav restores the larger set
			}
		} catch (err) {
			// AbortError = a newer request superseded this one: do nothing.
			if (err instanceof DOMException && err.name === 'AbortError') return;
			// Any other failure: stop hammering a failing source.
			hasMore = false;
		} finally {
			loadingMore = false;
			// BUGFIX: hold the load-more skeleton for the dwell floor, then clear if this
			// batch still owns the load-more slot (a superseding request swaps moreAc).
			await minDwell(startedAt);
			if (myMoreAc === moreAc) showMoreSkeleton = false;
		}
	}

	// D-02 + D-05: hydrate search history; restore a prior in-session search INSTANTLY
	// (no refetch) including scroll, after results paint.
	onMount(async () => {
		searchHistory.load();
		if (searchSession.hasPrior) {
			q = searchSession.q;
			results = searchSession.results;
			page = searchSession.page;
			hasMore = searchSession.hasMore;
			searched = searchSession.searched;
			// Restore artist tiles if cached for this query.
			artistTiles = searchSession.artistTiles;
			artistTilesFor = searchSession.artistTilesFor;

			// Restore scroll AFTER the {#each results} renders so the document has height
			// (the WINDOW scrolls — see the IO root:null below). Pitfall 6.
			await tick();
			window.scrollTo(0, searchSession.scrollY);
		}
		// RHX-01 / SRCH-03: mount-time-only focus on an EMPTY query so the mobile keyboard
		// rises. Evaluated AFTER the hasPrior restore above — a restored prior query makes `q`
		// non-empty so focus is not stolen (D-17). Lives in onMount (NOT a $effect keyed on
		// `q`) so clearing the input mid-session does NOT re-grab focus.
		// D-19: also set inputFocused = true so the recent-searches list opens on a fresh empty
		// visit even if the programmatic .focus() does not synchronously fire the onfocus
		// handler. iOS keyboard restriction accepted (D-18) — success = focused input (ring +
		// caret); no gesture-chained nav hack.
		if (!q.trim()) {
			queryInputEl?.focus();
			inputFocused = true;
		}
	});

	// D-02: on navigate-away, capture the live set + current scroll so a tab return restores it.
	onDestroy(() => {
		io?.disconnect();
		if (searched && typeof window !== 'undefined') {
			persistSession();
			searchSession.setScroll(window.scrollY);
		}
	});

	// Create / tear down the IntersectionObserver whenever the sentinel mounts or
	// changes. root:null = the viewport because the WINDOW scrolls (see reuse_note);
	// rootMargin prefetches the next batch slightly before the true bottom.
	$effect(() => {
		const el = sentinelEl;
		if (!el) return;
		io?.disconnect();
		io = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) loadMore();
			},
			{ root: null, rootMargin: '400px 0px' }
		);
		io.observe(el);
		return () => io?.disconnect();
	});
</script>

<header class="head"><h1>{t('search.title')}</h1></header>

<form class="bar" onsubmit={run}>
	<div class="input-wrap">
		<input
			bind:this={queryInputEl}
			bind:value={q}
			placeholder={t('search.placeholder')}
			autocomplete="off"
			autocapitalize="off"
			oninput={onSuggestInput}
			onfocus={() => (inputFocused = true)}
			onblur={() => {
				// Delay closing so a suggestion tap (mousedown→click) registers before blur
				// hides the list. The suggestion buttons also preventDefault on mousedown so
				// focus never leaves the input on tap (belt-and-braces).
				setTimeout(() => (inputFocused = false), 150);
			}}
		/>
		<!-- quick-260711-sm7 (req 1): clear (X) button — shown only when the input has text.
		     mousedown preventDefault keeps focus on the input so the mobile keyboard doesn't
		     drop, and clearSearch() refocuses anyway. -->
		{#if q}
			<button
				type="button"
				class="clear-input"
				aria-label={t('search.clearInput')}
				onmousedown={(e) => e.preventDefault()}
				onclick={clearSearch}
				use:tapBounce
			>
				<X size={18} />
			</button>
		{/if}
	</div>
	<button type="submit" disabled={loading} aria-busy={loading} aria-label={t('search.go')} use:tapBounce>
		{#if loading}<span class="spin motion-always" aria-hidden="true"><LoaderCircle size={18} /></span>{:else}<Search size={18} />{/if}
	</button>
</form>

<!-- D-05: tappable past-search suggestions in the idle pre-query state.
     quick-260711-sm7 (req 2): gate on an EMPTY input only (dropped the inputFocused/!searched
     conditions) so an emptied search bar always collapses to just this recent-keywords list. -->
{#if q.trim() === '' && searchHistory.entries.length > 0}
	<div class="suggest">
		<div class="suggest-head">
			<span class="suggest-title">{t('search.recent')}</span>
			<!-- quick-260711-sm7 (req 4): clear-all now behind a native confirm. -->
			<button type="button" class="suggest-clear" onmousedown={(e) => e.preventDefault()} onclick={() => { if (confirm(t('search.confirmClearAll'))) searchHistory.clear(); }} use:tapBounce>
				{t('search.clear')}
			</button>
		</div>
		<ul class="list">
			{#each searchHistory.entries as entry (entry.query)}
				<!-- quick-260711-sm7 (req 3): keyword button + sibling bin (its own ≥44px hit area,
				     mirroring the VERSIONS-01 .row-line/.ver layout) — the bin is never nested inside
				     the keyword's tap target. -->
				<li class="recent-line">
					<button
						type="button"
						class="row suggest-row"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => {
							q = entry.query;
							inputFocused = false;
							run();
						}}
						use:tapBounce
					>
						<span class="suggest-q">{entry.query}</span>
					</button>
					<button
						type="button"
						class="recent-del"
						aria-label={t('search.removeRecent')}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => removeRecent(entry.query)}
						use:tapBounce
					>
						<Trash2 size={16} />
					</button>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<!-- ql0: live typeahead suggestions with ≥2 chars and ≥1 result. The gate is mutually
     exclusive with the recent block above (recent requires q.trim()==='' ; this requires
     length ≥ MIN_QUERY_LEN) so the two never co-render.
     debug-search-typeahead-hidden-mobile: do NOT gate on `inputFocused`. On mobile Android
     Chrome the soft-keyboard/touch focus lifecycle drops input focus mid-type; the onblur
     150ms timeout then set inputFocused=false and nothing re-set it, so a POPULATED typeahead
     was suppressed on mobile (worked on desktop, where focus is stable). `suggestions` is
     already cleared on submit/pick/clear/below-2-chars, so this gate is self-limiting (no
     lingering dropdown). Mirrors the same inputFocused-drop done for the recent block (sm7). -->
{#if q.trim().length >= MIN_QUERY_LEN && suggestions.length > 0}
	<div class="suggest">
		<div class="suggest-head">
			<span class="suggest-title">{t('search.suggestions')}</span>
		</div>
		<ul class="list">
			{#each suggestions as s (s.key)}
				<li>
					<button
						type="button"
						class="row suggest-row"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => pickSuggestion(s)}
						use:tapBounce
					>
						<!-- quick-260712-gm4: 3-way kind glyph — song ♫ / artist ♪ / album ◎. Album rows
						     show the album artist as the muted sub-line, like a song row. -->
						<span class="suggest-kind" aria-hidden="true">{s.kind === 'album' ? '◎' : s.kind === 'artist' ? '♪' : '♫'}</span>
						<span class="suggest-meta">
							<span class="suggest-q">{names.dnTitle(s.title)}</span>
							{#if (s.kind === 'song' || s.kind === 'album') && s.artist}
								<span class="suggest-sub">{names.dnArtist(s.artist)}</span>
							{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<!-- OFFL-03 inline offline state: short-circuits the fetch (run() bails when offline) and
     promotes Downloads/Library. No redirect (D-09); reconnect lets the next search run. -->
{#if !online.isOnline}
	<div class="offline-state">
		<p class="offline-title">{t('offline.title')}</p>
		<p class="offline-body">{t('offline.body')}</p>
		<button type="button" class="offline-cta" onclick={() => goto('/library')} use:tapBounce>{t('offline.goToLibrary')}</button>
	</div>
{/if}

<!-- ONE skeleton-row definition shared by the D-01 first-load gate and the existing
     load-more position (no second skeleton style). Reduce-motion handled by .skel CSS. -->
{#snippet skeletonRows(count: number, label: string)}
	<li class="skel-wrap" aria-label={label}>
		<span class="vh">{label}</span>
		{#each Array(count) as _, i (i)}
			<span class="row skel" aria-hidden="true">
				<span class="art motion-always"></span>
				<span class="meta">
					<span class="bar bar-title motion-always"></span>
					<span class="bar bar-artist motion-always"></span>
				</span>
			</span>
		{/each}
	</li>
{/snippet}

{#if showFirstSkeleton}
	<!-- D-01: first-load skeleton. Gated on a dwell-floored flag (NOT raw `loading`/empty)
	     so a D-04 cache HIT / fast settle can't collapse it below one paint frame. -->
	<ul class="list">
		{@render skeletonRows(6, t('search.searching'))}
	</ul>
{:else if searched && !loading && results.length === 0}
	<p class="muted">{t('search.empty')}</p>
{:else}
	{#if artistTiles.length}
		<div class="artist-row">
			<h2 class="artist-row-h">{t('search.artists')}</h2>
			<div class="artist-tiles" use:dragScroll>
				{#each artistTiles as tile (tile.name)}
					<button class="artist-tile" onclick={() => goto('/artist/' + encodeURIComponent(tile.name))}>
						<span class="artist-avatar" style:background-image={tile.image ? `url(${tile.image})` : fallbackArtistCover(tile.name)}></span>
						<span class="artist-name">{names.dnArtist(tile.name)}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
	<ul class="list">
		{#each results as t (t.uid)}
			<li class="row-line">
				<!-- VERSIONS-01: version-picker trigger. A SIBLING tap target (its own ≥44px hit area,
				     mirroring CompactRow's .opt layout) placed BEFORE the play/grip control, so it never
				     nests inside the row play button. Rendered ONLY when this song has >1 source variant
				     (a single-source song has nothing to pick). Opens the picker with the retained
				     pre-dedupe variant group — zero new API calls. -->
				{#if (variantGroups[t.uid]?.length ?? 0) > 1}
					<button
						class="ver"
						aria-label={verOpenLabel}
						onclick={() => { pickerVersions = variantGroups[t.uid] ?? []; pickerOpen = true; }}
						use:tapBounce
					>
						<Layers size={18} />
					</button>
				{/if}
				<div class="swipe-wrap">
					<!-- UX-04 reveal layers sit BEHIND the row; the row translateX (use:swipeAction) slides
					     to expose them. Right-drag exposes the left-anchored queue affordance; left-drag
					     exposes the right-anchored like affordance. aria-hidden — the equivalent actions stay
					     reachable via the long-press TrackMenu (swipe is an enhancement). -->
					<span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>
					<span class="reveal reveal-next" aria-hidden="true"><ListStart size={20} /></span>
					<button
						class="row"
						class:is-active={player.current?.uid === t.uid}
						use:tapBounce
						use:longpress
						onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); menuTrack = t; menuOpen = true; }}
						onclick={() => { player.setListQueue(results, 'search'); player.play(t, { fresh: true }); }}
						use:swipeAction={{ onSwipeRight: () => swipeQueue(t), onSwipeLeft: () => swipeNext(t) }}
					>
						<span
							class="art"
							use:lazyCover={{ track: t, onResolved: (uid, url) => { resolvedCovers = { ...resolvedCovers, [uid]: url }; } }}
							style:background-image={(resolvedCovers[t.uid] ?? t.cover) ? `url(${resolvedCovers[t.uid] ?? t.cover})` : fallbackCover(t)}
						></span>
						<span class="meta">
							<span class="r-title">{names.dnTitle(t.title)}</span>
							<span class="r-artist">{names.dnArtist(t.artist)}</span>
						</span>
					</button>
				</div>
			</li>
		{/each}

		{#if showMoreSkeleton}
			{@render skeletonRows(4, t('search.loadingMore'))}
		{/if}

		{#if hasMore}
			<li class="sentinel" bind:this={sentinelEl}></li>
		{:else if results.length > 0 && !loading && !loadingMore}
			<li class="end-note">{t('search.noMore')}</li>
		{/if}
	</ul>
{/if}

<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />

<!-- VERSIONS-01: ONE VersionPicker mount (mirrors the single TrackMenu mount), driven by
     pickerVersions/pickerOpen. onpick plays the chosen source's EXACT variant; default row tap
     is unchanged (still plays the deduped winner). -->
<VersionPicker
	versions={pickerVersions}
	open={pickerOpen}
	overlayId="versionpicker-list"
	onclose={() => (pickerOpen = false)}
	onpick={(v) => { player.setListQueue(results, 'search'); player.play(v, { fresh: true }); }}
/>

<style>
	.head h1 { font-size: calc(1.4rem * var(--fs-title, 1)); margin: 16px 0 12px; }
	.bar { display: flex; gap: 8px; margin-bottom: 8px;}
	/* quick-260711-sm7: relative container so the clear (X) can sit inside the input's right edge. */
	.input-wrap { position: relative; flex: 1; min-width: 0; display: flex; }
	.bar input {
		flex: 1; min-width: 0; background: var(--color-surface-2); border: 1px solid var(--color-border);
		color: var(--color-text); border-radius: 999px; padding: 12px; font-size: 15px; outline: none; height: 40px;
	}
	.bar input:focus { border-color: var(--color-primary); }
	/* quick-260711-sm7: clear (X) button — full input-height grid-centred (NO translateY, so the
	   use:tapBounce scale keyframe can't displace it). Shown only when the input has text. */
	.clear-input {
		position: absolute; right: 0px; top: 0; bottom: 0; width: 34px;
		display: grid; place-items: center; background: none; border: none; padding: 0;
		color: var(--color-text-muted); cursor: pointer;
		background: transparent !important;
	}
	@media (hover: hover) { .clear-input:hover { color: var(--color-text); } }
	.bar button {
		background: var(--color-primary); border: none; color: #fff; border-radius: 999px;
		width: 40px; height: 40px; font-weight: 700; cursor: pointer;
		display: inline-flex; align-items: center; justify-content: center;
	}
	.bar button[disabled] { opacity: 0.8; cursor: default; }
	.spin { display: inline-flex; animation: spin 0.7s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.muted { color: var(--color-text-muted); font-size: 14px; }
	.end-note { list-style: none; text-align: center; color: var(--color-text-muted); font-size: 12px; padding: 16px 0 4px; }
	/* kyf + ljl-followup: artist tiles row — round avatars above the song list. Every unique
	   artist in the result set gets a tile; the row scrolls HORIZONTALLY (use:dragScroll on
	   the inner container) so there's no count cap. */
	.artist-row { margin: 0 0 14px; }
	.artist-row-h { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 8px; }
	.artist-tiles { display: flex; gap: 12px; flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
	.artist-tiles::-webkit-scrollbar { display: none; }
	.artist-tile { flex: 0 0 96px; background: none; border: none; padding: 0; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--color-text); }
	.artist-avatar { width: 96px; height: 96px; border-radius: 50%; background-size: cover; background-position: center; }
	.artist-name { font-size: 12px; font-weight: 600; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 96px; color: var(--color-text);}

	/* OFFL-03 inline offline empty-state (shared idiom across online-only surfaces). */
	.offline-state { text-align: center; padding: 32px 16px; color: var(--color-text-muted); }
	.offline-title { font-size: 15px; font-weight: 600; color: var(--color-text); margin: 0 0 6px; }
	.offline-body { font-size: 13px; margin: 0 0 16px; }
	.offline-cta {
		background: var(--color-primary); border: none; color: #fff; border-radius: 999px;
		padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
	}

	/* --- D-05 past-search suggestions --- */
	.suggest { margin-bottom: 14px; }
	.suggest-head {
		display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;
	}
	.suggest-title { font-size: 12px; font-weight: 700; color: var(--color-text-muted); letter-spacing: 0.02em; }
	.suggest-clear {
		background: none; border: none; color: var(--color-primary); font-size: 12px; font-weight: 600;
		cursor: pointer; padding: 4px 6px; border-radius: 8px;
	}
	.suggest-clear:hover { background: var(--color-surface); }
	.suggest-row { padding: 10px 8px; }
	/* quick-260711-sm7 (req 3): recent keyword row = keyword button (flex:1) + sibling bin. The bin
	   is its own ≥44px tap target (mirrors .row-line/.ver), never nested in the keyword button. */
	.recent-line { display: flex; align-items: center; gap: 4px; }
	.recent-line > .suggest-row { flex: 1; min-width: 0; width: auto; }
	.recent-del {
		flex: none; width: 44px; height: 44px; display: grid; place-items: center;
		background: none; border: none; border-radius: var(--radius-full, 999px);
		color: var(--color-text-muted); cursor: pointer;
	}
	@media (hover: hover) { .recent-del:hover { background: var(--color-surface); color: var(--color-text); } }
	.suggest-q {
		font-size: 14px; color: var(--color-text);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	/* ql0: typeahead suggestion rows — a small kind glyph + title/artist stack. */
	.suggest-kind { flex: none; width: 18px; text-align: center; color: var(--color-text-muted); font-size: 13px; }
	.suggest-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.suggest-sub {
		font-size: 12px; color: var(--color-text-muted);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}

	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	/* VERSIONS-01: a song row = the optional leading version trigger + the swipeable play row, laid
	   out together so the trigger is a SIBLING tap target (its own ≥44px hit area) rather than nested
	   inside the play button. The swipe-wrap flexes to fill the remaining width. */
	.row-line { display: flex; align-items: center; gap: 8px; min-height: 44px; }
	.ver {
		flex: none; width: 44px; height: 44px; display: grid; place-items: center;
		background: none; border: none; border-radius: var(--radius-full, 999px);
		color: var(--color-text-muted); cursor: pointer;
	}
	@media (hover: hover) { .ver:hover { background: var(--color-surface); color: var(--color-text); } }
	/* UX-04: positioning context for the swipe reveal layers. The reveal spans sit BEHIND the row
	   (the row carries an opaque background); the row's translateX (use:swipeAction) slides to
	   expose the correct side. overflow:hidden clips the row's off-screen travel + keeps the
	   reveal masked at rest. */
	.swipe-wrap { position: relative; overflow: hidden; border-radius: 10px; flex: 1; min-width: 0; }
	.reveal {
		position: absolute; top: 0; bottom: 0; width: 96px; display: flex; align-items: center;
		justify-content: center; color: #fff; pointer-events: none;
	}
	/* Right-drag (queue, --color-primary) reveals from the LEFT edge; left-drag (play-next,
	   --src-netease field) reveals from the RIGHT edge — matching the drag direction. */
	.reveal-queue { left: 0; color: var(--color-text-muted); }
	.reveal-next { right: 0; color: var(--color-text-muted); }
	.row {
		width: 100%; display: flex; align-items: center; gap: 12px; padding: 8px;
		background: var(--color-bg); position: relative; z-index: 1;
		border: none; border-radius: 10px; cursor: pointer; text-align: left; transition: background 0.12s ease;
	}
	/* MENU-03 / D-12: hover-capable devices only — touch otherwise latches this :hover
	   background on a row under a held finger while the track menu opens. */
	@media (hover: hover) { .row:hover { background: var(--color-surface); } }
	/* Active/selected row = the currently-playing track. NOT gated behind hover, so the light-grey
	   --color-surface highlight (same token as :hover) shows on touch too. */
	.row.is-active { background: var(--color-surface); }
	.art { width: 48px; height: 48px; border-radius: 8px; background-size: cover; background-position: center; flex: none; }
	.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.r-title { font-size: calc(14px * var(--fs-title, 1)); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--color-text);}
	.r-artist { font-size: calc(12px * var(--fs-artist, 1)); color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	/* --- infinite-scroll loading state --- */
	.sentinel { height: 1px; margin: 0; padding: 0; list-style: none; }
	.skel-wrap { display: flex; flex-direction: column; gap: 6px; list-style: none; }
	/* Skeleton row mirrors .row sizing so placeholders line up with real rows. */
	.skel { pointer-events: none; }
	/* Lighter grey than --color-surface-2 so the placeholders are clearly visible on the dark
	   page background during the (brief, dwell-floored) loading window. */
	.skel .art { background: rgba(255, 255, 255, 0.11); }
	.skel .meta { gap: 7px; }
	.skel .bar { display: block; height: 11px; border-radius: 5px; background: rgba(255, 255, 255, 0.11); }
	.skel .bar-title { width: 62%; height: 9px;}
	.skel .bar-artist { width: 40%; height: 9px; }
	.skel .art, .skel .bar {
		position: relative; overflow: hidden;
	}
	.skel .art::after, .skel .bar::after {
		content: ''; position: absolute; inset: 0;
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba(255, 255, 255, 0.22) 50%,
			transparent 100%
		);
		transform: translateX(-100%);
		animation: skel-shimmer 1.1s ease-in-out infinite;
	}
	@keyframes skel-shimmer {
		100% { transform: translateX(100%); }
	}
	/* Disable shimmer for users who prefer reduced motion. */
	/* Visually-hidden screen-reader cue for the skeleton container. */
	.vh {
		position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
		overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
	}
</style>
