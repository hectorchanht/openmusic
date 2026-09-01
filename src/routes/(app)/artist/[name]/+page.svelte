<script lang="ts">
	// Artist page. DATA CONSTRAINT: the source adapters expose only search + detail
	// (no real artist/album API). So this is DERIVED: searchAll(artistName) →
	// "Hit songs" = the result list; "Albums" = results grouped by track.album.
	// Not a true artist catalog — an approximation from cross-source search.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Heart, Play, Share2 } from '@lucide/svelte';
	import { searchAll } from '$lib/services/catalog';
	import { dedupeBest } from '$lib/services/dedupe';
	import { settings } from '$lib/stores/settings.svelte';
	import { entityCardUrl } from '$lib/services/share';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { online } from '$lib/stores/online.svelte';
	import RowBadges from '$lib/components/RowBadges.svelte';
	import { t, type TranslationKey } from '$lib/i18n';
	import { longpress } from '$lib/actions/longpress';
	import { lazyCover } from '$lib/actions/lazyCover';
	import { dragScroll } from '$lib/actions/dragScroll';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { marquee } from '$lib/actions/marquee';
	import { swipeAction } from '$lib/actions/swipeAction';
	import { tick as hapticTick } from '$lib/util/haptics';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import TagChips from '$lib/components/TagChips.svelte';
	import { enrichArtist, getArtistTopAlbums, type EnrichResult, type DiscoveryAlbum } from '$lib/services/lastfm';
	import { getSimilarArtists } from '$lib/services/similar';
	import { deezerArtistCover, deezerArtist, deezerArtistAlbums, type DeezerArtistInfo } from '$lib/services/deezer';
	import { sortByReleaseDesc, filterByType, typeLabelKey, releaseYear, albumHref, fallbackCoverSeed, type DiscographyEntry } from '$lib/services/discography';
	import { mergeEnrichArtist } from '$lib/services/enrich-merge';
	import { mapWithConcurrency } from '$lib/services/discovery';
	import PageOg from '$lib/components/PageOg.svelte';
	import type { PageData } from './$types';
	import type { Track } from '$lib/sources/types';

	// `data.og` comes from the universal +page.ts load (artist title/description derived at SSR) so
	// the artist page emits a crawler-correct OG card in the server HTML (GLN-4).
	let { data }: { data: PageData } = $props();

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);

	// OG-COMPAT-01 / Pitfall 1: read the param DIRECTLY — SvelteKit decoded it already
	// (decode_params, utils/routing.js:304). Decoding a second time threw URIError on any artist name
	// containing a literal '%', which crashed the SSR render (`GET /artist/50%25%20Cent` → 500). This
	// is the FOURTH double-decode site; RESEARCH §A.3 listed only three, but the loader fix alone left
	// the route 500ing here. The literal param stays the RESOLUTION key (CONTEXT: `dn`/the card are
	// display-only), so no lookup behavior changes — only the crash goes away.
	const name = $derived(page.params.name ?? '');

	let songs = $state<Track[]>([]);
	let loading = $state(true);
	let loadedFor = '';

	// ---- Last.fm enrichment (Phase 8, ENRICH-01/02 · D-07/D-08) ----
	// Best-effort, AUGMENTS the derived track-list — it never blocks or replaces the
	// searchAll load below (D-02). A SEPARATE $effect keyed on `name` with its own
	// guard void-fires enrichArtist (never awaited, never throws) and assigns the
	// result only if `name` still matches (race guard). A CN artist with no Last.fm
	// match / absent key resolves to the all-empty shape, so nothing extra renders.
	let enrich = $state<EnrichResult | null>(null);
	let enrichedFor = '';
	// In-flight flag for the About/bio skeleton (enrich settling to its all-empty shape is
	// indistinguishable from a no-bio result via `enrich` alone, and a failed fetch must not
	// leave the skeleton up forever — so track the settle explicitly).
	let enrichLoading = $state(true);

	// ---- Artist albums (Phase 9 D-04 + Phase 23 ART-01 / D-18 / D-19; pre-gate RELAXED quick-260711-te4) ----
	// Show every album that EXISTS — no trackless pre-gate. Previously (D-18) we verified each
	// album had resolvable tracks before rendering: the Deezer path filtered on `nb_tracks > 0`, the
	// Last.fm path ran a CAPPED per-album `getAlbumTracklist` count and hid any album that resolved
	// to 0 tracks. That gated the whole shelf on song-resolvability and spent N per-album fetches
	// (Path B) purely to decide whether to draw a card. It's redundant: the album *detail* page
	// already resolves the songs within lazily on tap (resolveStub, D-05). So the shelf now renders
	// as soon as the album LIST is known and defers song resolution to the album page. Source
	// priority (§8.2 AUGMENT): Deezer `deezerArtistAlbums` first (native list + covers), else
	// Last.fm getArtistTopAlbums. Both paths drop only obvious stub names (isStubAlbumName) — a
	// garbage-name filter, NOT a resolvability gate. Unified { name, image } shape so nav (which
	// keys on the album name) is unchanged.
	// quick-260831-qkx: RenderAlbum is now the shared DiscographyEntry — it carries the Deezer
	// album `id` (so the album page can fetch the REAL tracklist instead of re-matching by name),
	// plus `releaseDate`/`type` for the newest-first sort and the albums+EPs filter. The Last.fm
	// fallback path supplies null for all three, which every rule tolerates.
	type RenderAlbum = DiscographyEntry;
	// FULL discography (every record type), newest-first. The shelf renders a filtered view.
	let albums = $state<RenderAlbum[]>([]);
	let albumsFor = '';
	// In-flight flag for the Albums skeleton (an empty result and "still loading" are both
	// `albums.length === 0`, so the settle is tracked explicitly).
	let albumsLoading = $state(true);
	// The shelf shows albums + EPs only (user decision, 2026-09-01): Coldplay's real discography is
	// 123 releases — 17 albums, 5 EPs, 101 singles — so an unfiltered shelf is the reported noise.
	// The full list stays available on the discography page.
	const shelfAlbums = $derived(filterByType(albums, 'main'));

	// "More like this" shelf (quick-260607-jip). getSimilarArtists() chains Last.fm → Deezer
	// (jau-added fallback) → same-artist. Each related artist gets its avatar via Deezer's
	// artist-picture endpoint (4 in-flight cap; never throws). Race-guarded on `name`.
	type RelatedArtist = { name: string; image: string | null };
	let related = $state<RelatedArtist[]>([]);
	let relatedFor = '';
	let relatedLoading = $state(true);

	// ---- Deezer artist info (Phase 17, ENRICH-04 / D-14·D-16) ----
	// PARALLEL race-guarded effect cloning the enrichedFor idiom with its own `dzFor` guard.
	// deezerArtist never throws (own-origin /api/deezer/artist proxy) — a miss settles `dz` to
	// null → the Deezer info section is silently absent (D-14). Best-quality image + counts are
	// merged with the Last.fm enrich via the pure mergeEnrichArtist helper (D-15).
	let dz = $state<DeezerArtistInfo | null>(null);
	let dzFor = '';
	let dzLoading = $state(true);
	// Field-precedence merge of the Last.fm EnrichResult + Deezer info (D-15). Recomputes
	// reactively as either source settles. The merged image generalizes the old
	// `enrich?.lastfmArt ?? hero` precedent (Deezer hi-res wins, never downgrades to null).
	const merged = $derived(mergeEnrichArtist(enrich, dz));

	function fallbackCover(t: Track): string {
		const h = (t.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}
	// COVER-02 D-14: hit-song rows resolve empty/broken covers lazily on scroll via use:lazyCover,
	// repainting through this reactive uid→url map. SOLID https only (Plan 02 gate) — safe for the
	// existing background-image render (T-0bb-01). The al-cover album/related rows are NOT touched.
	let resolvedCovers = $state<Record<string, string>>({});
	function onCoverResolved(uid: string, url: string) {
		resolvedCovers = { ...resolvedCovers, [uid]: url };
	}
	// String-seed placeholder for a coverless row. quick-260831-qkx hoisted it to
	// $lib/services/discography so the discography page renders the identical gradient.

	// kmn: action-bar state. Heart fills when artist is in library.favArtists; play picks a
	// random hit + queues all songs from this artist; share uses Web Share API.
	const favArtist = $derived(library.isFavArtist(name));

	// WR-06 / D-15: feedback goes through the GLOBAL toast store (rendered once by ToastHost) —
	// the local toastMsg/toastTimer copy this page shipped was re-consolidated away.
	function toggleFavourite() {
		const was = favArtist;
		library.toggleFavArtist(name);
		toast.show(was ? t('toast.artistUnfavorited') : t('toast.artistFavorited'));
	}

	// Swipe-action commit handlers (UX-04 D-03/D-04) — same semantics as TrackMenu addQueue()/
	// playNext(): right = append to queue, left = play next. Commit-tier haptic tick + toast (D-17).
	function queueTrack(track: Track) {
		player.addToQueue(track);
		hapticTick();
		toast.show(t('toast.addedToQueue'));
	}
	function nextTrack(track: Track) {
		player.playNext(track);
		hapticTick();
		toast.show(t('toast.playingNext'));
	}

	function playArtistRandom() {
		if (!songs.length) return;
		const pickIdx = Math.floor(Math.random() * songs.length);
		const picked = songs[pickIdx];
		// Queue order = picked first, then the rest shuffled — same intent as the
		// shuffle button on a playlist. player.play() handles ensureAhead growth.
		const rest = songs.filter((_, i) => i !== pickIdx);
		for (let i = rest.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[rest[i], rest[j]] = [rest[j], rest[i]];
		}
		player.setQueue([picked, ...rest], 'artist');
		void player.play(picked, { fresh: true });
	}

	async function shareArtist() {
		// SHARE-02 / D-04 / OG-PATH-02: the artist entity link. The /artist/[name] route is the
		// readable entity page (SSR-opted-in by 24-04 for the crawler OG head) and the AUTHORITATIVE
		// round-trip key is the literal artist name in the path — ONE segment, since an artist has no
		// secondary name. Never an ASCII slug: entityShareUrl() slugifies CJK to '' (share.ts), which
		// would yield a non-reopening link for the app's primary CJK catalog. No ?play= carrier — an
		// artist page is an entity, not a now-playing restore (D-06). location guarded for SSR safety.
		//
		// quick-260723-ry1 (match the song card) — the link is now CARRIER-FREE (no `?` at all):
		//  - OG-EP-01: no `c` cover carrier; the card image is the own-origin /api/og endpoint, which
		//    re-resolves the hero art server-side.
		//  - OG-ZH-01 / RESEARCH §E.17: the `dn` DISPLAY QUERY CARRIER is retired.
		//
		// quick-260808-urx: the single path segment now carries the DISPLAY-language artist name —
		// what this user actually sees — not the raw catalog metadata, per the user's ask ("zht user
		// must not share zhs"). NOT a reversal of OG-ZH-01: the dn carrier stays dead; display text
		// rides the PATH, the single value used for BOTH display and resolution.
		//
		// Reliability (verified — do not re-check): names.resolve() returns the cached display string
		// and falls back to the raw text on a miss, so this is exactly what the page rendered; the
		// zh-Hant s2t dict is boot-warmed (quick-260712-et3) → synchronous. The recipient-side
		// Traditional-vs-Simplified resolution risk is closed by resolveStub's t2s rescue-on-miss.
		const dName = names.dnArtist(name);
		const url = entityCardUrl({ type: 'artist', name: dName });
		const title = dName;
		try {
			const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
			// quick-260808-vkd — the link rides `text`, NOT `url`. DO NOT "fix" this back.
			// The Web Share API spec URL-PARSES `ShareData.url` and re-serializes it, and the WHATWG
			// URL serializer percent-encodes every path code point above U+007E — so a `url` member
			// silently undoes encodePathSegment's raw-CJK output (quick-260807-vl1) at the very last
			// step. `ShareData.text` is NOT parsed; it is passed through verbatim. WhatsApp /
			// iMessage / Slack auto-linkify a bare URL inside shared text and still fetch its OG
			// card, so no preview is lost. Sending BOTH would duplicate the link in the message
			// (once readable, once encoded) on every target that concatenates the two members.
			// The former `text: title` was redundant with `title` — the link takes that slot.
			// quick-260808-vzu — the title line is now OPT-IN (settings.shareIncludeTitle, default
			// OFF). Concatenating targets (WhatsApp) render `title` and `text` as two separate lines,
			// so an unconditional title showed the artist name above the link and then AGAIN inside
			// the OG card the link unfurls into. It is a SETTING, not a deletion — some users want the
			// context inline, so the old behavior is one toggle away in Settings → General. Tradeoff
			// when OFF: targets that use `title` as a subject line (email, some Slack surfaces) get a
			// barer share. No placeholder title in the OFF branch — the Web Share spec needs at least
			// one of title/text/url, and `{ text: url }` satisfies it.
			if (nav.share) await nav.share(settings.shareIncludeTitle ? { title, text: url } : { text: url });
			else { await navigator.clipboard.writeText(url); toast.show(t('toast.shareCopied')); }
		} catch {
			/* user dismissed / clipboard blocked — no toast on cancel */
		}
	}

	const hero = $derived(songs.find((t) => t.cover)?.cover ?? null);
	// Prefer the best-quality enrichment image (Deezer hi-res > Last.fm art, via the merge)
	// ONLY when present; otherwise keep the derived cover so a real hero NEVER regresses to a
	// placeholder (ENRICH-02/D-15 override D-03).
	const heroImg = $derived(merged.image ?? hero);

	$effect(() => {
		const n = name;
		// OFFL-03 / D-10: SHORT-CIRCUIT when offline — never fire searchAll (which would hang and
		// strand the hit-songs skeleton). Clear `loading` so the inline offline state shows instead
		// of a stuck spinner. No redirect (D-09). The fetch resumes on the next online visit.
		// WR-01: do NOT gate this on `n` — an empty name AND offline (deep link `/artist/`) must
		// still clear the loader, else the skeleton is stuck forever (the fetch branch below also
		// never runs when `!n`).
		if (!online.isOnline) {
			loading = false;
			return;
		}
		if (n && loadedFor !== n) {
			loadedFor = n;
			loading = true;
			songs = [];
			searchAll(n, 1)
				.then((r) => (songs = dedupeBest(r.interleaved, settings.preferredSource)))
				.catch(() => (songs = []))
				.finally(() => (loading = false));
		}
	});

	// SEPARATE enrichment effect (D-02: augment, never block/replace the searchAll
	// load above). Keyed on `name` with its own `enrichedFor` guard.
	$effect(() => {
		const n = name;
		// OFFL-03: don't fire enrichment when offline; clear the bio skeleton flag so the hero
		// doesn't sit on a stuck skeleton (the `loading || enrichLoading` gate). Resumes online.
		// WR-01: ungated on `n` so an empty-name offline deep link clears this skeleton too.
		if (!online.isOnline) {
			enrichLoading = false;
			return;
		}
		if (n && enrichedFor !== n) {
			enrichedFor = n;
			enrich = null;
			enrichLoading = true;
			void enrichArtist(n)
				.then((r) => {
					if (enrichedFor === n) enrich = r; // race guard — discard if name changed
				})
				.finally(() => {
					if (enrichedFor === n) enrichLoading = false;
				});
		}
	});

	// Drop obvious stubs UP FRONT before any verification (D-18): an empty / whitespace-only name,
	// or a known placeholder string. Applied to BOTH the Deezer and the Last.fm list paths.
	function isStubAlbumName(raw: string | null | undefined): boolean {
		const s = (raw ?? '').trim().toLowerCase();
		if (!s) return true;
		return s === '(null)' || s === 'null' || s === 'undefined' || s === 'unknown album' || s === 'unknown';
	}

	// SEPARATE albums effect (D-04 + ART-01 D-18/D-19). Mirrors the enrichedFor race guard with
	// its own `albumsFor` key. Never blocks the Hit-songs / bio load; an empty settle → the
	// section hides. Verify-before-render: skeleton stays up until track-counts are known.
	$effect(() => {
		const n = name;
		// OFFL-03: skip the albums fetch offline; clear the skeleton flag (no stuck loader).
		// WR-01: ungated on `n` so an empty-name offline deep link clears this skeleton too.
		if (!online.isOnline) {
			albumsLoading = false;
			return;
		}
		if (n && albumsFor !== n) {
			albumsFor = n;
			albums = [];
			albumsLoading = true;
			void (async () => {
				try {
					// Path A (preferred, D-19): Deezer carries the album list + covers natively.
					// quick-260711-te4: NO nb_tracks>0 pre-gate — render every album that exists;
					// the album page resolves the songs within on tap.
					const dzAlbums = await deezerArtistAlbums(n).catch(() => []);
					if (albumsFor !== n) return; // race guard
					if (dzAlbums.length) {
						// quick-260831-qkx: carry id/date/type through, then order newest-first. The
						// proxy already returns the artist's WHOLE discography (paged), so this is the
						// exhaustive list; the shelf filters it and the discography page does not.
						const kept = sortByReleaseDesc(
							dzAlbums
								.filter((a) => !isStubAlbumName(a.title))
								.map(
									(a) =>
										({
											id: a.id,
											name: a.title,
											image: a.cover,
											releaseDate: a.release_date,
											type: a.record_type
										}) satisfies RenderAlbum
								)
						);
						if (albumsFor === n) albums = kept;
						return;
					}
					// Path B (fallback, §8.2): Deezer does not cover this artist → Last.fm album list.
					// quick-260711-te4: the CAPPED per-album getAlbumTracklist verification is GONE —
					// it gated the shelf on song-resolvability and cost N fetches. Drop only stub names.
					const lfAlbums = await getArtistTopAlbums(n).catch((): DiscoveryAlbum[] => []);
					if (albumsFor !== n) return; // race guard
					// Path B carries no id/date/type — those stay null, so these entries keep their
					// incoming order (sortByReleaseDesc puts undated last, stable) and render without
					// a type label, exactly as before this change.
					const kept = lfAlbums
						.filter((a) => !isStubAlbumName(a.name))
						.map(
							(a) =>
								({ id: null, name: a.name, image: a.image, releaseDate: null, type: null }) satisfies RenderAlbum
						);
					if (albumsFor === n) albums = kept;
				} finally {
					if (albumsFor === n) albumsLoading = false;
				}
			})();
		}
	});

	// SEPARATE more-like-this effect (jip, ju0 avatar fix). getSimilarArtists chains LF →
	// Deezer → []. Avatar source CHANGED ju0: Last.fm enrichArtist primary (matches the hero
	// — the user reported Deezer often returns wrong avatars due to partial-name matches);
	// Deezer falls back ONLY when LF is empty. Capped at 4 in-flight, race-guarded.
	$effect(() => {
		const n = name;
		// OFFL-03: skip the more-like-this fetch offline; clear the skeleton flag (no stuck loader).
		// WR-01: ungated on `n` so an empty-name offline deep link clears this skeleton too.
		if (!online.isOnline) {
			relatedLoading = false;
			return;
		}
		if (n && relatedFor !== n) {
			relatedFor = n;
			related = [];
			relatedLoading = true;
			void (async () => {
				try {
					const names = await getSimilarArtists(n);
					if (relatedFor !== n) return; // race guard
					if (!names.length) return;
					const withCovers = await mapWithConcurrency(names, 4, async (nm: string) => {
						// Last.fm primary (same source as hero) — exact-name-keyed, fewer wrong matches.
						const lf = await enrichArtist(nm).catch(() => null);
						const lfImg = lf?.lastfmArt ?? null;
						if (lfImg) return { name: nm, image: lfImg };
						// Fall back to Deezer only when LF has no picture for this artist.
						const dz = await deezerArtistCover(nm).catch(() => null);
						return { name: nm, image: dz };
					});
					if (relatedFor === n) related = withCovers;
				} finally {
					if (relatedFor === n) relatedLoading = false;
				}
			})();
		}
	});

	// SEPARATE Deezer-info effect (ENRICH-04, D-14). Clones the enrichedFor race guard with its
	// own `dzFor` key. Never blocks the searchAll load / enrich; a null settle → section absent.
	$effect(() => {
		const n = name;
		// OFFL-03: skip the Deezer-info fetch offline; clear the skeleton flag (no stuck loader).
		// WR-01: ungated on `n` so an empty-name offline deep link clears this skeleton too.
		if (!online.isOnline) {
			dzLoading = false;
			return;
		}
		if (n && dzFor !== n) {
			dzFor = n;
			dz = null;
			dzLoading = true;
			void deezerArtist(n)
				.then((r) => {
					if (dzFor === n) dz = r; // race guard — discard if name changed
				})
				.finally(() => {
					if (dzFor === n) dzLoading = false;
				});
		}
	});

	// Deezer numbers display (fans / albums). Intl-formatted; only rendered when present (D-14).
	const numFmt = new Intl.NumberFormat();
</script>

<svelte:head><title>{name} · openmusic</title></svelte:head>
{#if data.og}
	<PageOg og={data.og} />
{/if}

<header class="hero">
	<button type="button" class="back" aria-label={t('common.back')} onclick={() => history.back()} use:tapBounce><ChevronLeft size={22} /></button>
	{#if heroImg}
		<div class="herocover" style:background-image={`url(${heroImg})`}></div>
	{:else if loading || enrichLoading}
		<div class="herocover sk" aria-hidden="true"></div>
	{:else}
		<div class="herocover" style:background-image="linear-gradient(145deg,#3a2d63,#1a1326)"></div>
	{/if}
	<h1>{names.dnArtist(name)}</h1>
	<p class="note">{t('artist.derived', { count: songs.length })}</p>

	<!-- kmn: action bar — Favourite / Play (random hit) / Share. Matches the album-page
	     action-bar visual language (pill buttons, lucide icons). -->
	<div class="actions">
		<button class="act" class:on={favArtist} aria-label={favArtist ? t('artist.unfavorite') : t('artist.favorite')} onclick={toggleFavourite} use:tapBounce>
			<Heart size={18} fill={favArtist ? 'currentColor' : 'none'} />
			<span>{favArtist ? t('artist.unfavorite') : t('artist.favorite')}</span>
		</button>
		<button class="act primary" aria-label={t('artist.playArtist')} disabled={loading || !songs.length} onclick={playArtistRandom} use:tapBounce>
			<Play size={18} fill="currentColor" />
			<span>{t('artist.playArtist')}</span>
		</button>
		<button class="act" aria-label={t('artist.share')} onclick={shareArtist} use:tapBounce>
			<Share2 size={18} />
			<span>{t('artist.share')}</span>
		</button>
	</div>

	<!-- Deezer info (ENRICH-04, D-14): fan count + album/discography count, beside the Last.fm
	     enrichment. Shape-matched skeleton while resolving (D-17); silently absent on a miss
	     (`dz` settles to null → neither stat renders). Counts sit side-by-side, source-labeled. -->
	{#if dzLoading}
		<div class="dzstats" aria-hidden="true">
			<span class="sk sk-stat"></span>
			<span class="sk sk-stat"></span>
		</div>
	{:else if merged.deezerFans != null || merged.albums != null}
		<div class="dzstats">
			{#if merged.deezerFans != null}<span class="dzstat"><strong>{numFmt.format(merged.deezerFans)}</strong> {t('deezer.fans')}</span>{/if}
			{#if merged.albums != null}<span class="dzstat"><strong>{numFmt.format(merged.albums)}</strong> {t('deezer.albums')}</span>{/if}
		</div>
	{/if}

	{#if enrich?.tags?.length}
		<div class="herotags"><TagChips tags={enrich.tags} /></div>
	{/if}

	<!-- Bio (quick-260607-f4y: HTML-stripped, auto-translated to the app language via
	     names.dnBio — bio is one of the only two translated surfaces). Gated on BOTH bio
	     AND bioUrl so the required attribution link is never missing (D-08). -->
	{#if enrichLoading}
		<section class="bio" aria-hidden="true">
			<span class="sk sk-h2"></span>
			<span class="sk sk-line"></span>
			<span class="sk sk-line"></span>
			<span class="sk sk-line short"></span>
		</section>
	{:else if enrich?.bio && enrich?.bioUrl && names.dnBio(enrich.bio) && names.dnBio(enrich.bio).length}
		<section class="bio">
			<h2>{t('lastfm.about')}</h2>
			<p>{names.dnBio(enrich.bio)}</p>
			<a class="readmore" href={enrich.bioUrl} target="_blank" rel="noopener noreferrer">{t('lastfm.readMore')}</a>
		</section>
	{/if}
</header>

{#if !online.isOnline && !songs.length}
	<!-- OFFL-03 inline offline state: artist discovery needs the network — the effects above
	     short-circuit when offline (no stuck skeletons). Promote Downloads/Library; no redirect
	     (D-09). Shown only when there's nothing already loaded to interact with. -->
	<div class="offline-state">
		<p class="offline-title">{t('offline.title')}</p>
		<p class="offline-body">{t('offline.body')}</p>
		<button type="button" class="offline-cta" onclick={() => goto('/library')} use:tapBounce>{t('offline.goToLibrary')}</button>
	</div>
{/if}

{#if albumsLoading}
	<section>
		<h2>{t('artist.albums')}</h2>
		<div class="albumrow">
			{#each Array(4) as _, i (i)}
				<div class="album" aria-hidden="true">
					<span class="al-cover sk"></span>
					<span class="sk sk-albumname"></span>
					<span class="sk sk-albumcount"></span>
				</div>
			{/each}
		</div>
	</section>
{:else if shelfAlbums.length}
	<section>
		<h2 class="albums-head">
			{t('artist.albums')}
			<!-- quick-260831-qkx: the shelf is albums+EPs only; the full discography (every record
			     type, filterable) lives on its own page so nothing is hidden, just de-noised. -->
			<a class="see-all" href={'/artist/' + encodeURIComponent(name) + '/albums'}>{t('artist.seeAllAlbums')}</a>
		</h2>
		<div class="albumrow" use:dragScroll>
			{#each shelfAlbums as al (al.id ?? al.name)}
				<button class="album" onclick={() => goto(albumHref(al, name))} use:tapBounce>
					<span class="al-cover" style:background-image={al.image ? `url(${al.image})` : fallbackCoverSeed(al.name)}></span>
					<span class="al-name" use:marquee><span class="marquee-inner">{names.dnTitle(al.name)}</span></span>
					<span class="al-count" use:marquee><span class="marquee-inner">
						{#if typeLabelKey(al.type)}{t(typeLabelKey(al.type) as TranslationKey)}{:else}{t('artist.albumLabel')}{/if}{#if releaseYear(al.releaseDate)}{' · ' + releaseYear(al.releaseDate)}{/if}
					</span></span>
				</button>
			{/each}
		</div>
	</section>
{/if}

{#if loading}
	<section>
		<h2>{t('artist.hitSongs')}</h2>
		<ul class="list" aria-label={t('artist.loading', { name: names.dnArtist(name) })}>
			{#each Array(8) as _, i (i)}
				<li>
					<span class="row" aria-hidden="true">
						<span class="sk sk-rank"></span>
						<span class="art sk"></span>
						<span class="meta"><span class="sk sk-rtitle"></span><span class="sk sk-rsub"></span></span>
					</span>
				</li>
			{/each}
		</ul>
	</section>
{:else if online.isOnline || songs.length}
	<!-- Offline with nothing loaded: the inline offline state above covers it, so the empty
	     hit-songs section is suppressed (no duplicate dead screen — D-10). -->
	<section>
		<h2>{t('artist.hitSongs')}</h2>
		{#if songs.length}
			<ul class="list">
				{#each songs.slice(0, 30) as track, i (track.uid)}
					<li>
						<button class="row" use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); menuTrack = track; menuOpen = true; }} use:swipeAction={{ onSwipeRight: () => queueTrack(track), onSwipeLeft: () => nextTrack(track) }} onclick={() => { player.setListQueue(songs, 'artist'); player.play(track, { fresh: true }); }}>
							<span class="rank">{i + 1}</span>
							<span class="art" use:lazyCover={{ track, onResolved: onCoverResolved }} style:background-image={(resolvedCovers[track.uid] ?? track.cover) ? `url(${resolvedCovers[track.uid] ?? track.cover})` : fallbackCover(track)}></span>
							<span class="meta">
								<span class="r-title">{names.dnTitle(track.title)}</span>
								<span class="r-sub">{names.dnArtist(track.album || track.artist)}</span>
							</span>
							<!-- quick-260723: passive liked ♥ + downloaded ✓ indicators on artist hit-song rows. -->
							<RowBadges uid={track.uid} />
						</button>
					</li>
				{/each}
			</ul>
		{:else}<p class="muted">{t('artist.noSongs', { name: names.dnArtist(name) })}</p>{/if}
	</section>
{/if}

<!-- More like this (jip) — round avatar shelf, tap to navigate to that artist. -->
{#if relatedLoading}
	<section>
		<h2>{t('artist.moreLikeThis')}</h2>
		<div class="albumrow">
			{#each Array(6) as _, i (i)}
				<div class="album" aria-hidden="true">
					<span class="al-cover round sk"></span>
					<span class="sk sk-albumname"></span>
				</div>
			{/each}
		</div>
	</section>
{:else if related.length}
	<section>
		<h2>{t('artist.moreLikeThis')}</h2>
		<div class="albumrow" use:dragScroll>
			{#each related as a (a.name)}
				<button class="album" onclick={() => goto('/artist/' + encodeURIComponent(a.name))} use:tapBounce>
					<span class="al-cover round" style:background-image={a.image ? `url(${a.image})` : fallbackCoverSeed(a.name)}></span>
					<span class="al-name center" use:marquee><span class="marquee-inner">{names.dnArtist(a.name)}</span></span>
				</button>
			{/each}
		</div>
	</section>
{/if}

<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />


<style>
	.hero { padding: 14px 0 18px; text-align: center; }
	.back { display: grid; place-items: center; width: 36px; height: 36px; background: none; border: none; color: var(--color-text); cursor: pointer; margin: 0 0 8px; padding: 0; }
	.back:hover { background: var(--color-surface-2); border-radius: 50%; }
	.herocover { width: 150px; height: 150px; border-radius: 50%; margin: 8px auto 12px; background-size: cover; background-position: center; box-shadow: 0 12px 34px rgba(0,0,0,0.5); }
	.hero h1 { font-size: calc(1.7rem * var(--fs-title, 1)); margin: 0; }
	.note { color: var(--color-text-muted); font-size: 12px; margin-top: 4px; }
	.herotags { display: flex; justify-content: center; margin-top: 8px; }
	/* Deezer info stats (ENRICH-04) — fan/album counts under the hero, source-labeled. */
	.dzstats { display: flex; justify-content: center; gap: 18px; margin-top: 10px; flex-wrap: wrap; }
	.dzstat { color: var(--color-text-muted); font-size: 12px; }
	.dzstat strong { color: var(--color-text); font-weight: 600; }
	.dzstats .sk-stat { display: inline-block; width: 64px; height: 13px; }
	/* kmn: action bar — three pill buttons centered under the hero title/note. Mirrors the
	   album-page action-bar visual language. */
	.actions { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; margin: 14px 0 6px; }
	.act { display: inline-flex; align-items: center; gap: 7px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 9px 16px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.act:hover { background: var(--color-surface); }
	.act:disabled { opacity: 0.45; cursor: default; }
	.act.on { color: var(--color-primary); border-color: var(--color-primary); }
	.act.primary { background: var(--color-primary); color: #fff; border-color: transparent; }
	.act.primary:hover { filter: brightness(1.06); }
	.bio { text-align: left; margin: 16px 0 0; }
	.bio h2 { font-size: calc(1.1rem * var(--fs-title, 1)); margin: 0 0 8px; }
	.bio p { color: var(--color-text-muted); font-size: 13px; line-height: 1.55; margin: 0; }
	.readmore { display: inline-block; margin-top: 8px; color: var(--color-primary); font-size: 13px; }
	section { margin: 18px 0; }
	section h2 { font-size: calc(1.1rem * var(--fs-title, 1)); margin: 0 0 12px; }
	/* quick-260831-qkx: the Albums heading now carries a "See all" link to the full discography. */
	.albums-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
	.see-all { font-size: 0.8rem; font-weight: 600; color: var(--color-primary); text-decoration: none; white-space: nowrap; }
	.see-all:active { opacity: 0.6; }
	.albumrow { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 4px; }
	/* min-width:0 + max-width:130px lock the tile width even when a long artist/album name's
	   intrinsic content-width would otherwise stretch it. flex-basis alone is a hint — the
	   default `min-width: auto` on flex items respects content size and `max-width` is needed
	   to seal off the "grows to fit content" path. With both locked at 130px, .al-name's
	   overflow:hidden produces a real clientWidth < scrollWidth, so the use:marquee action
	   detects the overflow and bounce-scrolls the text (instead of a static ellipsis). Same
	   pattern as home .album. */
	.album { flex: 0 0 130px; min-width: 0; max-width: 130px; background: none; border: none; padding: 0; cursor: pointer; text-align: left; display: flex; flex-direction: column; gap: 4px; }
	.al-cover { width: 130px; height: 130px; border-radius: 10px; background-size: cover; background-position: center; }
	.al-cover.round { border-radius: 50%; }
	.al-name { font-size: calc(12px * var(--fs-title, 1)); font-weight: 600; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.al-name.center { text-align: center; }
	.al-count { font-size: calc(11px * var(--fs-artist, 1)); color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	/* Marquee animation lives globally in app.css (transform-based .marquee-inner). The
	   .al-name / .al-count clips above + the use:marquee action + inner .marquee-inner span
	   in the markup are the only per-file pieces — the global rule animates them. */
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.row { width: 100%; text-align: left; background: none; border: none; padding: 6px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 12px; }
	/* MENU-03 / D-12: hover-capable devices only — touch otherwise latches this :hover
	   background on a row under a held finger while the track menu opens. */
	@media (hover: hover) { .row:hover { background: var(--color-surface); } }
	.rank { width: 18px; text-align: center; color: var(--color-text-muted); font-size: 13px; flex: none; }
	.art { width: 44px; height: 44px; border-radius: 6px; background-size: cover; background-position: center; flex: none; }
	.meta { flex: 1; display: flex; flex-direction: column; min-width: 0; }
	.r-title { font-size: calc(14px * var(--fs-title, 1)); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--color-text-muted);}
	.r-sub { font-size: calc(12px * var(--fs-artist, 1)); color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.muted { color: var(--color-text-muted); font-size: 14px; }

	/* OFFL-03 inline offline empty-state (shared idiom across online-only surfaces). */
	.offline-state { text-align: center; padding: 32px 16px; color: var(--color-text-muted); }
	.offline-title { font-size: 15px; font-weight: 600; color: var(--color-text); margin: 0 0 6px; }
	.offline-body { font-size: 13px; margin: 0 0 16px; }
	.offline-cta {
		background: var(--color-primary); border: none; color: #fff; border-radius: 999px;
		padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
	}

	/* ---- loading skeletons (global .sk in app.css supplies the grey + shimmer; these size the
	   blocks to match the real content they stand in for) ---- */
	.bio .sk-h2 { display: block; width: 96px; height: 18px; margin-bottom: 12px; }
	.bio .sk-line { display: block; width: 100%; height: 12px; margin-bottom: 8px; }
	.bio .sk-line.short { width: 55%; }
	/* album-row skeleton tiles: .al-cover sizes the square (130px), bars sit under it */
	.sk-albumname { display: block; width: 78%; height: 12px; }
	.sk-albumcount { display: block; width: 48%; height: 11px; }
	/* hit-songs skeleton rows: reuse .row/.art/.meta layout, grey the rank + bars */
	.sk-rank { width: 14px; height: 12px; flex: none; border-radius: 3px; }
	.meta .sk-rtitle { display: block; width: 80%; height: 13px; margin-bottom: 7px; }
	.meta .sk-rsub { display: block; width: 45%; height: 11px; }
</style>
