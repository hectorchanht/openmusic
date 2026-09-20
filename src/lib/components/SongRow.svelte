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
	// `variant='track'` branch as <SongRow index={null} actions={[]}> at the 40x40 art scale.
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
	// D-2 — WIDTH: THE TITLE GIVES. Every control here is fixed-width (rank 18, art 44, each inline
	// action 36, the menu 44) and `.meta` is the only flexible box, so it absorbs 100% of the
	// squeeze. At 360px with both buttons on, `.meta` gets ~130px — which a CJK title overruns. That
	// is exactly what use:marquee exists for, so the two lines SCROLL rather than sit clipped.
	// Nothing else shrinks, nothing wraps, no responsive hiding, no row-height change.
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
	import { Heart, MoreVertical, GripVertical } from '@lucide/svelte';
	import type { Track } from '$lib/sources/types';
	import { longpress } from '$lib/actions/longpress';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { lazyCover } from '$lib/actions/lazyCover';
	import { marquee } from '$lib/actions/marquee';
	import { swipeAction, type SwipeActionOpts } from '$lib/actions/swipeAction';
	import { pickRowCover } from '$lib/services/row-cover';
	import { readCoverByUidOrName, readPinnedCover } from '$lib/stores/cover-version.svelte';
	import { coverGradient } from '$lib/services/cover-gradient';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { settings, type RowAction } from '$lib/stores/settings.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import { t } from '$lib/i18n';
	import { rowActionTarget, hasRealIdentity } from '$lib/components/row-action-target';
	import RowBadges from '$lib/components/RowBadges.svelte';
	import DownloadControl from '$lib/components/DownloadControl.svelte';
	import DownloadRing from '$lib/components/DownloadRing.svelte';

	interface Props {
		/** The song. `uid = ${source}:${songid}` is IDENTITY (makeUid). */
		track: Track;
		/** displayIndex — ORDERING ONLY, never identity. null/omitted = no rank column. */
		index?: number | null;
		/** REQUIRED. Tap-to-play. Each surface installs its OWN queue here. */
		onplay: () => void;
		/** REQUIRED. Long-press or the ⋮. The HOST owns TrackMenu state (the CompactRow contract). */
		onrequestmenu: () => void;
		/** undefined = the app convention (right = add to queue, left = play next), implemented
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
		/** Forwarded verbatim to DownloadControl. The album tracklist passes false (album downloads
		 *  stay OUT of the offline blob / native public folder — 29-CONTEXT Open Q2); everything
		 *  else takes the default. */
		persist?: boolean;
		/** Second line. Default `names.dnArtist(track.album || track.artist)`. */
		subtitle?: string;
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
		index = null,
		onplay,
		onrequestmenu,
		swipe = undefined,
		grip = false,
		actions = undefined,
		resolve = null,
		persist = true,
		subtitle = undefined,
		cover = undefined,
		active = undefined,
		lazy = true,
		danger = false
	}: Props = $props();

	// The prop FORCES; the setting is the fallback. Order is load-bearing — `acts` IS the
	// left-to-right layout, so `['download','like']` really does put the download button first.
	const acts = $derived(actions ?? settings.rowActions);
	const sub = $derived(subtitle ?? names.dnArtist(track.album || track.artist));
	const isActive = $derived(active ?? player.current?.uid === track.uid);

	// RESOLVE-ON-TAP state (quick-260919-l9e). A stub row has no uid to key liked/downloaded state
	// on until something resolves it, so the first action that resolves CACHES the result here and
	// every per-uid read below switches to it — the same "cache the resolved Track so post-download
	// state reads its uid" move DownloadControl already makes for the album stub, hoisted one level
	// so the Like button and the Download button share ONE resolve instead of running two.
	let resolvedTrack = $state<Track | null>(null);
	/** The uid every state read keys on: the resolved one once we have it, else the row's own. */
	const actUid = $derived(resolvedTrack?.uid ?? track.uid);
	const liked = $derived(library.isLiked(actUid));
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

	// The shared three-rung row cover read (quick-260910-qwt + quick-260915-w4f rung 0): the user's
	// PINNED cover, then this row's own lazyCover result, then a host-provided cover, then the
	// shared reactive cache. A reactive READ, not a fetch — use:lazyCover below is the only network.
	let resolvedCover = $state<string | null>(null);
	const art = $derived(
		pickRowCover(
			readPinnedCover(track.uid),
			resolvedCover ?? undefined,
			// `cover ?? track.cover` would let an explicit `null` fall THROUGH to track.cover, which
			// is the opposite of what passing null means. Only an OMITTED prop defaults.
			cover === undefined ? track.cover : cover,
			readCoverByUidOrName(track.uid, track.artist, track.title)
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

	// The app-wide swipe convention, lifted verbatim from the per-page copies it replaces (UX-04
	// D-03/D-04). swipeAction is a PURE DOM gesture and fires no haptics — the consumer must.
	function queueTrack() {
		player.addToQueue(track);
		hapticTick();
		toast.show(t('toast.addedToQueue'));
	}
	function nextTrack() {
		player.playNext(track);
		hapticTick();
		toast.show(t('toast.playingNext'));
	}
	const swipeOpts = $derived<SwipeActionOpts>(
		swipe === null ? { enabled: false } : (swipe ?? { onSwipeRight: queueTrack, onSwipeLeft: nextTrack })
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
	async function toggleLike() {
		if (likeBusy) return; // second tap during a multi-second resolve: no-op, not a double-toggle
		const gen = rowGen;
		const plan = rowActionTarget(track, resolvedTrack, !!resolve);
		let target = plan.kind === 'act' ? plan.track : null;
		if (plan.kind === 'resolve') {
			likeBusy = true;
			try {
				target = await runResolve();
			} finally {
				likeBusy = false;
			}
			if (gen !== rowGen) return; // superseded mid-resolve — act on nothing, say nothing
		}
		// TELL THE TRUTH: a refused stub or a failed resolve is a button that did nothing, so it
		// says so with the surfaces' own unplayable copy rather than claiming a Liked/Unliked that
		// never happened.
		if (!target) {
			toast.show(t('home.unplayable'));
			return;
		}
		library.toggleLike(target);
		toast.show(library.isLiked(target.uid) ? t('toast.liked') : t('toast.unliked'));
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
		aria-label={`${names.dnTitle(track.title)} — ${sub}`}
		use:longpress
		onlongpress={(e) => {
			(e.currentTarget as HTMLElement)?.blur();
			hapticTick();
			onrequestmenu();
		}}
		onclick={onplay}
	></button>
	{#if grip}<span class="grip" aria-hidden="true"><GripVertical size={16} /></span>{/if}
	{#if index != null}<span class="rank">{index + 1}</span>{/if}
	<span
		class="art"
		use:lazyCover={{ track, enabled: lazy, onResolved: (_uid, url) => (resolvedCover = url) }}
		style:background-image={art ? `url(${art})` : coverGradient(gradientSeed)}
	></span>
	<span class="meta">
		<span class="r-title" use:marquee><span class="marquee-inner">{names.dnTitle(track.title)}</span></span>
		<span class="r-sub" use:marquee><span class="marquee-inner">{sub}</span></span>
	</span>
	<!-- D-5: the passive badge stands down for whichever state this row draws a live control for. -->
	<RowBadges uid={actUid} hideLiked={acts.includes('like')} hideDownloaded={acts.includes('download')} />
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
					     36px box, so nothing shifts under the finger. -->
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
				track={resolvedTrack ?? (resolve ? null : track)}
				resolve={resolve ? runResolve : null}
				{persist}
			/>
		{/if}
	{/each}
	<button class="opt" aria-label={t('menu.options')} onclick={onrequestmenu}>
		<MoreVertical size={18} />
	</button>
</div>

<style>
	.srow {
		position: relative;
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		padding: 6px;
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
	.srow.is-danger .r-sub {
		color: #ff7a90;
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
	.rank,
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
	.rank {
		flex: none;
		width: 18px;
		text-align: center;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	.art {
		/* quick-260618-goe: the row tile scales with the Cover size setting, like CompactRow's. */
		width: calc(44px * var(--cover-scale, 1));
		height: calc(44px * var(--cover-scale, 1));
		border-radius: 6px;
		background-size: cover;
		background-position: center;
		background-color: var(--color-surface-2);
		flex: none;
	}
	/* D-2: the ONLY flexible box, so it absorbs the whole squeeze — by design. */
	.meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	/* min-width:0 + overflow:hidden so use:marquee measures a REAL overflow and scrolls it. */
	.r-title {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		font-size: calc(0.875rem * var(--fs-title, 1));
		font-weight: 600;
		line-height: 1.3;
	}
	.r-sub {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		font-size: calc(0.75rem * var(--fs-artist, 1));
		font-weight: 400;
		line-height: 1.3;
		color: var(--color-text-muted);
	}
	/* The inline actions keep their pointer events (they are siblings of .hit, not children, so
	   tapping one never fires the row's click — no stopPropagation needed). 36px, not
	   DownloadControl's own 40, so TWO of them still cost less than one ⋮: the menu keeps the full
	   44px because it is the always-reachable control. */
	.ract {
		position: relative;
		flex: none;
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		padding: 0;
		background: none;
		border: none;
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.ract.on {
		color: var(--color-primary);
	}
	/* DownloadControl owns its own markup (it swaps between a <button> and three <span> states),
	   so its 40x40 default is re-sized to the 36px row action from here. `position: relative` is
	   what lifts it above the stretched .hit — without it the download tap would land on play. */
	.srow :global(.dc) {
		position: relative;
		width: 36px;
		height: 36px;
	}
	@media (hover: hover) {
		.ract:hover {
			background: var(--color-surface);
		}
	}
	.opt {
		position: relative;
		flex: none;
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		background: none;
		border: none;
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	@media (hover: hover) {
		.opt:hover {
			background: var(--color-surface);
			color: var(--color-text);
		}
	}
</style>
