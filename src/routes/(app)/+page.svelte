<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Search, Settings, RotateCw, ChevronRight } from '@lucide/svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { buildDiversePicks } from '$lib/services/picks';
	import {
		getChartTopTracks,
		getChartTopArtists,
		getTagTopTracks,
		getGeoTopTracks,
		type DiscoveryTrack,
		type DiscoveryArtist
	} from '$lib/services/lastfm';
	import {
		mapWithConcurrency,
		shuffle,
		pickRandomPage,
		resolveStub,
		DISCOVERY_TAGS,
		DISCOVERY_COUNTRIES
	} from '$lib/services/discovery';
	import {
		resolveSectionOrder,
		resolveSubset,
		clampShelfSize,
		resolveSectionDensity,
		type HomeSectionId
	} from '$lib/services/home-layout';
	import { settings } from '$lib/stores/settings.svelte';
	import { deezerChart } from '$lib/services/deezer';
	import { getCachedCover, getCachedArtistCover } from '$lib/services/cover-cache';
	import { backfillCovers, backfillArtistCovers } from '$lib/services/cover-backfill';
	import { decodeShare } from '$lib/services/share';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { history as playHistory } from '$lib/stores/history.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { t } from '$lib/i18n';
	import { longpress } from '$lib/actions/longpress';
	import { dragScroll } from '$lib/actions/dragScroll';
	import { marquee } from '$lib/actions/marquee';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import CompactRow from '$lib/components/CompactRow.svelte';
	import CompactPager from '$lib/components/CompactPager.svelte';
	import PageOg from '$lib/components/PageOg.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import type { PageData } from './$types';
	import type { Track } from '$lib/sources/types';

	// `data.og` comes from the universal +page.ts load: non-null when this is a shared-song link
	// (`/?play=<token>`), so the shared song gets a crawler-correct OG card in the SSR HTML (GLN-4).
	let { data }: { data: PageData } = $props();

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);

	const PICK_COUNT = 9;
	// w87: items-per-shelf is now the user setting (clampShelfSize(settings.homeShelfSize)),
	// read inside refresh(); the old hardcoded PER_SHELF=18 is gone (18 is still the default).
	const FANOUT_CAP = 4; // ≤4 in-flight tag/country shelf fetches (Pitfall 11 / DISCO-04)
	// Bumped to v2: the cache now holds the four Last.fm discovery shelves (D-01/D-02),
	// not the flat v1 buildDiversePicks list. A stale v1 entry is simply ignored.
	// w87: the cache is keyed by CACHE_KEY ONLY (NOT by the home-layout config). A config
	// change (subset / shelf size) is reconciled by the background refresh(false,true) that
	// runs after applyCache — it re-fetches with the CURRENT config and overwrites the cache,
	// so the next paint reflects the change without adding config to the key.
	const CACHE_KEY = 'openmusic:top-picks:v2';

	// A labelled tag/country row paired with its heading.
	type Shelf = { label: string; tracks: DiscoveryTrack[] };
	// Versioned cache payload: the four displayed shelves + the fallback flag.
	// `cfg` (stamped by saveCache) is a signature of the home-layout config the shelves were
	// built with (shelf size + selected tag/country subset). On reload we only background-
	// revalidate when it DIFFERS from the current config — so a Randomize arrangement survives a
	// refresh instead of being clobbered by a fresh page-1 fetch (a non-randomize revalidate is
	// deterministic page 1, so skipping it when config is unchanged loses nothing).
	type ShelfCache = {
		v: 2;
		topHits: DiscoveryTrack[];
		topArtists: DiscoveryArtist[];
		tagShelves: Shelf[];
		countryShelves: Shelf[];
		useFallback: boolean;
		fallback: Track[];
		cfg?: string;
	};

	let topHits = $state<DiscoveryTrack[]>([]);
	let topArtists = $state<DiscoveryArtist[]>([]);
	let tagShelves = $state<Shelf[]>([]);
	let countryShelves = $state<Shelf[]>([]);
	// D-06: when LASTFM_KEY is absent or every shelf is empty, fall back to the random
	// buildDiversePicks grid so the home page is never blank signed-out / no-key.
	let useFallback = $state(false);
	let fallbackSongs = $state<Track[]>([]);

	// --- Library-sourced home shelves (quick-260607-hhd) ---------------------------
	// Local-only shelves built from the user's library + history. They behave like the
	// chart shelves: appear in /settings/home as reorderable + show/hide entries, the
	// Randomize button reshuffles them, and the picked uid sets are cached separately so
	// a page refresh restores the same arrangement. Each shelf is hidden at render time
	// when its source is empty (no header, no row).
	let likedShelf = $state<Track[]>([]);
	let downloadsShelf = $state<Track[]>([]);
	let historyShelf = $state<Track[]>([]);
	let playlistShelves = $state<{ id: string; name: string; tracks: Track[] }[]>([]);
	// kmn: favourite artists shelf (round avatars). Covers backfill via the existing
	// backfillArtistCovers chain (Deezer → iTunes) on mount + whenever the list changes.
	let favArtistsShelf = $state<{ name: string }[]>([]);
	const LIBRARY_CACHE_KEY = 'openmusic:home-library:v1';
	type LibraryShelfCache = {
		v: 1;
		liked?: string[];
		downloads?: string[];
		history?: string[];
		playlists?: Record<string, string[]>;
		/** kmn: fav-artists shelf — names only (cover backfills on render). */
		favArtists?: string[];
	};
	function pickN<T>(arr: T[], n: number, randomize: boolean): T[] {
		if (arr.length <= n) return randomize ? shuffle(arr) : [...arr];
		if (!randomize) return arr.slice(0, n);
		// Reservoir-style: shuffle a copy then take N.
		const copy = [...arr];
		for (let i = copy.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[copy[i], copy[j]] = [copy[j], copy[i]];
		}
		return copy.slice(0, n);
	}
	function buildLibraryShelves(randomize: boolean) {
		const cap = clampShelfSize(settings.homeShelfSize);
		likedShelf = pickN(library.liked, cap, randomize);
		downloadsShelf = pickN(library.downloads, cap, randomize);
		// History entries carry the full track on `.track`; the latest are at the front.
		// HistoryEntry IS the playable Track whitelist (audioUrl re-resolves on play()).
		const historyTracks = playHistory.entries as unknown as Track[];
		historyShelf = pickN(historyTracks, cap, randomize);
		playlistShelves = library.playlists
			.filter((p) => p.tracks.length > 0)
			.map((p) => ({ id: p.id, name: p.name, tracks: pickN(p.tracks, cap, randomize) }));
		// kmn: favourite artists — same shape as topArtists tiles (name only; cover backfills).
		favArtistsShelf = pickN(library.favArtists, cap, randomize).map((n) => ({ name: n }));
		// Schedule a cover backfill for the rendered fav-artist names (Deezer → iTunes chain,
		// post-paint, capped + cached; same posture as the top-artists tier).
		if (favArtistsShelf.length) {
			void backfillArtistCovers(favArtistsShelf.map((a) => a.name), {
				onResolved: () => coverVer++,
				max: favArtistsShelf.length
			});
		}
		saveLibraryCache();
	}
	function saveLibraryCache() {
		const payload: LibraryShelfCache = {
			v: 1,
			liked: likedShelf.map((t) => t.uid),
			downloads: downloadsShelf.map((t) => t.uid),
			history: historyShelf.map((t) => t.uid),
			playlists: Object.fromEntries(playlistShelves.map((s) => [s.id, s.tracks.map((t) => t.uid)])),
			favArtists: favArtistsShelf.map((a) => a.name)
		};
		try {
			localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(payload));
		} catch {
			/* quota — non-fatal */
		}
	}
	function loadLibraryCache(): LibraryShelfCache | null {
		try {
			const raw = localStorage.getItem(LIBRARY_CACHE_KEY);
			if (!raw) return null;
			const v: unknown = JSON.parse(raw);
			if (v && typeof v === 'object' && (v as LibraryShelfCache).v === 1) return v as LibraryShelfCache;
			return null;
		} catch {
			return null;
		}
	}
	function applyLibraryCache(c: LibraryShelfCache) {
		// Resolve cached uids → live Track refs from the live stores. A uid not found in the live
		// store is dropped (e.g. user un-liked the song between sessions); the shelf shrinks but
		// never holds stale Track objects.
		const byUidArr = (src: Track[]) => {
			const idx = new Map(src.map((t) => [t.uid, t]));
			return (uids: string[] | undefined) => (uids ?? []).map((u) => idx.get(u)).filter(Boolean) as Track[];
		};
		likedShelf = byUidArr(library.liked)(c.liked);
		downloadsShelf = byUidArr(library.downloads)(c.downloads);
		// HistoryEntry IS the playable Track whitelist (audioUrl re-resolves on play()).
		const historyTracks = playHistory.entries as unknown as Track[];
		historyShelf = byUidArr(historyTracks)(c.history);
		playlistShelves = library.playlists
			.filter((p) => p.tracks.length > 0)
			.map((p) => ({ id: p.id, name: p.name, tracks: byUidArr(p.tracks)(c.playlists?.[p.id]) }))
			// A playlist whose CACHED picks no longer resolve (e.g. all tracks removed) still
			// renders nothing — let buildLibraryShelves repopulate it next Randomize. Drop empties
			// so the shelf header doesn't render either.
			.filter((s) => s.tracks.length > 0);
		// kmn: fav-artists — restore the saved ordering, filtered to names still in the live
		// library bucket. An entry the user un-favourited between sessions is dropped. When the
		// cache predates this feature (no `favArtists` key) seed from live library — non-destructive
		// migration so existing users see their fav-artists immediately on first load.
		const liveFav = new Set(library.favArtists.map((n) => n.trim().toLowerCase()));
		const cachedNames = c.favArtists ?? null;
		favArtistsShelf = (cachedNames !== null ? cachedNames.filter((n) => liveFav.has(n.trim().toLowerCase())) : library.favArtists)
			.map((n) => ({ name: n }));
		if (favArtistsShelf.length) {
			void backfillArtistCovers(favArtistsShelf.map((a) => a.name), {
				onResolved: () => coverVer++,
				max: favArtistsShelf.length
			});
		}
	}

	let loading = $state(true);
	let error = $state<string | null>(null);

	// D-15: the home local toast copy migrated to the global `toast` store (rendered once by
	// ToastHost in the (app) layout). Call sites use `toast.show(...)`.

	function fallbackCover(seed: string): string {
		const h = (seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	// quick-260606-wv8 (supersedes v7k; extends nza's FIX-B / rvy's FIX-A): prefer a real cover
	// for a discovery item in this EXACT render order (the cheap, synchronous pre-checks):
	//   1. Last.fm image (item.image)                    — already on the row (the "Last.fm" tier
	//                                                       of the Deezer → CN → Last.fm chain,
	//                                                       satisfied here, NOT as a backfill call)
	//   2. CAA-by-mbid (caaReleaseGroupCover)             — nza's MusicBrainz path
	//   3a. TRACK: cached cover (getCachedCover)          — Deezer/CN backfill, keyed by artist|title
	//   3b. ARTIST: cached artist image (getCachedArtistCover) — Deezer backfill, keyed by artistName
	//   4. null → gradient                                — never a broken/blocking image
	// What changed in wv8 is the BACKFILL that fills tiers 3a/3b (Deezer-first → CN for tracks,
	// Deezer for artists); the tileCover render order itself is UNCHANGED. The
	// cached lookups read `coverVer` so Svelte 5 re-evaluates each tile's <img src> when a
	// background resolve lands (coverVer is bumped in the backfill onResolved callback). Track
	// rows pass {artist,title}; ARTIST tiles pass a dedicated `artistName` (NOT `artist`) so the
	// artist-only cache key is read — never colliding with a {artist,title} track of the same
	// name. Rendered as a lazy <img> over the gradient (NOT a CSS background) so a 404 degrades
	// via onerror.
	function tileCover(item: {
		image: string | null;
		mbid: string | null;
		artist?: string;
		title?: string;
		artistName?: string;
	}): string | null {
		void coverVer; // reactive dependency: recompute when a backfilled cover lands
		if (item.image) return item.image;
		// NOTE: the CAA-by-mbid tier was REMOVED here — coverartarchive.org image loads are
		// blocked by the browser's Opaque Response Blocking (net::ERR_BLOCKED_BY_ORB), so a CAA
		// URL always renders broken AND shadowed the working Deezer/CN backfilled cover for any
		// item that carried an mbid (the runtime root cause of "most tiles are color blocks").
		if (item.artist && item.title) return getCachedCover(item.artist, item.title);
		if (item.artistName) return getCachedArtistCover(item.artistName);
		return null;
	}
	// Hide a cover <img> on load error so the gradient underneath shows (no broken-image icon).
	function hideOnError(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}

	// FIX-A: bumped in backfillCovers' onResolved so tileCover() recomputes and resolved covers
	// appear without a full refresh. A plain $state number is the cheapest reactive trigger.
	let coverVer = $state(0);

	// quick-260607-0bb (supersedes wv8): gather every TRACK row across all shelves that still
	// shows a gradient (no Last.fm image AND no mbid) — exactly the tiles nza's CAA path could
	// not cover — and every top-ARTIST tile with no Last.fm image (artist art is deprecated →
	// always null). Then fire BOTH lazy, concurrency-capped backfills OFF the critical path (void,
	// never awaited before paint): track covers (Deezer → iTunes → CN) and artist images
	// (Deezer → iTunes). Both skip already-cached entries, so a warm visit issues ~0 requests. The
	// same coverVer++ onResolved makes covers — track AND artist — appear progressively as resolves
	// land. Chain: tileCover render = Last.fm image → CAA(mbid) → cached(Deezer/iTunes/CN) →
	// gradient; BACKFILL fill = Deezer → iTunes → CN (track) / Deezer → iTunes (artist).
	//
	// CAP LIFTED (0bb): the cap is now the FULL gathered gradient set — `max: rows.length` /
	// `max: artistNames.length` — so EVERY rendered gradient tile (all ~270 track tiles + ~18 artist
	// tiles in the default config) is attempted, not just a fixed first 24/12 (the wv8 cap stranded
	// every tile past the 24th/12th as a permanent gradient — the grounded root cause of "most tiles
	// are color blocks"). The in-flight CAP=6 pool + per-call AbortSignal.timeout + skip-cached +
	// de-dupe keep this safe: a cold visit stays under Deezer's ~50 req/5s (Deezer is tier-1 + edge-
	// cached; iTunes/CN fire only on a Deezer miss), and a warm visit is ~free (every tile cached).
	function scheduleBackfill() {
		const rows: { artist: string; title: string }[] = [];
		const pushNeeding = (items: DiscoveryTrack[]) => {
			for (const it of items) {
				if (!it.image) rows.push({ artist: it.artist, title: it.title });
			}
		};
		pushNeeding(topHits);
		for (const s of tagShelves) pushNeeding(s.tracks);
		for (const s of countryShelves) pushNeeding(s.tracks);
		if (rows.length) {
			void backfillCovers(rows, { onResolved: () => coverVer++, max: rows.length });
		}

		// 0bb: artist tiles are structurally gradient (Last.fm artist art deprecated → null).
		// Resolve their images via Deezer → iTunes, capped (= full gathered set) + cached + post-paint.
		const artistNames = topArtists.filter((a) => !a.image).map((a) => a.name);
		if (artistNames.length) {
			void backfillArtistCovers(artistNames, {
				onResolved: () => coverVer++,
				max: artistNames.length
			});
		}
	}

	// Has at least one Last.fm shelf returned anything? Drives the D-06 fallback decision.
	function hasAnyDiscovery(
		hits: DiscoveryTrack[],
		artists: DiscoveryArtist[],
		tags: Shelf[],
		countries: Shelf[]
	): boolean {
		return (
			hits.length > 0 ||
			artists.length > 0 ||
			tags.some((s) => s.tracks.length) ||
			countries.some((s) => s.tracks.length)
		);
	}

	// localStorage is browser-only; these run inside onMount / click handlers (never SSR).
	// Signature of the home-layout config the shelves depend on. Two cached payloads with the
	// same cfg would re-fetch (non-randomized) to the identical page-1 surface, so a reload can
	// safely skip the revalidate and keep whatever is cached (incl. a Randomize arrangement).
	function configSig(): string {
		return JSON.stringify({
			s: clampShelfSize(settings.homeShelfSize),
			t: resolveSubset(settings.homeTags, DISCOVERY_TAGS),
			c: resolveSubset(settings.homeCountries, DISCOVERY_COUNTRIES)
		});
	}

	function saveCache(payload: ShelfCache) {
		payload.cfg = configSig();
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
		} catch {
			/* quota or unavailable — non-fatal */
		}
	}
	function loadCache(): ShelfCache | null {
		try {
			const raw = localStorage.getItem(CACHE_KEY);
			if (!raw) return null;
			const v: unknown = JSON.parse(raw);
			if (v && typeof v === 'object' && (v as ShelfCache).v === 2) return v as ShelfCache;
			return null;
		} catch {
			return null;
		}
	}

	function applyCache(c: ShelfCache) {
		topHits = c.topHits ?? [];
		topArtists = c.topArtists ?? [];
		tagShelves = c.tagShelves ?? [];
		countryShelves = c.countryShelves ?? [];
		useFallback = c.useFallback ?? false;
		fallbackSongs = c.fallback ?? [];
	}

	// Randomize page bound (VX2): how many Last.fm chart/tag/geo pages to draw from. Kept
	// SMALL so a randomly-picked page still has data on these high-traffic methods — going
	// deeper risks empty pages (→ a blank shelf). The fan-out WIDTH is unchanged (one
	// request per existing shelf, FANOUT_CAP in flight); only WHICH page each shelf fetches
	// varies, and each (method+params+page) stays edge-cached (T-vx2-03 — no new fan-out).
	const RANDOM_PAGE_BOUND = 5;

	// Fetch the four Last.fm shelves (concurrency-capped), fall back to buildDiversePicks
	// when discovery is empty, cache the displayed result, and seed the player queue.
	// Used by Randomize + cold start + background revalidate.
	//
	// `background` (WR-02): a post-cache-hit revalidate does NOT toggle `loading`, so the
	// Randomize button stays enabled and shows live content rather than "Loading…".
	// `refreshGen` (WR-04): only the LATEST refresh writes state — a stale background call
	// that finishes after a manual Randomize is discarded, so they never clobber each other.
	// `randomize` (VX2): the 隨機推薦 button passes true to genuinely VARY the surface — each
	// chart/tag/geo call draws a fresh random page AND the shelf order + within-shelf tile
	// order + topHits/topArtists are shuffled, so consecutive presses look different even
	// when an overlapping page comes back. A NON-randomize (cold/background) call passes the
	// default page 1 → identical request + edge cache key as before, AND no shuffle, so the
	// cache-friendly fast path is untouched. Randomize never reads loadCache(); it always
	// FETCHES and OVERWRITES the cache below with the freshly-shuffled arrangement.
	let refreshGen = 0;
	async function refresh(seedQueue = true, background = false, randomize = false) {
		// quick-260607-hhd: library-sourced shelves rebuild on every refresh. They cost ~0
		// (pure JS reads of in-memory stores + a localStorage write) so we don't gate by
		// `background`. Randomize=true picks fresh random subsets; otherwise stable order.
		buildLibraryShelves(randomize);
		const gen = ++refreshGen;
		if (!background) loading = true;
		error = null;
		try {
			// w87: per-shelf tile count is the user setting, clamped to [6,24] (T-w87-01 — a
			// poisoned/old value can never produce a giant or NaN page size). Tag/country
			// fan-out runs over the SELECTED subset (resolveSubset falls back to the full pool
			// when none/garbage are selected, T-w87-03), so config can only NARROW the
			// surface — fan-out width stays ≤ the pool size, behind FANOUT_CAP (Pitfall 11).
			const perShelf = clampShelfSize(settings.homeShelfSize);
			const tagPool = resolveSubset(settings.homeTags, DISCOVERY_TAGS);
			const countryPool = resolveSubset(settings.homeCountries, DISCOVERY_COUNTRIES);
			// Shelves 1+2 (chart) + the capped tag/country fan-out (shelves 3+4). All
			// builders never throw (→ [] on failure / absent key), so this never rejects.
			// On a randomize press, draw a fresh random page PER call so different shelves
			// pull from different pages; on a normal call pass page 1 (cache-friendly).
			const pg = () => (randomize ? pickRandomPage(RANDOM_PAGE_BOUND) : 1);
			// TOP-HITS + TOP-ARTISTS source from the Deezer /chart: covers + artist pictures are
			// EMBEDDED, so ONE request yields a fully-covered shelf and the per-tile cover backfill
			// is demoted to a rare backup (user: "less requests, backfill as backup not norm").
			// Tag/country shelves stay Last.fm (their imageless tiles are the backup backfill's job).
			const dzChart = await deezerChart(perShelf);
			if (gen !== refreshGen) return;
			const [tagRows, countryRows] = await Promise.all([
				mapWithConcurrency(tagPool, FANOUT_CAP, (tag) =>
					getTagTopTracks(tag, perShelf, pg())
				),
				mapWithConcurrency(countryPool, FANOUT_CAP, (c) =>
					getGeoTopTracks(c, perShelf, pg())
				)
			]);
			if (gen !== refreshGen) return; // superseded by a newer refresh (WR-04)

			// Deezer PRIMARY; fall back to the Last.fm chart PER SOURCE only when Deezer is empty.
			const rawHits = dzChart.tracks.length
				? dzChart.tracks
				: await getChartTopTracks(perShelf, pg());
			const rawArtists = dzChart.artists.length
				? dzChart.artists
				: await getChartTopArtists(perShelf);
			if (gen !== refreshGen) return;

			// On randomize, shuffle the chart shelves' tile order so even an overlapping page
			// renders visibly differently. (Non-randomize leaves them in Last.fm rank order.)
			const hits = randomize ? shuffle(rawHits) : rawHits;
			const artists = randomize ? shuffle(rawArtists) : rawArtists;

			// Build the tag/country shelves; on randomize also shuffle the tile order WITHIN
			// each shelf. w87: map over the resolved SUBSET (tagPool/countryPool) so the
			// shelves match the rows we fetched above — a deselected tag simply has no shelf.
			let tags: Shelf[] = tagPool.map((label, i) => ({
				label,
				tracks: randomize ? shuffle(tagRows[i] ?? []) : (tagRows[i] ?? [])
			})).filter((s) => s.tracks.length);
			let countries: Shelf[] = countryPool.map((label, i) => ({
				label,
				tracks: randomize ? shuffle(countryRows[i] ?? []) : (countryRows[i] ?? [])
			})).filter((s) => s.tracks.length);

			// On randomize, also shuffle the ORDER of the shelves themselves (which tag/country
			// shelf appears first) — done on the local vars BEFORE assignment + saveCache so the
			// persisted cache and the rendered UI carry the identical shuffled arrangement.
			if (randomize) {
				tags = shuffle(tags);
				countries = shuffle(countries);
			}

			if (hasAnyDiscovery(hits, artists, tags, countries)) {
				// PRIMARY: the Last.fm discovery surface (D-01/D-02).
				topHits = hits;
				topArtists = artists;
				tagShelves = tags;
				countryShelves = countries;
				useFallback = false;
				fallbackSongs = [];
				saveCache({
					v: 2,
					topHits: hits,
					topArtists: artists,
					tagShelves: tags,
					countryShelves: countries,
					useFallback: false,
					fallback: []
				});
				scheduleBackfill(); // FIX-A: fill gradients with real CN covers, post-paint, capped
			} else {
				// D-06 FALLBACK: absent key / all-empty → keep the home page populated.
				const picks = await buildDiversePicks(PICK_COUNT);
				if (gen !== refreshGen) return; // superseded during the fallback fetch (WR-04)
				if (picks.length) {
					useFallback = true;
					fallbackSongs = picks;
					topHits = [];
					topArtists = [];
					tagShelves = [];
					countryShelves = [];
					if (seedQueue) player.setQueue(picks, 'home-discovery');
					saveCache({
						v: 2,
						topHits: [],
						topArtists: [],
						tagShelves: [],
						countryShelves: [],
						useFallback: true,
						fallback: picks
					});
				} else if (!background) {
					error = t('home.noResults');
				}
			}
		} catch (e) {
			// Background-revalidate failures stay silent — cached content remains visible.
			if (gen === refreshGen && !background) error = e instanceof Error ? e.message : String(e);
		} finally {
			if (gen === refreshGen && !background) loading = false;
		}
	}

	// Resolve-on-tap (D-03) — now OPTIMISTIC (FIX-A). Delegate to player.playStub, which
	// locks the tapped {artist,title,cover} into the now-bar with a loading indicator
	// instantly, dedupes a same-song double-tap, and supersedes an in-flight resolve when a
	// different song is tapped. playStub returns null for BOTH a genuine miss AND a
	// supersede, so gate the toast on pendingTrack: a supersede leaves pendingTrack pointing
	// at the NEWER song (no toast), a miss clears pendingTrack (toast). Cover-if-known is
	// passed so the optimistic bar shows real art immediately when available.
	async function playStub(item: DiscoveryTrack) {
		const tr = await player.playStub(item.artist, item.title, item.image, 'home-discovery');
		if (tr === null && player.pendingTrack == null) toast.show(t('home.unplayable'));
	}

	// Long-press a discovery tile → open the track menu. The tile is an unresolved stub, so the
	// menu opens INSTANTLY with a display stub + loading skeleton (predictable, never delayed by
	// the network — so a slow re-search can't eat the long-press), then resolveStub fills in the
	// real Track + actions in the background. A generation guard discards a stale resolve if the
	// user closed / reopened the menu meanwhile; a miss closes the menu + toasts.
	let menuLoading = $state(false);
	let menuGen = 0;
	function stubTrack(item: DiscoveryTrack): Track {
		return {
			uid: '', source: 'netease', songid: '', title: item.title, artist: item.artist,
			album: '', cover: item.image ?? null, audioUrl: null, lrc: null, lrcUrl: null,
			detailsLoaded: false, quality: null, qualityLabel: null, keyword: '', displayIndex: 0
		};
	}
	async function tileMenu(item: DiscoveryTrack) {
		const gen = ++menuGen;
		menuTrack = stubTrack(item); // header shows title/artist immediately
		menuLoading = true;
		menuOpen = true;
		const tr = await resolveStub(item.artist, item.title);
		if (gen !== menuGen || !menuOpen) return; // superseded or closed while resolving
		if (tr) {
			menuTrack = tr;
			menuLoading = false;
		} else {
			menuOpen = false;
			menuLoading = false;
			toast.show(t('home.unplayable'));
		}
	}

	// --- Compact homepage mode (HOME-02/03, D-05/07/10) --------------------------------
	// D-07: ALL sections compact BY DEFAULT — we pass 'compact' as resolveSectionDensity's
	// globalDefault, so a section is comfortable only when the user explicitly overrides it
	// in /settings/home (settings.homeSectionDensity[id] === 'comfortable'). A corrupt/garbage
	// override falls back to 'compact' (resolveSectionDensity, T-23-09 — never blanks).
	function densityOf(id: HomeSectionId): 'comfortable' | 'compact' {
		return resolveSectionDensity(id, settings.homeSectionDensity, 'compact');
	}
	// D-10: compact item count = homeShelfSize rounded UP to the nearest full column of 4, so a
	// pager never shows a ragged trailing column shorter than the others would imply.
	const compactCount = $derived(Math.ceil(clampShelfSize(settings.homeShelfSize) / 4) * 4);
	function compactSlice<T>(arr: T[]): T[] {
		return arr.slice(0, compactCount);
	}

	// Library-track row play (matches librarySongRow's comfortable behavior) + its menu open.
	function playLibraryTrack(track: Track) {
		player.play(track, { fresh: true });
	}
	function openTrackMenu(track: Track) {
		menuTrack = track;
		menuOpen = true;
	}
	function libraryRowCover(track: Track): string | null {
		return track.cover ?? getCachedCover(track.artist, track.title);
	}

	onMount(() => {
		// w87: ensure the home-layout config is loaded before cache/refresh reads it. load()
		// is idempotent (its own `loaded` guard), so the layout's onMount call is harmless.
		settings.load();
		// hhd: library + history feed the new local-source shelves. load() is idempotent on both.
		library.load();
		playHistory.load();
		// Hydrate the library shelves instantly from the persisted uid set so the same picks
		// survive page refresh. Falls back to a fresh non-randomize build when no cache exists.
		const libCache = loadLibraryCache();
		if (libCache) applyLibraryCache(libCache);
		else buildLibraryShelves(false);

		// Shared link: /?play=<token> → reconstruct the current track + up-next queue and play
		// through the SAME continuity path normal tap-to-play uses, so a shared song auto-advances
		// (regenerate/ensureAhead + prefetchNext) at end instead of stopping (GLN-1) AND restores
		// the shared queue, not just one song (GLN-2). decodeShare also accepts legacy v1 tokens.
		const token = new URLSearchParams(location.search).get('play');
		if (token) {
			const { current, queue } = decodeShare(token);
			if (current) {
				// Multi-item queue → install it; otherwise seed a 1-item queue (legacy/single-track
				// token). fresh:true makes the player regenerate a similar-artist up-next + prefetch,
				// matching a normal fresh play so the shared song keeps playing continuously.
				player.setQueue(queue.length > 1 ? queue : [current], 'home-discovery');
				player.play(current, { fresh: true });
			}
			// Clear the params via the global window.history (the play-history store is imported as
			// `playHistory`, so `window.history` is the real History API here).
			window.history.replaceState(null, '', location.pathname);
		}

		// Instant render from the cached shelves, then revalidate in the background.
		const cached = loadCache();
		if (cached) {
			applyCache(cached);
			// Re-seed the queue only for the fallback grid (discovery taps resolve-on-tap).
			if (!token && cached.useFallback && cached.fallback.length) {
				player.setQueue(cached.fallback, 'home-discovery');
			}
			loading = false;
			scheduleBackfill(); // FIX-A: backfill covers for the just-applied cached shelves
			// Background revalidate ONLY when the home-layout config changed since the cache was
			// built. When it's unchanged, a non-randomize revalidate would just re-fetch the same
			// deterministic page-1 surface AND overwrite a prior Randomize arrangement — so we
			// keep the cached set instead (user: "after refresh it should show the latest set B,
			// not A"). A config change still revalidates to reconcile the new shelf size/subset.
			if (cached.cfg !== configSig()) void refresh(false, true);
		} else {
			// Cold cache: full fetch. Seed the queue unless a shared link is taking over.
			refresh(!token);
		}
	});
</script>

{#if data.og}
	<PageOg og={data.og} />
{/if}

<header class="topnav">
	<div class="brand"><Logo size={26} /> openmusic</div>
	<button class="gear" aria-label={t('home.settings')} onclick={() => goto('/settings')}><Settings size={20} /></button>
</header>

{#if settings.homeShowSearchPill}
	<button class="searchpill" onclick={() => goto('/search')}>
		<Search size={16} /> <span>{t('home.searchPill')}</span>
	</button>
{/if}

<section class="section" class:compact={settings.homeDensity === 'compact'}>
	<div class="head">
		<h2>{t('home.topPicks')}</h2>
		{#if settings.homeShowRandomize}
			<button class="more" onclick={() => refresh(true, false, true)} disabled={loading}><RotateCw size={13} /> {loading ? t('home.loadingPicks') : t('home.randomize')}</button>
		{/if}
	</div>

	{#if loading && !useFallback && !topHits.length && !topArtists.length && !tagShelves.length && !countryShelves.length && !fallbackSongs.length}
		<!-- Cold-load skeleton: compact-by-default, so match the compact pager shape — a column
		     of 4 compact-row placeholders (40px art + 2 bars), with the next column peeking. -->
		<div class="compact-skel-pager">
			{@render compactSkeletonColumn()}
			{@render compactSkeletonColumn()}
		</div>
	{:else if error}
		<p class="error">{error} — <button class="retry" onclick={() => refresh(true)}>{t('common.retry')}</button></p>
	{:else if useFallback}
		<!-- D-06 fallback: the random buildDiversePicks grid (real Tracks → tap-to-play). -->
		<div class="grid">
			{#each fallbackSongs as track (track.uid)}
				<button class="tile" use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); menuTrack = track; menuOpen = true; }} onclick={() => { player.setQueue(fallbackSongs, 'home-discovery'); player.play(track, { fresh: true }); }}>
					<div class="art" style:background-image={track.cover ? `url(${track.cover})` : fallbackCover(track.uid)}></div>
					{#if track.qualityLabel || track.quality}<span class="q">{track.qualityLabel ?? track.quality}</span>{/if}
					<div class="scrim"></div>
					<div class="label">
						<div class="t-title">{names.dnTitle(track.title)}</div>
						<div class="t-artist">{names.dnArtist(track.artist)}</div>
					</div>
				</button>
			{/each}
		</div>
	{:else}
		<!-- PRIMARY: the four Last.fm discovery shelves (D-01/D-02). w87: render each
		     section block in the user's RESOLVED order (resolveSectionOrder drops unknown /
		     appends missing known ids, so a corrupt saved order never blanks the home),
		     skipping any id in settings.homeHidden. The per-section markup lives in the
		     snippets below; only ORDER + the hidden-skip are new. -->
		{#each resolveSectionOrder(settings.homeSectionOrder) as id (id)}
			{#if !settings.homeHidden.includes(id)}
				{#if id === 'top-hits'}{@render topHitsBlock()}
				{:else if id === 'top-artists'}{@render topArtistsBlock()}
				{:else if id === 'tags'}{@render tagsBlock()}
				{:else if id === 'countries'}{@render countriesBlock()}
				{:else if id === 'liked'}{@render likedBlock()}
				{:else if id === 'downloads'}{@render downloadsBlock()}
				{:else if id === 'fav-artists'}{@render favArtistsBlock()}
				{:else if id === 'playlists'}{@render playlistsBlock()}
				{:else if id === 'history'}{@render historyBlock()}
				{/if}
			{/if}
		{/each}
	{/if}
</section>

<!-- D-14: the whole section-title row is one tap target → its destination (chart page /
     library tab / playlist detail). `dest` is built from FIXED in-app paths with any dynamic
     segment encodeURIComponent-wrapped (T-23-08 — same-origin goto, no open redirect). -->
{#snippet titleNav(label: string, dest: string)}
	<button class="subhead-nav" aria-label={`${label}, ${t('home.seeAll')}`} onclick={() => goto(dest)}>
		<span class="subhead-label">{label}</span>
		<ChevronRight class="subhead-chev" size={18} />
	</button>
{/snippet}

<!-- Compact-row skeleton (UI-SPEC §2): 40px art + 2 bars (62%/40%), 4 per column. -->
{#snippet compactSkeletonColumn()}
	<div class="compact-skel-col" aria-hidden="true">
		{#each Array(4) as _, i (i)}
			<div class="compact-skel-row">
				<span class="cs-art sk"></span>
				<span class="cs-meta">
					<span class="cs-bar cs-bar-title sk"></span>
					<span class="cs-bar cs-bar-sub sk"></span>
				</span>
			</div>
		{/each}
	</div>
{/snippet}

{#snippet topHitsBlock()}
	{#if topHits.length}
		{@render titleNav(t('home.topHits'), '/charts/top')}
		{@render discoveryShelf(topHits, densityOf('top-hits') === 'compact')}
	{/if}
{/snippet}

{#snippet topArtistsBlock()}
	{#if topArtists.length}
		{@render titleNav(t('home.topArtists'), '/charts/top')}
		{#if densityOf('top-artists') === 'compact'}
			<CompactPager items={compactSlice(topArtists)} key={(a) => a.name}>
				{#snippet row(a: DiscoveryArtist)}
					<CompactRow
						variant="artist"
						title={names.dnArtist(a.name)}
						cover={tileCover({ image: a.image, mbid: a.mbid, artistName: a.name })}
						seed={a.name}
						onopen={() => goto('/artist/' + encodeURIComponent(a.name))}
					/>
				{/snippet}
			</CompactPager>
		{:else}
			<div class="albumrow" use:dragScroll>
				{#each topArtists as a (a.name)}
					{@const artistCover = tileCover({ image: a.image, mbid: a.mbid, artistName: a.name })}
					<button class="album" onclick={() => goto('/artist/' + encodeURIComponent(a.name))}>
						<span class="al-cover round" style:background-image={fallbackCover(a.name)}>
							{#if artistCover}<img class="al-cover-img" src={artistCover} loading="lazy" alt="" onerror={hideOnError} />{/if}
						</span>
						<span class="al-name center" use:marquee><span class="marquee-inner">{names.dnArtist(a.name)}</span></span>
					</button>
				{/each}
			</div>
		{/if}
	{/if}
{/snippet}

<!-- A reusable compact/comfortable discovery shelf (top-hits / tags / countries share it). -->
{#snippet discoveryShelf(items: DiscoveryTrack[], compact: boolean)}
	{#if compact}
		<CompactPager items={compactSlice(items)} key={(item) => item.artist + ' ' + item.title}>
			{#snippet row(item: DiscoveryTrack)}
				<CompactRow
					title={names.dnTitle(item.title)}
					subtitle={names.dnArtist(item.artist)}
					cover={tileCover(item)}
					seed={item.artist + item.title}
					onplay={() => playStub(item)}
					onrequestmenu={() => tileMenu(item)}
				/>
			{/snippet}
		</CompactPager>
	{:else}
		<div class="albumrow" use:dragScroll>
			{#each items as item (item.artist + ' ' + item.title)}
				<button class="album" use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); tileMenu(item); }} onclick={() => playStub(item)}>
					<span class="al-cover" style:background-image={fallbackCover(item.artist + item.title)}>
						{#if tileCover(item)}<img class="al-cover-img" src={tileCover(item)} loading="lazy" alt="" onerror={hideOnError} />{/if}
					</span>
					<span class="al-name" use:marquee><span class="marquee-inner">{names.dnTitle(item.title)}</span></span>
					<span class="al-count" use:marquee><span class="marquee-inner">{names.dnArtist(item.artist)}</span></span>
				</button>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet tagsBlock()}
	{#each tagShelves as shelf (shelf.label)}
		{@render titleNav(t('home.tagShelf', { tag: shelf.label }), '/charts/tags/' + encodeURIComponent(shelf.label))}
		{@render discoveryShelf(shelf.tracks, densityOf('tags') === 'compact')}
	{/each}
{/snippet}

{#snippet countriesBlock()}
	{#each countryShelves as shelf (shelf.label)}
		{@render titleNav(t('home.countryShelf', { country: shelf.label }), '/charts/countries/' + encodeURIComponent(shelf.label))}
		{@render discoveryShelf(shelf.tracks, densityOf('countries') === 'compact')}
	{/each}
{/snippet}

{#snippet librarySongRow(track: Track)}
	{@const rowCover = track.cover ?? getCachedCover(track.artist, track.title)}
	<button class="album" use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); menuTrack = track; menuOpen = true; }} onclick={() => player.play(track, { fresh: true })}>
		<span class="al-cover" style:background-image={rowCover ? `url(${rowCover})` : fallbackCover(track.uid)}>
			{#if rowCover}<img class="al-cover-img" src={rowCover} loading="lazy" alt="" onerror={hideOnError} />{/if}
		</span>
		<span class="al-name" use:marquee><span class="marquee-inner">{names.dnTitle(track.title)}</span></span>
		<span class="al-count" use:marquee><span class="marquee-inner">{names.dnArtist(track.artist)}</span></span>
	</button>
{/snippet}

<!-- A reusable compact/comfortable library track shelf (liked / downloads / history / playlists). -->
{#snippet libraryShelf(tracks: Track[], compact: boolean)}
	{#if compact}
		<CompactPager items={compactSlice(tracks)} key={(track) => track.uid}>
			{#snippet row(track: Track)}
				<CompactRow
					title={names.dnTitle(track.title)}
					subtitle={names.dnArtist(track.artist)}
					cover={libraryRowCover(track)}
					seed={track.uid}
					track={track}
					onplay={() => playLibraryTrack(track)}
					onrequestmenu={() => openTrackMenu(track)}
				/>
			{/snippet}
		</CompactPager>
	{:else}
		<div class="albumrow" use:dragScroll>
			{#each tracks as track (track.uid)}{@render librarySongRow(track)}{/each}
		</div>
	{/if}
{/snippet}

{#snippet likedBlock()}
	{#if likedShelf.length}
		{@render titleNav(t('settings.homeSectionLiked'), '/library?tab=liked')}
		{@render libraryShelf(likedShelf, densityOf('liked') === 'compact')}
	{/if}
{/snippet}

{#snippet downloadsBlock()}
	{#if downloadsShelf.length}
		{@render titleNav(t('settings.homeSectionDownloads'), '/library?tab=downloads')}
		{@render libraryShelf(downloadsShelf, densityOf('downloads') === 'compact')}
	{/if}
{/snippet}

{#snippet historyBlock()}
	{#if historyShelf.length}
		{@render titleNav(t('settings.homeSectionHistory'), '/library?tab=history')}
		{@render libraryShelf(historyShelf, densityOf('history') === 'compact')}
	{/if}
{/snippet}

{#snippet favArtistsBlock()}
	{#if favArtistsShelf.length}
		{@render titleNav(t('settings.homeSectionFavArtists'), '/library?tab=fav-artists')}
		{#if densityOf('fav-artists') === 'compact'}
			<CompactPager items={compactSlice(favArtistsShelf)} key={(a) => a.name}>
				{#snippet row(a: { name: string })}
					<CompactRow
						variant="artist"
						title={names.dnArtist(a.name)}
						cover={tileCover({ image: null, mbid: null, artistName: a.name })}
						seed={a.name}
						onopen={() => goto('/artist/' + encodeURIComponent(a.name))}
					/>
				{/snippet}
			</CompactPager>
		{:else}
			<div class="albumrow" use:dragScroll>
				{#each favArtistsShelf as a (a.name)}
					{@const artistCover = tileCover({ image: null, mbid: null, artistName: a.name })}
					<button class="album" onclick={() => goto('/artist/' + encodeURIComponent(a.name))}>
						<span class="al-cover round" style:background-image={fallbackCover(a.name)}>
							{#if artistCover}<img class="al-cover-img" src={artistCover} loading="lazy" alt="" onerror={hideOnError} />{/if}
						</span>
						<span class="al-name center" use:marquee><span class="marquee-inner">{names.dnArtist(a.name)}</span></span>
					</button>
				{/each}
			</div>
		{/if}
	{/if}
{/snippet}

{#snippet playlistsBlock()}
	{#each playlistShelves as shelf (shelf.id)}
		<!-- D-13: per-playlist shelf deep-links to THAT playlist's detail (tab=playlists +
		     the playlist id), NOT the generic Playlists tab. id is encodeURIComponent-wrapped. -->
		{@render titleNav(shelf.name, '/library?tab=playlists&playlist=' + encodeURIComponent(shelf.id))}
		{@render libraryShelf(shelf.tracks, densityOf('playlists') === 'compact')}
	{/each}
{/snippet}

<TrackMenu track={menuTrack} open={menuOpen} loading={menuLoading} onclose={() => { menuOpen = false; menuLoading = false; menuGen++; }} />

<style>
	.topnav { display: flex; align-items: center; justify-content: space-between; padding: 14px 0 10px; }
	.brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 1.35rem; }
	.gear { background: none; border: none; color: var(--color-text); cursor: pointer; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; }
	.gear:hover { background: var(--color-surface-2); }
	.searchpill {
		width: 100%; text-align: left; background: var(--color-surface-2);
		border: 1px solid var(--color-border); border-radius: 999px;
		padding: 11px 16px; color: var(--color-text-muted); font-size: 13px;
		display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 18px;
	}
	.section .head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
	.section h2 { font-size: calc(1.1rem * var(--fs-title, 1)); margin: 0; }
	/* D-14: section title is a full-row tap target (title + trailing chevron). Keeps the old
	   .subhead typography (0.95rem/700); ≥44px touch height; chevron pushed right. */
	.subhead-nav {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		margin: 14px 0 8px;
		padding: 0;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		color: var(--color-text);
		font-size: calc(0.95rem * var(--fs-title, 1));
		font-weight: 700;
	}
	.subhead-label { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.subhead-nav :global(.subhead-chev) { margin-left: auto; flex: none; color: var(--color-text-muted); }
	@media (hover: hover) { .subhead-nav:hover .subhead-label { color: var(--color-text-muted); } }
	/* Compact-row cold-load skeleton (UI-SPEC §2): mirrors the compact pager column shape. */
	.compact-skel-pager { display: flex; gap: 12px; overflow: hidden; }
	.compact-skel-col { flex: 0 0 90vw; max-width: 90vw; display: flex; flex-direction: column; gap: 8px; }
	@media (min-width: 640px) { .compact-skel-col { flex-basis: 420px; max-width: 420px; } }
	.compact-skel-row { display: flex; align-items: center; gap: 8px; min-height: 44px; }
	.cs-art { width: 40px; height: 40px; border-radius: 6px; flex: none; }
	.cs-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
	.cs-bar { height: 11px; border-radius: 5px; }
	.cs-bar-title { width: 62%; }
	.cs-bar-sub { width: 40%; height: 9px; }
	.more, .retry {
		background: none; border: 1px solid var(--color-border); color: var(--color-text-muted);
		padding: 5px 12px; border-radius: 999px; font-size: 12px; cursor: pointer;
		display: inline-flex; align-items: center; gap: 5px;
	}
	/* Horizontal scroll row (copied from the artist page .albumrow pattern). */
	.albumrow { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 4px; }
	/* min-width:0 is REQUIRED: without it the flex item's default min-width:auto lets the
	   nowrap .al-name/.al-count grow the tile past its 130px basis to fit the full text — which
	   both widened the row AND defeated the marquee (its clientWidth grew to the text width so
	   scrollWidth>clientWidth never tripped). Pinning min-width:0 holds the 130px basis, so the
	   labels clip to the cover width and the marquee correctly detects + scrolls the overflow. */
	.album { flex: 0 0 calc(130px * var(--cover-scale, 1)); min-width: 0; max-width: calc(130px * var(--cover-scale, 1)); background: none; border: none; padding: 0; cursor: pointer; text-align: left; display: flex; flex-direction: column; gap: 4px; transition: transform 0.12s ease; }
	/* MENU-03 / D-12: hover-capable devices only — a touch long-press otherwise latches the
	   :active scale under the held finger while the track menu opens. */
	@media (hover: hover) { .album:active { transform: scale(0.96); } }
	.al-cover { position: relative; overflow: hidden; width: calc(130px * var(--cover-scale, 1)); height: calc(130px * var(--cover-scale, 1)); border-radius: 10px; background-size: cover; background-position: center; background-color: var(--color-surface-2); }
	.al-cover.round { border-radius: 50%; }
	/* w87: COMPACT density — tighter tiles + gaps so more fit per shelf row. Comfortable
	   (the default) keeps the values above. The class is set on .section from
	   settings.homeDensity, so toggling the setting re-sizes every shelf/grid live. */
	.section.compact .albumrow { gap: 8px; }
	.section.compact .album { flex-basis: calc(96px * var(--cover-scale, 1)); max-width: calc(96px * var(--cover-scale, 1)); }
	.section.compact .al-cover { width: calc(96px * var(--cover-scale, 1)); height: calc(96px * var(--cover-scale, 1)); }
	.section.compact .grid { gap: 8px; }
	/* FIX-B: real cover (Last.fm or CAA) layered over the gradient span; onerror hides it
	   (a 404 → the gradient shows). inherit border-radius so the round variant clips it. */
	.al-cover-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
	.al-name { font-size: calc(12px * var(--fs-title, 1)); font-weight: 600; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.al-name.center { text-align: center; }
	.al-count { font-size: calc(11px * var(--fs-artist, 1)); color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	/* Marquee animation now lives globally in app.css (transform-based .marquee-inner). The
	   clip element keeps overflow:hidden + white-space:nowrap above; when text overflows the
	   use:marquee action sets --marquee-dx + .marquee-on and the inner span scrolls. */
	/* Fallback grid (D-06). */
	.grid { display: grid; grid-template-columns: repeat(var(--home-grid-cols, 3), 1fr); gap: 12px; }
	.tile {
		position: relative; aspect-ratio: 1 / 1; border-radius: var(--radius-md);
		overflow: hidden; cursor: pointer; border: none; padding: 0; background: var(--color-surface-2);
		transition: transform 0.12s ease;
	}
	/* MENU-03 / D-12: hover-capable devices only (see .album:active above). */
	@media (hover: hover) { .tile:active { transform: scale(0.96); } }
	.art { position: absolute; inset: 0; background-size: cover; background-position: center; }
	.scrim { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 55%); }
	.label { position: absolute; left: 7px; right: 7px; bottom: 6px; text-align: left; }
	.t-title { font-size: calc(11px * var(--fs-title, 1)); font-weight: 700; line-height: 1.2; color: #fff; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.t-artist { font-size: calc(10px * var(--fs-artist, 1)); color: #d8d8de; margin-top: 2px; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.q { position: absolute; top: 6px; right: 6px; font-size: 8px; font-weight: 700; padding: 2px 5px; border-radius: 4px; background: rgba(0,0,0,0.55); color: #fff; }
	.error { color: #ff7a90; font-size: 14px; }
</style>
