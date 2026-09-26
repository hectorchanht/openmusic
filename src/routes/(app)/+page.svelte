<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { navigating } from '$app/state';
	import { Search, Settings, RotateCw, ChevronRight } from '@lucide/svelte';
	import Logo from '$lib/components/Logo.svelte';
	import ShelfChevrons from '$lib/components/ShelfChevrons.svelte';
	import { buildDiversePicks } from '$lib/services/picks';
	import { buildRadio } from '$lib/services/radio';
	import type { QueueContext } from '$lib/config/defaults';
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
		resolveChartRegion,
		resolveExtraRegions,
		resolveChartGenres,
		CHART_SECTIONS,
		CLASSIC_SECTIONS,
		type HomeSectionId,
		type HomeDensity
	} from '$lib/services/home-layout';
	import {
		planChartShelves,
		poolKey,
		genrePoolKey,
		samplePicks,
		regionLabel,
		CHART_GENRE_LABEL,
		HOME_CACHE_KEY,
		LEGACY_HOME_CACHE_KEYS,
		POOL_STALE_MS,
		POOL_CAP,
		type ChartTask
	} from '$lib/services/home-charts';
	import {
		appleSongs,
		appleAlbums,
		kkboxSongs,
		kkboxNewReleases,
		ytTracks,
		ytArtists,
		genreChart
	} from '$lib/services/charts';
	import { fuseCharts, type ChartAlbum } from '$lib/services/chart-parse';
	import { settings } from '$lib/stores/settings.svelte';
	import { deezerChart } from '$lib/services/deezer';
	import { backfillCovers, backfillArtistCovers } from '$lib/services/cover-backfill';
	import { lazyCover } from '$lib/actions/lazyCover';
	// quick-260615-hep: read covers through the GLOBAL reactive signal so a cover landing anywhere
	// (now-playing, lazyCover, backfill) repaints homepage tiles live; read uid-first for Track rows.
	import {
		coverVersion,
		readCoverByUidOrName,
		// quick-260915-w4f: the user's pinned cover. These home reads put track.cover FIRST, so a pin
		// folded only into the cache read would lose on every one of them.
		readPinnedCover,
		readCoverByName,
		readArtistCover,
		bumpCoverVersion
	} from '$lib/stores/cover-version.svelte';
	import { decodeShare } from '$lib/services/share';
	// 38-D-12: the legacy `?play=` decoder lands here. A static import is correct on THIS page — it
	// already imports the player store at module top (it is not an SSR landing surface); the
	// lazy-import-inside-onMount contract is specific to the two /song/* routes.
	import { arriveTrack } from '$lib/services/share-arrival';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { history as playHistory } from '$lib/stores/history.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { t } from '$lib/i18n';
	import { longpress } from '$lib/actions/longpress';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { dragScroll } from '$lib/actions/dragScroll';
	import { marquee } from '$lib/actions/marquee';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import CompactRow from '$lib/components/CompactRow.svelte';
	import CompactPager from '$lib/components/CompactPager.svelte';
	import HomeGridPager from '$lib/components/HomeGridPager.svelte';
	import PageOg from '$lib/components/PageOg.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import type { PageData } from './$types';
	import type { Track } from '$lib/sources/types';
	import { coverGradient } from '$lib/services/cover-gradient';

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
	// w87: the cache is keyed by HOME_CACHE_KEY ONLY (NOT by the home-layout config). A config
	// change (subset / shelf size) is reconciled by the background refresh(false,true) that
	// runs after applyCache — it re-fetches with the CURRENT config and overwrites the cache,
	// so the next paint reflects the change without adding config to the key.
	// 39-D-26: v3 (HOME_CACHE_KEY, shared with the settings Clear-picks button) adds the chart
	// POOLS (≤ POOL_CAP rows per key) and the sampled PICKS (indices into each pool). A v2 blob is
	// not migrated — loadCache rejects it, which simply forces one cold refresh; saveCache removes
	// the legacy keys.

	// A labelled tag/country row paired with its heading.
	type Shelf = { label: string; tracks: DiscoveryTrack[] };
	/** Chart pools by pool key (poolKey / genrePoolKey), one map per item shape. */
	type ChartPools = {
		songs: Record<string, DiscoveryTrack[]>;
		artists: Record<string, DiscoveryArtist[]>;
		albums: Record<string, ChartAlbum[]>;
	};
	// Versioned cache payload: the chart pools + picks, the four classic shelves + the fallback flag.
	// `cfg` (stamped by saveCache) is a signature of the home-layout config the shelves were
	// built with (shelf size + selected tag/country subset). On reload we only background-
	// revalidate when it DIFFERS from the current config — so a Randomize arrangement survives a
	// refresh instead of being clobbered by a fresh page-1 fetch (a non-randomize revalidate is
	// deterministic page 1, so skipping it when config is unchanged loses nothing).
	type ShelfCache = {
		v: 3;
		/** When the pools were fetched — drives the silent POOL_STALE_MS revalidate (39-D-32). */
		fetchedAt: number;
		pools: ChartPools;
		picks: Record<string, number[]>;
		topHits: DiscoveryTrack[];
		topArtists: DiscoveryArtist[];
		tagShelves: Shelf[];
		countryShelves: Shelf[];
		useFallback: boolean;
		fallback: Track[];
		cfg?: string;
	};

	// 39-D-26: chart pools + the sampled picks the shelves render (see sampledSongs & co).
	let pools = $state<ChartPools>({ songs: {}, artists: {}, albums: {} });
	let picks = $state<Record<string, number[]>>({});
	// Plain fields — the UI never reads them. `pendingPools` holds a silently revalidated pool set
	// that must NOT swap tiles on screen; the next mount or a Randomize press adopts it (39-D-32).
	let poolsFetchedAt = 0;
	let pendingPools: { pools: ChartPools; fetchedAt: number } | null = null;

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
	// quick-260924-pgu: "Your Radio" — lazy `nameStub` Tracks (resolveByName), similar-but-unheard
	// songs seeded from play history. Built ONCE per mount (see onMount), not on every refresh(),
	// because unlike the other local shelves it costs network.
	let radioShelf = $state<Track[]>([]);
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
		// quick-260924-pgu: Randomize reshuffles the radio tiles it already has — it does NOT refetch.
		if (randomize) radioShelf = shuffle(radioShelf);
		playlistShelves = library.playlists
			.filter((p) => p.tracks.length > 0)
			.map((p) => ({ id: p.id, name: p.name, tracks: pickN(p.tracks, cap, randomize) }));
		// kmn: favourite artists — same shape as topArtists tiles (name only; cover backfills).
		favArtistsShelf = pickN(library.favArtists, cap, randomize).map((n) => ({ name: n }));
		// Schedule a cover backfill for the rendered fav-artist names (Deezer → iTunes chain,
		// post-paint, capped + cached; same posture as the top-artists tier).
		if (favArtistsShelf.length) {
			void backfillArtistCovers(favArtistsShelf.map((a) => a.name), {
				onResolved: () => bumpCoverVersion(),
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
				onResolved: () => bumpCoverVersion(),
				max: favArtistsShelf.length
			});
		}
	}

	let loading = $state(true);
	let error = $state<string | null>(null);

	// D-15: the home local toast copy migrated to the global `toast` store (rendered once by
	// ToastHost in the (app) layout). Call sites use `toast.show(...)`.

	// Shared placeholder gradient (cover-gradient.ts) — was inlined in eight files.
	function fallbackCover(seed: string): string {
		return coverGradient(seed);
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
	// cached lookups read the GLOBAL coverVersion() signal so Svelte 5 re-evaluates each tile's
	// <img src> when a cover lands ANYWHERE (now-playing/lazyCover/backfill all bump it). Track
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
		coverVersion(); // reactive dependency on the GLOBAL signal: recompute when a cover lands anywhere
		if (item.image) return item.image;
		// NOTE: the CAA-by-mbid tier was REMOVED here — coverartarchive.org image loads are
		// blocked by the browser's Opaque Response Blocking (net::ERR_BLOCKED_BY_ORB), so a CAA
		// URL always renders broken AND shadowed the working Deezer/CN backfilled cover for any
		// item that carried an mbid (the runtime root cause of "most tiles are color blocks").
		// DiscoveryTrack carries NO uid → name-key only (the cross-surface bridge); reactive readers.
		if (item.artist && item.title) return readCoverByName(item.artist, item.title);
		if (item.artistName) return readArtistCover(item.artistName);
		return null;
	}
	// Hide a cover <img> on load error so the gradient underneath shows (no broken-image icon).
	function hideOnError(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}

	// quick-260615-hep: the local coverVer was replaced by the GLOBAL coverVersion() signal (see the
	// cover-version.svelte import) so a cover landing on ANY surface — now-playing, lazyCover, this
	// page's backfill — repaints every mounted tile here, not just this page's own backfill resolves.

	// quick-260607-0bb (supersedes wv8): gather every TRACK row across all shelves that still
	// shows a gradient (no Last.fm image AND no mbid) — exactly the tiles nza's CAA path could
	// not cover — and every top-ARTIST tile with no Last.fm image (artist art is deprecated →
	// always null). Then fire BOTH lazy, concurrency-capped backfills OFF the critical path (void,
	// never awaited before paint): track covers (Deezer → iTunes → CN) and artist images
	// (Deezer → iTunes). Both skip already-cached entries, so a warm visit issues ~0 requests. The
	// same bumpCoverVersion() onResolved makes covers — track AND artist — appear progressively as resolves
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
		// 39-D-31: chart rows carry EMBEDDED art, so this normally adds nothing — the backfill stays
		// the rare backup for an imageless (or allowlist-rejected) chart row.
		const keys = plannedKeys();
		for (const key of keys) pushNeeding(sampledSongs(key));
		if (rows.length) {
			void backfillCovers(rows, { onResolved: () => bumpCoverVersion(), max: rows.length });
		}

		// 0bb: artist tiles are structurally gradient (Last.fm artist art deprecated → null).
		// Resolve their images via Deezer → iTunes, capped (= full gathered set) + cached + post-paint.
		const artistNames = [...topArtists, ...keys.flatMap((key) => sampledArtists(key))]
			.filter((a) => !a.image)
			.map((a) => a.name);
		if (artistNames.length) {
			void backfillArtistCovers(artistNames, {
				onResolved: () => bumpCoverVersion(),
				max: artistNames.length
			});
		}
	}

	// --- Chart shelves (39-D-26 … 39-D-32) ------------------------------------------------------
	// The resolved chart config. Every value has passed the home-layout resolvers, so nothing a
	// persisted setting holds can reach an upstream URL unchecked.
	const chartRegion = $derived(
		resolveChartRegion(
			settings.homeChartRegion,
			settings.appLang,
			typeof navigator !== 'undefined' ? navigator.language : undefined
		)
	);
	const chartExtraRegions = $derived(resolveExtraRegions(settings.homeExtraRegions, chartRegion));
	const chartGenres = $derived(resolveChartGenres(settings.homeChartGenres));
	const isVisible = (id: HomeSectionId) => !settings.homeHidden.includes(id);
	/** 39-D-30: any classic (Deezer / Last.fm) section visible — the only case that fetches them. */
	const classicVisible = $derived(CLASSIC_SECTIONS.some((id) => isVisible(id)));

	/** The fetches the visible, region-capable chart shelves need. Hidden ⇒ no task ⇒ zero requests. */
	function chartTasks(): ChartTask[] {
		return planChartShelves({
			region: chartRegion,
			extraRegions: chartExtraRegions,
			genres: chartGenres,
			hidden: settings.homeHidden
		});
	}
	/** Distinct pool keys of the current plan (chart-songs plans two tasks under one key). */
	function plannedKeys(): string[] {
		return [...new Set(chartTasks().map((task) => task.key))];
	}

	// T-39-29: `picks` / `pools` are persisted, so a tampered or stale index is simply skipped and a
	// non-array value yields an empty shelf instead of a render-time throw.
	function sampled<T>(pool: T[] | undefined, key: string): T[] {
		const idx = picks[key];
		if (!Array.isArray(idx) || !Array.isArray(pool)) return [];
		return idx.flatMap((i) => (pool[i] ? [pool[i]] : []));
	}
	const sampledSongs = (key: string) => sampled(pools.songs[key], key);
	const sampledArtists = (key: string) => sampled(pools.artists[key], key);
	const sampledAlbums = (key: string) => sampled(pools.albums[key], key);
	const hasPool = (key: string) =>
		!!(pools.songs[key]?.length || pools.artists[key]?.length || pools.albums[key]?.length);

	const genreShelves = $derived(
		chartGenres
			.map((g) => ({ id: g, key: genrePoolKey(g), items: sampledSongs(genrePoolKey(g)) }))
			.filter((s) => s.items.length)
	);
	const regionShelves = $derived(
		chartExtraRegions
			.map((cc) => ({ cc, key: poolKey('region', cc), items: sampledSongs(poolKey('region', cc)) }))
			.filter((s) => s.items.length)
	);

	type TaskResult =
		| { kind: 'songs'; items: DiscoveryTrack[] }
		| { kind: 'artists'; items: DiscoveryArtist[] }
		| { kind: 'albums'; items: ChartAlbum[] };
	/** Every charts.ts call is never-throw (→ [] on failure), so no try/catch here. */
	async function fetchTask(task: ChartTask): Promise<TaskResult> {
		switch (task.src) {
			case 'apple':
				return task.kind === 'songs'
					? { kind: 'songs', items: await appleSongs(task.cc) }
					: { kind: 'albums', items: await appleAlbums(task.cc) };
			case 'kkbox':
				return {
					kind: 'songs',
					items: await (task.kind === 'song' ? kkboxSongs(task.cc) : kkboxNewReleases(task.cc))
				};
			case 'yt':
				return task.kind === 'tracks'
					? { kind: 'songs', items: await ytTracks(task.cc) }
					: { kind: 'artists', items: await ytArtists(task.cc) };
			case 'genre':
				return { kind: 'songs', items: await genreChart(task.genre) };
		}
	}
	function uniqBy<T>(items: T[], key: (x: T) => string): T[] {
		const seen = new Set<string>();
		return items.filter((x) => {
			const k = key(x);
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		});
	}

	// Generation of the chart FETCH, separate from refreshGen: only a newer chart fetch supersedes
	// one in flight. A Randomize press bumps refreshGen but must NOT cancel pools still landing on a
	// cold load (the button stays enabled when no classic section is visible) — they are new content,
	// not stale content. Plain field (never read by the UI).
	let chartGen = 0;

	/**
	 * 39-D-28: run the planned tasks grouped by pool key, FANOUT_CAP groups in flight. Each group's
	 * pool is written AS IT LANDS (chartGen-guarded), so one hanging Apple call never holds back the
	 * KKBOX / YouTube shelves (RESEARCH Pitfall 9). `apply(key)` = also write the reactive state for
	 * that key (the silent revalidate applies only keys with nothing on screen). An EMPTY answer
	 * (upstream failure) keeps the current pool. Rows are de-duplicated on the way in because the
	 * shelves key their rows by artist + title (or name) — a chart listing the same song twice
	 * (explicit + clean) would otherwise collide.
	 */
	async function runChartTasks(tasks: ChartTask[], gen: number, apply: (key: string) => boolean) {
		const groups = new Map<string, ChartTask[]>();
		for (const task of tasks) groups.set(task.key, [...(groups.get(task.key) ?? []), task]);
		const out: ChartPools = { songs: {}, artists: {}, albums: {} };
		const outPicks: Record<string, number[]> = {};
		const n = clampShelfSize(settings.homeShelfSize);
		await mapWithConcurrency([...groups.values()], FANOUT_CAP, async (group) => {
			const results = await Promise.all(group.map(fetchTask));
			if (gen !== chartGen) return; // superseded by a newer chart fetch (WR-04 idiom)
			const key = group[0].key;
			const live = apply(key);
			const first = results[0];
			let len = 0;
			if (first.kind === 'artists') {
				const items = uniqBy(first.items, (a) => a.name).slice(0, POOL_CAP);
				if (!(len = items.length)) return;
				out.artists[key] = items;
				if (live) pools.artists[key] = items;
			} else if (first.kind === 'albums') {
				const items = uniqBy(first.items, (a) => a.artist + ' ' + a.name).slice(0, POOL_CAP);
				if (!(len = items.length)) return;
				out.albums[key] = items;
				if (live) pools.albums[key] = items;
			} else {
				// Top Songs in hk/tw/sg: KKBOX + Apple fused, Apple's list FIRST so its display strings
				// win (CONTEXT). A one-list group runs through fuseCharts too — rank order is kept and
				// duplicates collapse.
				const lists = group
					.map((task, i) => ({ apple: task.src === 'apple', r: results[i] }))
					.sort((a, b) => Number(b.apple) - Number(a.apple))
					.flatMap(({ r }) => (r.kind === 'songs' ? [r.items] : []));
				const items = fuseCharts(lists, 60, POOL_CAP);
				if (!(len = items.length)) return;
				out.songs[key] = items;
				if (live) pools.songs[key] = items;
			}
			outPicks[key] = samplePicks(len, n);
			if (live) picks[key] = outPicks[key];
		});
		return { pools: out, picks: outPicks };
	}

	/**
	 * 39-D-29: Randomize for the chart shelves is a LOCAL re-draw — zero requests. A pool set the
	 * silent revalidate parked in `pendingPools` is adopted first, so the press samples fresh charts.
	 */
	function redrawPicks() {
		if (pendingPools) {
			pools = pendingPools.pools;
			poolsFetchedAt = pendingPools.fetchedAt;
			pendingPools = null;
		}
		const n = clampShelfSize(settings.homeShelfSize);
		const next: Record<string, number[]> = {};
		for (const map of [pools.songs, pools.artists, pools.albums]) {
			for (const [key, pool] of Object.entries(map)) {
				next[key] = samplePicks(Array.isArray(pool) ? pool.length : 0, n); // T-39-29
			}
		}
		picks = next;
	}

	/**
	 * 39-D-32 (CONTEXT: a stale refresh lands on the NEXT visit): refetch every planned pool in the
	 * background and write it to the cache WITHOUT touching the pools on screen, so nothing swaps
	 * under the user. A planned key with NO pool yet (its earlier fetch failed or was cut short) has
	 * nothing to swap, so it is shown as it lands. `onlyMissing` fetches just those keys (fresh pools,
	 * one failed shelf) instead of the whole plan. It bumps neither generation — it must never
	 * supersede a user action — and bails if anything else started meanwhile.
	 */
	async function revalidatePools(onlyMissing = false) {
		const gen = refreshGen;
		const cg = chartGen;
		const tasks = chartTasks().filter((task) => !onlyMissing || !hasPool(task.key));
		const fresh = await runChartTasks(tasks, cg, (key) => !hasPool(key));
		if (gen !== refreshGen || cg !== chartGen) return;
		// A cached D-06 fallback grid hides every shelf; once a pool exists it has served its purpose,
		// or the grid would be persisted (and shown) again on every later visit.
		if (useFallback && hasAnyContent()) {
			useFallback = false;
			fallbackSongs = [];
		}
		if (onlyMissing) {
			saveCache(); // every fetched key was missing, so all of them are already on screen
			return;
		}
		const merged: ChartPools = {
			songs: { ...pools.songs, ...fresh.pools.songs },
			artists: { ...pools.artists, ...fresh.pools.artists },
			albums: { ...pools.albums, ...fresh.pools.albums }
		};
		pendingPools = { pools: merged, fetchedAt: Date.now() };
		saveCache({ pools: merged, picks: { ...picks, ...fresh.picks }, fetchedAt: pendingPools.fetchedAt });
	}

	// D-06 / UI-SPEC §1.8 (RESEARCH Pitfall 2): the fallback grid replaces EVERY section, so it may only
	// win when every VISIBLE shelf — chart, classic and library — is empty. Also gates the cold skeleton.
	function hasAnyContent(): boolean {
		const library: [HomeSectionId, number][] = [
			['liked', likedShelf.length],
			['downloads', downloadsShelf.length],
			['history', historyShelf.length],
			['radio', radioShelf.length],
			['playlists', playlistShelves.length],
			['fav-artists', favArtistsShelf.length]
		];
		return (
			plannedKeys().some(
				(key) => sampledSongs(key).length || sampledArtists(key).length || sampledAlbums(key).length
			) ||
			(isVisible('top-hits') && topHits.length > 0) ||
			(isVisible('top-artists') && topArtists.length > 0) ||
			(isVisible('tags') && tagShelves.some((s) => s.tracks.length)) ||
			(isVisible('countries') && countryShelves.some((s) => s.tracks.length)) ||
			library.some(([id, n]) => n > 0 && isVisible(id))
		);
	}

	// localStorage is browser-only; these run inside onMount / click handlers (never SSR).
	// Signature of the home-layout config the shelves depend on. Two cached payloads with the
	// same cfg would re-fetch (non-randomized) to the identical page-1 surface, so a reload can
	// safely skip the revalidate and keep whatever is cached (incl. a Randomize arrangement).
	// 39-D-27 (RESEARCH Pitfall 4): hidden now GATES fetching, so the visible network-backed set is
	// part of the signature — un-hiding a section must revalidate, or the reload keeps a cache that
	// never fetched it. Region / extra regions / genres are in it for the same reason.
	function configSig(): string {
		return JSON.stringify({
			s: clampShelfSize(settings.homeShelfSize),
			t: isVisible('tags') ? resolveSubset(settings.homeTags, DISCOVERY_TAGS) : [],
			c: isVisible('countries') ? resolveSubset(settings.homeCountries, DISCOVERY_COUNTRIES) : [],
			r: chartRegion,
			x: chartExtraRegions,
			g: chartGenres,
			v: [...CHART_SECTIONS, ...CLASSIC_SECTIONS].filter((id) => isVisible(id))
		});
	}

	/**
	 * Persist the current home surface. `over` substitutes the pools/picks/fetchedAt (the silent
	 * revalidate writes fresh pools without assigning them). Only the CURRENT plan's pool keys are
	 * kept, so switching regions never grows the blob past ~one plan's worth of pools.
	 */
	function saveCache(over?: { pools: ChartPools; picks: Record<string, number[]>; fetchedAt: number }) {
		const keep = new Set(plannedKeys());
		function only<T>(m: Record<string, T>): Record<string, T> {
			return Object.fromEntries(Object.entries(m).filter(([k]) => keep.has(k)));
		}
		const src = over?.pools ?? pools;
		const payload: ShelfCache = {
			v: 3,
			cfg: configSig(),
			fetchedAt: over?.fetchedAt ?? poolsFetchedAt,
			pools: { songs: only(src.songs), artists: only(src.artists), albums: only(src.albums) },
			picks: only(over?.picks ?? picks),
			topHits,
			topArtists,
			tagShelves,
			countryShelves,
			useFallback,
			fallback: fallbackSongs
		};
		try {
			localStorage.setItem(HOME_CACHE_KEY, JSON.stringify(payload));
		} catch {
			/* quota or unavailable — non-fatal */
		}
		for (const key of LEGACY_HOME_CACHE_KEYS) {
			try {
				localStorage.removeItem(key);
			} catch {
				/* unavailable — non-fatal */
			}
		}
	}
	const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
	function loadCache(): ShelfCache | null {
		try {
			const raw = localStorage.getItem(HOME_CACHE_KEY);
			if (!raw) return null;
			const v: unknown = JSON.parse(raw);
			// T-39-28: v3 + shape guard; anything else (incl. an old v2 blob) → null → cold refresh.
			if (!isRecord(v) || v.v !== 3 || typeof v.fetchedAt !== 'number' || !isRecord(v.picks)) return null;
			const p = v.pools;
			if (!isRecord(p) || !isRecord(p.songs) || !isRecord(p.artists) || !isRecord(p.albums)) return null;
			return v as unknown as ShelfCache;
		} catch {
			return null;
		}
	}

	function applyCache(c: ShelfCache) {
		pools = c.pools;
		picks = c.picks;
		poolsFetchedAt = c.fetchedAt;
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

	// Fetch the chart pools and the visible classic shelves (concurrency-capped), fall back to
	// buildDiversePicks when every visible shelf is empty, cache the displayed result, and seed the
	// player queue. Used by Randomize + cold start + background revalidate.
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
	// FETCHES and OVERWRITES the cache below with the freshly-shuffled arrangement. (The chart
	// shelves are the exception: their Randomize re-samples the cached pools locally — 39-D-29.)
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
			// (a) CHART SHELVES. Randomize re-draws the picks locally (39-D-29, zero requests); every
			// other call runs the planned tasks, assigning each pool as it lands.
			if (randomize) {
				redrawPicks();
			} else {
				const tasks = chartTasks();
				if (tasks.length) {
					await runChartTasks(tasks, ++chartGen, () => true);
					if (gen !== refreshGen) return;
					poolsFetchedAt = Date.now();
					pendingPools = null; // this fetch is newer than anything a revalidate parked
				}
			}

			// (b) CLASSIC shelves. 39-D-30 (RESEARCH Pitfall 1): a hidden classic section issues ZERO
			// requests — Deezer /chart only for a visible top-hits / top-artists, the tag and country
			// fan-outs only for their own visible section. Hidden → the shelf state is emptied.
			let hits: DiscoveryTrack[] = [];
			let artists: DiscoveryArtist[] = [];
			let tags: Shelf[] = [];
			let countries: Shelf[] = [];
			if (classicVisible) {
				const hitsVisible = isVisible('top-hits');
				const artistsVisible = isVisible('top-artists');
				// w87: per-shelf tile count is the user setting, clamped to [6,24] (T-w87-01 — a
				// poisoned/old value can never produce a giant or NaN page size). Tag/country
				// fan-out runs over the SELECTED subset (resolveSubset falls back to the full pool
				// when none/garbage are selected, T-w87-03), so config can only NARROW the
				// surface — fan-out width stays ≤ the pool size, behind FANOUT_CAP (Pitfall 11).
				const perShelf = clampShelfSize(settings.homeShelfSize);
				const tagPool = isVisible('tags') ? resolveSubset(settings.homeTags, DISCOVERY_TAGS) : [];
				const countryPool = isVisible('countries')
					? resolveSubset(settings.homeCountries, DISCOVERY_COUNTRIES)
					: [];
				// Shelves 1+2 (chart) + the capped tag/country fan-out (shelves 3+4). All
				// builders never throw (→ [] on failure / absent key), so this never rejects.
				// On a randomize press, draw a fresh random page PER call so different shelves
				// pull from different pages; on a normal call pass page 1 (cache-friendly).
				const pg = () => (randomize ? pickRandomPage(RANDOM_PAGE_BOUND) : 1);
				// TOP-HITS + TOP-ARTISTS source from the Deezer /chart: covers + artist pictures are
				// EMBEDDED, so ONE request yields a fully-covered shelf and the per-tile cover backfill
				// is demoted to a rare backup (user: "less requests, backfill as backup not norm").
				// Tag/country shelves stay Last.fm (their imageless tiles are the backup backfill's job).
				const dzChart =
					hitsVisible || artistsVisible ? await deezerChart(perShelf) : { tracks: [], artists: [] };
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

				// Deezer PRIMARY; fall back to the Last.fm chart PER SOURCE only when Deezer is empty
				// (and only for a visible section).
				const rawHits = !hitsVisible
					? []
					: dzChart.tracks.length
						? dzChart.tracks
						: await getChartTopTracks(perShelf, pg());
				const rawArtists = !artistsVisible
					? []
					: dzChart.artists.length
						? dzChart.artists
						: await getChartTopArtists(perShelf);
				if (gen !== refreshGen) return;

				// On randomize, shuffle the chart shelves' tile order so even an overlapping page
				// renders visibly differently. (Non-randomize leaves them in Last.fm rank order.)
				hits = randomize ? shuffle(rawHits) : rawHits;
				artists = randomize ? shuffle(rawArtists) : rawArtists;

				// Build the tag/country shelves; on randomize also shuffle the tile order WITHIN
				// each shelf. w87: map over the resolved SUBSET (tagPool/countryPool) so the
				// shelves match the rows we fetched above — a deselected tag simply has no shelf.
				tags = tagPool.map((label, i) => ({
					label,
					tracks: randomize ? shuffle(tagRows[i] ?? []) : (tagRows[i] ?? [])
				})).filter((s) => s.tracks.length);
				countries = countryPool.map((label, i) => ({
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
			}
			topHits = hits;
			topArtists = artists;
			tagShelves = tags;
			countryShelves = countries;

			// (c) FALLBACK gate — hasAnyContent() sees chart, classic AND library shelves (Pitfall 2).
			if (hasAnyContent()) {
				// PRIMARY: the chart / classic / library surface (D-01/D-02).
				useFallback = false;
				fallbackSongs = [];
				saveCache();
				scheduleBackfill(); // FIX-A: fill gradients with real CN covers, post-paint, capped
			} else {
				// D-06 FALLBACK: absent key / all-empty → keep the home page populated.
				const diverse = await buildDiversePicks(PICK_COUNT);
				if (gen !== refreshGen) return; // superseded during the fallback fetch (WR-04)
				if (diverse.length) {
					useFallback = true;
					fallbackSongs = diverse;
					topHits = [];
					topArtists = [];
					tagShelves = [];
					countryShelves = [];
					if (seedQueue) player.setQueue(diverse, 'home-discovery');
					saveCache(); // pools stay in the payload, even when empty
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
	// `cover` defaults to the tile's own art; Trending passes null (39-D-34, see ytTrendingBlock).
	async function playStub(item: DiscoveryTrack, cover: string | null = item.image) {
		const tr = await player.playStub(item.artist, item.title, cover, 'home-discovery');
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

	// --- Home density modes (HOME-02/03, D-05/07/10; quick-260618-goe renamed list/pile/grid) ---
	// ALL sections 'list' BY DEFAULT — we pass 'list' as resolveSectionDensity's globalDefault
	// (the migrated equivalent of the legacy compact-by-default), so a section is 'pile'/'grid'
	// only when the user explicitly overrides it in /settings/home. A corrupt/garbage override
	// falls back to 'list' (resolveSectionDensity, T-23-09 — never blanks).
	function densityOf(id: HomeSectionId): HomeDensity {
		return resolveSectionDensity(id, settings.homeSectionDensity, 'list');
	}
	// D-10: compact item count = homeShelfSize rounded UP to the nearest full column of 4, so a
	// pager never shows a ragged trailing column shorter than the others would imply.
	const compactCount = $derived(Math.ceil(clampShelfSize(settings.homeShelfSize) / 4) * 4);
	function compactSlice<T>(arr: T[]): T[] {
		return arr.slice(0, compactCount);
	}

	// debug page-switch-lag-tap-dead (cycle 3): PROGRESSIVE SHELF MOUNT. The default config is 29
	// shelves × 24 rows = 692 CompactRows (9392 DOM nodes, 1374 ResizeObservers) mounted in ONE
	// synchronous render for a viewport that shows ~3 shelves. On a 4x-throttled prod build that was a
	// 455 ms long task between the Home-tab tap and the first frame — "tap Home, nothing happens" —
	// versus 54–109 ms and NO long task with three shelves. So shelves now mount against a flat
	// budget consumed in the user's section order (above-the-fold first): REVEAL_INITIAL with the
	// page, then REVEAL_PER_FRAME more per animation frame until every shelf is in, after which the
	// budget is Infinity so a later Randomize / revalidate renders in full as before. Every shelf still
	// ends up in the DOM — this is staging, not windowing.
	//
	// Back/forward (`popstate`) mounts everything at once: SvelteKit restores scrollY synchronously
	// after the render, and a three-shelf page would clamp that position to ~0.
	// One shelf per frame: 24 rows ≈ 30 ms at 4x CPU, so a step stays under a frame-ish and taps
	// land between steps; two per frame measured as 55–100 ms tasks at 4x for the same total time.
	const REVEAL_INITIAL = 3;
	const REVEAL_PER_FRAME = 1;
	let revealed = $state(navigating.type === 'popstate' ? Infinity : REVEAL_INITIAL);
	function shelfCount(id: HomeSectionId): number {
		if (id === 'tags') return tagShelves.length;
		if (id === 'countries') return countryShelves.length;
		if (id === 'playlists') return playlistShelves.length;
		if (id === 'genres') return genreShelves.length;
		if (id === 'regions') return regionShelves.length;
		// An empty single chart shelf renders nothing, so it must not use up a reveal frame.
		if (id === 'chart-songs' || id === 'new-releases' || id === 'yt-trending') {
			return sampledSongs(poolKey(id, chartRegion)).length ? 1 : 0;
		}
		if (id === 'chart-artists') return sampledArtists(poolKey(id, chartRegion)).length ? 1 : 0;
		if (id === 'chart-albums') return sampledAlbums(poolKey(id, chartRegion)).length ? 1 : 0;
		return 1;
	}
	/** Per visible section: how many of its shelves may mount right now, plus the grand total. */
	const shelfBudget = $derived.by(() => {
		const per: Partial<Record<HomeSectionId, number>> = {};
		let used = 0;
		for (const id of resolveSectionOrder(settings.homeSectionOrder)) {
			if (settings.homeHidden.includes(id)) continue;
			per[id] = Math.max(0, revealed - used);
			used += shelfCount(id);
		}
		return { per, total: used };
	});
	function revealShelves() {
		if (revealed >= shelfBudget.total) {
			revealed = Infinity;
			return;
		}
		revealed += REVEAL_PER_FRAME;
		requestAnimationFrame(revealShelves);
	}

	// Library-track row play (matches librarySongRow's comfortable behavior) + its menu open.
	// quick-260831-sp9: pass the SHELF's queue context. These shelves deliberately do not install a
	// queue — a simple tap should generate a fresh Up-Next — but without a context the player kept
	// the previous play's one, so tapping a liked song after an album inherited 'album' →
	// 'same-list' → no regenerate, and Up-Next still showed the album. Manual `Play next` /
	// `Add to queue` entries survive because regenerate preserves them.
	function playLibraryTrack(track: Track, ctx: QueueContext) {
		// quick-260924-pgu: a radio row is a lazy name stub. play() records history with the
		// PRE-resolve object (player.svelte.ts `history.record(track)`), so a raw stub play would
		// write a synthetic `similar-` uid into history whose replay cannot resolve (toEntry drops
		// `resolveByName`). Keyed on the TRACK, not on ctx, so the rule reads "stubs play via
		// playStub" wherever a stub shows up; real library tracks keep the direct fresh play.
		if (track.resolveByName) {
			void playRadioTrack(track);
			return;
		}
		player.play(track, { fresh: true, context: ctx });
	}
	// quick-260924-pgu: mirrors the album hero Play (quick-260919-alb / quick-260915-vb9) — `sameList`
	// pins the same-list branch so the fresh-play tail does not regenerate over the install;
	// setListQueue after the resolve anchors the now-real `current` into the shelf by
	// uid-then-sameSongKey, so the remaining radio tiles are the Up Next. Toast gate copied from
	// playStub(item) above (null = miss OR supersede; only a miss clears pendingTrack).
	async function playRadioTrack(track: Track) {
		const tr = await player.playStub(track.artist, track.title, track.cover, 'home-discovery', {
			sameList: true
		});
		if (!tr) {
			if (player.pendingTrack == null) toast.show(t('home.unplayable'));
			return;
		}
		player.setListQueue(radioShelf, 'home-discovery');
	}
	function openTrackMenu(track: Track) {
		menuTrack = track;
		menuOpen = true;
	}
	function libraryRowCover(track: Track): string | null {
		// quick-260615-hep: library rows carry a full Track (uid present) → read uid-first then name,
		// through the global reactive signal so a cover resolved elsewhere repaints this row live.
		// quick-260915-w4f: a pin outranks the inline source cover (rung 0).
		return readPinnedCover(track.uid) ?? track.cover ?? readCoverByUidOrName(track.uid, track.artist, track.title);
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
		// quick-260924-pgu: fires in the first request burst (ahead of the tag/country fan-out) so the
		// shelf lands early; a hidden section spends nothing. buildRadio never throws and returns []
		// on empty history (zero requests), so there is no error path — an empty shelf renders nothing.
		if (!settings.homeHidden.includes('radio')) {
			void buildRadio(playHistory.entries, clampShelfSize(settings.homeShelfSize)).then((r) => {
				radioShelf = r;
			});
		}

		// Shared link: /?play=<token>. 38-D-11: the DECODER is kept — nothing emits this shape any
		// more, but old links are in the wild and must keep working. 38-D-12: what changed is where
		// it lands. Its payload is now ONLY `current`; the sender's queue is deliberately DROPPED,
		// because the RECIPIENT's queue shape is what survives an arrival (38-D-02/D-07). The old
		// body here did a `setQueue(...)` install plus a FRESH play of the decoded track — a full queue
		// replacement plus a tail regeneration, i.e. exactly the queue nuke this phase exists to stop
		// (GLN-1/GLN-2 wanted continuity, but paid for it with the recipient's whole up-next).
		// Routing through `arriveTrack` gives one behaviour instead of three: cold → armed, paused,
		// no autoplay (38-D-06); warm → splice in after current and play, queue rows intact —
		// identical to a /song/* arrival and to the Android deep link.
		const token = new URLSearchParams(location.search).get('play');
		if (token) {
			const { current } = decodeShare(token);
			if (current) {
				void arriveTrack(current).then((o) => {
					// 38-D-20: only a WARM arrival changed the music under the user, so only it toasts.
					if (o === 'played') toast.show(t('toast.sharedPlaying'));
				});
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
			// 39-D-32: pools older than POOL_STALE_MS revalidate SILENTLY — the fresh pools land in the
			// cache (and a Randomize press) but tiles on screen do not swap until the next app open.
			else if (Date.now() - cached.fetchedAt > POOL_STALE_MS) void revalidatePools();
			// A planned key with no pool (a failed or cut-short first fetch) is fetched on its own, so
			// a transient upstream miss cannot blank a shelf for the whole six hours.
			else if (chartTasks().some((task) => !hasPool(task.key))) void revalidatePools(true);
		} else {
			// Cold cache: full fetch. Seed the queue unless a shared link is taking over.
			refresh(!token);
		}
		// Cycle 3: stage the remaining shelves in over the next frames (see shelfBudget).
		requestAnimationFrame(revealShelves);
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

<section class="section" class:compact={settings.homeDensity === 'list'}>
	<div class="head">
		<h2>{t('home.topPicks')}</h2>
		{#if settings.homeShowRandomize}
			<!-- UI-SPEC §1.7: the chart shelves re-sample locally, so the disabled "Loading…" state is
			     confined to a visible classic section (the only case that still fetches). -->
			<button class="more" onclick={() => refresh(true, false, true)} disabled={loading && classicVisible}><RotateCw size={13} /> {loading && classicVisible ? t('home.loadingPicks') : t('home.randomize')}</button>
		{/if}
	</div>

	{#if loading && !useFallback && !hasAnyContent() && !fallbackSongs.length}
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
				<!-- quick-260915-w4f: a pin outranks the tile's inline cover. {@const} must be the immediate
				     child of the {#each}, not of the <button>. -->
				{@const art = readPinnedCover(track.uid) ?? track.cover}
				<button class="tile" use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); menuTrack = track; menuOpen = true; }} onclick={() => { player.setQueue(fallbackSongs, 'home-discovery'); player.play(track, { fresh: true }); }}>
					<div class="art" style:background-image={art ? `url(${art})` : fallbackCover(track.uid)}></div>
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
			{#if !settings.homeHidden.includes(id) && (shelfBudget.per[id] ?? 0) > 0}
				{#if id === 'top-hits'}{@render topHitsBlock()}
				{:else if id === 'top-artists'}{@render topArtistsBlock()}
				{:else if id === 'tags'}{@render tagsBlock()}
				{:else if id === 'countries'}{@render countriesBlock()}
				{:else if id === 'liked'}{@render likedBlock()}
				{:else if id === 'downloads'}{@render downloadsBlock()}
				{:else if id === 'fav-artists'}{@render favArtistsBlock()}
				{:else if id === 'playlists'}{@render playlistsBlock()}
				{:else if id === 'history'}{@render historyBlock()}
				{:else if id === 'radio'}{@render radioBlock()}
				{:else if id === 'chart-songs'}{@render chartSongsBlock()}
				{:else if id === 'new-releases'}{@render newReleasesBlock()}
				{:else if id === 'chart-artists'}{@render chartArtistsBlock()}
				{:else if id === 'yt-trending'}{@render ytTrendingBlock()}
				{:else if id === 'genres'}{@render genresBlock()}
				{:else if id === 'regions'}{@render regionsBlock()}
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

<!-- 39-D-33 (UI-SPEC §1.2): the chart shelves have NO See-all page, so their heading is a plain,
     non-focusable <h3> — a chevron leading nowhere would be a false affordance. `.subhead-label`
     gives the single-line ellipsis ("Trending on YouTube · United Arab Emirates"). -->
{#snippet titleStatic(label: string)}
	<h3 class="subhead-static"><span class="subhead-label">{label}</span></h3>
{/snippet}

<!-- quick-260618-goe: one ARTIST tile for the 3×3 grid mode — round cover + centered name,
     tap opens the artist page (artists are name-only: no ⋮, no long-press, mirroring CompactRow's
     artist variant). Reuses the .tile shell with .art.round + a name-only .label. -->
{#snippet artistGridTile(name: string, cover: string | null)}
	<!-- quick-260910-qjv: artist tap feedback, parity with song rows -->
	<button class="tile artist-tile" use:tapBounce onclick={() => goto('/artist/' + encodeURIComponent(name))}>
		<div class="art round" style:background-image={fallbackCover(name)}>
			{#if cover}<img class="al-cover-img" src={cover} loading="lazy" alt="" onerror={hideOnError} />{/if}
		</div>
		<div class="artist-name" use:marquee><span class="marquee-inner">{names.dnArtist(name)}</span></div>
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
		{@render discoveryShelf(topHits, densityOf('top-hits'))}
	{/if}
{/snippet}

{#snippet topArtistsBlock()}
	{#if topArtists.length}
		{@render titleNav(t('home.topArtists'), '/charts/top?tab=artists')}
		{@render artistShelf(topArtists, densityOf('top-artists'))}
	{/if}
{/snippet}

<!-- A list/pile/grid ARTIST shelf (classic Top artists + chart Top artists share it). Artists are
     name-only: tap opens the artist page, no ⋮, no long-press. -->
{#snippet artistShelf(artists: DiscoveryArtist[], density: HomeDensity)}
	{#if density === 'list'}
		<CompactPager items={compactSlice(artists)} key={(a) => a.name}>
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
	{:else if density === 'grid'}
		<!-- 3×3 artist grid (decision documented in SUMMARY): reuse the .tile shell with a
		     ROUND .art cover + a centered name label (artists are name-only, no ⋮/long-press). -->
		<HomeGridPager items={artists.slice(0, 27)} key={(a) => a.name}>
			{#snippet row(a: DiscoveryArtist)}
				{@const artistCover = tileCover({ image: a.image, mbid: a.mbid, artistName: a.name })}
				{@render artistGridTile(a.name, artistCover)}
			{/snippet}
		</HomeGridPager>
	{:else}
		<div class="albumrow" use:dragScroll>
			{#each artists as a (a.name)}
				{@const artistCover = tileCover({ image: a.image, mbid: a.mbid, artistName: a.name })}
				<button class="album" use:tapBounce onclick={() => goto('/artist/' + encodeURIComponent(a.name))}>
					<span class="al-cover round" style:background-image={fallbackCover(a.name)}>
						{#if artistCover}<img class="al-cover-img" src={artistCover} loading="lazy" alt="" onerror={hideOnError} />{/if}
					</span>
					<span class="al-name center" use:marquee><span class="marquee-inner">{names.dnArtist(a.name)}</span></span>
				</button>
			{/each}
		</div>
		<!-- quick-260919-et3: ShelfChevrons resolves its target as root.previousElementSibling,
		     so it MUST stay the IMMEDIATE sibling after the .albumrow it drives. It renders
		     nothing below 1024px (display:none), so the mobile DOM gains one inert element
		     per shelf and no layout space at all. -->
		<ShelfChevrons />
	{/if}
{/snippet}

<!-- A reusable list/pile/grid discovery shelf (top-hits / tags / countries share it).
     quick-260618-goe: param is now a HomeDensity ('list'|'pile'|'grid'), not a boolean. -->
{#snippet discoveryShelf(items: DiscoveryTrack[], density: HomeDensity, coverOnPlay = true)}
	{#if density === 'list'}
		<CompactPager items={compactSlice(items)} key={(item) => item.artist + ' ' + item.title}>
			{#snippet row(item: DiscoveryTrack)}
				<CompactRow
					title={names.dnTitle(item.title)}
					subtitle={names.dnArtist(item.artist)}
					cover={tileCover(item)}
					seed={item.artist + item.title}
					onplay={() => playStub(item, coverOnPlay ? item.image : null)}
					onrequestmenu={() => tileMenu(item)}
				/>
			{/snippet}
		</CompactPager>
	{:else if density === 'grid'}
		<!-- 3×3 paginated cover grid (decision #1). Reuses the .tile/.scrim/.label markup;
		     capped at 27 by both the slice here and the component (belt-and-braces). -->
		<HomeGridPager items={items.slice(0, 27)} key={(item) => item.artist + ' ' + item.title}>
			{#snippet row(item: DiscoveryTrack)}
				<button class="tile" use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); tileMenu(item); }} onclick={() => playStub(item, coverOnPlay ? item.image : null)}>
					<div class="art" style:background-image={fallbackCover(item.artist + item.title)}></div>
					{#if tileCover(item)}<img class="al-cover-img" src={tileCover(item)} loading="lazy" alt="" onerror={hideOnError} />{/if}
					<div class="scrim"></div>
					<div class="label">
						<div class="t-title">{names.dnTitle(item.title)}</div>
						<div class="t-artist">{names.dnArtist(item.artist)}</div>
					</div>
				</button>
			{/snippet}
		</HomeGridPager>
	{:else}
		<div class="albumrow" use:dragScroll>
			{#each items as item (item.artist + ' ' + item.title)}
				<!-- DiscoveryTrack carries NO uid → resolve-on-view is via scheduleBackfill + the global
				     reactive signal (NOT use:lazyCover, which needs a Track); no synthetic uid stub. -->
				<button class="album" use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); tileMenu(item); }} onclick={() => playStub(item, coverOnPlay ? item.image : null)}>
					<span class="al-cover" style:background-image={fallbackCover(item.artist + item.title)}>
						{#if tileCover(item)}<img class="al-cover-img" src={tileCover(item)} loading="lazy" alt="" onerror={hideOnError} />{/if}
					</span>
					<span class="al-name" use:marquee><span class="marquee-inner">{names.dnTitle(item.title)}</span></span>
					<span class="al-count" use:marquee><span class="marquee-inner">{names.dnArtist(item.artist)}</span></span>
				</button>
			{/each}
		</div>
		<ShelfChevrons />
	{/if}
{/snippet}

{#snippet tagsBlock()}
	{#each tagShelves.slice(0, shelfBudget.per.tags ?? 0) as shelf (shelf.label)}
		{@render titleNav(t('home.tagShelf', { tag: shelf.label }), '/charts/tags/' + encodeURIComponent(shelf.label))}
		{@render discoveryShelf(shelf.tracks, densityOf('tags'))}
	{/each}
{/snippet}

{#snippet countriesBlock()}
	{#each countryShelves.slice(0, shelfBudget.per.countries ?? 0) as shelf (shelf.label)}
		{@render titleNav(t('home.countryShelf', { country: shelf.label }), '/charts/countries/' + encodeURIComponent(shelf.label))}
		{@render discoveryShelf(shelf.tracks, densityOf('countries'))}
	{/each}
{/snippet}

<!-- Chart shelves (UI-SPEC §1.1): each renders NOTHING — no header — while its sampled pool is
     empty, like the library blocks. Titles are region-qualified with the localized region name. -->
{#snippet chartSongsBlock()}
	{@const items = sampledSongs(poolKey('chart-songs', chartRegion))}
	{#if items.length}
		{@render titleStatic(t('home.chartSongs', { region: regionLabel(chartRegion, settings.appLang) }))}
		{@render discoveryShelf(items, densityOf('chart-songs'))}
	{/if}
{/snippet}

{#snippet newReleasesBlock()}
	{@const items = sampledSongs(poolKey('new-releases', chartRegion))}
	{#if items.length}
		{@render titleStatic(t('home.newReleases', { region: regionLabel(chartRegion, settings.appLang) }))}
		{@render discoveryShelf(items, densityOf('new-releases'))}
	{/if}
{/snippet}

{#snippet chartArtistsBlock()}
	{@const items = sampledArtists(poolKey('chart-artists', chartRegion))}
	{#if items.length}
		{@render titleStatic(t('home.chartArtists', { region: regionLabel(chartRegion, settings.appLang) }))}
		{@render artistShelf(items, densityOf('chart-artists'))}
	{/if}
{/snippet}

<!-- 39-D-34 (UI-15 / research A12): a Trending tap passes a NULL cover. Google-hosted thumbnails
     (some are 16:9 i.ytimg frames, often unloadable for CN-facing users) blank the NowPlaying hero,
     which paints the cover as a CSS background with no error event. With null, play() runs the
     normal iTunes-first cover chain while the tile itself still shows the thumbnail. A deliberate
     deviation from CONTEXT's tap line, accepted at plan review. -->
{#snippet ytTrendingBlock()}
	{@const items = sampledSongs(poolKey('yt-trending', chartRegion))}
	{#if items.length}
		{@render titleStatic(t('home.ytTrending', { region: regionLabel(chartRegion, settings.appLang) }))}
		{@render discoveryShelf(items, densityOf('yt-trending'), false)}
	{/if}
{/snippet}

{#snippet genresBlock()}
	{#each genreShelves.slice(0, shelfBudget.per.genres ?? 0) as shelf (shelf.key)}
		{@render titleStatic(t(CHART_GENRE_LABEL[shelf.id]))}
		{@render discoveryShelf(shelf.items, densityOf('genres'))}
	{/each}
{/snippet}

{#snippet regionsBlock()}
	{#each regionShelves.slice(0, shelfBudget.per.regions ?? 0) as shelf (shelf.key)}
		{@render titleStatic(t('home.chartSongs', { region: regionLabel(shelf.cc, settings.appLang) }))}
		{@render discoveryShelf(shelf.items, densityOf('regions'))}
	{/each}
{/snippet}

{#snippet librarySongRow(track: Track, ctx: QueueContext)}
	<!-- quick-260615-hep: uid-first reactive read; lazyCover resolves-on-view (writes both cache layers
	     internally) and bumps the global signal so this reactive rowCover recomputes + the <img> paints. -->
	{@const rowCover = readPinnedCover(track.uid) ?? track.cover ?? readCoverByUidOrName(track.uid, track.artist, track.title)}
	<button class="album" use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); menuTrack = track; menuOpen = true; }} onclick={() => playLibraryTrack(track, ctx)}>
		<span class="al-cover" use:lazyCover={{ track, onResolved: () => bumpCoverVersion() }} style:background-image={rowCover ? `url(${rowCover})` : fallbackCover(track.uid)}>
			{#if rowCover}<img class="al-cover-img" src={rowCover} loading="lazy" alt="" onerror={hideOnError} />{/if}
		</span>
		<span class="al-name" use:marquee><span class="marquee-inner">{names.dnTitle(track.title)}</span></span>
		<span class="al-count" use:marquee><span class="marquee-inner">{names.dnArtist(track.artist)}</span></span>
	</button>
{/snippet}

<!-- A reusable list/pile/grid library track shelf (liked / downloads / history / playlists).
     quick-260618-goe: param is now a HomeDensity ('list'|'pile'|'grid'), not a boolean. -->
{#snippet libraryShelf(tracks: Track[], density: HomeDensity, ctx: QueueContext)}
	{#if density === 'list'}
		<CompactPager items={compactSlice(tracks)} key={(track) => track.uid}>
			{#snippet row(track: Track)}
				<CompactRow
					title={names.dnTitle(track.title)}
					subtitle={names.dnArtist(track.artist)}
					cover={libraryRowCover(track)}
					seed={track.uid}
					track={track}
					onplay={() => playLibraryTrack(track, ctx)}
					onrequestmenu={() => openTrackMenu(track)}
				/>
			{/snippet}
		</CompactPager>
	{:else if density === 'grid'}
		<!-- 3×3 paginated cover grid (decision #1). Library tracks carry a uid → key by uid and
		     resolve covers via use:lazyCover (like librarySongRow), reusing the .tile markup. -->
		<HomeGridPager items={tracks.slice(0, 27)} key={(track) => track.uid}>
			{#snippet row(track: Track)}
				{@const rowCover = libraryRowCover(track)}
				<button class="tile" use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); openTrackMenu(track); }} onclick={() => playLibraryTrack(track, ctx)}>
					<div class="art" use:lazyCover={{ track, onResolved: () => bumpCoverVersion() }} style:background-image={rowCover ? `url(${rowCover})` : fallbackCover(track.uid)}></div>
					<div class="scrim"></div>
					<div class="label">
						<div class="t-title">{names.dnTitle(track.title)}</div>
						<div class="t-artist">{names.dnArtist(track.artist)}</div>
					</div>
				</button>
			{/snippet}
		</HomeGridPager>
	{:else}
		<div class="albumrow" use:dragScroll>
			{#each tracks as track (track.uid)}{@render librarySongRow(track, ctx)}{/each}
		</div>
		<ShelfChevrons />
	{/if}
{/snippet}

{#snippet likedBlock()}
	{#if likedShelf.length}
		{@render titleNav(t('settings.homeSectionLiked'), '/library?tab=liked')}
		{@render libraryShelf(likedShelf, densityOf('liked'), 'liked')}
	{/if}
{/snippet}

{#snippet downloadsBlock()}
	{#if downloadsShelf.length}
		{@render titleNav(t('settings.homeSectionDownloads'), '/library?tab=downloads')}
		{@render libraryShelf(downloadsShelf, densityOf('downloads'), 'downloads')}
	{/if}
{/snippet}

{#snippet historyBlock()}
	{#if historyShelf.length}
		{@render titleNav(t('settings.homeSectionHistory'), '/library?tab=history')}
		{@render libraryShelf(historyShelf, densityOf('history'), 'history')}
	{/if}
{/snippet}

<!-- quick-260924-pgu: the header deep-links to the history the radio is seeded from (titleNav always
     navigates; there is no radio page). libraryShelf gives list/grid/pile density, long-press
     TrackMenu (which resolves `resolveByName` stubs on demand, same as album rows), and
     use:lazyCover on-view cover resolution for stubs whose Last.fm/Deezer image was missing. -->
{#snippet radioBlock()}
	{#if radioShelf.length}
		{@render titleNav(t('settings.homeSectionRadio'), '/library?tab=history')}
		{@render libraryShelf(radioShelf, densityOf('radio'), 'home-discovery')}
	{/if}
{/snippet}

{#snippet favArtistsBlock()}
	{#if favArtistsShelf.length}
		{@render titleNav(t('settings.homeSectionFavArtists'), '/library?tab=fav-artists')}
		{#if densityOf('fav-artists') === 'list'}
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
		{:else if densityOf('fav-artists') === 'grid'}
			<HomeGridPager items={favArtistsShelf.slice(0, 27)} key={(a) => a.name}>
				{#snippet row(a: { name: string })}
					{@render artistGridTile(a.name, tileCover({ image: null, mbid: null, artistName: a.name }))}
				{/snippet}
			</HomeGridPager>
		{:else}
			<div class="albumrow" use:dragScroll>
				{#each favArtistsShelf as a (a.name)}
					{@const artistCover = tileCover({ image: null, mbid: null, artistName: a.name })}
					<button class="album" use:tapBounce onclick={() => goto('/artist/' + encodeURIComponent(a.name))}>
						<span class="al-cover round" style:background-image={fallbackCover(a.name)}>
							{#if artistCover}<img class="al-cover-img" src={artistCover} loading="lazy" alt="" onerror={hideOnError} />{/if}
						</span>
						<span class="al-name center" use:marquee><span class="marquee-inner">{names.dnArtist(a.name)}</span></span>
					</button>
				{/each}
			</div>
			<ShelfChevrons />
		{/if}
	{/if}
{/snippet}

{#snippet playlistsBlock()}
	{#each playlistShelves.slice(0, shelfBudget.per.playlists ?? 0) as shelf (shelf.id)}
		<!-- D-13: per-playlist shelf deep-links to THAT playlist's detail (tab=playlists +
		     the playlist id), NOT the generic Playlists tab. id is encodeURIComponent-wrapped. -->
		{@render titleNav(shelf.name, '/library?tab=playlists&playlist=' + encodeURIComponent(shelf.id))}
		{@render libraryShelf(shelf.tracks, densityOf('playlists'), 'playlist')}
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
		padding: 11px 16px; color: var(--color-text-muted); font-size: 0.8125rem;
		display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 18px;
	}
	.section .head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
	.section h2 { font-size: calc(1.1rem * var(--fs-title, 1)); margin: 0; }
	/* D-14: section title is a full-row tap target (title + trailing chevron). Keeps the old
	   .subhead typography (0.95rem/700); ≥44px touch height; chevron pushed right. */
	/* 39-D-33: the static chart-shelf heading shares the exact box + type of the tappable one; only
	   the pointer affordances (cursor, hover) stay on .subhead-nav. */
	.subhead-nav, .subhead-static {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		margin: 14px 16px 14px 0;
		padding: 0;
		padding-right: 6px;
		background: none;
		border: none;
		text-align: left;
		color: var(--color-text);
		font-size: calc(0.95rem * var(--fs-title, 1));
		font-weight: 700;
	}
	.subhead-nav { cursor: pointer; }
	.subhead-label { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.subhead-nav :global(.subhead-chev) { margin-left: auto; flex: none; color: var(--color-text-muted); height: 18px; width: 18px;}
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
		padding: 5px 12px; border-radius: 999px; font-size: 0.75rem; cursor: pointer;
		display: inline-flex; align-items: center; gap: 5px;
	}
	/* Horizontal scroll row (copied from the artist page .albumrow pattern). */
	/* quick-260919-et3 (D-8): VERIFIED to need no desktop rule — do not "fix" this. `.album` below
	   is a fixed 130px flex basis, so a container that is 1900px instead of 390px simply fits ~13
	   tiles instead of ~5, for free. Same for CompactPager, whose column is already capped at
	   420px above 640px. The desktop affordance these shelves DO need is a pointer one, and that
	   is <ShelfChevrons /> sitting after each row, not a CSS change here. */
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
	.al-name { font-size: calc(0.75rem * var(--fs-title, 1)); font-weight: 600; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.al-name.center { text-align: center; }
	.al-count { font-size: calc(0.6875rem * var(--fs-artist, 1)); color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
	.t-title { font-size: calc(0.6875rem * var(--fs-title, 1)); font-weight: 700; line-height: 1.2; color: #fff; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.t-artist { font-size: calc(0.625rem * var(--fs-artist, 1)); color: #d8d8de; margin-top: 2px; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.q { position: absolute; top: 6px; right: 6px; font-size: 0.5rem; font-weight: 700; padding: 2px 5px; border-radius: 4px; background: rgba(0,0,0,0.55); color: #fff; }
	/* quick-260618-goe: artist grid tile — round cover + centered name BELOW (no overlay/scrim),
	   so it overrides the square aspect-ratio .tile shell with a flex-column layout. */
	.artist-tile { position: static; aspect-ratio: auto; background: none; border-radius: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
	.artist-tile .art { position: relative; inset: auto; width: 100%; aspect-ratio: 1 / 1; border-radius: 50%; overflow: hidden; background-size: cover; background-position: center; background-color: var(--color-surface-2); }
	.artist-name { width: 100%; min-width: 0; overflow: hidden; white-space: nowrap; text-align: center; font-size: calc(0.6875rem * var(--fs-title, 1)); font-weight: 600; color: var(--color-text); }
	.error { color: #ff7a90; font-size: 0.875rem; }

	/* quick-260919-et3 (D-8): at desktop the fallback grid holds the TILE SIZE and lets the COUNT
	   follow the window, instead of inflating three tiles to 600px each in a 1900px column.
	   --home-grid-cols (the user's column-count setting) stays authoritative below 1024px and is
	   deliberately overridden above it — a calc() is not valid as a repeat() count, so there is no
	   way to honour the setting AND derive columns from the width in one rule. --cover-scale stays
	   inside the minmax so the cover-size setting still scales desktop tiles. */
	@media (min-width: 1024px) {
		.grid { grid-template-columns: repeat(auto-fill, minmax(calc(150px * var(--cover-scale, 1)), 1fr)); }
	}
</style>
