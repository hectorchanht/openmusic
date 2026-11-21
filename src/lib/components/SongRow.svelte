<script lang="ts">
	// SongRow — the ONE song row for list surfaces (quick-260919-l9e). CLAUDE.md's Anti-Patterns
	// section has been asking for this: `swipeQueue` / `swipeNext` / `openMenu` / `rowKey` were
	// re-declared across 6+ pages in three variants. They live here now, once.
	//
	// STRANGLER MIGRATION — round 2 adds charts/tags, charts/countries, search, album and the four
	// library lists, so SIX surfaces run on this row. The two NowPlaying panes (NpUpNext, NpRelated)
	// stay on their own markup ON PURPOSE — see the "WHY THE SHEET PANES ARE NOT HERE" note below.
	// CompactRow is deliberately NOT yet folded in (D-3): it serves the home
	// shelves, which had a live layout regression hours before this was written, and re-expressing
	// it would put that surface inside the blast radius of a brand-new component for zero visible
	// gain. CONVERGENCE CONDITION: once >=3 surfaces run on SongRow, re-express CompactRow's
	// `variant='track'` branch as <SongRow actions={[]}> at the 40x40 art scale.
	// `variant='artist'` (round avatar, one line, no menu) is NEVER unified — D-4, and CLAUDE.md
	// already records that the item-type difference is real.
	//
	// WHY THE SHEET PANES ARE NOT HERE (NpUpNext / NpRelated). Three of their requirements are not
	// prop-shaped, they are shape-shaped, and expressing them would mean degrading the panes:
	//   1. NO per-row cover chain is allowed on either pane (T-26-10-01 — per-row use:lazyCover WAS
	//      the observed /api/deezer/search flood). `lazy={false}` below covers that half, but
	//   2. the ⋮ is UNCONDITIONAL here, and quick-260910-nx6 deliberately DELETED the per-row
	//      control from Up Next to buy back 44px in a narrow sheet column; re-adding it undoes a
	//      shipped decision, and
	//   3. Up Next's grip is a real pointer-drag reorder handle that must sit OUTSIDE the swiped
	//      element (so it does not slide with the row) and needs down/move/up callbacks with the
	//      row index. `grip` below is a decorative, pointer-events:none glyph INSIDE `.srow`.
	// Up Next also branches on a probe-dead `skipped` state (dim + leading ✗ + tap-retries-this-
	// exact-track) and paints a purple playing tint over an opaque base. Forcing those through
	// would cost more props than the markup they replace. The panes keep their own rows.
	//
	// D-6 — WHY A <div> WITH A STRETCHED .hit BUTTON, not a <button> row. The inline Like/Download
	// controls are real buttons, and a <button> inside a <button> is invalid HTML that browsers
	// resolve by making the inner one unreachable. So the row is a div; a transparent `.hit` button
	// is stretched over it (inset: 0) and carries the play onclick + use:longpress; the visual
	// content is `pointer-events: none` so it never swallows a tap meant for `.hit`; and the action
	// buttons are SIBLINGS painted above it. This is the quick-260919-1eh solution, verbatim.
	// use:swipeAction and use:tapBounce go on the WRAPPER, not on `.hit` — swipeAction writes inline
	// translateX on its own node, and on an absolutely-positioned child the row would not visibly
	// slide. But the wrapper's bounce MUST be scoped to `.hit` (quick-260919-l9e): pointerdown
	// bubbles, so an unscoped `use:tapBounce` here scaled the whole row for a press on Like /
	// Download / ⋮ as well, sliding those controls ~6 / ~9 / ~12px inward at the keyframe's 0.94
	// peak while the browser hit-tested the release at the ORIGINAL coords. The press and the
	// release then landed on different elements, `click` fired on their common ancestor — this
	// inert `.srow` div — and the tap was SWALLOWED (the reported "like does nothing", "download
	// fails", "the ⋮ is swallowed sometimes"; measured dead zones were the outer ~17% of Like and
	// ~30% of the ⋮). `only: '.hit'` means a row tap still bounces the row — `.hit` is stretched
	// over it and the visuals are pointer-events:none, so every press that is NOT on one of these
	// controls lands there — while a press ON a control leaves the row at rest and nothing moves
	// under the finger. Each control keeps its OWN bounce, which scales about its own centre and
	// so displaces its own rim by ~1px instead of its width. `.opt` deliberately has none, exactly
	// as CompactRow's trailing ⋮ does not.
	//
	// D-2 — WIDTH (SUPERSEDED by D-8, quick-261121-row3): the two-line row made `.meta` absorb
	// 100% of the squeeze (art 44, each inline action 36, the menu 28 — quick-261006-smb) and
	// answered the overrun with use:marquee. Hector replaced that bargain wholesale; see D-8.
	// The one piece that survives intact: quick-261020-norank — the rank column (18px) is GONE
	// (no page shows song numbering; the number's width belongs to the title/artist) and there
	// is deliberately NO `index` prop, so a future surface cannot re-add numbers by passing one.
	//
	// D-7 — THE 24+-ROW BUDGET, which every future edit here has to keep:
	//   * an action that is OFF renders NO node (no hidden placeholder, no visibility trick);
	//   * ONE $effect per instance, the WR-01 identity-change cover reset CompactRow already pays;
	//   * ZERO new network per row — the cover chain is the same pickRowCover READ + the one
	//     use:lazyCover the migrated pages already ran;
	//   * DownloadControl is never passed `probe` (its own doc-comment forbids it on a list row —
	//     that is the api-fetch-flood lesson), so its probe $effect early-returns on line one;
	//   * each inline button reads library.isLiked / isDownloaded — the SAME reads RowBadges
	//     performed on these rows before, and `hideLiked`/`hideDownloaded` below removes the
	//     badge's copy, so the net subscription count per row is UNCHANGED.
	//
	// D-8 — FINAL: THE ROW STACKS, NOTHING SQUEEZES (quick-261121-row3; Hector's layout, settled
	// 2026-11-21 after three iterations — brief: openmusic-songrow/brief.md). The row is THREE
	// fixed lines beside a 64px cover:
	//   line 1 — the TITLE alone. Nobody competes, not even the ⋮: the title is the most
	//     important AND the longest string in the row, so it owns the whole meta column (~240px
	//     at 360px, vs the ~130px marquee box the D-2 bargain gave it).
	//   line 2 — the ARTIST + the ⋮ at the right. Artist names are usually shorter, so this is
	//     the line that can afford to host one button; the name still gets ~200px — the
	//     three-artist string 玖壹壹 · 高爾宣 OSN · 派偉俊， which the old shared subtitle cut
	//     inside its second artist, now fits whole.
	//   line 3 — the ALBUM as plain text at the left + the passive badges + the inline
	//     Like/Download at the right. The `.album-tag` pill is DEMOTED to text: it was always a
	//     passive span, and it can never eat the artist again — they are never on the same line.
	// NO MARQUEE in lists any more: every line ellipsises. A frozen glance at a bounce-scrolling
	// row reads a mid-scroll fragment ("…LUES Live)"), which is noise, not information; marquee
	// survives only where a line owns the full width (Now Playing). NO STRETCH: the row is a
	// fixed 96px (padding 10 + lines 24/20/24 + gaps 4/4 + padding 10) for short titles and
	// five-artist rows alike, and `contain-intrinsic-size` carries the same 96 so virtualised
	// lists do not jump.
	// HIT TARGETS: every control's hit box is ≥44×44 again — the 36px / 28px boxes D-2 shipped
	// violated Hector's 44px rule. The VISIBLE boxes stay compact (36 wide, line height) and a
	// ::after expands the hit area invisibly. Three 44px bands cannot tile 96px, so the
	// expansions overlap BY DESIGN and the seam is assigned, not accidental: the ⋮'s expansion
	// is bottom-aligned to its line (it reaches UP into line 1's empty right end, never down),
	// the line-3 expansions are centred (their bottoms land exactly on the row's bottom edge),
	// and the menu carries the higher z-index — in the one contested strip (the download
	// column, ~6px) the menu wins, because a control whose own glyph area is partly dead is
	// the D-6 swallowed-tap bug again, while Download loses only expansion, never its box.
	// THE ALBUM ECHO IS DROPPED: album == title renders NO line-3 text (quick-261010-sar2's
	// suppression, previously only on the smartArtist tag, now uniform — line 3 repeating
	// line 1 verbatim is noise on every surface).
	// THE COVER stays inside the --cover-scale system at a 64px base (64px belongs to this
	// tall row only; CompactRow keeps its 40px base), capped at the 76px content box so a
	// 150% cover setting cannot push the fixed row open.
	import { Heart, MoreVertical, GripVertical } from '@lucide/svelte';
	import type { Track } from '$lib/sources/types';
	import { longpress } from '$lib/actions/longpress';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { lazyCover } from '$lib/actions/lazyCover';
	import { swipeAction, type SwipeActionOpts } from '$lib/actions/swipeAction';
	import { pickRowCover } from '$lib/services/row-cover';
	import { sizedCover, ROW_COVER_PX } from '$lib/services/cover-size';
	import { readCoverByUidOrName, readChosenCover } from '$lib/stores/cover-version.svelte';
	import { coverGradient } from '$lib/services/cover-gradient';
import { videoAvailability } from '$lib/services/video-availability.svelte';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { settings, type RowAction } from '$lib/stores/settings.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import { t } from '$lib/i18n';
	import { rowActionTarget, hasRealIdentity } from '$lib/components/row-action-target';
	import { rowSwipe } from '$lib/components/swipe-act';
	import RowBadges from '$lib/components/RowBadges.svelte';
import CoverArt from '$lib/components/CoverArt.svelte';
	import DownloadControl from '$lib/components/DownloadControl.svelte';
	import DownloadRing from '$lib/components/DownloadRing.svelte';
	import { splitArtists } from '$lib/util/artist-split';
	import { resolveArtistNames } from '$lib/services/artist-names';

	interface Props {
		/** The song. `uid = ${source}:${songid}` is IDENTITY (makeUid). */
		track: Track;
		/** REQUIRED. Tap-to-play. Each surface installs its OWN queue here. */
		onplay: () => void;
		/** REQUIRED. Long-press or the ⋮. The HOST owns TrackMenu state (the CompactRow contract). */
		onrequestmenu: () => void;
		/** undefined = the app convention (right = 收藏 like + Undo — quick-261104-swipe, left = play next), implemented
		 *  below. `null` = no swipe. An object OVERRIDES both directions — the seam Up Next needs
		 *  (its left-swipe is remove-with-undo, its right-swipe is the version picker). */
		swipe?: SwipeActionOpts | null;
		/** Drag handle. Off by default; only a surface with real reordering turns it on. */
		grip?: boolean;
		/** Which inline buttons render, IN ORDER. undefined = settings.rowActions (the user's
		 *  choice); an array FORCES it — Up Next passes ['like'] or [] so it cannot grow a Download
		 *  button just because the setting is on. The ⋮ is NOT in this union: it always renders,
		 *  which is what makes an empty list a safe choice rather than a dead-end row. */
		actions?: RowAction[];
		/** RESOLVE-ON-TAP, for a surface whose rows are STUBS (quick-260919-l9e). Omit on a surface
		 *  whose rows are already real Tracks — a real row must not gain a single instruction from
		 *  this. When set, an inline action that needs identity resolves FIRST and then acts on the
		 *  result: that is what lets charts/album rows carry Like/Download at all, instead of the
		 *  `actions={[]}` opt-out they used to need. Called ONLY from a tap (D-7 forbids per-row
		 *  network on a render path), at most once per row — the result is cached and shared by both
		 *  buttons. It must never throw; return null for "no playable match". */
		resolve?: (() => Promise<Track | null>) | null;
		/** quick-260930-uia: the page's already-resolved Track for a stub row, so download/like state
		 *  keys on the real uid before the user taps (the album page passes it once its batch resolve
		 *  lands, which is what lets each row's ring light during "Download all"). The row still
		 *  DISPLAYS `track`. A row-local resolve (`resolvedTrack`) wins over it. */
		resolved?: Track | null;
		/** Forwarded verbatim to DownloadControl. The album tracklist passes false (album downloads
		 *  stay OUT of the offline blob / native public folder — 29-CONTEXT Open Q2); everything
		 *  else takes the default. */
		persist?: boolean;
		/** D-8: line 2 (the ARTIST line) verbatim, when a host needs to own that line's text.
		 *  Default: the smartArtist pipeline on smart surfaces, else `names.dnArtist(track.artist)`.
		 *  The album is line 3's business now and never rides this prop. */
		subtitle?: string;
		/** quick-261010-sar: SMART artist subtitle (opt-in per surface). When true, the second
		 *  line shows the track's ARTIST — resolved through the same smart pipeline as the Now
		 *  Playing artist line (quick-261009-ewf): the synchronous split paints instantly, then
		 *  an async pass (MusicBrainz identity → recording credits → split fallback) auto-updates
		 *  it, so a row whose source mislabels the artist self-corrects instead of sitting wrong.
		 *  The artist page sets this: its rows were showing `track.album` ("COMPOSITION", "原創",
		 *  the single title), which reads as a wrong ARTIST name under the SongRow convention.
		 *  Default false — every other surface keeps today's album-first subtitle byte-identical. */
		smartArtist?: boolean;
		/** quick-261014-notag: `false` hides the album tag after the smart artist name. The
		 *  search page sets it — the tag is noise next to the artist there. Default true:
		 *  artist/charts/library rows keep the album disambiguation. */
		showAlbumTag?: boolean;
		/** A host-known cover → rung 2 of pickRowCover. OMIT and it defaults to `track.cover`, the
		 *  song's own source art, which is what every list surface passed here by hand. Pass an
		 *  explicit value only to override that (the album tracklist passes the album hero, whose
		 *  stub rows carry no source cover of their own). `null` forces the rung empty. */
		cover?: string | null;
		/** Highlight. Default: this is the currently-playing track. */
		active?: boolean;
		/** Default true. `false` = NO per-row cover chain (see LazyCoverParam.enabled). The album
		 *  tracklist sets it: every row legitimately shares the one album cover, so N per-row
		 *  resolves would buy nothing and cost N fan-outs. Constant per surface, read once. */
		lazy?: boolean;
		/** Destructive mode — the row's tap REMOVES rather than plays (library's bulk-edit). Tints
		 *  the text red and suppresses the neutral is-active highlight, which would otherwise say
		 *  "this is playing" on a row whose tap deletes it. The host still owns what `onplay` does;
		 *  this only makes that visible. */
		danger?: boolean;
	}

	let {
		track,
		onplay,
		onrequestmenu,
		swipe = undefined,
		grip = false,
		actions = undefined,
		resolve = null,
		resolved = null,
		persist = true,
		subtitle = undefined,
		smartArtist = false,
		showAlbumTag = true,
		cover = undefined,
		active = undefined,
		lazy = true,
		danger = false
	}: Props = $props();

	// The prop FORCES; the setting is the fallback. Order is load-bearing — `acts` IS the
	// left-to-right layout, so `['download','like']` really does put the download button first.
	const acts = $derived(actions ?? settings.rowActions);
	// quick-261010-sar: the smart-artist subtitle state. Null until the effect below paints the
	// synchronous split (today's behavior); the effect then refines via resolveArtistNames —
	// the NowPlaying auto-update pattern, verbatim. Runs ONLY when the host opts in
	// (smartArtist), so every other surface pays nothing.
	let smartNames = $state<string[] | null>(null);
	$effect(() => {
		if (!smartArtist) return;
		const a = track.artist ?? '';
		const t = track.title ?? '';
		smartNames = splitArtists(a);
		let cancelled = false;
		void resolveArtistNames(a, t).then((ns) => {
			if (!cancelled) smartNames = ns;
		});
		return () => {
			cancelled = true;
		};
	});
	// No empty-subtitle flash: before the effect first runs, paint the synchronous split of the
	// current track (a $derived read of the prop is reactive — no state_referenced_locally).
	const smartSub = $derived(
		!smartArtist
			? ''
			: (smartNames ?? splitArtists(track.artist ?? '')).map((n) => names.dnArtist(n)).join(' · ')
	);
	// D-8 (quick-261121-row3): line 2 is the ARTIST line. The host's `subtitle` prop owns it
	// verbatim when passed; smartArtist surfaces get the smart pipeline (smartSub); every other
	// surface gets the plain artist derivation. Pre-FINAL this row's second line was the
	// album-first `sub` — the album moved to line 3, and the artist (the string Hector's
	// folding complaint was about) was promoted to a line of its own.
	const artistLine = $derived(
		subtitle ?? (smartArtist ? smartSub : names.dnArtist(track.artist))
	);
	// D-8: line 3's album text — the old `.album-tag` pill DEMOTED to plain text (it was always
	// a passive span; the pill styling only made metadata read as a second artist name).
	// quick-261010-sar2's gates carry over and are now uniform: a blank album renders no text,
	// and album == title (the single echoing line 1) renders no text, on smart and plain rows
	// alike. quick-261014-notag: showAlbumTag=false (search page) suppresses it on smartArtist
	// rows, exactly as it suppressed the tag. quick-261102-tlo: an ALBUM name goes through the
	// title derivation, never the artist translator — smart rows keep the tag's exact
	// dnTitle(a) call, plain rows keep sub's exact dnTitle(album, artist) call.
	const albumText = $derived.by(() => {
		if (smartArtist && !showAlbumTag) return '';
		const a = (track.album ?? '').trim();
		if (!a) return '';
		if (a.toLowerCase() === (track.title ?? '').trim().toLowerCase()) return '';
		return smartArtist ? names.dnTitle(a) : names.dnTitle(track.album, track.artist);
	});
	// quick-261024-vid1: the MV tag — ytmusic rows are watchable unless a past resolve
	// proved otherwise (videoAvailability) or the user disabled videos in Settings.
	const mvTag = $derived(
		track.source === 'ytmusic' && settings.videoEnabled && videoAvailability.showsTag(track.songid)
	);
	const isActive = $derived(active ?? player.current?.uid === track.uid);

	// RESOLVE-ON-TAP state (quick-260919-l9e). A stub row has no uid to key liked/downloaded state
	// on until something resolves it, so the first action that resolves CACHES the result here and
	// every per-uid read below switches to it — the same "cache the resolved Track so post-download
	// state reads its uid" move DownloadControl already makes for the album stub, hoisted one level
	// so the Like button and the Download button share ONE resolve instead of running two.
	let resolvedTrack = $state<Track | null>(null);
	/** The uid every state read keys on: the resolved one once we have it, else the row's own. */
	// quick-260930-uia: `real` folds in the host's `resolved` Track (see the prop doc).
	// debug download-state-lost-on-page-return: last rung is the STORE's stub memory — a stub this
	// row (or a whole-album action, or an earlier visit) already resolved keeps its real uid across a
	// remount, so the ring / tick for a download still running under that uid shows at once.
	const real = $derived(
		resolvedTrack ?? resolved ?? (resolve ? library.stubTrack(track.artist, track.title) : null)
	);
	const actUid = $derived(real?.uid ?? track.uid);
	// quick-261115-likeid: the heart reads the SONG identity of the acting track (the resolved
	// twin when there is one, else the row's own) — a song liked under another resolver lights
	// up here too, not just on its own source's rows.
	const liked = $derived(library.isLikedTrack(real ?? track));
	/** In-flight guard, THIS row THIS action (Download's lives in DownloadControl's localBusy). */
	let likeBusy = $state(false);

	// The placeholder gradient's SEED. A real song seeds off its uid, but the discovery surfaces
	// (charts/tags, charts/countries) render synthetic stubs whose uid is '' — seeding every one of
	// those off '' paints the SAME gradient down the whole list (the charts-tags-same-cover bug, in
	// its gradient form). Fall back to the {artist,title} pair, which is exactly the name identity
	// lazyCover and the cover cache already use for a stub.
	//
	// quick-260919-l9e CORRECTION: this comment used to claim the ALBUM tracklist was in that same
	// empty-uid group. It is not. `nameStub` (`$lib/services/similar.ts`) mints a TRUTHY synthetic
	// uid, `${source}:similar-${matchKey}`, so an album row takes the `track.uid` branch below and
	// gets a per-row gradient — correct, and the reason nobody noticed. The distinction matters
	// beyond this seed: a `!track.uid` guard CANNOT catch an album stub, so a surface that rendered
	// a Like button over album rows would persist an unplayable synthetic uid into the liked list.
	// That hazard is now handled rather than avoided — the stub surfaces dropped their
	// `actions={[]}` opt-out and pass a `resolve` instead, and `row-action-target.ts` discriminates
	// on `resolveByName` (which nameStub sets) precisely because the uid test cannot.
	const gradientSeed = $derived(track.uid || `${track.artist} ${track.title}`);

	// The shared row cover read (quick-260910-qwt + quick-260915-w4f rung 0), in pickRowCover's
	// canonical rung order: the user's PINNED cover → the host-provided cover (rung 2, the
	// `cover` prop) → the shared reactive cache → this row's own lazyCover result. A reactive
	// READ, not a fetch — use:lazyCover below is the only network.
	let resolvedCover = $state<string | null>(null);
	const art = $derived(
		// quick-261006-o9u: rows paint at 36–56px — render the 200px variant of the cached
		// master (render-only; the cache keeps the master for the hero / pins / share).
		sizedCover(
			pickRowCover(
				// Phase 40 D-14: rung 0 is the CHOSEN cover — pin, then the crowd pick.
				readChosenCover(track.uid, track.artist, track.title),
				// `cover ?? track.cover` would let an explicit `null` fall THROUGH to track.cover, which
				// is the opposite of what passing null means. Only an OMITTED prop defaults.
				cover === undefined ? track.cover : cover,
				resolvedCover ?? undefined,
				// quick-261101-chk: the seeded rung stays empty here — SongRow has no seeded cover
				// distinct from the `cover` prop above (CompactRow passes null the same way). The
				// call previously passed only 4 arguments, shifting every later rung one slot up.
				null,
				readCoverByUidOrName(track.uid, track.artist, track.title)
			),
			ROW_COVER_PX
		)
	);
	// The row's IDENTITY as a VALUE, not as an object reference. A $derived that recomputes to an
	// equal string does not notify, so the effect below fires on a real song change and NOT merely
	// because a host re-created the row object ({@const rowTrack = nameStub(...)} on the album page
	// mints a fresh Track whenever the hero art lands) — which would otherwise cancel an in-flight
	// resolve started by a tap, i.e. a tap that visibly does nothing.
	const rowId = $derived(`${track.uid}|${track.artist}|${track.title}`);
	// WR-01 defense-in-depth: if this instance is ever reused for a DIFFERENT song (identity
	// change), drop the previous song's resolved art so it cannot paint over the new title. Lists
	// are uid-keyed so this is normally a no-op — it is insurance against a non-keyed {#each}
	// reorder, and it is the ONE $effect D-7 permits.
	//
	// It is also this row's GENERATION GUARD (the playGen/menuGen idiom). `rowGen` is a PLAIN field,
	// not $state — nothing renders it (the house convention for loop guards / generation counters).
	// Bumping it in the body AND the teardown means a late resolve is discarded when the row is
	// re-keyed to another song OR unmounted (navigated away, list changed underneath), so a result
	// that lands seconds after the user left can never like or download anything.
	let rowGen = 0;
	$effect(() => {
		void rowId;
		resolvedCover = null;
		resolvedTrack = null;
		rowGen++;
		return () => {
			rowGen++;
		};
	});

	// The app-wide swipe convention (UX-04). quick-261108-swp: the default swipe follows the user's
	// Settings → Playback swipe map via the shared rowSwipe (like / play next / queue / skip / off);
	// Like resolves a stub first through likeTarget, exactly like the Like button; play next / queue
	// resolve first too when the host supplied a resolver (charts / album stubs, as their old
	// per-page swipes did), else take the row's track as-is (a name-stub in the queue is the app's
	// normal path — the player resolves it on play). A host-supplied `swipe` still wins; `null` disables it.
	const swipeOpts = $derived<SwipeActionOpts>(
		swipe === null
			? { enabled: false }
			: (swipe ?? rowSwipe(settings.swipeRow, (act) => (act === 'like' || resolve ? likeTarget() : track), rowId))
	);

	/**
	 * Run the host's resolver ONCE for this row and cache the result. Returns null for a miss, a
	 * throw, a superseded row, or a resolver that hands back another stub — so a caller can treat
	 * null as "there is no real song here" without re-checking identity.
	 */
	async function runResolve(): Promise<Track | null> {
		if (!resolve) return null;
		const gen = rowGen;
		const r = await resolve().catch(() => null);
		if (gen !== rowGen) return null; // superseded: this row is now a different song, or gone
		if (!hasRealIdentity(r)) return null;
		resolvedTrack = r;
		// debug download-state-lost-on-page-return: the store remembers it too, so the NEXT mount of
		// this list keys the row on the same real uid (see `real`).
		library.rememberStub(track.artist, track.title, r);
		return r;
	}

	// like-state-wrong-track-menu, carried over from TrackMenu's Like row: a stub has no identity to
	// key on, so library.toggleLike REFUSES it — and a toast that reads the state back AFTER the
	// toggle would then report an "Unliked" that never happened on top of a button that did nothing.
	//
	// quick-260919-l9e makes the button WORK on a stub instead of standing it down: the three charts
	// surfaces and the album tracklist used to pass actions={[]} purely because of that missing uid,
	// which meant settings.rowActions governed five surfaces and was silently ignored on four. With
	// a `resolve` in hand the row resolves on tap and then likes the REAL Track — never the stub,
	// whose uid is TRUTHY on an album row (`${source}:similar-${matchKey}`) and would otherwise be
	// persisted into the liked list as an unplayable entry. `rowActionTarget` owns that decision.
	// quick-261010-rcm: right-click == long-press on a row. The longpress action already
	// swallows the native context menu on .hit; this opens the same TrackMenu a hold would.
	// Shared by onlongpress + oncontextmenu so the two gestures can never drift apart.
	function openRowMenu(e: Event) {
		(e.currentTarget as HTMLElement)?.blur();
		hapticTick();
		onrequestmenu();
	}

	/** The Track a like-type action should act on: a real Track, `null` for a refused stub / failed
	 *  resolve / a second press during a resolve, `undefined` when the row was superseded mid-resolve
	 *  (act on nothing, say nothing). Shared by the Like button and the like swipe (quick-261104-swipe). */
	async function likeTarget(): Promise<Track | null | undefined> {
		if (likeBusy) return null; // second tap during a multi-second resolve: no-op, not a double-toggle
		const gen = rowGen;
		const plan = rowActionTarget(track, real, !!resolve);
		let target = plan.kind === 'act' ? plan.track : null;
		if (plan.kind === 'resolve') {
			likeBusy = true;
			try {
				target = await runResolve();
			} finally {
				likeBusy = false;
			}
			if (gen !== rowGen) return undefined;
		}
		return target;
	}

	async function toggleLike() {
		if (likeBusy) return; // second tap during a multi-second resolve: no-op, not a double-toggle
		const target = await likeTarget();
		if (target === undefined) return; // superseded mid-resolve — act on nothing, say nothing
		// TELL THE TRUTH: a refused stub or a failed resolve is a button that did nothing, so it
		// says so with the surfaces' own unplayable copy rather than claiming a Liked/Unliked that
		// never happened.
		if (!target) {
			toast.show(t('home.unplayable'));
			return;
		}
		library.toggleLike(target);
		toast.show(library.isLikedTrack(target) ? t('toast.liked') : t('toast.unliked'));
	}
</script>

<div
	class="srow"
	class:is-active={isActive}
	class:is-danger={danger}
	use:tapBounce={{ only: '.hit' }}
	use:swipeAction={swipeOpts}
>
	<!-- D-6: the stretched transparent hit target. It carries play + long-press and nothing else;
	     its aria-label is the row's whole readable content, since the visuals below are inert. -->
	<button
		class="hit"
		aria-label={`${names.dnTitle(track.title, track.artist)} — ${artistLine}${albumText ? ` · ${albumText}` : ''}`}
		use:longpress
		onlongpress={openRowMenu}
		oncontextmenu={openRowMenu}
		onclick={onplay}
	></button>
	{#if grip}<span class="grip" aria-hidden="true"><GripVertical size={16} /></span>{/if}
	<span
		class="art"
		use:lazyCover={{ track, enabled: lazy, onResolved: (_uid, url) => (resolvedCover = url) }}
		style:background-image={coverGradient(gradientSeed)}
	>
		<CoverArt src={art} />
	</span>
	<span class="meta">
		<!-- D-8 line 1: the title ALONE — no control may share this line (the title-uncontested
		     pin in songrow-final.test.ts). -->
		<span class="line l1"><span class="txt r-title">{names.dnTitle(track.title, track.artist)}</span></span>
		<!-- D-8 line 2: the artist + the ⋮ at the right. quick-261010-sar: the ⋮ hides when the
		     user switches it off in Settings → Appearance → Song rows (settings.showRowMenu) —
		     long-press / right-click still opens the menu. The download-ring state rides the ⋮
		     as it did when the ⋮ trailed the row: it stands in for a Download control this row
		     does not draw. -->
		<span class="line l2">
			<span class="txt r-artist">{artistLine}</span>
			{#if settings.showRowMenu}
				{@const showDlRing = !acts.includes('download') && track?.uid && library.downloading.has(track.uid)}
				{@const dlFrac = track?.uid ? library.downloadProgress[track.uid] : undefined}
				<button class="ract menu" aria-label={t('menu.options')} aria-busy={!!showDlRing} onclick={onrequestmenu}>
					{#if showDlRing}
						<DownloadRing value={dlFrac}><MoreVertical size={18} /></DownloadRing>
					{:else}
						<MoreVertical size={18} />
					{/if}
				</button>
			{/if}
		</span>
		<!-- D-8 line 3: the album as plain text + the passive badges + the inline actions.
		     D-5: the passive badge stands down for whichever state this row draws a live
		     control for. -->
		<span class="line l3">
			<span class="txt r-album">{albumText}</span>
			{#if mvTag}<span class="mv-tag">MV</span>{/if}
			<RowBadges uid={actUid} track={real ?? track} hideLiked={acts.includes('like')} hideDownloaded={acts.includes('download')} />
			{#each acts as a (a)}
				{#if a === 'like'}
					<button
						class="ract"
						class:on={liked}
						aria-pressed={liked}
						aria-busy={likeBusy}
						aria-label={t(liked ? 'menu.liked' : 'menu.like')}
						title={t(liked ? 'menu.liked' : 'menu.like')}
						use:tapBounce
						onclick={toggleLike}
					>
						{#if likeBusy}
							<!-- A stub resolve takes SECONDS (searchAll fan-out), and a tap with no visible
							     change reads as a swallowed click. The shared indeterminate ring — the same one
							     the Download button one slot over spins — wraps the heart without changing the
							     button's box, so nothing shifts under the finger. -->
							<DownloadRing><Heart size={18} fill="none" /></DownloadRing>
						{:else}
							<Heart size={18} fill={liked ? 'currentColor' : 'none'} />
						{/if}
					</button>
				{:else if a === 'download'}
					<!-- No `probe`, ever: this is a list row (see D-7 / DownloadControl's own contract).
					     A stub row hands DownloadControl `track={null}` + the resolver, which is the contract
					     it already serves the album page's own control with — and NOT the stub itself, whose
					     truthy synthetic uid would make it try to download an unresolvable song. Once either
					     button has resolved, the real Track goes down instead and the resolve is not repeated. -->
					<DownloadControl
						track={real ?? (resolve ? null : track)}
						resolve={resolve ? runResolve : null}
						{persist}
					/>
				{/if}
			{/each}
		</span>
	</span>
</div>

<style>
	.srow {
		position: relative;
		display: flex;
		align-items: center;
		gap: 12px;
		/* D-8: the fixed FINAL height — 2×10px padding + the 76px three-line column. Content
		   never stretches it (NO STRETCH): a longer string ellipsises inside its own line. */
		height: 96px;
		padding: 10px 6px;
		/* quick-261116-perf: rendering virtualization for long document-scroll lists
		   (Library / Search / Charts / Album / Artist all render this row). Off-screen
		   rows skip layout+paint; `auto` makes the browser remember each row's real
		   height after first render, and 96px is the row's true fixed height (D-8) so
		   first-pass scroll geometry does not shift. The row stays in the DOM, so
		   lazyCover's IntersectionObserver, longpress and find-in-page are
		   unaffected — near-viewport rows render ahead of visibility. */
		content-visibility: auto;
		contain-intrinsic-size: auto 96px;
		border-radius: 8px;
		transition: background 0.12s ease;
		/* quick-260910-k45, generalised: OPAQUE, not transparent. Every migrated surface wraps this
		   row in a `.swipe-wrap` holding the UX-04 reveal icons (queue / play-next) BEHIND it; the
		   swipe's translateX slides the row to expose one side. z-index only ORDERS layers — only an
		   opaque background OCCLUDES, and without it the reveal glyphs show through the title text
		   at rest. It has to live HERE: a Svelte 5 child component's root element does not inherit
		   the parent's style scope, so no host rule can reach `.srow`. `--color-bg` is the page
		   background on every consuming surface, so the artist page (no reveals) is unchanged. */
		background: var(--color-bg);
		z-index: 1;
	}
	/* MENU-03 / D-12: hover-capable devices only — touch otherwise latches this :hover under a
	   held finger while the track menu opens. */
	@media (hover: hover) {
		.srow:hover {
			background: var(--color-surface);
		}
	}
	.srow.is-active {
		background: var(--color-surface);
	}
	/* Library bulk-edit: a row whose tap REMOVES. The red tint must beat the neutral is-active
	   highlight (a grey "this is playing" cue on a delete-on-tap row is actively misleading), which
	   is what the compound selector below does — the same precedence the library page expressed as
	   `.row.edit-row.is-active` before it moved here. */
	.srow.is-danger .r-title,
	.srow.is-danger .r-artist,
	.srow.is-danger .r-album {
		color: var(--color-danger-text);
	}
	.srow.is-danger.is-active {
		background: var(--color-bg);
	}
	@media (hover: hover) {
		.srow.is-danger:hover {
			background: rgba(255, 122, 144, 0.08);
		}
	}
	/* D-6: the row's real tap target, stretched under everything. Transparent and label-only. */
	.hit {
		position: absolute;
		inset: 0;
		width: 100%;
		padding: 0;
		background: none;
		border: none;
		border-radius: inherit;
		cursor: pointer;
	}
	/* Inert visuals: `pointer-events: none` so they never swallow a tap meant for .hit, and
	   `position: relative` so they still paint ABOVE it. */
	.grip,
	.art,
	.meta,
	.srow :global(.row-badges) {
		position: relative;
		pointer-events: none;
	}
	.grip {
		flex: none;
		display: grid;
		place-items: center;
		color: var(--color-text-muted);
	}
	.art {
		/* quick-260618-goe: the row tile scales with the Cover size setting, like CompactRow's.
		   D-8: the base is 64px in this tall row, capped at the 76px content box — a 150%
		   cover setting (COVER_SCALE_MAX) must not push the fixed 96px row open. */
		width: min(calc(64px * var(--cover-scale, 1)), 76px);
		height: min(calc(64px * var(--cover-scale, 1)), 76px);
		border-radius: 8px;
		overflow: hidden;
		background-color: var(--color-surface-2);
		flex: none;
	}
	/* D-8: the meta column is the row's only flexible box, but it no longer absorbs a squeeze —
	   it STACKS. Three fixed lines (24/20/24) distributed over a fixed 76px column; each line
	   is its own flex row whose text box ellipsises and whose controls (lines 2 and 3 only)
	   are fixed-width. */
	.meta {
		flex: 1;
		min-width: 0;
		height: 76px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
	}
	.line {
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.l1 {
		height: 24px;
	}
	.l2 {
		height: 20px;
		gap: 4px;
	}
	.l3 {
		height: 24px;
		gap: 2px;
	}
	/* The one text box per line: flexes to whatever the line's controls leave, clips, and
	   ellipsises. NO marquee in lists (D-8) — a list row is read at a frozen glance. */
	.txt {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.r-title {
		font-size: calc(0.875rem * var(--fs-title, 1));
		font-weight: 600;
		line-height: 1.3;
	}
	/* The artist reads a step brighter than the album: title > artist > album is the FINAL
	   layout's information order, carried by tone as well as position. */
	.r-artist {
		font-size: calc(0.75rem * var(--fs-artist, 1));
		font-weight: 400;
		line-height: 1.3;
		color: color-mix(in srgb, var(--color-text) 80%, var(--color-text-muted));
	}
	.r-album {
		font-size: calc(0.75rem * var(--fs-artist, 1));
		font-weight: 400;
		line-height: 1.3;
		color: var(--color-text-muted);
	}
	/* quick-261024-vid1: the MV tag — a pill on line 3, after the album text (it was
	   accent-tinted to read as "watchable" until quick-261102-s5t, below). D-8: a flex item
	   in .l3 now, so the line's gap spaces it and it never ellipsises away with the album. */
	.mv-tag {
		flex: none;
		display: inline-block;
		padding: 0 6px;
		/* quick-261102-s5t: --color-accent is undefined (always the red fallback = a second accent);
		   a passive tag is not "live/on/go", so it takes the muted pill tokens. */
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		border-radius: 999px;
		font-size: 0.8em;
		font-weight: 600;
		letter-spacing: 0.04em;
		line-height: 1.5;
		white-space: nowrap;
	}
	/* D-8: the inline actions now live INSIDE .meta's lines, and .meta's visuals are
	   pointer-events:none — so a control re-arms its own events here, and position:relative
	   keeps it painted above the stretched .hit (tapping one still never fires the row's
	   click — no stopPropagation needed, as when they were .hit's siblings). The VISIBLE box
	   is line-height so the fixed geometry never moves; the hit area is expanded separately,
	   below. */
	.ract {
		position: relative;
		flex: none;
		width: 36px;
		height: 24px;
		display: grid;
		place-items: center;
		padding: 0;
		background: none;
		border: none;
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		cursor: pointer;
		pointer-events: auto;
	}
	.ract.on {
		color: var(--color-primary);
	}
	/* D-8: ≥44×44 hit areas by invisible expansion (Hector's 44px rule; the pre-FINAL 36px /
	   28px boxes violated it). The expansion is a centred ::after on every row control. The
	   ⋮ overrides its anchor below; the seam between the two expansions is assigned in D-8. */
	.ract::after,
	.srow :global(.dc)::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
	}
	/* The ⋮ sits on line 2 (20px tall, 36 wide — quick-261006-smb's 28px slimming is retired:
	   width is no longer taken from the title, which owns line 1 outright). Its hit expansion
	   is anchored to the button's BOTTOM, so the extra reach goes UP into line 1's empty
	   right end and never down into line 3's controls; z-index 2 wins the one contested
	   strip against line 3 (see D-8). */
	.ract.menu {
		width: 36px;
		height: 20px;
		z-index: 2;
	}
	.ract.menu::after {
		top: auto;
		bottom: 0;
		transform: translateX(-50%);
	}
	/* DownloadControl owns its own markup (it swaps between a <button> and three <span> states),
	   so its 40x40 default is re-sized to the row action from here: a 32×32 visible box,
	   centred in the 24px line (its overflow is transparent; DownloadRing sizes off the
	   glyph, not this box, so the ring stays round). `position: relative` is what lifts it
	   above the stretched .hit — without it the download tap would land on play — and
	   pointer-events:auto re-arms it inside .meta, like .ract above. */
	.srow :global(.dc) {
		position: relative;
		width: 32px;
		height: 32px;
		pointer-events: auto;
	}
	@media (hover: hover) {
		.ract:hover {
			background: var(--color-surface);
		}
	}
	@media (hover: hover) {
		.opt:hover {
			background: var(--color-surface);
			color: var(--color-text);
		}
	}
</style>
