<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Heart, ListMusic, Download, Trash2, Play, Clock, Pencil, Check, Users, ListEnd, ListStart } from '@lucide/svelte';
	import { library } from '$lib/stores/library.svelte';
	import { history } from '$lib/stores/history.svelte';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { enrichArtist } from '$lib/services/lastfm';
	import { deezerArtistCover } from '$lib/services/deezer';
	import { mapWithConcurrency } from '$lib/services/discovery';
	import { t } from '$lib/i18n';
	import { longpress } from '$lib/actions/longpress';
	import { swipeAction } from '$lib/actions/swipeAction';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { lazyCover } from '$lib/actions/lazyCover';
	import { toast } from '$lib/stores/toast.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import DownloadControl from '$lib/components/DownloadControl.svelte';
	import type { Track } from '$lib/sources/types';
	import type { QueueContext } from '$lib/config/defaults';

	// UX-04 / D-03/D-04: swipe-right = add to queue (player.addToQueue, append-to-end), swipe-left
	// = play next (player.playNext, splice-after-current) — same semantics as TrackMenu, plus the
	// global toast + a commit-tier haptic tick. Wired on the TRACK rows only (liked/downloads/
	// history/playlist-detail); fav-artist + playlist-folder rows are not tracks and get no swipe.
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

	type Tab = 'liked' | 'playlists' | 'downloads' | 'fav-artists' | 'history';
	const VALID_TABS: ReadonlySet<Tab> = new Set(['liked', 'playlists', 'downloads', 'fav-artists', 'history']);
	const TAB_KEY = 'openmusic:library:tab';
	/** Persisted last-viewed tab — restored synchronously on the first read so the page
	 *  renders the correct tab from frame 1. SSR-guarded; corrupt value falls back to 'liked'.
	 *  D-13: a `?tab=` query param (home library-mirror redirects) WINS over the stored value and
	 *  is validated against VALID_TABS — an unknown/garbage tab falls back to the stored/default
	 *  tab and never throws (T-23-10). */
	function loadInitialTab(): Tab {
		if (!browser) return 'liked';
		try {
			// A valid ?playlist deep-link forces the Playlists tab (its detail view lives there).
			if (loadInitialPlaylist()) return 'playlists';
			const qp = page.url.searchParams.get('tab');
			if (qp && VALID_TABS.has(qp as Tab)) return qp as Tab;
			const raw = localStorage.getItem(TAB_KEY);
			if (raw && VALID_TABS.has(raw as Tab)) return raw as Tab;
		} catch {
			/* localStorage unavailable / corrupt → default */
		}
		return 'liked';
	}
	/** D-13: per-playlist home shelves deep-link straight to that playlist's detail view (NOT the
	 *  generic Playlists tab). A `?playlist=<id>` param, validated against existing playlist ids,
	 *  pins the Playlists tab to a single playlist; an unknown id falls back to showing all
	 *  playlists without crashing (T-23-10). Read synchronously so frame 1 is correct. */
	function loadInitialPlaylist(): string | null {
		if (!browser) return null;
		try {
			const pid = page.url.searchParams.get('playlist');
			if (pid && library.playlists.some((p) => p.id === pid)) return pid;
		} catch {
			/* malformed url → no detail pin */
		}
		return null;
	}
	// When a valid ?playlist=<id> is present, pin the Playlists tab to that playlist's detail view.
	let detailPlaylistId = $state<string | null>(loadInitialPlaylist());
	let tab = $state<Tab>(loadInitialTab());
	const detailPlaylist = $derived(
		detailPlaylistId ? (library.playlists.find((p) => p.id === detailPlaylistId) ?? null) : null
	);
	function setTab(v: Tab) {
		tab = v;
		// A manual tab switch clears any ?playlist deep-link pin so the Playlists tab shows all
		// playlists again (the deep-link is a one-shot entry, not a sticky filter).
		detailPlaylistId = null;
		if (!browser) return;
		try { localStorage.setItem(TAB_KEY, v); } catch { /* quota — non-fatal */ }
	}
	// kyf-followup: active-tab label, surfaced next to the page heading so the pill row
	// can shrink to icon-only and fit all 5 tabs in one row.
	const tabLabel = $derived<string>(
		tab === 'liked' ? t('library.liked')
			: tab === 'playlists' ? t('library.playlists')
			: tab === 'downloads' ? t('library.downloads')
			: tab === 'fav-artists' ? t('library.favArtists')
			: t('history.heading')
	);

	// kyf: per-name lazy-loaded avatars for the fav-artists tab. Cached in a Map so a
	// tab-flip re-render doesn't refire the network.
	let favCovers = $state<Record<string, string | null>>({});
	let favCoversLoaded = false;
	async function loadFavCovers() {
		if (favCoversLoaded) return;
		favCoversLoaded = true;
		const names = library.favArtists;
		if (!names.length) return;
		const covered = await mapWithConcurrency(names, 4, async (nm) => {
			const lf = await enrichArtist(nm).catch(() => null);
			const img = lf?.lastfmArt ?? (await deezerArtistCover(nm).catch(() => null));
			return [nm, img] as const;
		});
		const next = { ...favCovers };
		for (const [nm, img] of covered) next[nm] = img;
		favCovers = next;
	}
	$effect(() => {
		if (tab === 'fav-artists' && library.favArtists.length) void loadFavCovers();
	});

	function favArtistFallback(name: string): string {
		const h = (name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}
	// COVER-02 D-14: track-row covers resolve lazily on scroll-into-view via use:lazyCover,
	// repainting through this reactive uid→url map (mirrors the favCovers reactive-map idiom).
	// Values are SOLID https URLs only (Plan 02 gate) — safe for the existing background-image
	// render path, no widening of the injection surface (T-0bb-01).
	let resolvedCovers = $state<Record<string, string>>({});
	function onCoverResolved(uid: string, url: string) {
		resolvedCovers = { ...resolvedCovers, [uid]: url };
	}

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);
	function openMenu(t: Track) { menuTrack = t; menuOpen = true; }

	// Bulk-edit mode (ii6 / j49). When editMode is true, row click REMOVES the track from
	// the CURRENT list instead of playing it. Per-tab remove dispatched in rowAction; the Edit
	// button appears on every bulk-editable tab. History stays read-only (its own "Clear all"
	// button already covers nuke-everything; per-row remove of a stale entry isn't useful).
	let editMode = $state(false);
	$effect(() => {
		// reactive dependency on `tab`: switching tab leaves edit mode.
		void tab;
		editMode = false;
	});
	function rowAction(track: Track, list: Track[], playlistId?: string) {
		if (editMode) {
			if (tab === 'liked') library.toggleLike(track);
			else if (tab === 'downloads') library.removeDownload(track.uid);
			else if (tab === 'playlists' && playlistId) library.removeFromPlaylist(playlistId, track.uid);
			return;
		}
		playList(list, track);
	}
	/** A bulk-editable tab is one where the Edit button + per-row remove make sense. */
	const editableTabHasContent = $derived(
		(tab === 'liked' && library.liked.length > 0) ||
			(tab === 'downloads' && library.downloads.length > 0) ||
			(tab === 'playlists' && library.playlists.some((p) => p.tracks.length > 0)) ||
			(tab === 'fav-artists' && library.favArtists.length > 0)
	);
	onMount(() => {
		library.load();
		history.load();
	});

	function fallbackCover(t: Track): string {
		const h = (t.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}
	function playList(list: Track[], t: Track) {
		// Phase 17 (QUEUE-03): pass the active tab's queue context so per-context sourcing
		// resolves. 'playlists' tab → the 'playlist' context (singular QueueContext token).
		const ctx: QueueContext = tab === 'playlists' ? 'playlist' : tab === 'downloads' ? 'downloads' : 'liked';
		// Set queue+context FIRST, then fresh-play so the per-context up-next mode resolves
		// (a 'generated' context regenerates up-next from the seed instead of using `list`).
		player.setListQueue(list, ctx);
		player.play(t, { fresh: true });
	}
	// Listen history: replay slice (audioUrl re-resolves on play), moved here from settings.
	function playEntry(track: Track) {
		player.setListQueue(history.entries as Track[], 'history');
		player.play(track, { fresh: true });
	}
</script>

<svelte:head><title>{t('library.title')}</title></svelte:head>

<header class="head">
	<h1>{t('library.heading')} <span class="tab-sub">{tabLabel}</span></h1>
	{#if editableTabHasContent}
		<button class="edit-btn" aria-pressed={editMode} onclick={() => (editMode = !editMode)} use:tapBounce>
			{#if editMode}<Check size={16} /> {t('common.done')}{:else}<Pencil size={16} /> {t('library.edit')}{/if}
		</button>
	{:else if tab === 'history' && history.entries.length}
		<button class="edit-btn danger" onclick={() => history.clear()} use:tapBounce><Trash2 size={16} /> {t('history.clear')}</button>
	{/if}
</header>

<!-- kyf-followup: icon-only pills (text moved to the header sub-label) so all 5 tabs
     fit in a single row at any reasonable viewport width. aria-label preserves the
     accessible name for screen readers + tooltips. -->
<nav class="tabs">
	<button class:active={tab === 'liked'} aria-pressed={tab === 'liked'} aria-current={tab === 'liked' ? 'page' : undefined} aria-label={t('library.liked')} title={t('library.liked')} onclick={() => setTab('liked')} use:tapBounce><Heart size={16} /></button>
	<button class:active={tab === 'playlists'} aria-pressed={tab === 'playlists'} aria-current={tab === 'playlists' ? 'page' : undefined} aria-label={t('library.playlists')} title={t('library.playlists')} onclick={() => setTab('playlists')} use:tapBounce><ListMusic size={16} /></button>
	<button class:active={tab === 'downloads'} aria-pressed={tab === 'downloads'} aria-current={tab === 'downloads' ? 'page' : undefined} aria-label={t('library.downloads')} title={t('library.downloads')} onclick={() => setTab('downloads')} use:tapBounce><Download size={16} /></button>
	<button class:active={tab === 'fav-artists'} aria-pressed={tab === 'fav-artists'} aria-current={tab === 'fav-artists' ? 'page' : undefined} aria-label={t('library.favArtists')} title={t('library.favArtists')} onclick={() => setTab('fav-artists')} use:tapBounce><Users size={16} /></button>
	<button class:active={tab === 'history'} aria-pressed={tab === 'history'} aria-current={tab === 'history' ? 'page' : undefined} aria-label={t('history.heading')} title={t('history.heading')} onclick={() => setTab('history')} use:tapBounce><Clock size={16} /></button>
</nav>

{#if tab === 'liked'}
	{#if library.liked.length}
		<ul class="list" class:editing={editMode}>
			{#each library.liked as track (track.uid)}
				<li class="row-line">
					<div class="swipe-wrap">
						<span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>
						<span class="reveal reveal-next" aria-hidden="true"><ListStart size={20} /></span>
						<button class="row" class:is-active={player.current?.uid === track.uid} class:edit-row={editMode} use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); openMenu(track); }} onclick={() => rowAction(track, library.liked)} use:swipeAction={{ onSwipeRight: () => swipeQueue(track), onSwipeLeft: () => swipeNext(track) }}>
							<span class="art" use:lazyCover={{ track, onResolved: onCoverResolved }} style:background-image={(resolvedCovers[track.uid] ?? track.cover) ? `url(${resolvedCovers[track.uid] ?? track.cover})` : fallbackCover(track)}></span>
							<span class="meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-sub">{names.dnArtist(track.artist)}</span></span>
							{#if editMode}<Trash2 size={16} />{:else}<Play size={16} />{/if}
						</button>
					</div>
					<!-- D-11: per-row download control (tri-state, own tap target beside the row). -->
					<DownloadControl track={track} />
				</li>
			{/each}
		</ul>
	{:else}<p class="empty"><Heart size={28} /><span>{t('library.noLiked')}</span></p>{/if}
{:else if tab === 'playlists'}
	{#if library.playlists.length}
		<!-- D-13: when deep-linked via ?playlist=<id> show ONLY that playlist's detail; otherwise
		     all playlist folders. An unknown/removed id resolves detailPlaylist to null → falls back
		     to the full list (never an empty crash). -->
		{#each (detailPlaylist ? [detailPlaylist] : library.playlists) as pl (pl.id)}
			<section class="pl">
				<div class="pl-head">
					<h2>{pl.name} <span class="count">{pl.tracks.length}</span></h2>
					{#if editMode}
						<button class="del" aria-label={t('library.deletePlaylist')} onclick={() => library.deletePlaylist(pl.id)} use:tapBounce><Trash2 size={16} /></button>
					{:else if pl.tracks.length}
						<button class="del" aria-label={t('library.playAll')} title={t('library.playAll')} onclick={() => playList(pl.tracks, pl.tracks[0])} use:tapBounce><Play size={16} /></button>
					{/if}
				</div>
				{#if pl.tracks.length}
					<ul class="list">
						{#each pl.tracks as track (track.uid)}
							<li class="row-line">
								<div class="swipe-wrap">
									<span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>
									<span class="reveal reveal-next" aria-hidden="true"><ListStart size={20} /></span>
									<button class="row" class:is-active={player.current?.uid === track.uid} class:edit-row={editMode} use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); openMenu(track); }} onclick={() => rowAction(track, pl.tracks, pl.id)} use:swipeAction={{ onSwipeRight: () => swipeQueue(track), onSwipeLeft: () => swipeNext(track) }}>
										<span class="art" use:lazyCover={{ track, onResolved: onCoverResolved }} style:background-image={(resolvedCovers[track.uid] ?? track.cover) ? `url(${resolvedCovers[track.uid] ?? track.cover})` : fallbackCover(track)}></span>
										<span class="meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-sub">{names.dnArtist(track.artist)}</span></span>
										{#if editMode}<Trash2 size={16} />{:else}<Play size={16} />{/if}
									</button>
								</div>
								<!-- D-11: per-row download control (own tap target beside the row). -->
								<DownloadControl track={track} />
							</li>
						{/each}
					</ul>
				{:else}<p class="empty-sm">{t('library.emptyPlaylist')}</p>{/if}
			</section>
		{/each}
	{:else}<p class="empty"><ListMusic size={28} /><span>{t('library.noPlaylists')}</span></p>{/if}
{:else if tab === 'downloads'}
	{#if library.downloads.length}
		<ul class="list">
			{#each library.downloads as track (track.uid)}
				<li class="row-line">
					<div class="swipe-wrap">
						<span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>
						<span class="reveal reveal-next" aria-hidden="true"><ListStart size={20} /></span>
						<button class="row" class:is-active={player.current?.uid === track.uid} class:edit-row={editMode} use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); openMenu(track); }} onclick={() => rowAction(track, library.downloads)} use:swipeAction={{ onSwipeRight: () => swipeQueue(track), onSwipeLeft: () => swipeNext(track) }}>
							<span class="art" use:lazyCover={{ track, onResolved: onCoverResolved }} style:background-image={(resolvedCovers[track.uid] ?? track.cover) ? `url(${resolvedCovers[track.uid] ?? track.cover})` : fallbackCover(track)}></span>
							<span class="meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-sub">{names.dnArtist(track.artist)}</span></span>
							{#if editMode}<Trash2 size={16} />{:else}<Play size={16} />{/if}
						</button>
					</div>
					<!-- D-11: per-row download control. On this tab it renders the greyed "Downloaded" state. -->
					<DownloadControl track={track} />
				</li>
			{/each}
		</ul>
		<p class="note">{t('library.downloadsNote')}</p>
	{:else}<p class="empty"><Download size={28} /><span>{t('library.noDownloads')}</span></p>{/if}
{:else if tab === 'fav-artists'}
	{#if library.favArtists.length}
		<div class="fav-grid">
			{#each library.favArtists as name (name)}
				<button class="fav-tile" class:edit-row={editMode} use:tapBounce onclick={() => {
					if (editMode) library.toggleFavArtist(name);
					else goto('/artist/' + encodeURIComponent(name));
				}}>
					<span class="fav-avatar" style:background-image={favCovers[name] ? `url(${favCovers[name]})` : favArtistFallback(name)}></span>
					<span class="fav-name">{names.dnArtist(name)}</span>
					{#if editMode}<span class="fav-trash"><Trash2 size={14} /></span>{/if}
				</button>
			{/each}
		</div>
	{:else}<p class="empty"><Users size={28} /><span>{t('library.noFavArtists')}</span></p>{/if}
{:else}
	{#if history.entries.length}
		<ul class="list">
			{#each history.entries as entry (entry.uid)}
				{@const track = entry as Track}
				<li class="row-line">
					<div class="swipe-wrap">
						<span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>
						<span class="reveal reveal-next" aria-hidden="true"><ListStart size={20} /></span>
						<button class="row" class:is-active={player.current?.uid === track.uid} use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); openMenu(track); }} onclick={() => playEntry(track)} use:swipeAction={{ onSwipeRight: () => swipeQueue(track), onSwipeLeft: () => swipeNext(track) }}>
							<span class="art" use:lazyCover={{ track, onResolved: onCoverResolved }} style:background-image={(resolvedCovers[track.uid] ?? track.cover) ? `url(${resolvedCovers[track.uid] ?? track.cover})` : fallbackCover(track)}></span>
							<span class="meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-sub">{names.dnArtist(track.artist)}</span></span>
							<Play size={16} />
						</button>
					</div>
					<!-- D-11: per-row download control (initiation + state affordance on history rows). -->
					<DownloadControl track={track} />
				</li>
			{/each}
		</ul>
	{:else}<p class="empty"><Clock size={28} /><span>{t('history.empty')}</span></p>{/if}
{/if}

<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />

<style>
	.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 16px 0 12px; flex-wrap: wrap; }
	.head h1 { font-size: calc(1.4rem * var(--fs-title, 1)); margin: 0; min-width: 0; }
	.tab-sub { color: var(--color-text-muted); font-weight: 400; font-size: 0.95rem; margin-left: 8px; }
	.edit-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 6px 12px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.edit-btn[aria-pressed='true'] { background: var(--color-primary); color: #fff; border-color: transparent; }
	.edit-btn.danger { color: #ff7a90; }
	.edit-btn.danger:hover { background: rgba(255, 122, 144, 0.12); }
	.edit-row { color: #ff7a90; }
	.edit-row:hover { background: rgba(255, 122, 144, 0.08); }
	.tabs { display: flex; gap: 8px; margin-bottom: 14px; }
	.tabs button { flex: 1; display: inline-flex; align-items: center; justify-content: center; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text-muted); padding: 10px 0; border-radius: 999px; cursor: pointer; min-width: 0; }
	.tabs button.active { background: var(--color-primary); color: #fff; border-color: transparent; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	/* D-11: each row = the swipe-wrap (flex 1) + a trailing DownloadControl (its own tap target,
	   OUTSIDE the overflow:hidden swipe-wrap so the swipe reveal never clips it). */
	.row-line { display: flex; align-items: center; gap: 6px; }
	.row-line .swipe-wrap { flex: 1; min-width: 0; }
	/* UX-04: positioning context for the swipe reveal layers. The reveal spans sit BEHIND the row
	   (the row carries an opaque background); the row's translateX (use:swipeAction) slides to
	   expose the correct side. overflow:hidden masks the reveal at rest + clips the row travel. */
	.swipe-wrap { position: relative; overflow: hidden; border-radius: 10px; }
	.reveal {
		position: absolute; top: 0; bottom: 0; width: 96px; display: flex; align-items: center;
		justify-content: center; color: #fff; pointer-events: none;
	}
	.reveal-queue { left: 0; color: var(--color-text-muted); }
	.reveal-next { right: 0; color: var(--color-text-muted); }
	.row { width: 100%; text-align: left; background: var(--color-bg); position: relative; z-index: 1; border: none; padding: 8px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 12px; color: var(--color-text); }
	/* MENU-03 / D-12: hover-capable devices only — touch otherwise latches this :hover
	   background on a row under a held finger while the track menu opens. */
	@media (hover: hover) { .row:hover { background: var(--color-surface); } }
	/* Active/selected row = the currently-playing track. NOT hover-gated, so the light-grey
	   --color-surface highlight shows on touch too. The edit-row modifier (red, remove-mode) must
	   keep precedence over this neutral highlight: in edit mode a row click removes, not plays, so
	   the grey active tint would be misleading — the more-specific .row.edit-row.is-active below
	   suppresses it. */
	.row.is-active { background: var(--color-surface); }
	.row.edit-row.is-active { background: var(--color-bg); }
	.art { width: 48px; height: 48px; border-radius: 8px; background-size: cover; background-position: center; flex: none; }
	.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.r-title { font-size: calc(14px * var(--fs-title, 1)); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.r-sub { font-size: calc(12px * var(--fs-artist, 1)); color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.pl { margin-bottom: 18px; }
	.pl-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
	.pl-head h2 { font-size: 1rem; margin: 0; }
	.count { color: var(--color-text-muted); font-size: 12px; font-weight: 400; }
	.del { background: none; border: none; color: var(--color-text-muted); cursor: pointer; display: grid; place-items: center; padding: 6px; }
	.empty { display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--color-text-muted); padding: 48px 16px; text-align: center; font-size: 14px; }
	.empty-sm { color: var(--color-text-muted); font-size: 13px; padding: 4px 8px; }
	.note { color: var(--color-text-muted); font-size: 11px; margin-top: 12px; }
	/* kyf: fav-artists tab grid — responsive round-avatar tiles. */
	.fav-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 14px; }
	.fav-tile { position: relative; background: none; border: none; padding: 6px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--color-text); border-radius: 12px; }
	.fav-tile:hover { background: var(--color-surface); }
	.fav-avatar { width: 88px; height: 88px; border-radius: 50%; background-size: cover; background-position: center; }
	.fav-name { font-size: 13px; font-weight: 600; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
	.fav-tile.edit-row .fav-name { color: #ff7a90; }
	.fav-tile.edit-row .fav-avatar { filter: brightness(0.65); }
	.fav-trash { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -60%); color: #fff; pointer-events: none; }
</style>
