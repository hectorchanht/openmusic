<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { pickTab, syncTabUrl } from '$lib/services/url-tab';
	import { ListEnd, ListStart } from '@lucide/svelte';
	import {
		getChartTopTracks,
		getChartTopArtists,
		type DiscoveryTrack,
		type DiscoveryArtist
	} from '$lib/services/lastfm';
	import { resolveStub } from '$lib/services/discovery';
	import { marquee } from '$lib/actions/marquee';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { shouldRun } from '$lib/actions/inflightGuard';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { online } from '$lib/stores/online.svelte';
	import * as haptics from '$lib/util/haptics';
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SongRow from '$lib/components/SongRow.svelte';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import type { Track } from '$lib/sources/types';

	// D-12: deep chart — fetch a longer Last.fm chart than the home shelf cap (~100 rows).
	const CHART_LIMIT = 100;

	// Two views on the per-type /charts/top route (UI-SPEC §5.2 — Top Hits + Top Artists kept
	// under the per-type convention as a tab toggle on one route). Songs = the deep .row list
	// with tap/long-press/swipe; Artists = round-avatar rows tapping to /artist/{name}.
	type View = 'tracks' | 'artists';
	// quick-260919-hdr: URL-backed, same idiom as the discography filter (quick-260919-2jo) — seeded
	// from `?tab=`, validated, anything else falls back to the default. Both home shelves used to
	// link at the bare `/charts/top`, so "Top artists" landed on the Songs tab; the href now carries
	// the tab and this seed honours it. Also makes the tab linkable and survive a reload.
	const VALID_VIEWS: ReadonlySet<string> = new Set(['tracks', 'artists']);
	let view = $state<View>(pickTab(page.url, 'tab', VALID_VIEWS, 'tracks'));

	let tracks = $state<DiscoveryTrack[]>([]);
	let artists = $state<DiscoveryArtist[]>([]);

	// Dwell-floored skeleton (search-page pattern): a cache HIT settles within a microtask,
	// before any paint — hold the skeleton flag for a minimum on-screen window so it never
	// flickers. A slow fetch already exceeds the floor and adds nothing. No loading TEXT.
	const SKELETON_MIN_MS = 280;
	let showTrackSkeleton = $state(true);
	let showArtistSkeleton = $state(true);

	function minDwell(startedAt: number): Promise<void> {
		const remaining = SKELETON_MIN_MS - (Date.now() - startedAt);
		return remaining > 0 ? new Promise((r) => setTimeout(r, remaining)) : Promise.resolve();
	}

	// Stable per-row key for {#each} + lazyCover (DiscoveryTrack has no uid).
	function rowKey(it: DiscoveryTrack): string {
		return `${it.artist} ${it.title}`;
	}

	// Build the minimal Track stub lazyCover + TrackMenu read (mirrors the home page stubTrack).
	function stubTrack(it: DiscoveryTrack): Track {
		return {
			uid: '',
			source: 'netease',
			songid: '',
			title: it.title,
			artist: it.artist,
			album: '',
			cover: it.image ?? null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: null,
			qualityLabel: null,
			keyword: '',
			displayIndex: 0
		};
	}

	function fallbackArtistCover(name: string): string {
		const h = (name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	// --- tap-to-play (the home discovery resolve path) -------------------------------
	// playStub locks the tapped {artist,title,cover} into the now-bar instantly, dedupes a
	// same-song double-tap, supersedes an in-flight resolve, and re-searches via resolveStub
	// to a real playable Track. Returns null for BOTH a miss AND a supersede — gate the
	// unplayable toast on pendingTrack (a supersede leaves pendingTrack on the NEWER song).
	async function play(it: DiscoveryTrack) {
		const tr = await player.playStub(it.artist, it.title, it.image, 'home-discovery');
		if (tr === null && player.pendingTrack == null) toast.show(t('home.unplayable'));
	}

	// --- long-press → track menu (stub opens instantly, resolveStub fills the real Track) ---
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
		if (gen !== menuGen || !menuOpen) return; // superseded / closed mid-resolve
		if (tr) {
			menuTrack = tr;
			menuLoading = false;
		} else {
			menuOpen = false;
			menuLoading = false;
			toast.show(t('home.unplayable'));
		}
	}

	// --- swipe actions (UX-04 / D-02): resolve the stub, then queue/like + toast + haptic ---
	// swipeAction is a pure DOM gesture; the host fires haptics here (PATTERNS §3.3).
	// D-16 / WR-03: per-row-per-action in-flight guard — a second swipe on the same row while
	// its multi-second resolve is still in flight is a no-op (prevents duplicate addToQueue and
	// racing playNext). Reassign-for-reactivity + finally-delete per PATTERNS §3.2.
	let swipeInFlight = $state(new Set<string>());

	async function swipeQueue(it: DiscoveryTrack) {
		const key = `q:${rowKey(it)}`;
		if (!shouldRun(swipeInFlight, key)) return;
		swipeInFlight = new Set(swipeInFlight).add(key);
		try {
			const tr = await resolveStub(it.artist, it.title);
			if (!tr) {
				toast.show(t('home.unplayable'));
				return;
			}
			player.addToQueue(tr); // D-03: append to end (TrackMenu addQueue semantics)
			haptics.tick();
			toast.show(t('toast.addedToQueue'));
		} finally {
			const n = new Set(swipeInFlight);
			n.delete(key);
			swipeInFlight = n;
		}
	}

	// quick-260712-0md: swipe-left = play next (player.playNext, splice-after-current) —
	// matches search/library/artist/album/charts. Resolves the discovery stub first
	// (a DiscoveryTrack has no uid/audioUrl until resolved).
	async function swipeNext(it: DiscoveryTrack) {
		const key = `n:${rowKey(it)}`;
		if (!shouldRun(swipeInFlight, key)) return;
		swipeInFlight = new Set(swipeInFlight).add(key);
		try {
			const tr = await resolveStub(it.artist, it.title);
			if (!tr) {
				toast.show(t('home.unplayable'));
				return;
			}
			player.playNext(tr); // D-04: splice after current (TrackMenu playNext semantics)
			haptics.tick();
			toast.show(t('toast.playingNext'));
		} finally {
			const n = new Set(swipeInFlight);
			n.delete(key);
			swipeInFlight = n;
		}
	}

	onMount(async () => {
		// OFFL-03 / D-10: SHORT-CIRCUIT when offline — do NOT fire the chart fetches (which would
		// hang and strand the skeletons forever). Clear the skeleton flags so the inline offline
		// state shows instead of a stuck loader. No redirect (D-09).
		if (!online.isOnline) {
			showTrackSkeleton = false;
			showArtistSkeleton = false;
			return;
		}
		// Both views fetch in parallel on mount; never-throw resolvers → [] on failure so the
		// list simply hides (no error surface). The tracks fetch owns the default-view skeleton.
		const tStart = Date.now();
		const aStart = Date.now();
		void getChartTopTracks(CHART_LIMIT)
			.then((rows) => {
				tracks = rows;
			})
			.finally(async () => {
				await minDwell(tStart);
				showTrackSkeleton = false;
			});
		void getChartTopArtists(CHART_LIMIT)
			.then((rows) => {
				artists = rows;
			})
			.finally(async () => {
				await minDwell(aStart);
				showArtistSkeleton = false;
			});
	});
</script>

<PageHeader title={t('charts.topTitle')} backLabel={t('common.back')} />

<!-- Songs / Artists toggle (UI-SPEC §7.1 — aria-pressed reflects the active toggle). -->
<div class="tabs">
	<button
		type="button"
		class="tab"
		aria-pressed={view === 'tracks'}
		onclick={() => { view = 'tracks'; syncTabUrl(page.url, 'tab', 'tracks', 'tracks'); }}
	>
		{t('charts.topTracksTab')}
	</button>
	<button
		type="button"
		class="tab"
		aria-pressed={view === 'artists'}
		onclick={() => { view = 'artists'; syncTabUrl(page.url, 'tab', 'artists', 'tracks'); }}
	>
		{t('charts.topArtistsTab')}
	</button>
</div>

<!-- OFFL-03 inline offline state: charts need the network — short-circuit (onMount bails when
     offline) and promote Downloads/Library. No redirect (D-09). -->
{#if !online.isOnline}
	<div class="offline-state">
		<p class="offline-title">{t('offline.title')}</p>
		<p class="offline-body">{t('offline.body')}</p>
		<button type="button" class="offline-cta" onclick={() => goto('/library')}>{t('offline.goToLibrary')}</button>
	</div>
{/if}

<!-- ONE skeleton-row definition shared by both views' first paint (search-page pattern). -->
{#snippet skeletonRows(count: number, label: string)}
	<li class="skel-wrap" aria-label={label}>
		<span class="vh">{label}</span>
		{#each Array(count) as _, i (i)}
			<span class="row skel" aria-hidden="true">
				<span class="art"></span>
				<span class="meta">
					<span class="bar bar-title"></span>
					<span class="bar bar-artist"></span>
				</span>
			</span>
		{/each}
	</li>
{/snippet}

{#if view === 'tracks'}
	{#if showTrackSkeleton}
		<ul class="list">{@render skeletonRows(12, t('charts.topTitle'))}</ul>
	{:else if tracks.length > 0}
		<ul class="list">
			{#each tracks as it (rowKey(it))}
				<!-- quick-260919-hdr: the shared row, migrated exactly as charts/tags and
				     charts/countries were (quick-260919-l9e) — same DiscoveryTrack stubs, so the same
				     four overrides. `onplay` is playStub (not setListQueue + play), `onrequestmenu`
				     resolves BEFORE opening, and the swipe pair keeps the D-16/WR-03
				     per-row-per-action in-flight guard. `resolve` is the same resolve-on-tap seam for
				     the INLINE buttons (quick-260919-l9e): a stub carries no uid, so Like/Download key
				     off the RESOLVED uid — the row used to pass `actions={[]}` to hide them, which
				     meant settings.rowActions was silently ignored here. The ⋮ is unconditional, so
				     the menu is reachable by TAP, not only by long-press. {@const} must be the
				     immediate block child of the {#each}. -->
				{@const stub = stubTrack(it)}
				<li class="row-wrap">
					<!-- Reveal layers behind the row: right=queue (primary), left=play next. -->
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
	{/if}
{:else if showArtistSkeleton}
	<ul class="list">{@render skeletonRows(12, t('charts.topArtists'))}</ul>
{:else if artists.length > 0}
	<!-- Artist rows: round avatar, tap → /artist/{name}; no swipe, no ⋮ (artists aren't tracks, D-09). -->
	<ul class="list">
		{#each artists as a (a.name)}
			<li>
				<button class="row" onclick={() => goto('/artist/' + encodeURIComponent(a.name))} use:tapBounce>
					<span
						class="art round"
						style:background-image={a.image ? `url(${a.image})` : fallbackArtistCover(a.name)}
					></span>
					<span class="meta">
						<span class="r-title" use:marquee><span class="marquee-inner">{names.dnArtist(a.name)}</span></span>
					</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}

<TrackMenu track={menuTrack} open={menuOpen} loading={menuLoading} onclose={() => (menuOpen = false)} />

<style>

	/* Songs / Artists toggle */
	.tabs { display: flex; gap: 8px; margin-bottom: 14px; }
	.tab {
		background: var(--color-surface-2); border: 1px solid var(--color-border);
		color: var(--color-text-muted); border-radius: var(--radius-full);
		padding: 8px 16px; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
		transition: background 0.12s ease, color 0.12s ease;
	}
	.tab[aria-pressed='true'] { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }

	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }

	/* OFFL-03 inline offline empty-state (shared idiom across online-only surfaces). */
	.offline-state { text-align: center; padding: 32px 16px; color: var(--color-text-muted); }
	.offline-title { font-size: 0.9375rem; font-weight: 600; color: var(--color-text); margin: 0 0 6px; }
	.offline-body { font-size: 0.8125rem; margin: 0 0 16px; }
	.offline-cta {
		background: var(--color-primary); border: none; color: #fff; border-radius: 999px;
		padding: 9px 18px; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
	}

	/* Row wrapper hosts the swipe reveal layers BEHIND the .row (which slides via translateX). */
	.row-wrap { position: relative; overflow: hidden; border-radius: var(--radius-md); }
	.reveal {
		position: absolute; top: 0; bottom: 0; width: 72px; display: flex; align-items: center;
		justify-content: center; color: #fff; pointer-events: none;
	}
	/* quick-260919-hdr: the reveal glyphs lost their coloured plates to match charts/tags and
	   charts/countries — SongRow paints an OPAQUE --color-bg over them at rest, so the plate was
	   only ever visible mid-swipe and differed from every other migrated list. */
	.reveal-right { left: 0; color: var(--color-text-muted); }
	.reveal-left { right: 0; color: var(--color-text-muted); }

	/* quick-260919-hdr: the SONG rows are SongRow.svelte now (their styles travelled with it —
	   Svelte scopes per component). `.row` / `.art` / `.meta` / `.r-title` are KEPT because the
	   ARTISTS view still renders its own `<button class="row">` (round avatar, one line, no menu —
	   an artist is not a track, D-09 / CLAUDE.md), and because the 12-row skeleton above is the
	   whole first paint of a cold charts page. `.r-artist` went with the song rows: nothing else
	   drew a second line. */
	.row {
		position: relative; z-index: 1; width: 100%; display: flex; align-items: center; gap: 12px;
		padding: 8px; background: var(--color-bg); border: none; border-radius: var(--radius-md);
		cursor: pointer; text-align: left; transition: background 0.12s ease;
	}
	/* hover-capable devices only — touch otherwise latches :hover under a held finger. */
	@media (hover: hover) { .row:hover { background: var(--color-surface); } }
	.art { width: 48px; height: 48px; border-radius: 8px; background-size: cover; background-position: center; flex: none; }
	.art.round { border-radius: var(--radius-full); }
	.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.r-title { font-size: calc(0.875rem * var(--fs-title, 1)); font-weight: 600; min-width: 0; max-width: 100%; }

	/* skeleton (search-page pattern) */
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
	@media (prefers-reduced-motion: reduce) { .skel .art::after, .skel .bar::after { animation: none; } }
	.vh {
		position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
		overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
	}
</style>
