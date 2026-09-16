<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Heart, ListMusic, Download, Trash2, Play, Clock, Pencil, Check, Users, ListEnd, ListStart, Shuffle, Ellipsis, X } from '@lucide/svelte';
	import { library } from '$lib/stores/library.svelte';
	import { history } from '$lib/stores/history.svelte';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { enrichArtist } from '$lib/services/lastfm';
	import { deezerArtistCover } from '$lib/services/deezer';
	import { mapWithConcurrency, shuffle } from '$lib/services/discovery';
	import { t } from '$lib/i18n';
	import { longpress } from '$lib/actions/longpress';
	import { swipeAction } from '$lib/actions/swipeAction';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { lazyCover } from '$lib/actions/lazyCover';
	// quick-260910-qwt: the shared row cover read (resolved → track.cover → the shared cache).
	import { pickRowCover } from '$lib/services/row-cover';
	import { readCoverByUidOrName } from '$lib/stores/cover-version.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import DownloadControl from '$lib/components/DownloadControl.svelte';
	import type { Track } from '$lib/sources/types';
	import type { QueueContext } from '$lib/config/defaults';
	import { coverGradient } from '$lib/services/cover-gradient';

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
	// kyf-followup: active-tab label, so the pill row can shrink to icon-only and fit all 5 tabs.
	// quick-260915-vb9: this IS the page heading now — the bottom nav already says "Library", so
	// repeating it above the tab name was the same word twice on a phone-width screen.
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
	//
	// quick-260910-qwt: the map stays rung 1, but all four track lists now paint through the shared
	// `pickRowCover` read (resolved → track.cover → the shared reactive cover cache). A song whose
	// cover was resolved on ANY other surface paints here on FIRST render — no intersection, no
	// network — and repaints live via coverVersion(). A reactive READ; no new request path.
	let resolvedCovers = $state<Record<string, string>>({});
	function onCoverResolved(uid: string, url: string) {
		resolvedCovers = { ...resolvedCovers, [uid]: url };
	}

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);
	function openMenu(t: Track) { menuTrack = t; menuOpen = true; }

	// quick-260915-vb9: the per-tab list sheet (the ⋯ button). Inline rather than a component:
	// TrackMenu is track-scoped (it needs a Track) and a ListMenu.svelte would have exactly one
	// consumer. Copies the album page's playlist-picker idiom verbatim.
	let listMenuOpen = $state(false);
	// Back-to-close overlay. Dep is `listMenuOpen` ONLY, and the cleanup is the SOLE dismiss caller,
	// so scrim / X / drag / hardware Back all converge on one history pop (TrackMenu's rationale).
	// The id must differ from TrackMenu's `trackmenu-*` — both are mounted on this page.
	$effect(() => {
		if (listMenuOpen) {
			untrack(() => overlays.open('library-list-menu', () => (listMenuOpen = false)));
			return () => untrack(() => overlays.dismiss('library-list-menu'));
		}
	});

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
	/**
	 * quick-260915-vb9: the current tab's playable tracks — what Play / Shuffle / Add to queue /
	 * Play next all act on. Empty means those affordances HIDE (not disable — a dead button is
	 * worse than no button).
	 * Deliberately empty on the Playlists tab with no ?playlist detail pin: each folder already has
	 * its own Play button, and flattening every playlist into one queue is not something anyone
	 * asked for. Also empty on fav-artists — artists are not tracks.
	 */
	const tabList = $derived<Track[]>(
		tab === 'liked' ? library.liked
			: tab === 'downloads' ? library.downloads
			: tab === 'history' ? (history.entries as Track[])
			: tab === 'playlists' ? (detailPlaylist?.tracks ?? [])
			: []
	);
	/** The ⋯ button hides entirely when every row of its sheet would be hidden. */
	const listMenuHasItems = $derived(
		tabList.length > 0 || (tab === 'fav-artists' && library.favArtists.length > 0) || !!detailPlaylist
	);
	/**
	 * quick-260915-vb9: wipe the CURRENT tab's list only — never the whole library (clearAll exists
	 * for that and lives in Settings → Data). confirm() is the house pattern for a destructive tap
	 * (settings/data/+page.svelte; Capacitor 8 renders it as a native AlertDialog), so a single
	 * mis-tap can never empty a list.
	 */
	function clearCurrentList() {
		if (!confirm(t('library.clearListConfirm', { name: detailPlaylist?.name ?? tabLabel }))) return;
		if (tab === 'liked') library.clearLiked();
		else if (tab === 'downloads') library.clearDownloads();
		else if (tab === 'fav-artists') library.clearFavArtists();
		else if (tab === 'history') history.clear();
		else if (detailPlaylist) library.clearPlaylistTracks(detailPlaylist.id);
		editMode = false; // nothing left to edit
		listMenuOpen = false;
	}
	function deleteDetailPlaylist() {
		if (!detailPlaylist) return;
		if (!confirm(t('library.deletePlaylistConfirm', { name: detailPlaylist.name }))) return;
		library.deletePlaylist(detailPlaylist.id);
		detailPlaylistId = null; // the detail view's subject is gone — fall back to all playlists
		listMenuOpen = false;
	}
	// quick-260915-vb9: whole-list queue actions. addToQueue/playNext each persist per call — fine
	// at library sizes. ponytail: N persists, batch if a 1000-song list ever measures slow.
	function queueWholeList() {
		for (const x of tabList) player.addToQueue(x);
		toast.show(t('toast.addedToQueue'));
		hapticTick();
		listMenuOpen = false;
	}
	function playListNext() {
		// Reversed: each playNext splices at current+1, so feeding the list backwards lands it
		// after current in its ORIGINAL order.
		for (const x of [...tabList].reverse()) player.playNext(x);
		toast.show(t('toast.playingNext'));
		hapticTick();
		listMenuOpen = false;
	}
	onMount(() => {
		library.load();
		history.load();
	});

	// Shared placeholder gradient (cover-gradient.ts) — was inlined in eight files.
	function fallbackCover(t: Track): string {
		return coverGradient(t.uid);
	}
	/**
	 * quick-260915-vb9: `wholeList` marks the caller as an explicit "play this entire list" button
	 * (the action row's Play/Shuffle, and each playlist folder's own Play) rather than a row tap.
	 * It pins player.play's same-list branch so the list the user pressed Play ON is what Up Next
	 * shows — every library context resolves to the 'generated' up-next mode by default, which
	 * would otherwise replace the tail with genre-similar songs and drop the list entirely.
	 * A plain row tap passes nothing and keeps the user's per-context sourcing setting.
	 */
	function playList(list: Track[], t: Track, opts?: { wholeList?: boolean }) {
		// Phase 17 (QUEUE-03): pass the active tab's queue context so per-context sourcing
		// resolves. 'playlists' tab → the 'playlist' context (singular QueueContext token).
		// quick-260915-vb9: 'history' added so this one function serves every tab and playEntry
		// cannot drift from it.
		const ctx: QueueContext = tab === 'playlists' ? 'playlist'
			: tab === 'downloads' ? 'downloads'
			: tab === 'history' ? 'history'
			: 'liked';
		// Set queue+context FIRST, then fresh-play so the per-context up-next mode resolves
		// (a 'generated' context regenerates up-next from the seed instead of using `list`).
		player.setListQueue(list, ctx);
		player.play(t, { fresh: true, sameList: opts?.wholeList });
	}
	// Listen history: replay slice (audioUrl re-resolves on play), moved here from settings.
	function playEntry(track: Track) {
		playList(history.entries as Track[], track);
	}
	// quick-260915-vb9: the action row's Play — the whole tab, from the top.
	function playAll() {
		if (tabList.length) playList(tabList, tabList[0], { wholeList: true });
	}
	/**
	 * quick-260915-vb9: Shuffle installs a Fisher-Yates COPY of the tab as the queue — it does NOT
	 * call player.toggleShuffle(). That mode only reorders the tail AFTER the current track and is
	 * a no-op when shuffle is already on, so the result would depend on prior state; a shuffled copy
	 * is deterministic and leaves the user's shuffle setting alone.
	 */
	function shuffleAll() {
		const s = shuffle(tabList);
		if (s.length) playList(s, s[0], { wholeList: true });
	}
</script>

<svelte:head><title>{t('library.title')}</title></svelte:head>

<!-- quick-260915-vb9: the heading is the active tab's label alone. Edit moved to the action row
     below; the history-only Clear button became the sheet's per-tab "Clear all" row. -->
<header class="head">
	<h1>{tabLabel}</h1>
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

<!-- quick-260915-vb9: per-tab action row. Every button is conditional — a tab with nothing to
     play shows no Play/Shuffle at all rather than dead greyed-out controls. -->
<div class="actions">
	{#if tabList.length}
		<button class="edit-btn" onclick={playAll} use:tapBounce><Play size={16} /> {t('library.playAll')}</button>
		<button class="edit-btn" onclick={shuffleAll} use:tapBounce><Shuffle size={16} /> {t('nowplaying.shuffle')}</button>
	{/if}
	{#if editableTabHasContent}
		<button class="edit-btn" aria-pressed={editMode} onclick={() => (editMode = !editMode)} use:tapBounce>
			{#if editMode}<Check size={16} /> {t('common.done')}{:else}<Pencil size={16} /> {t('library.edit')}{/if}
		</button>
	{/if}
	{#if listMenuHasItems}
		<button class="edit-btn" aria-label={t('menu.options')} title={t('menu.options')} onclick={() => (listMenuOpen = true)} use:tapBounce><Ellipsis size={16} /></button>
	{/if}
</div>

{#if tab === 'liked'}
	{#if library.liked.length}
		<ul class="list" class:editing={editMode}>
			{#each library.liked as track (track.uid)}
				<!-- quick-260910-qwt: the shared three-rung row cover read. Must sit directly under the
				     {#each} — Svelte only allows {@const} as an immediate block child. -->
				{@const art = pickRowCover(resolvedCovers[track.uid], track.cover, readCoverByUidOrName(track.uid, track.artist, track.title))}
				<li class="row-line">
					<div class="swipe-wrap">
						<span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>
						<span class="reveal reveal-next" aria-hidden="true"><ListStart size={20} /></span>
						<button class="row" class:is-active={player.current?.uid === track.uid} class:edit-row={editMode} use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); openMenu(track); }} onclick={() => rowAction(track, library.liked)} use:swipeAction={{ onSwipeRight: () => swipeQueue(track), onSwipeLeft: () => swipeNext(track) }}>
							<span class="art" use:lazyCover={{ track, onResolved: onCoverResolved }} style:background-image={art ? `url(${art})` : fallbackCover(track)}></span>
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
						<!-- quick-260915-vb9: a folder's own Play is a whole-list play too, so it gets the
						     same Up-Next guarantee as the action row's Play (two Play buttons on one page
						     must not behave differently). -->
						<button class="del" aria-label={t('library.playAll')} title={t('library.playAll')} onclick={() => playList(pl.tracks, pl.tracks[0], { wholeList: true })} use:tapBounce><Play size={16} /></button>
					{/if}
				</div>
				{#if pl.tracks.length}
					<ul class="list">
						{#each pl.tracks as track (track.uid)}
							<!-- quick-260910-qwt: shared three-rung row cover read (see the liked list above). -->
							{@const art = pickRowCover(resolvedCovers[track.uid], track.cover, readCoverByUidOrName(track.uid, track.artist, track.title))}
							<li class="row-line">
								<div class="swipe-wrap">
									<span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>
									<span class="reveal reveal-next" aria-hidden="true"><ListStart size={20} /></span>
									<button class="row" class:is-active={player.current?.uid === track.uid} class:edit-row={editMode} use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); openMenu(track); }} onclick={() => rowAction(track, pl.tracks, pl.id)} use:swipeAction={{ onSwipeRight: () => swipeQueue(track), onSwipeLeft: () => swipeNext(track) }}>
										<span class="art" use:lazyCover={{ track, onResolved: onCoverResolved }} style:background-image={art ? `url(${art})` : fallbackCover(track)}></span>
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
				<!-- quick-260910-qwt: shared three-rung row cover read (see the liked list above). -->
				{@const art = pickRowCover(resolvedCovers[track.uid], track.cover, readCoverByUidOrName(track.uid, track.artist, track.title))}
				<li class="row-line">
					<div class="swipe-wrap">
						<span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>
						<span class="reveal reveal-next" aria-hidden="true"><ListStart size={20} /></span>
						<button class="row" class:is-active={player.current?.uid === track.uid} class:edit-row={editMode} use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); openMenu(track); }} onclick={() => rowAction(track, library.downloads)} use:swipeAction={{ onSwipeRight: () => swipeQueue(track), onSwipeLeft: () => swipeNext(track) }}>
							<span class="art" use:lazyCover={{ track, onResolved: onCoverResolved }} style:background-image={art ? `url(${art})` : fallbackCover(track)}></span>
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
				<!-- quick-260910-qwt: shared three-rung row cover read (see the liked list above). -->
				{@const art = pickRowCover(resolvedCovers[track.uid], track.cover, readCoverByUidOrName(track.uid, track.artist, track.title))}
				<li class="row-line">
					<div class="swipe-wrap">
						<span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>
						<span class="reveal reveal-next" aria-hidden="true"><ListStart size={20} /></span>
						<button class="row" class:is-active={player.current?.uid === track.uid} use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); openMenu(track); }} onclick={() => playEntry(track)} use:swipeAction={{ onSwipeRight: () => swipeQueue(track), onSwipeLeft: () => swipeNext(track) }}>
							<span class="art" use:lazyCover={{ track, onResolved: onCoverResolved }} style:background-image={art ? `url(${art})` : fallbackCover(track)}></span>
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

<!-- quick-260915-vb9: per-tab list sheet (⋯). Only applicable rows render — no dead entries. -->
{#if listMenuOpen}
	<button class="scrim" aria-label={t('menu.close')} onclick={() => (listMenuOpen = false)}></button>
	<div class="sheet" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: () => (listMenuOpen = false) }} use:focusTrap>
		<div class="sheet-head">{tabLabel}</div>
		{#if tabList.length}
			<button class="mi" onclick={queueWholeList} use:tapBounce><ListEnd size={18} /> {t('menu.addToQueue')}</button>
			<button class="mi" onclick={playListNext} use:tapBounce><ListStart size={18} /> {t('menu.playNext')}</button>
		{/if}
		{#if detailPlaylist}
			<button class="mi danger" onclick={deleteDetailPlaylist} use:tapBounce><Trash2 size={18} /> {t('library.deletePlaylist')}</button>
		{/if}
		{#if listMenuHasItems}
			<button class="mi danger" onclick={clearCurrentList} use:tapBounce><Trash2 size={18} /> {t('library.clearList')}</button>
		{/if}
		<button class="mi close" onclick={() => (listMenuOpen = false)} use:tapBounce><X size={18} /> {t('menu.close')}</button>
	</div>
{/if}

<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />

<style>
	.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 16px 0 12px; flex-wrap: wrap; }
	.head h1 { font-size: calc(1.4rem * var(--fs-title, 1)); margin: 0; min-width: 0; }
	.edit-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 6px 12px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.edit-btn[aria-pressed='true'] { background: var(--color-primary); color: #fff; border-color: transparent; }
	/* quick-260915-vb9: four 13px pills — Play ~70px, Shuffle ~90px, Edit ~70px, ⋯ ~40px plus 24px
	   of gaps ≈ 300px, inside a 360px viewport minus page padding, so one line holds. `flex: 0 1 auto`
	   lets a long translated label shrink rather than push ⋯ off the edge. */
	.actions { display: flex; gap: 8px; margin-bottom: 14px; }
	.actions .edit-btn { flex: 0 1 auto; white-space: nowrap; min-width: 0; overflow: hidden; }
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
	/* ---- quick-260915-vb9: per-tab list sheet (mirrors the album page's playlist picker) ---- */
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, 0.45); border: none; }
	.sheet { position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px; padding: 8px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5); max-height: 70vh; overflow-y: auto; }
	.sheet-head { font-size: 13px; color: var(--color-text-muted); padding: 8px 10px; }
	.mi { width: 100%; display: flex; align-items: center; gap: 12px; background: none; border: none; color: var(--color-text); font-size: 15px; padding: 12px; border-radius: 10px; cursor: pointer; text-align: left; }
	.mi:hover { background: var(--color-surface); }
	.mi.danger { color: #ff7a90; }
	.mi.close { color: var(--color-text-muted); }
</style>
