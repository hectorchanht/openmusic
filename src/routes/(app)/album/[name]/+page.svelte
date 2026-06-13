<script lang="ts">
	// Album page. The tracklist is the REAL ordered album.getInfo tracklist (Phase 9,
	// D-05), reached by clicking an album on the artist page (which carries the album
	// artist via the ?artist= query param). Each track is a Last.fm {artist,title} STUB
	// resolved to a playable Track lazily, ON TAP, via resolveStub (D-05/D-03) — the same
	// resolve-on-tap path the home shelves use.
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { ChevronLeft, Play, Download, ListPlus, Heart, Share2, Plus, X } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { longpress } from '$lib/actions/longpress';
	import { swipeAction } from '$lib/actions/swipeAction';
	import { shouldRun } from '$lib/actions/inflightGuard';
	import { lazyCover } from '$lib/actions/lazyCover';
	import { toast as globalToast } from '$lib/stores/toast.svelte';
	import { online } from '$lib/stores/online.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import { ListEnd } from '@lucide/svelte';
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { resolveStub } from '$lib/services/discovery';
	import { ensureTrackDetails } from '$lib/services/catalog';
	import { enrichAlbum, getAlbumTracklist, type EnrichResult } from '$lib/services/lastfm';
	import { deezerAlbum, type DeezerAlbumInfo } from '$lib/services/deezer';
	import { mergeEnrichAlbum } from '$lib/services/enrich-merge';
	import { marquee } from '$lib/actions/marquee';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import PageOg from '$lib/components/PageOg.svelte';
	import type { PageData } from './$types';
	import type { Track } from '$lib/sources/types';

	// `data.og` comes from the universal +page.ts load (album title/description derived at SSR) so
	// the album page emits a crawler-correct OG card in the server HTML (GLN-4).
	let { data }: { data: PageData } = $props();

	// A Last.fm tracklist entry — NOT a Track (no uid/source/audioUrl). Resolved on tap.
	type AlbumStub = { artist: string; title: string };

	const name = $derived(decodeURIComponent(page.params.name ?? ''));
	// The album artist is carried in the URL by the artist-page link (?artist=…). It is
	// NOT derived from tracks[0] (the stubs have no resolved artist until tap, and the
	// album.getInfo query NEEDS the artist up front). Absent param (deep link) → '' → the
	// page still renders the hero + a graceful empty state instead of crashing.
	const albumArtist = $derived(page.url.searchParams.get('artist') ?? '');

	let tracks = $state<AlbumStub[]>([]);
	let loading = $state(true);
	let loadedFor = '';

	// ---- Last.fm enrichment (Phase 8, ENRICH-01/02 · D-01c/D-03/D-04) ----
	// Best-effort, AUGMENTS the page — never blocks/replaces the tracklist load. A SEPARATE
	// $effect keyed on `name` + `albumArtist` with its own guard void-fires enrichAlbum
	// (never awaited, never throws) and assigns the result only if the key still matches
	// (race guard). An album with no Last.fm match / absent key resolves to the all-empty
	// shape, so nothing extra renders (the listeners/playcount hero is gated on presence).
	let enrich = $state<EnrichResult | null>(null);
	let enrichedFor = '';
	// In-flight flag for the cover/info skeletons (album art + listeners/playcount come ONLY
	// from Last.fm enrich; tracked explicitly so an empty result / deep-link doesn't strand the
	// skeleton — it stays false unless the enrich effect actually fires).
	let enrichLoading = $state(false);

	// Synthetic gradient cover keyed by the stub (no source cover on a Last.fm stub).
	function fallbackCover(seed: string): string {
		const h = (seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	// COVER-02 D-14: album tracklist rows are Last.fm STUBS ({artist,title} only — no source
	// cover today, just the gradient). use:lazyCover resolves a real cover on scroll-into-view
	// and we paint it OVER the gradient via this reactive uid→url map. The action needs a Track,
	// so we build a synthetic one per stub: the name-layer cache key is (artist,title) — the SAME
	// key the resolved Track uses on tap (resolveCoverForTrack writes both layers) — so the cover
	// caches consistently across the stub here and the real track later (no refetch). The synthetic
	// `uid` uses an `album:` prefix (disjoint from real source uids) for the uid-layer + de-dupe.
	// Resolved values are SOLID https only (Plan 02 gate) — safe for background-image (T-0bb-01).
	let resolvedCovers = $state<Record<string, string>>({});
	function onCoverResolved(uid: string, url: string) {
		resolvedCovers = { ...resolvedCovers, [uid]: url };
	}
	function stubUid(stub: AlbumStub): string {
		return `album:${stub.artist} ${stub.title}`;
	}
	function stubAsTrack(stub: AlbumStub): Track {
		return {
			uid: stubUid(stub),
			source: 'netease',
			songid: '',
			title: stub.title,
			artist: stub.artist,
			album: name,
			cover: null,
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
	// ---- Deezer album info (Phase 17, ENRICH-04 / D-14·D-16) ----
	// PARALLEL race-guarded effect cloning the enrichedFor idiom with its own `dzFor` guard.
	// deezerAlbum never throws (own-origin /api/deezer/album proxy) — a miss settles `dz` to
	// null → the Deezer info section is silently absent (D-14). Best-quality cover + counts +
	// release/label/genres/tracks/duration are merged with the Last.fm enrich via mergeEnrichAlbum.
	let dz = $state<DeezerAlbumInfo | null>(null);
	let dzFor = '';
	let dzLoading = $state(false);
	const merged = $derived(mergeEnrichAlbum(enrich, dz));

	// Prefer the best-quality enrichment cover (Deezer hi-res > Last.fm art, via the merge).
	// The stub tracklist carries no source cover, so this is the only hero art source.
	const heroImg = $derived(merged.cover ?? null);
	const numFmt = new Intl.NumberFormat();
	// Format Deezer total duration (seconds) → "M:SS" or "H:MM:SS" for the album info row.
	function fmtDuration(sec: number): string {
		const h = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		const s = sec % 60;
		const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
		const ss = String(s).padStart(2, '0');
		return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
	}

	// WR-06 / D-15: ALL feedback goes through the GLOBAL toast store (rendered once by
	// ToastHost) — the local toastMsg/toastTimer copy was re-consolidated away so a single
	// gesture never surfaces feedback through two different pipelines.

	// ---- Real album.getInfo ordered tracklist (D-05) ----
	// REPLACES the old searchAll-grouped-by-track.album approximation. Race-guarded on
	// `name|albumArtist`; [] on absent key / absent artist / no match → the graceful empty
	// state. The album.getInfo query needs the artist, so skip the fetch when it is absent.
	$effect(() => {
		const n = name;
		const artist = albumArtist;
		const key = `${n}|${artist}`;
		// OFFL-03 / D-10: SHORT-CIRCUIT when offline — never fire getAlbumTracklist (which would
		// hang and strand the tracklist skeleton). Clear `loading` so the inline offline state shows
		// instead of a stuck spinner. No redirect (D-09). Resumes on the next online visit.
		// WR-01: do NOT gate on `n` — an empty name AND offline (deep link `/album/`) must still
		// clear the loader, else the skeleton is stuck forever (the fetch branch below never runs
		// when `!n`).
		if (!online.isOnline) {
			loading = false;
			return;
		}
		if (n && loadedFor !== key) {
			loadedFor = key;
			tracks = [];
			// WR-08: SvelteKit reuses this component instance across same-route param navigation
			// (history back/forward between two albums). Without these resets, resolveAllCached()
			// short-circuits on the PREVIOUS album's resolved tracks — Like/Download/Add-to-playlist
			// would act on the wrong album and albumLiked would render the stale heart state.
			resolvedCache = null;
			busyAction = null;
			if (!artist) {
				// Deep link with no ?artist= — cannot query album.getInfo. Render the
				// graceful "open from an artist" empty state, not a spinner.
				loading = false;
				return;
			}
			loading = true;
			getAlbumTracklist(n, artist)
				.then((r) => {
					if (loadedFor === key) tracks = r; // race guard — discard if key changed
				})
				.catch(() => {
					if (loadedFor === key) tracks = [];
				})
				.finally(() => {
					if (loadedFor === key) loading = false;
				});
		}
	});

	// SEPARATE enrichment effect (D-02: augment, never block/replace the tracklist load).
	// Keyed on `name` + `albumArtist` with its own `enrichedFor` guard.
	$effect(() => {
		const n = name;
		const artist = albumArtist;
		const key = `${n} ${artist}`;
		// OFFL-03: skip album enrichment offline (enrichLoading stays false → no stuck skeleton).
		if (!online.isOnline) return;
		if (n && artist && enrichedFor !== key) {
			enrichedFor = key;
			enrich = null;
			enrichLoading = true;
			void enrichAlbum(n, artist)
				.then((r) => {
					if (enrichedFor === key) enrich = r; // race guard — discard if key changed
				})
				.finally(() => {
					if (enrichedFor === key) enrichLoading = false;
				});
		}
	});

	// SEPARATE Deezer-info effect (ENRICH-04, D-14). Clones the enrichedFor race guard with its
	// own `dzFor` key. Fires even on a deep link with no ?artist= (deezerAlbum searches on title
	// alone). A null settle → the Deezer info section is silently absent.
	$effect(() => {
		const n = name;
		const artist = albumArtist;
		const key = `${n}|${artist}`;
		// OFFL-03: skip the Deezer-info fetch offline (dzLoading stays false → no stuck skeleton).
		if (!online.isOnline) return;
		if (n && dzFor !== key) {
			dzFor = key;
			dz = null;
			dzLoading = true;
			void deezerAlbum(n, artist)
				.then((r) => {
					if (dzFor === key) dz = r; // race guard — discard if key changed
				})
				.finally(() => {
					if (dzFor === key) dzLoading = false;
				});
		}
	});

	// Resolve-on-tap (D-05/D-03) — now OPTIMISTIC (FIX-A). Delegate to player.playStub so the
	// now-bar locks the tapped {artist,title} with a loading indicator instantly (album stubs
	// carry no cover), dedupes a same-song double-tap, and supersedes an in-flight resolve.
	// playStub returns null for BOTH a miss AND a supersede; toast only on a genuine miss
	// (pendingTrack cleared) — a supersede leaves pendingTrack on the newer song (no toast).
	async function playStub(stub: AlbumStub) {
		const tr = await player.playStub(stub.artist, stub.title, null, 'album');
		if (tr === null) {
			if (player.pendingTrack == null) globalToast.show(t('album.unplayable'));
			return;
		}
		// album-and-next-song-bug fix: playStub installs a one-track queue ([tr]) for the optimistic
		// now-bar, so up-next would otherwise be GENERATED (or grown) rather than the album remainder,
		// and next() could fail. Resolve the rest of the album and re-anchor the queue AROUND the
		// now-playing track so up-next IS the album's remaining tracks (and stays so under the
		// "same-list" sourcing setting). setListQueue keeps `tr` (already current) as the member, so
		// playback is not interrupted. Guard a stale tap: only install while `tr` is still current.
		const all = await resolveAllCached();
		if (player.current?.uid === tr.uid && all.length) player.setListQueue(all, 'album');
	}

	// UX-04 / D-03/D-04: row swipe-actions. Album rows are {artist,title} STUBS, so — exactly like
	// tap-to-play and long-press-menu — the stub is resolved to a real Track BEFORE the queue/like
	// commit. swipe-right = add to queue (player.addToQueue, append-to-end), swipe-left = toggle
	// like (library.toggleLike). Both fire the GLOBAL toast (Plan 01) + a commit-tier haptic tick;
	// a stub that resolves to no CN-source match degrades to the existing unplayable toast (no throw).
	// D-16 / WR-03: per-row-per-action in-flight guard — a second swipe on the same row while
	// its resolve is in flight is a no-op (no duplicate addToQueue / racing toggleLike).
	let swipeInFlight = $state(new Set<string>());

	async function swipeQueue(stub: AlbumStub) {
		const key = `q:${stubUid(stub)}`;
		if (!shouldRun(swipeInFlight, key)) return;
		swipeInFlight = new Set(swipeInFlight).add(key);
		try {
			const tr = await resolveStub(stub.artist, stub.title).catch(() => null);
			if (!tr) { globalToast.show(t('album.unplayable')); return; }
			player.addToQueue(tr);
			globalToast.show(t('toast.addedToQueue'));
			hapticTick();
		} finally {
			const n = new Set(swipeInFlight);
			n.delete(key);
			swipeInFlight = n;
		}
	}
	async function swipeLike(stub: AlbumStub) {
		const key = `l:${stubUid(stub)}`;
		if (!shouldRun(swipeInFlight, key)) return;
		swipeInFlight = new Set(swipeInFlight).add(key);
		try {
			const tr = await resolveStub(stub.artist, stub.title).catch(() => null);
			if (!tr) { globalToast.show(t('album.unplayable')); return; }
			const wasLiked = library.isLiked(tr.uid);
			library.toggleLike(tr);
			globalToast.show(wasLiked ? t('toast.unliked') : t('toast.liked'));
			hapticTick();
		} finally {
			const n = new Set(swipeInFlight);
			n.delete(key);
			swipeInFlight = n;
		}
	}

	// ---- Album-level actions (between hero + tracklist) ----
	// The tracklist is {artist,title} STUBS; the whole-album actions (download/playlist/like)
	// need playable Tracks, so they batch-resolve every stub via the SAME resolveStub path used
	// on tap, concurrency-capped (album-scoped fan-out is user-initiated, not eager per Pitfall
	// 11).
	//
	// ii6: `albumBusy: boolean` → `busyAction: AlbumAction | null`. Each handler sets/clears
	// only its own id, so an in-flight Download doesn't disable Like — only THIS button
	// re-fires are suppressed (double-fire protection retained). Other buttons stay live.
	type AlbumAction = 'play' | 'download' | 'like' | 'addToPlaylist' | 'share';
	let busyAction = $state<AlbumAction | null>(null);
	let pickerOpen = $state(false);

	// Resolved-track cache (ii6). Populated by `resolveAllCached` and reused across like/heart-state
	// computations so the album-like heart reflects the post-action state without re-resolving
	// every render. `null` = not yet resolved; outline-heart is the safe default.
	let resolvedCache = $state<Track[] | null>(null);

	// Long-press TrackMenu (ii6 #4): album rows are STUBS, so we resolve on long-press, then
	// open the menu against the real Track. `menuLoading` shows the TrackMenu skeleton while
	// the resolve is in flight, mirroring the home-shelf long-press idiom.
	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);
	let menuLoading = $state(false);
	async function openMenu(stub: AlbumStub) {
		menuTrack = null;
		menuLoading = true;
		menuOpen = true;
		try {
			const tr = await resolveStub(stub.artist, stub.title).catch(() => null);
			if (!menuOpen) return; // user dismissed during resolve — discard
			if (!tr) { menuOpen = false; globalToast.show(t('album.unplayable')); return; }
			menuTrack = tr;
		} finally {
			menuLoading = false;
		}
	}

	// Resolve EVERY stub to a Track, order-preserved, max 4 concurrent searchAll fan-outs.
	async function resolveAll(): Promise<Track[]> {
		const out: (Track | null)[] = new Array(tracks.length).fill(null);
		let next = 0;
		const worker = async () => {
			for (let i = next++; i < tracks.length; i = next++) {
				out[i] = await resolveStub(tracks[i].artist, tracks[i].title).catch(() => null);
			}
		};
		await Promise.all(Array.from({ length: Math.min(4, tracks.length || 1) }, worker));
		return out.filter((t): t is Track => t !== null);
	}
	/** Resolve and cache, so the second action / heart-state read is instant. */
	async function resolveAllCached(): Promise<Track[]> {
		if (resolvedCache && resolvedCache.length) return resolvedCache;
		const r = await resolveAll();
		resolvedCache = r;
		return r;
	}

	// Album-like state (ii6 #5): "all resolved tracks are liked". Initially `resolvedCache` is
	// null → derived returns false → outline heart. After likeAlbum() resolves + likes, the
	// cache is set + library.liked mutates → derived recomputes to true → filled heart.
	// Tapping again unlikes → recomputes to false → outline. Matches the user-reported flow.
	const albumLiked = $derived(
		!!resolvedCache && resolvedCache.length > 0 && resolvedCache.every((tr) => library.isLiked(tr.uid))
	);

	// Play the whole album: play track 1 instantly (optimistic now-bar), then resolve the rest
	// and set the queue in album order so it plays straight through.
	async function playAlbum() {
		if (!tracks.length || busyAction === 'play') return;
		busyAction = 'play';
		try {
			const first = await player.playStub(tracks[0].artist, tracks[0].title, null, 'album');
			if (!first) {
				if (player.pendingTrack == null) globalToast.show(t('album.unplayable'));
				return;
			}
			const all = await resolveAllCached();
			// album-and-next-song-bug fix: `first` (player.current) was resolved by playStub's own
			// resolveStub and may be a DIFFERENT source-variant uid than `all`'s entry for track 0
			// (resolveStub is non-deterministic + dedupeBest collapses variants). A plain setQueue(all)
			// would leave indexOf(current) === -1 → next() dead. setListQueue re-anchors current into
			// the album list (by uid, then by same-song key) so the whole album plays straight through.
			if (all.length) player.setListQueue(all, 'album');
			else player.setQueue([first], 'album');
		} finally {
			busyAction = null;
		}
	}

	// Download the album → resolve all + re-resolve each at the DOWNLOAD quality + trigger a
	// real browser file save for EACH track (matches the per-track TrackMenu doDownload path)
	// AND add each to the library Downloads tab so they re-stream from the library. hvu: the
	// previous implementation only added to library; user wanted actual on-device files. We
	// stagger the saves slightly so the browser doesn't dedupe simultaneous anchor.click()s.
	async function downloadAlbum() {
		if (!tracks.length || busyAction === 'download') return;
		busyAction = 'download';
		globalToast.show(t('toast.preparingDownload'));
		try {
			const resolved = await resolveAllCached();
			let saved = 0;
			for (const tr of resolved) {
				// WR-07: pass the DOWNLOAD tier explicitly through ensureTrackDetails instead of
				// temporarily mutating settings.defaultQuality — the old swap raced concurrent
				// playback resolves (they resolved at the download tier for the whole loop) and
				// any mid-window settings.save() persisted the wrong streaming default.
				const full = await ensureTrackDetails(
					{ ...tr, detailsLoaded: false, audioUrl: null, lrc: null },
					undefined,
					settings.downloadQuality
				).catch(() => tr);
				library.addDownload(full);
				if (!full.audioUrl) continue;
				// Try fetch+blob+anchor.click first; on CORS / network failure fall back to
				// window.open which lets the BROWSER handle the download (ii6 #1 — the user
				// reported no files were saving; the CN-source audio CDNs don't always send
				// Access-Control-Allow-Origin, so the blob path silently fails without this).
				let didSave = false;
				try {
					const resp = await fetch(full.audioUrl);
					const blob = await resp.blob();
					const ext = (full.audioUrl.split('?')[0].match(/\.(mp3|flac|m4a|aac|ogg|wav)$/i)?.[1] ?? 'mp3').toLowerCase();
					const a = document.createElement('a');
					a.href = URL.createObjectURL(blob);
					a.download = `${full.artist} - ${full.title}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_');
					a.click();
					URL.revokeObjectURL(a.href);
					didSave = true;
				} catch {
					try {
						window.open(full.audioUrl, '_blank');
						didSave = true; // delegated to the browser — count as "initiated"
					} catch {
						/* both paths failed — track stays in library Downloads list */
					}
				}
				if (didSave) saved++;
				// Stagger so browser doesn't squash concurrent downloads / hit per-origin caps.
				await new Promise((r) => setTimeout(r, 250));
			}
			globalToast.show(saved > 0 ? t('toast.downloaded') : resolved.length ? t('toast.noAudio') : t('album.unplayable'));
		} finally {
			busyAction = null;
		}
	}

	// Like the album → resolve all + apply idempotent like-all (gte: AskUserQuestion):
	// if any track is unliked → like the missing ones; if EVERY track is already liked →
	// unlike them all (so the user has an undo). The resolveAll fan-out can take ~10s for a
	// long album so we flash a "loading" toast immediately for visible feedback.
	async function likeAlbum() {
		if (!tracks.length || busyAction === 'like') return;
		busyAction = 'like';
		globalToast.show(t('toast.preparingDownload'));
		try {
			const resolved = await resolveAllCached();
			if (!resolved.length) {
				globalToast.show(t('album.unplayable'));
				return;
			}
			const allLiked = resolved.every((tr) => library.isLiked(tr.uid));
			if (allLiked) {
				for (const tr of resolved) library.toggleLike(tr);
				globalToast.show(t('toast.unliked')); // ii6: past-tense; matches the heart returning to outline
			} else {
				for (const tr of resolved) if (!library.isLiked(tr.uid)) library.toggleLike(tr);
				globalToast.show(t('toast.liked'));
			}
		} finally {
			busyAction = null;
		}
	}

	// Share the album = the current album page URL (carries ?artist= so the link reopens the
	// tracklist). Native share sheet when available, else copy to clipboard.
	async function shareAlbum() {
		if (busyAction === 'share') return;
		busyAction = 'share';
		try {
			// SHARE-02 / D-04: the album entity link. The /album/[name] route is the readable entity
			// page (SSR-opted-in by 24-04 for the crawler OG head) and decodes params.name via
			// decodeURIComponent + reads ?artist= to query the tracklist — so the AUTHORITATIVE round-
			// trip key is the literal album name in the path (plus ?artist=), NOT an ASCII slug.
			// entityShareUrl() is deliberately NOT used here: it slugifies CJK to '' (share.ts), which
			// would yield a non-reopening link for the app's primary CJK catalog (deviation — see
			// SUMMARY). No ?play= carrier — an album page is an entity, not a now-playing restore (D-06).
			const base = typeof location !== 'undefined' ? location.origin : '';
			const path = `/album/${encodeURIComponent(name)}`;
			const url = albumArtist ? `${base}${path}?artist=${encodeURIComponent(albumArtist)}` : `${base}${path}`;
			const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
			if (nav.share) await nav.share({ title: `${name} — ${albumArtist}`, url });
			else {
				await navigator.clipboard.writeText(url);
				globalToast.show(t('toast.shareCopied'));
			}
		} catch {
			/* cancelled */
		} finally {
			busyAction = null;
		}
	}

	// Add the whole album to a playlist (existing or new) → resolve all + add each.
	// resolveAll is ~10s for long albums; flash a "working on it" toast immediately so the
	// user gets visible feedback while the fan-out runs (hvu).
	async function addAlbumToPlaylist(id: string) {
		pickerOpen = false;
		if (busyAction === 'addToPlaylist') return;
		busyAction = 'addToPlaylist';
		globalToast.show(t('toast.preparingDownload'));
		try {
			const resolved = await resolveAllCached();
			for (const tr of resolved) library.addToPlaylist(id, tr);
			globalToast.show(resolved.length ? t('toast.addedToPlaylist') : t('album.unplayable'));
		} finally {
			busyAction = null;
		}
	}
	function newPlaylistForAlbum() {
		const nm = prompt(t('menu.newPlaylistPrompt'));
		if (!nm) return;
		const pl = library.createPlaylist(nm);
		globalToast.show(t('toast.playlistCreated'));
		void addAlbumToPlaylist(pl.id);
	}

	// Playlist picker is a back-to-close overlay (same single-dismiss idiom as TrackMenu).
	$effect(() => {
		if (pickerOpen) {
			untrack(() => overlays.open('album-picker', () => (pickerOpen = false)));
			return () => untrack(() => overlays.dismiss('album-picker'));
		}
	});
</script>

<svelte:head><title>{t('album.title', { name })}</title></svelte:head>
{#if data.og}
	<PageOg og={data.og} />
{/if}

<header class="hero">
	<button class="back" aria-label={t('album.back')} onclick={() => goto(albumArtist ? '/artist/' + encodeURIComponent(albumArtist) : '/')}><ChevronLeft size={22} /></button>
	{#if heroImg}
		<div class="cover" style:background-image={`url(${heroImg})`}></div>
	{:else if loading || enrichLoading}
		<div class="cover sk" aria-hidden="true"></div>
	{:else}
		<div class="cover" style:background-image="linear-gradient(145deg,#3a2d63,#1a1326)"></div>
	{/if}
	<h1>{names.dnTitle(name)}</h1>
	{#if albumArtist}<p class="artist">{names.dnArtist(albumArtist)}</p>{/if}
	<p class="note">{t('album.tracklistNote', { count: tracks.length })}</p>

	<!-- Last.fm album info (D-01c). Rendered only when present; degrades silently. -->
	{#if enrichLoading}
		<p class="info" aria-hidden="true"><span class="sk sk-info"></span></p>
	{:else if enrich?.listeners != null || enrich?.playcount != null}
		<p class="info">
			{#if enrich?.listeners != null}<span>{t('lastfm.listeners')}: {numFmt.format(enrich.listeners)}</span>{/if}
			{#if enrich?.playcount != null}<span>{t('lastfm.playcount')}: {numFmt.format(enrich.playcount)}</span>{/if}
		</p>
	{/if}

	<!-- Deezer album info (ENRICH-04, D-14): release date / label / genres / track count /
	     duration / fans, beside the Last.fm enrichment. Shape-matched skeleton while resolving
	     (D-17); silently absent on a miss. Label uses use:marquee (long names, MEMORY rule). -->
	{#if dzLoading}
		<div class="dzinfo" aria-hidden="true">
			<span class="sk sk-info"></span>
			<span class="sk sk-info short"></span>
		</div>
	{:else if merged.releaseDate || merged.label || merged.genres.length || merged.tracks != null || merged.duration != null || merged.deezerFans != null}
		<div class="dzinfo">
			{#if merged.releaseDate}<span class="dzrow"><b>{t('deezer.released')}</b> {merged.releaseDate}</span>{/if}
			{#if merged.label}<span class="dzrow label"><b>{t('deezer.label')}</b> <span class="lbl" use:marquee><span class="marquee-inner">{merged.label}</span></span></span>{/if}
			{#if merged.genres.length}<span class="dzrow"><b>{t('deezer.genres')}</b> {merged.genres.join(', ')}</span>{/if}
			{#if merged.tracks != null}<span class="dzrow"><b>{t('deezer.tracks')}</b> {merged.tracks}</span>{/if}
			{#if merged.duration != null}<span class="dzrow"><b>{t('deezer.duration')}</b> {fmtDuration(merged.duration)}</span>{/if}
			{#if merged.deezerFans != null}<span class="dzrow"><b>{t('deezer.fans')}</b> {numFmt.format(merged.deezerFans)}</span>{/if}
		</div>
	{/if}
</header>

{#if loading}
	<ul class="list" aria-label={t('album.loading')}>
		{#each Array(10) as _, i (i)}
			<li>
				<span class="row" aria-hidden="true">
					<span class="sk sk-rank"></span>
					<span class="art sk"></span>
					<span class="meta"><span class="sk sk-rtitle"></span><span class="sk sk-rsub"></span></span>
				</span>
			</li>
		{/each}
	</ul>
{:else if !online.isOnline && !tracks.length}
	<!-- OFFL-03 inline offline state: the tracklist fetch short-circuits when offline (no stuck
	     skeleton). Promote Downloads/Library; no redirect (D-09). Takes precedence over the
	     no-tracks / open-from-artist empties so there's no dead screen. -->
	<div class="offline-state">
		<p class="offline-title">{t('offline.title')}</p>
		<p class="offline-body">{t('offline.body')}</p>
		<button type="button" class="offline-cta" onclick={() => goto('/library')}>{t('offline.goToLibrary')}</button>
	</div>
{:else if tracks.length}
	<!-- Album-level actions. ii6: PER-BUTTON disable (busyAction === id) so only the
	     clicked button greys out while its action runs — other buttons stay live. Heart
	     fill state reflects albumLiked (derived from resolvedCache + library.liked). -->
	<div class="album-actions">
		<button class="act" aria-label={t('menu.download')} disabled={busyAction === 'download'} onclick={downloadAlbum}><Download size={20} /></button>
		<button class="act" aria-label={t('menu.addToPlaylist')} disabled={busyAction === 'addToPlaylist'} onclick={() => (pickerOpen = true)}><ListPlus size={20} /></button>
		<button class="act play" aria-label={t('nowplaying.playPause')} disabled={busyAction === 'play'} onclick={playAlbum}><Play size={20} /></button>
		<button class="act" aria-label={albumLiked ? t('menu.liked') : t('menu.like')} disabled={busyAction === 'like'} onclick={likeAlbum}><Heart size={20} fill={albumLiked ? 'currentColor' : 'none'} /></button>
		<button class="act" aria-label={t('menu.share')} disabled={busyAction === 'share'} onclick={shareAlbum}><Share2 size={20} /></button>
	</div>
	<ul class="list">
		{#each tracks as track, i (i)}
			<li class="swipe-wrap">
				<!-- UX-04 reveal layers behind the row; the row translateX (use:swipeAction) exposes them. -->
				<span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>
				<span class="reveal reveal-like" aria-hidden="true"><Heart size={20} fill="none" /></span>
				<button class="row" use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); openMenu(track); }} onclick={() => playStub(track)} use:swipeAction={{ onSwipeRight: () => swipeQueue(track), onSwipeLeft: () => swipeLike(track) }}>
					<span class="rank">{i + 1}</span>
					<span class="art" use:lazyCover={{ track: stubAsTrack(track), onResolved: onCoverResolved }} style:background-image={resolvedCovers[stubUid(track)] ? `url(${resolvedCovers[stubUid(track)]})` : fallbackCover(track.artist + track.title)}></span>
					<span class="meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-sub">{names.dnArtist(track.artist)}</span></span>
					<Play size={16} />
				</button>
			</li>
		{/each}
	</ul>
{:else if !albumArtist}
	<p class="muted">{t('album.openFromArtist')}</p>
{:else}
	<p class="muted">{t('album.noTracks', { name: names.dnTitle(name) })}</p>
{/if}


<!-- ii6 #4: long-press on a track row opens TrackMenu against the resolved track.
     resolveStub runs while menuLoading=true → menu shows its skeleton placeholder. -->
<TrackMenu track={menuTrack} open={menuOpen} loading={menuLoading} onclose={() => { menuOpen = false; menuTrack = null; menuLoading = false; }} />

<!-- Add-album-to-playlist picker (back-to-close sheet, mirrors the track menu's picker). -->
{#if pickerOpen}
	<button class="scrim" aria-label={t('menu.close')} onclick={() => (pickerOpen = false)}></button>
	<div class="picker" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: () => (pickerOpen = false) }} use:focusTrap>
		<div class="picker-head">{t('menu.addToPlaylist')}</div>
		<button class="mi" onclick={newPlaylistForAlbum}><Plus size={18} /> {t('menu.newPlaylist')}</button>
		{#each library.playlists as pl (pl.id)}
			<button class="mi" onclick={() => addAlbumToPlaylist(pl.id)}><ListPlus size={18} /> {pl.name}</button>
		{/each}
		<button class="mi close" onclick={() => (pickerOpen = false)}><X size={18} /> {t('menu.close')}</button>
	</div>
{/if}

<style>
	.hero { padding: 14px 0 18px; text-align: center; position: relative; }
	.back { position: absolute; left: 0; top: 8px; background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.cover { width: 160px; height: 160px; border-radius: 12px; margin: 8px auto 12px; background-size: cover; background-position: center; box-shadow: 0 12px 34px rgba(0,0,0,0.5); }
	.hero h1 { font-size: calc(1.5rem * var(--fs-title, 1)); margin: 0; }
	.artist { color: var(--color-text); font-size: calc(14px * var(--fs-artist, 1)); margin: 4px 0 0; opacity: 0.85; }
	.note { color: var(--color-text-muted); font-size: 12px; margin-top: 4px; }
	.info { color: var(--color-text-muted); font-size: 12px; margin-top: 6px; display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
	/* Deezer album info (ENRICH-04) — release/label/genres/tracks/duration/fans rows. */
	.dzinfo { color: var(--color-text-muted); font-size: 12px; margin-top: 8px; display: flex; gap: 6px 16px; justify-content: center; flex-wrap: wrap; max-width: 520px; margin-left: auto; margin-right: auto; }
	.dzrow { display: inline-flex; align-items: baseline; gap: 5px; min-width: 0; }
	.dzrow b { color: var(--color-text); font-weight: 600; }
	.dzrow.label { max-width: 220px; }
	.dzrow .lbl { display: inline-block; max-width: 150px; min-width: 0; overflow: hidden; white-space: nowrap; }
	.dzinfo .sk-info.short { width: 90px; }
	.muted { color: var(--color-text-muted); font-size: 14px; }

	/* OFFL-03 inline offline empty-state (shared idiom across online-only surfaces). */
	.offline-state { text-align: center; padding: 32px 16px; color: var(--color-text-muted); }
	.offline-title { font-size: 15px; font-weight: 600; color: var(--color-text); margin: 0 0 6px; }
	.offline-body { font-size: 13px; margin: 0 0 16px; }
	.offline-cta {
		background: var(--color-primary); border: none; color: #fff; border-radius: 999px;
		padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
	}
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	/* UX-04: positioning context for the swipe reveal layers. The reveal spans sit BEHIND the row
	   (the row carries an opaque background); the row translateX (use:swipeAction) slides to expose
	   the correct side. overflow:hidden masks the reveal at rest + clips the row travel. */
	.swipe-wrap { position: relative; overflow: hidden; border-radius: 8px; }
	.reveal {
		position: absolute; top: 0; bottom: 0; width: 96px; display: flex; align-items: center;
		justify-content: center; color: #fff; pointer-events: none;
	}
	.reveal-queue { left: 0; background: var(--color-primary); }
	.reveal-like { right: 0; background: var(--src-netease); }
	.row { width: 100%; text-align: left; background: var(--color-bg); position: relative; z-index: 1; border: none; padding: 6px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 12px; color: var(--color-text); }
	/* MENU-03 / D-12: hover-capable devices only — touch otherwise latches this :hover
	   background on a row under a held finger while the track menu opens. */
	@media (hover: hover) { .row:hover { background: var(--color-surface); } }
	.rank { width: 18px; text-align: center; color: var(--color-text-muted); font-size: 13px; flex: none; }
	.art { width: 44px; height: 44px; border-radius: 6px; background-size: cover; background-position: center; flex: none; }
	.meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
	.r-title { font-size: calc(14px * var(--fs-title, 1)); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.r-sub { font-size: calc(12px * var(--fs-artist, 1)); color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	/* ---- loading skeletons (global .sk in app.css supplies the grey + shimmer; these size the
	   blocks to match the real content) ---- */
	.info .sk-info { display: inline-block; width: 150px; height: 12px; }
	.sk-rank { width: 14px; height: 12px; flex: none; border-radius: 3px; }
	.meta .sk-rtitle { display: block; width: 80%; height: 13px; margin-bottom: 7px; }
	.meta .sk-rsub { display: block; width: 45%; height: 11px; }

	/* ---- album-level action toolbar (between hero + tracklist) ---- */
	.album-actions { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 2px 0 20px; }
	.act { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); cursor: pointer; transition: background 0.15s, transform 0.1s; }
	.act:hover { background: var(--color-surface); }
	.act:active { transform: scale(0.92); }
	.act:disabled { opacity: 0.4; cursor: default; }
	.act.play { width: 56px; height: 56px; background: var(--color-primary); border-color: transparent; color: #fff; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4); }
	/* ---- add-to-playlist picker (mirrors the track menu sheet) ---- */
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, 0.45); border: none; }
	.picker { position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px; padding: 8px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5); max-height: 70vh; overflow-y: auto; }
	.picker-head { font-size: 13px; color: var(--color-text-muted); padding: 8px 10px; }
	.mi { width: 100%; display: flex; align-items: center; gap: 12px; background: none; border: none; color: var(--color-text); font-size: 15px; padding: 12px; border-radius: 10px; cursor: pointer; text-align: left; }
	.mi:hover { background: var(--color-surface); }
	.mi.close { color: var(--color-text-muted); }
</style>
