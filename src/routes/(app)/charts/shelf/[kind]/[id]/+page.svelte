<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { ListEnd, ListStart } from '@lucide/svelte';
	import {
		poolTasks,
		regionLabel,
		chartAlbumHref,
		CHART_POOL_KINDS,
		CHART_POOL_LABEL,
		CHART_GENRE_LABEL,
		type ChartPoolKind,
		type RegionPool
	} from '$lib/services/home-charts';
	import { fetchChartPool, type ChartPool } from '$lib/services/charts';
	import { CHART_REGIONS, CHART_GENRE_IDS, type ChartGenre } from '$lib/services/home-layout';
	import type { DiscoveryTrack } from '$lib/services/lastfm';
	import { resolveStub } from '$lib/services/discovery';
	import { coverGradient } from '$lib/services/cover-gradient';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { marquee } from '$lib/actions/marquee';
	import { shouldRun } from '$lib/actions/inflightGuard';
	import { growOnScroll } from '$lib/actions/growOnScroll';
	import { LIST_GROW_PAGE, hasMore, nextVisibleCount } from '$lib/services/list-grow';
	import { player } from '$lib/stores/player.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { readArtistCover } from '$lib/stores/cover-version.svelte';
	import * as haptics from '$lib/util/haptics';
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SongRow from '$lib/components/SongRow.svelte';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import type { Track } from '$lib/sources/types';

	// quick-260927-1fx: the see-all page for every chart shelf on the home page. `[kind]` is one of
	// CHART_POOL_KINDS and `[id]` a region cc (or a genre id for kind=genre). Defensive decode
	// (T-23-13): a malformed escape can't throw. T-1fx-01: poolTasks allowlists BOTH params, so a
	// tampered URL yields no task → an empty list with zero requests.
	function param(raw: string | undefined): string {
		try {
			return decodeURIComponent(raw ?? '');
		} catch {
			return raw ?? '';
		}
	}
	const kind = $derived(param(page.params.kind));
	const id = $derived(param(page.params.id));
	const validKind = $derived((CHART_POOL_KINDS as readonly string[]).includes(kind));
	const tasks = $derived(validKind ? poolTasks(kind as ChartPoolKind, id) : []);

	// The shelf's own label; '' for anything off the allowlist (never an undefined key).
	const title = $derived.by(() => {
		if (kind === 'genre') {
			return (CHART_GENRE_IDS as readonly string[]).includes(id) ? t(CHART_GENRE_LABEL[id as ChartGenre]) : '';
		}
		if (!validKind || !(CHART_REGIONS as readonly string[]).includes(id)) return '';
		return t(CHART_POOL_LABEL[kind as RegionPool], { region: regionLabel(id, settings.appLang) });
	});

	let pool = $state<ChartPool>({ kind: 'songs', items: [] });

	// Auto-grow: the pool is fully fetched up front (up to POOL_CAP = 50 rows) but only the first
	// page paints; a sentinel at the list end appends one more page each time it scrolls into
	// view (use:growOnScroll), until the pool is exhausted. Growth is render-only — zero requests.
	let visibleCount = $state(LIST_GROW_PAGE);
	const canGrowMore = $derived(hasMore(visibleCount, pool.items.length));
	function grow() {
		visibleCount = nextVisibleCount(visibleCount, pool.items.length);
	}
	// The union-typed pool.items narrows per branch through the kind check, so each list iterates
	// a correctly typed visible slice.
	const visibleSongs = $derived(pool.kind === 'songs' ? pool.items.slice(0, visibleCount) : []);
	const visibleArtists = $derived(pool.kind === 'artists' ? pool.items.slice(0, visibleCount) : []);
	const visibleAlbums = $derived(pool.kind === 'albums' ? pool.items.slice(0, visibleCount) : []);

	const SKELETON_MIN_MS = 280;
	let showSkeleton = $state(true);

	function minDwell(startedAt: number): Promise<void> {
		const remaining = SKELETON_MIN_MS - (Date.now() - startedAt);
		return remaining > 0 ? new Promise((r) => setTimeout(r, remaining)) : Promise.resolve();
	}

	function rowKey(it: DiscoveryTrack): string {
		return `${it.artist} ${it.title}`;
	}

	function stubTrack(it: DiscoveryTrack): Track {
		return {
			uid: '', source: 'netease', songid: '', title: it.title, artist: it.artist, album: '',
			cover: it.image ?? null, audioUrl: null, lrc: null, lrcUrl: null, detailsLoaded: false,
			quality: null, qualityLabel: null, keyword: '', displayIndex: 0
		};
	}

	// 39-D-34: a Trending tap passes a NULL cover (Google-hosted thumbnails blank the NowPlaying
	// hero), exactly as the home shelf's coverOnPlay=false does.
	async function play(it: DiscoveryTrack) {
		const cover = kind === 'yt-trending' ? null : it.image;
		const tr = await player.playStub(it.artist, it.title, cover, 'home-discovery');
		if (tr === null && player.pendingTrack == null) toast.show(t('home.unplayable'));
	}

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);
	let menuLoading = $state(false);
	let menuGen = 0;
	async function openMenu(it: DiscoveryTrack) {
		const gen = ++menuGen;
		menuTrack = stubTrack(it);
		menuLoading = true;
		menuOpen = true;
		const tr = await resolveStub(it.artist, it.title);
		if (gen !== menuGen || !menuOpen) return;
		if (tr) {
			menuTrack = tr;
			menuLoading = false;
		} else {
			menuOpen = false;
			menuLoading = false;
			toast.show(t('home.unplayable'));
		}
	}

	// D-16 / WR-03: per-row-per-action in-flight guard — a second swipe on the same row while
	// its resolve is in flight is a no-op (no duplicate addToQueue / racing playNext).
	let swipeInFlight = $state(new Set<string>());

	async function swipeQueue(it: DiscoveryTrack) {
		const key = `q:${rowKey(it)}`;
		if (!shouldRun(swipeInFlight, key)) return;
		swipeInFlight = new Set(swipeInFlight).add(key);
		try {
			const tr = await resolveStub(it.artist, it.title);
			if (!tr) { toast.show(t('home.unplayable')); return; }
			player.addToQueue(tr);
			haptics.tick();
			toast.show(t('toast.addedToQueue'));
		} finally {
			const n = new Set(swipeInFlight);
			n.delete(key);
			swipeInFlight = n;
		}
	}

	async function swipeNext(it: DiscoveryTrack) {
		const key = `n:${rowKey(it)}`;
		if (!shouldRun(swipeInFlight, key)) return;
		swipeInFlight = new Set(swipeInFlight).add(key);
		try {
			const tr = await resolveStub(it.artist, it.title);
			if (!tr) { toast.show(t('home.unplayable')); return; }
			player.playNext(tr);
			haptics.tick();
			toast.show(t('toast.playingNext'));
		} finally {
			const n = new Set(swipeInFlight);
			n.delete(key);
			swipeInFlight = n;
		}
	}

	// quick-260927-1fx: the page re-fetches through the same memoised chart services the home shelf
	// used (6 h `cached()`), so a shelf-title tap costs zero requests and a cold deep-link costs the
	// group's 1-2 edge-cached calls. The pool is the WHOLE list the shelf sampled from (39-D-26), not
	// the sample. A generation guard discards a fetch superseded by a param change.
	let fetchGen = 0;
	$effect(() => {
		const group = tasks; // track the dependency (kind / id)
		const gen = ++fetchGen;
		showSkeleton = true;
		visibleCount = LIST_GROW_PAGE; // a new shelf starts grown from the first page again
		const startedAt = Date.now();
		if (!group.length) {
			pool = { kind: 'songs', items: [] };
			void minDwell(startedAt).then(() => { if (gen === fetchGen) showSkeleton = false; });
			return;
		}
		void fetchChartPool(group)
			.then((r) => {
				if (gen === fetchGen) pool = r;
			})
			.finally(async () => {
				await minDwell(startedAt);
				if (gen === fetchGen) showSkeleton = false;
			});
	});
</script>

<PageHeader {title} backLabel={t('common.back')} showSettings />

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

{#if showSkeleton}
	<ul class="list">{@render skeletonRows(12, title)}</ul>
{:else if pool.kind === 'songs' && pool.items.length}
	<ul class="list">
		{#each visibleSongs as it (rowKey(it))}
			<!-- Same DiscoveryTrack stub rows as charts/tags (quick-260919-l9e): every interaction
			     resolves first, and `resolve` lets the inline Like/Download key off the RESOLVED uid. -->
			{@const stub = stubTrack(it)}
			<li class="row-wrap">
				<span class="reveal reveal-right" aria-hidden="true"><ListEnd size={20} /></span>
				<span class="reveal reveal-left" aria-hidden="true"><ListStart size={20} /></span>
				<SongRow
					track={stub}
					resolve={() => resolveStub(it.artist, it.title).catch(() => null)}
					onplay={() => play(it)}
					onrequestmenu={() => openMenu(it)}
					swipe={{ onSwipeRight: () => swipeQueue(it), onSwipeLeft: () => swipeNext(it) }}
				/>
			</li>
		{/each}
	</ul>
{:else if pool.kind === 'artists' && pool.items.length}
	<!-- Round-avatar rows, tap → /artist/{name}; no swipe, no ⋮ (an artist is not a track, D-09). -->
	<ul class="list">
		{#each visibleArtists as a (a.name)}
			{@const img = a.image ?? readArtistCover(a.name)}
			<li>
				<button class="row" use:tapBounce onclick={() => goto(names.artistHref(a.name))}>
					<span class="art round" style:background-image={img ? `url(${img})` : coverGradient(a.name)}></span>
					<span class="meta">
						<span class="r-title" use:marquee><span class="marquee-inner">{names.dnArtist(a.name)}</span></span>
					</span>
				</button>
			</li>
		{/each}
	</ul>
{:else if pool.kind === 'albums' && pool.items.length}
	<!-- 39-D-36 + quick-260926-hze parity with the home tile: the name-only album page via
	     chartAlbumHref, through names.lockUrl. No long-press (an album has no song to resolve, UI-14). -->
	<ul class="list">
		{#each visibleAlbums as a (a.artist + ' ' + a.name)}
			<li>
				<button class="row" use:tapBounce onclick={() => goto(names.lockUrl(chartAlbumHref(a)))}>
					<span class="art" style:background-image={a.image ? `url(${a.image})` : coverGradient(a.artist + a.name)}></span>
					<span class="meta">
						<span class="r-title" use:marquee><span class="marquee-inner">{names.dnTitle(a.name)}</span></span>
						<span class="r-sub">{names.dnArtist(a.artist)}</span>
					</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}

<!-- Auto-grow sentinel: invisible, at the list end. When it scrolls near the viewport the action
     asks for one more page until the pool is exhausted; growth is render-only (zero requests). -->
{#if !showSkeleton && canGrowMore}
	<div class="grow-sentinel" aria-hidden="true" use:growOnScroll={{ enabled: canGrowMore, onGrow: grow }}></div>
{/if}

<TrackMenu track={menuTrack} open={menuOpen} loading={menuLoading} onclose={() => (menuOpen = false)} />

<style>
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.row-wrap { position: relative; overflow: hidden; border-radius: var(--radius-md); }
	.reveal {
		position: absolute; top: 0; bottom: 0; width: 72px; display: flex; align-items: center;
		justify-content: center; color: #fff; pointer-events: none;
	}
	.reveal-right { left: 0; color: var(--color-text-muted); }
	.reveal-left { right: 0; color: var(--color-text-muted); }
	/* Song rows are SongRow.svelte (its styles travel with it). `.row` / `.art` / `.meta` serve the
	   artist + album buttons below and the 12-row skeleton (the whole first paint of a cold page). */
	.row {
		position: relative; z-index: 1; width: 100%; display: flex; align-items: center; gap: 12px;
		padding: 8px; background: var(--color-bg); border: none; border-radius: var(--radius-md);
		color: inherit; cursor: pointer; text-align: left; transition: background 0.12s ease;
	}
	/* hover-capable devices only — touch otherwise latches :hover under a held finger. */
	@media (hover: hover) { .row:hover { background: var(--color-surface); } }
	.art { width: 48px; height: 48px; border-radius: 8px; background-size: cover; background-position: center; flex: none; }
	.art.round { border-radius: var(--radius-full); }
	.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.r-title { font-size: calc(0.875rem * var(--fs-title, 1)); font-weight: 600; min-width: 0; max-width: 100%; }
	.r-sub {
		font-size: 0.75rem; color: var(--color-text-muted);
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.skel-wrap { display: flex; flex-direction: column; gap: 6px; list-style: none; }
	.skel { pointer-events: none; background: none; }
	.skel .art { background: rgba(255, 255, 255, 0.11); }
	.skel .meta { gap: 7px; }
	.skel .bar { display: block; height: 11px; border-radius: 5px; background: rgba(255, 255, 255, 0.11); }
	.skel .bar-title { width: 62%; }
	.skel .bar-artist { width: 40%; height: 9px; }
	.skel .art, .skel .bar { position: relative; overflow: hidden; }
	.skel .art::after, .skel .bar::after {
		content: ''; position: absolute; inset: 0;
		background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.22) 50%, transparent 100%);
		transform: translateX(-100%); animation: skel-shimmer 1.1s ease-in-out infinite;
	}
	@keyframes skel-shimmer { 100% { transform: translateX(100%); } }
	.vh {
		position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
		overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
	}
	/* Auto-grow sentinel: takes no space, paints nothing — the IntersectionObserver only needs
	   a box to watch at the end of the list. */
	.grow-sentinel { height: 1px; }
</style>
