<script lang="ts">
	import { untrack } from 'svelte';
	import { GripVertical, Layers, Trash2 } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { t } from '$lib/i18n';
	import { longpress } from '$lib/actions/longpress';
	import { swipeAction } from '$lib/actions/swipeAction';
	import { readCoverByUidOrName, readPinnedCover, bumpCoverVersion } from '$lib/stores/cover-version.svelte';
	import { backfillCovers } from '$lib/services/cover-backfill';
	import { upNextCoverNeeds, UPNEXT_COVER_MAX } from '$lib/services/upnext-covers';
	import { pickRowCover } from '$lib/services/row-cover';
	import { coverGradient } from '$lib/services/cover-gradient';
	import { tick as hapticTick } from '$lib/util/haptics';
	import RowBadges from '$lib/components/RowBadges.svelte';
	import type { Track } from '$lib/sources/types';

	// quick-260919-np3: the Up-Next pane, lifted OUT of NowPlaying.svelte verbatim. Nothing about the
	// rows, the reorder drag, the swipe actions or the cover fill changed — only their home did. The
	// parent keeps the TrackMenu / VersionPicker mounts (one each, shared with the other panes), so
	// the two gestures that open them arrive as callbacks.
	//
	// `open` replaces the old `sheetState !== 'closed'` read and `rows`/`startIndex` replace the
	// upNextList / upNextStart derivations; `tab === 'queue'` is GONE as a gate because mounting this
	// component IS that gate now (the parent only renders it for the selected tab on mobile, and as
	// one of three columns at >=1280px).
	let {
		rows,
		startIndex,
		resolvedCovers,
		open,
		onMenu,
		onVersions
	}: {
		rows: Track[];
		startIndex: number;
		resolvedCovers: Record<string, string>;
		open: boolean;
		onMenu: (track: Track) => void;
		onVersions: (track: Track) => void;
	} = $props();

	// quick-260910-q5a / quick-260910-qwt — POST-PAINT cover fill for THIS pane's rows.
	//
	// WHY GATED ON `open`: nothing is fetched until the user actually opens the sheet, so the
	// click-to-play critical path pays zero — a tap with the sheet closed issues no cover call. That
	// is the SAME gate as before (`sheetState !== 'closed'` plus the selected tab); the tab half now
	// lives in the mount.
	//
	// THE COST NUMBER: <=20 tier-1 /api/deezer/search per fill (UPNEXT_COVER_MAX), <=6 in flight
	// (backfillCovers' CAP=6 pool); the iTunes + CN tiers fire ONLY on a per-row Deezer miss; a
	// re-open issues ~0 (backfillCovers skips cached rows and remembers misses for 5 min).
	//
	// WHY THIS IS *NOT* THE T-26-10-01 FLOOD: that was N uncoordinated per-tile `use:lazyCover`
	// chains, one per rendered row, re-firing on every list render with no shared cap. This is ONE
	// capped pool from ONE site, aborted on re-run, behind the apiFetch governor. The
	// no-`use:lazyCover`-on-Up-Next rule still holds — do not re-introduce it.
	//
	// quick-260919-np3 CEILING: Related owns an IDENTICAL pool of its own now, so at >=1280px (both
	// columns mounted) there are TWO live pools instead of one, i.e. <=40 tier-1 calls per track
	// change instead of <=20. That is deliberate: a single shared pool would have to split one
	// UPNEXT_COVER_MAX budget across both lists, and since a similarity-generated queue has no seeded
	// covers at all (a live probe of 20 `track.getSimilar` pairs returned withImage: 0) Up Next would
	// consume the whole budget and the Related column would render 20 gradients. Both pools stay
	// capped, aborted on re-run, cached, and behind the apiFetch governor's global
	// MAX_CONCURRENT_REQUESTS + circuit breaker, so the ceiling is bounded, not open-ended.
	//
	// SELF-INVALIDATION GUARD (cf. restore-effect-self-invalidation-loop): this effect NEVER reads
	// `coverVersion()` — `upNextCoverNeeds` is cache-free, and the `readCoverByUidOrName` read lives
	// in the template, not here — and `backfillCovers` is called under `untrack`. So `onResolved ->
	// bumpCoverVersion` repaints the tiles but cannot re-trigger the effect that started the fill.
	//
	// PIZ GUARD (quick-260910-piz): `upNextCoverNeeds` skips any row with an https `track.cover`, so
	// an album-installed queue is never even submitted; `backfillCovers` writes the NAME cache layer
	// only and never touches `track.cover` / `attachedCover`.
	$effect(() => {
		if (!open) return;
		const needs = upNextCoverNeeds(rows);
		if (!needs.length) return;
		const ac = new AbortController();
		untrack(() => {
			void backfillCovers(needs, {
				signal: ac.signal,
				onResolved: () => bumpCoverVersion(),
				max: UPNEXT_COVER_MAX
			});
		});
		// A re-run (queue change / sheet close / unmount) aborts the in-flight fill, so at most ONE
		// pool is ever live per pane. backfillCovers treats abort != miss, so nothing is poisoned.
		return () => ac.abort();
	});

	// quick-260910-nx6: the split-by-direction swipe on the UP-NEXT list (right = open the version
	// picker, left = remove). swipeAction is a PURE DOM gesture — the host fires haptics on commit
	// (PATTERNS.md 3.3).
	// quick-260910-omt: the removal used to be silent AND irreversible — a mis-swipe permanently
	// session-excluded the song (D-10 removedUids) with no feedback. It now raises an undo toast:
	// removeFromQueue hands back a receipt, restoreToQueue reverses the queue index, the manual
	// pin and the exclusion. The callback lives HERE because stores stay i18n-free and never
	// import UI; it closes over the receipt only, never over private player state. Per the toast
	// contract a superseding toast DISCARDS a pending undo (it can never fire late).
	function queueSwipeVersions(track: Track) {
		onVersions(track);
		hapticTick();
	}
	function queueSwipeRemove(track: Track) {
		const r = player.removeFromQueue(track.uid);
		if (!r) return; // nothing removed (current row / not in queue) -> no toast, nothing to undo
		toast.show(t('toast.removedFromQueue'), {
			action: { label: t('toast.undo'), run: () => player.restoreToQueue(r) }
		});
		hapticTick();
	}

	// ---- Up-Next reorder: custom pointer/touch drag on the far-right grip handle ----
	// (NOT native HTML5 DnD — poor on touch). On drop we call player.reorderQueue,
	// which pins the moved track manual so it survives the next fresh-play regen.
	let queueListEl = $state<HTMLElement | null>(null);
	// quick-260618-ink (tweak 2): one-shot latch — plain let (NOT $state) so reading it does not make
	// the scroll effect re-run; reset to false when the list closes so the next open re-fires.
	let upNextScrollDone = false;
	let dragFrom = $state(-1); // source row index while dragging (-1 = idle)
	let dragOver = $state(-1); // current target row index
	let rowDragY = $state(0); // px the lifted row follows the finger
	let rowDragStartY = 0;

	/** Find the queue row index under client-Y `y` by measuring each <li>'s rect. */
	function rowIndexAt(y: number): number {
		if (!queueListEl) return dragFrom;
		const items = queueListEl.querySelectorAll('li');
		for (let i = 0; i < items.length; i++) {
			const r = items[i].getBoundingClientRect();
			if (y < r.top + r.height / 2) return i;
		}
		return items.length - 1;
	}

	function gripDragDown(e: PointerEvent, index: number) {
		e.stopPropagation(); // don't trigger the row's play onclick
		dragFrom = index;
		dragOver = index;
		rowDragStartY = e.clientY;
		rowDragY = 0;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function gripDragMove(e: PointerEvent) {
		if (dragFrom < 0) return;
		rowDragY = e.clientY - rowDragStartY;
		dragOver = rowIndexAt(e.clientY);
	}
	function gripDragUp() {
		if (dragFrom < 0) return;
		// list is sliced from the anchor (startIndex); reorderQueue needs queue-absolute indices.
		if (dragOver >= 0 && dragOver !== dragFrom)
			player.reorderQueue(dragFrom + startIndex, dragOver + startIndex);
		dragFrom = -1;
		dragOver = -1;
		rowDragY = 0;
	}

	// quick-260618-ink (tweak 2): ONE-SHOT scroll-to-current on Up-Next OPEN only. Latched by
	// upNextScrollDone, reset when the list closes. Deliberately NOT a mutation-driven scroll —
	// 260615-mnr removed continuous auto-scroll (overflow-anchor:none) and that must not return.
	$effect(() => {
		// `open` is the only TRACKED read — the open/visibility transition. The row lookup happens
		// inside the rAF callback (untracked DOM read), so a queue mutation alone never re-fires this.
		if (!open) {
			upNextScrollDone = false; // re-arm for the next open
			return;
		}
		if (upNextScrollDone) return;
		upNextScrollDone = true; // latch immediately so a reactive re-tick cannot re-scroll
		if (typeof window === 'undefined') return;
		// The DOM may not be laid out the same tick the pane mounts; wait one frame so layout flushed.
		requestAnimationFrame(() => {
			const container = queueListEl?.closest('.panel') as HTMLElement | null;
			const playingRow = queueListEl?.querySelector('.q-row.playing') as HTMLElement | null;
			const li = playingRow?.closest('li') as HTMLElement | null;
			if (!container || !li) return;
			// Pin the current row to the container TOP (block:'start' semantics) via rect deltas —
			// NOT Element.scrollIntoView() ancestor-walking (it yanks the sheet to full).
			const liRect = li.getBoundingClientRect();
			const cRect = container.getBoundingClientRect();
			const offsetWithin = liRect.top - cRect.top + container.scrollTop;
			container.scrollTo({ top: offsetWithin, behavior: 'smooth' });
		});
	});
</script>

{#if rows.length}
	<ul class="list" bind:this={queueListEl}>
		{#each rows as track, i (track.uid)}
			{@const skipped = player.isUnplayable(track.uid)}
			<!-- quick-260910-q5a: the tile's three-rung cover read (see the Gap 3 block below).
			     quick-260910-qwt: now the SHARED pickRowCover — the identical read every other row
			     surface uses (resolved → track.cover → shared cache). Behaviour is unchanged here. -->
			{@const qArt = pickRowCover(readPinnedCover(track.uid), resolvedCovers[track.uid], track.cover, readCoverByUidOrName(track.uid, track.artist, track.title))}
			<li
				class:lifted={i === dragFrom}
				class:over={i === dragOver && i !== dragFrom}
				style:transform={i === dragFrom && rowDragY ? `translateY(${rowDragY}px)` : undefined}
			>
				<!-- Gap 4 (26-10): per-row version-picker trigger, still the single lazy fetchVariants
				     fan-out fired ONLY on a deliberate gesture, never on list render (T-26-10-02).
				     quick-260910-nx6: it is no longer an always-visible per-row button — the trigger is now the
				     swipe-RIGHT reveal below (hidden at rest, per the user decision, one fewer 44px control per
				     row). Keyboard/AT reach is unchanged: the long-press / contextmenu TrackMenu still lists
				     "Play from source" (TrackMenu.svelte → openVersions). The wrapper is a <span>, so the
				     Gap 4 no-button-in-button constraint still holds. -->
				<!-- quick-260615-i9u (Feature A): a probe-confirmed-dead Up-Next entry stays IN the queue
				     (nextPlayableIndex just routes past it) — render it dimmed with a leading ✗ and branch
				     the row tap to retry-that-exact-track instead of a fresh play. swipeAction/longpress/grip
				     are deliberately untouched so reorder + swipe actions keep working on a skipped row. -->
				<span class="swipe-wrap q-swipe" class:is-current={track.uid === player.current?.uid}>
				<!-- quick-260910-nx6: reveal layers sit BEHIND the row; the row's translateX exposes one
				     side. Left edge = versions (a RIGHT drag), right edge = remove (a LEFT drag). aria-hidden
				     — decorative only. -->
				<span class="reveal reveal-versions" aria-hidden="true"><Layers size={20} /></span>
				<span class="reveal reveal-remove" aria-hidden="true"><Trash2 size={20} /></span>
				<!-- quick-260910-nx6: swipeAction's `enabled` is GLOBAL (it would also kill swipe-right, which
				     stays available on the current row) — so the current-row remove gate is expressed by leaving
				     onSwipeLeft UNDEFINED instead: swipeAction calls `onSwipeLeft?.()`, i.e. a silent no-op that
				     still springs the row back. Preserves the old swipe-to-remove `enabled: uid !== current` contract
				     (T-nx6-01: the playing track can never be removed by gesture). -->
				<button class="row q-row" class:playing={track.uid === player.current?.uid} class:skipped use:swipeAction={{ onSwipeRight: () => queueSwipeVersions(track), onSwipeLeft: track.uid === player.current?.uid ? undefined : () => queueSwipeRemove(track) }} use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); onMenu(track); }} onclick={(e) => { (e.currentTarget as HTMLElement)?.blur(); skipped ? player.retryUnplayable(track) : player.play(track, {fresh: false}); }} title={skipped ? t('nowplaying.skippedRetry') : undefined}>
					<!-- Gap 3 (26-10): the Up-Next LIST tile paints from the SEEDED cover (26-07 seeds the
					     name-stub's cover with the Last.fm image; search/resolved tracks carry their real cover),
					     with a gradient on a true miss — NO per-tile use:lazyCover Deezer→iTunes→CN chain (that
					     was the observed /api/deezer/search flood — T-26-10-01). The `resolvedCovers[track.uid] ??`
					     read is KEPT (zero-cost): the map is still fed by the prev/next CAROUSEL neighbors below,
					     so a row that WAS a neighbor keeps its resolved cover, but the list itself resolves nothing.
					     Accepted trade-off: an Up-Next tile no longer self-heals a dead cover via the chain — only the
					     now-playing track gets the optional HQ upgrade (per the UAT). https-only; never throws.

					     quick-260910-q5a: that 26-07 SEED is dead in practice — a live probe of 20 `track.getSimilar`
					     pairs returned withImage: 0, so a similarity-generated list has no seeded cover at all. The tile
					     therefore now reads a THIRD rung, the shared reactive cover cache, via `readCoverByUidOrName`
					     (uid → name layer). That is a reactive READ depending on coverVersion(), NOT a per-tile fetch —
					     T-26-10-01's no-`use:lazyCover`-here rule still holds; the single capped backfillCovers pass in
					     the gated $effect above is the ONLY network path. Same asymmetry class the hero fixed in
					     cover-hero-mediacard-missing. `track.cover` stays AHEAD of the cache so a quick-260910-piz
					     attached album cover always wins over a per-track image. -->
					<span class="q-art" style:background-image={qArt ? `url(${qArt})` : coverGradient(track.uid)}></span>
					<span class="q-text">
						{#if skipped}<span class="r-skip" aria-hidden="true">✗</span>{/if}
						<span class="r-title">{names.dnTitle(track.title, track.artist)}</span>
						<span class="r-artist">{names.dnArtist(track.artist)}</span>
					</span>
					<!-- quick-260723: passive liked/downloaded indicators on up-next rows. -->
					<RowBadges uid={track.uid} />
				</button>
				</span>
				<button
					class="grip-handle"
					aria-label={t('nowplaying.reorderTrack')}
					onpointerdown={(e) => gripDragDown(e, i)}
					onpointermove={gripDragMove}
					onpointerup={gripDragUp}
					onpointercancel={gripDragUp}
					onclick={(e) => e.stopPropagation()}
				><GripVertical size={18} /></button>
			</li>
		{/each}
	</ul>
{:else}<p class="empty">{t('nowplaying.noQueue')}</p>{/if}

<style>
	/* quick-260919-np3: these rules are the Up-Next SUBSET of NowPlaying.svelte's old panel CSS,
	   moved verbatim with the component they style (Svelte scopes styles per component, so they
	   have to travel with the markup). `.list` / `.row` / `.q-art` / `.r-title` / `.r-artist` /
	   `.empty` / the hover rule also exist in NpRelated.svelte — the two row shapes genuinely
	   diverge below that shared base, and hoisting six declarations into app.css would widen the
	   global surface for no behavioural gain. */
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
	.row { width: 100%; text-align: left; background: none; border: none; padding: 8px 6px; border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; }
	/* quick-260910-nx6: the reveal pattern on the UP-NEXT list. The wrapper is a <span> (not the
	   <li>, which also holds the always-visible grip) so the grip never slides with the row;
	   flex:1/min-width:0 make it fill the li beside that sibling button, and the old
	   `.q-row { flex: 1; min-width: 0 }` now applies INSIDE the wrapper where `.row { width: 100% }`
	   sizes it. The opaque background is the quick-260910-k45 root-cause fix carried over: z-index
	   only ORDERS layers, only an opaque background OCCLUDES — without it the grip/reveal icons
	   render through the row's title text mid-swipe (confirmed live before this task). */
	.q-swipe { position: relative; overflow: hidden; border-radius: 10px; flex: 1; min-width: 0; }
	.q-swipe .reveal {
		position: absolute; top: 0; bottom: 0; width: 96px; display: flex; align-items: center;
		justify-content: center; color: var(--color-text-muted); pointer-events: none;
	}
	.q-swipe .reveal-versions { left: 0; }
	.q-swipe .reveal-remove { right: 0; }
	/* The current row's swipe-LEFT is a deliberate no-op (T-nx6-01), so never flash a trash icon
	   that cannot do anything. */
	.q-swipe.is-current .reveal-remove { display: none; }
	.q-swipe .q-row { background: var(--color-bg); position: relative; z-index: 1; }
	/* MENU-03 / D-12: hover-capable devices only — touch otherwise latches this :hover
	   background on a queue row under a held finger while the track menu opens. */
	@media (hover: hover) { .row:hover { background: var(--color-surface); } }
	.row.playing { background: rgba(124,92,255,0.15); }
	/* quick-260910-nx6: `.row.playing` is TRANSLUCENT and, later at equal specificity, would beat
	   the opaque `.q-swipe .q-row` on the playing row and re-open the bleed. Same tint, composited
	   over the opaque bg. `.row.playing` itself stays untouched (it is the generic rule). */
	.q-swipe .q-row.playing { background: linear-gradient(rgba(124,92,255,0.15), rgba(124,92,255,0.15)) var(--color-bg); }
	/* Queue rows: play-button + far-right grip side by side. */
	.list li { display: flex; align-items: center; gap: 2px; }
	.q-row { flex: 1; min-width: 0; }
	/* quick-260629-nyl Task 1: Up-Next rows lay the lazy album-art thumbnail to the LEFT of a
	   min-width:0 text column so the title/artist still stack and ellipsis as before. The art dims
	   with the row via `.q-row.skipped` (child). */
	.q-row { flex-direction: row; align-items: center; gap: 0; }
	.q-art { width: 36px; height: 36px; border-radius: 6px; background-size: cover; background-position: center; background-color: rgba(255,255,255,0.04); flex: none; margin-right: 8px; }
	.q-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
	.grip-handle { flex: 0 0 auto; background: none; border: none; color: var(--color-text-muted); opacity: 0.55; cursor: grab; touch-action: none; display: grid; place-items: center; padding: 8px 6px; border-radius: 8px; }
	.grip-handle:active { cursor: grabbing; opacity: 0.9; }
	.list li.lifted { position: relative; z-index: 2; opacity: 0.92; }
	.list li.lifted .q-row { background: var(--color-surface); }
	/* quick-260910-nx6: the drop shadow moves to the wrapper — `.q-swipe { overflow: hidden }` would
	   clip it off the row during a grip drag. `.list li.over .q-row` is INSET, so it is unaffected. */
	.list li.lifted .q-swipe { box-shadow: 0 6px 18px rgba(0,0,0,0.4); }
	.list li.over .q-row { box-shadow: inset 0 2px 0 var(--color-primary); }
	.r-title { font-size: calc(0.875rem * var(--fs-title, 1)); font-weight: 600; color: var(--color-text);}
	.r-artist { font-size: calc(0.75rem * var(--fs-artist, 1)); color: var(--color-text-muted); }
	/* quick-260615-i9u (Feature A): a probe-confirmed-dead Up-Next row, dimmed + leading ✗. Tapping
	   it retries that exact track. Reuses existing design tokens (no new hardcoded colors).
	   quick-260910-nx6: scoped to the CHILDREN — dimming the button itself made the whole row
	   translucent, letting the reveal layers behind it show through. Art/text/badges dim, the
	   row's own background stays opaque. */
	.q-row.skipped > * { opacity: 0.45; }
	.r-skip { font-size: calc(0.75rem * var(--fs-artist, 1)); font-weight: 600; color: var(--color-text-muted); margin-right: 6px; }
	.empty { color: var(--color-text-muted); font-size: 0.875rem; text-align: center; padding: 24px; }
</style>
