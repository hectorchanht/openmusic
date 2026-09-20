<script lang="ts">
	import { untrack } from 'svelte';
	import { ListEnd, ListStart } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { t } from '$lib/i18n';
	import { searchAll } from '$lib/services/catalog';
	import { dedupeBest } from '$lib/services/dedupe';
	import { longpress } from '$lib/actions/longpress';
	import { swipeAction } from '$lib/actions/swipeAction';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { readCoverByUidOrName, readPinnedCover, bumpCoverVersion } from '$lib/stores/cover-version.svelte';
	import { backfillCovers } from '$lib/services/cover-backfill';
	import { upNextCoverNeeds, UPNEXT_COVER_MAX } from '$lib/services/upnext-covers';
	import { pickRowCover } from '$lib/services/row-cover';
	import { coverGradient } from '$lib/services/cover-gradient';
	import { tick as hapticTick } from '$lib/util/haptics';
	import RowBadges from '$lib/components/RowBadges.svelte';
	import type { Track } from '$lib/sources/types';

	// quick-260919-np3: the Related pane, lifted OUT of NowPlaying.svelte. The rows, the swipe
	// handlers and the tap-to-play composition are verbatim; what CHANGED is the fetch gate.
	//
	// It used to be `tab === 'related'` — selecting the tab was the only way to reach it, so "the tab
	// is open" and "the pane is on screen" were the same statement. At >=1280px they stop being the
	// same: all three panes render at once, so a mount-only gate would fan out a searchAll for EVERY
	// track change whether or not anyone is looking at this column. This app has a documented history
	// of /api/* floods freezing the whole UI (the apiFetch governor's MAX_CONCURRENT_REQUESTS +
	// circuit breaker exist because of them), so the gate was not deleted — it was re-pointed at the
	// thing it was always a proxy for: VISIBILITY, measured directly with an IntersectionObserver.
	let {
		resolvedCovers,
		onMenu
	}: {
		resolvedCovers: Record<string, string>;
		onMenu: (track: Track) => void;
	} = $props();

	let paneEl = $state<HTMLElement | null>(null);
	let visible = $state(false);

	// Minimum on-screen height that counts as "the user can see this pane". A bare
	// `entry.isIntersecting` fires on a ONE-PIXEL sliver, which is exactly what the sheet's `closed`
	// peek state leaves showing — so a plain threshold-0 observer would re-introduce the fetch on
	// every collapsed open. 48px is one list row: below that there is nothing to read anyway.
	const MIN_VISIBLE_PX = 48;
	// The predicate above is in PIXELS but IntersectionObserver only notifies on THRESHOLD crossings,
	// which are RATIOS — with the default `[0]` it fires once when the pane first touches the
	// viewport and then never again, because growing a 25px sliver into a 270px column never
	// re-crosses 0%. Measured live: the sheet dragged peek -> full left `visible` stuck at false and
	// the fetch never fired. This ladder re-notifies across the range so the px predicate is actually
	// re-evaluated as the sheet moves. It is a notification-density knob, NOT a second gate — every
	// callback still decides on `intersectionRect.height`.
	const RATIOS = [0, 0.01, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1];

	$effect(() => {
		const el = paneEl;
		if (!el || typeof IntersectionObserver === 'undefined') {
			// No IO (SSR / ancient engine) -> fall back to "mounted means visible", i.e. exactly the
			// old tab-gated behaviour. Never LESS eager than before, so no lyrics/related regression.
			visible = !!el;
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				const e = entries[entries.length - 1];
				visible = e.isIntersecting && e.intersectionRect.height >= MIN_VISIBLE_PX;
			},
			{ threshold: RATIOS }
		);
		io.observe(el);
		return () => io.disconnect();
	});

	// ---- related ----
	let related = $state<Track[]>([]);
	let relatedLoading = $state(false);
	let relatedFor = '';
	$effect(() => {
		const cur = player.current;
		if (visible && cur && relatedFor !== cur.uid) {
			relatedFor = cur.uid;
			related = [];
			relatedLoading = true;
			searchAll(cur.artist, 1)
				.then((r) => {
					if (relatedFor !== cur.uid) return; // race guard: a newer track took over
					related = dedupeBest(r.interleaved, settings.preferredSource).filter((x) => x.uid !== cur.uid).slice(0, 20);
					relatedLoading = false;
				})
				.catch(() => {
					if (relatedFor !== cur.uid) return;
					related = [];
					relatedLoading = false;
				});
		}
	});

	// quick-260910-qwt: the SAME single capped cover pool the Up-Next pane runs, over this pane's
	// rows. `related` is at most 20 rows and `upNextCoverNeeds` skips every row already carrying an
	// https source cover (most CN search hits carry an inline pic), so a fill is <=20 tier-1
	// /api/deezer/search, typically far fewer, <=6 in flight, ~0 on re-open (skip-cached + the 5-min
	// miss memo). This is emphatically NOT a per-row `use:lazyCover` on Related — T-26-10-01 holds.
	//
	// quick-260919-np3: gated on the SAME `visible` signal as the fetch above, so an off-screen
	// column costs nothing. `related` is reassigned ONLY by its own fetch effect (once per track
	// change), so adding it as a dependency cannot loop; `backfillCovers` runs under `untrack` and
	// this effect never reads `coverVersion()`, so `onResolved -> bumpCoverVersion` repaints the
	// tiles without re-triggering the fill (cf. restore-effect-self-invalidation-loop).
	$effect(() => {
		if (!visible) return;
		const needs = upNextCoverNeeds(related);
		if (!needs.length) return;
		const ac = new AbortController();
		untrack(() => {
			void backfillCovers(needs, {
				signal: ac.signal,
				onResolved: () => bumpCoverVersion(),
				max: UPNEXT_COVER_MAX
			});
		});
		return () => ac.abort();
	});

	// quick-260625-pzs-02: swipe-to-queue on the Related list, mirroring search/+page.svelte:41-50.
	// swipe-right = add to queue (D-03), swipe-left = play next (D-04). Reuses the shared swipeAction
	// (tap-preserving + vertical-yielding) so tap-to-play and long-press menu keep working.
	function relatedSwipeQueue(track: Track) {
		player.addToQueue(track);
		toast.show(t('toast.addedToQueue'));
		hapticTick();
	}
	function relatedSwipeNext(track: Track) {
		player.playNext(track);
		toast.show(t('toast.playingNext'));
		hapticTick();
	}

	// quick-260910-qjv → player.spliceAndPlay (38-D-07). The full decision record (why fresh:true
	// nuked the queue, why pin:false, the D-03 already-current no-op guard and the double-play guard)
	// lives on that method now — the share-arrival path is its second caller, so the composition
	// belongs in the store. No toast/haptic — the row becoming the playing track IS the feedback.
	function relatedTapPlay(track: Track) {
		player.spliceAndPlay(track);
	}
</script>

<!-- The IntersectionObserver target. `min-height` keeps it a real, measurable box in every state
     (mid-fetch skeleton, no-related empty text, or a short list) so an empty pane can neither
     collapse its grid column at >=1280px nor make the observer report a zero-height rect. -->
<div class="rel-pane" bind:this={paneEl}>
	{#if related.length}
		<ul class="list">
			{#each related as track (track.uid)}
				<!-- quick-260910-qwt: Related rows had NO art at all. This is the same shared
				     three-rung read the Up-Next tile uses (resolved → track.cover → shared cache) —
				     a reactive READ, never a fetch. NO `use:lazyCover` on these rows: per-row chains
				     here were the observed /api/deezer/search flood (T-26-10-01) and that rule still
				     holds. The coverless rows are filled by the ONE capped, tab-gated backfillCovers
				     effect above. Must sit directly under the {#each} ({@const} is block-child only). -->
				{@const rArt = pickRowCover(readPinnedCover(track.uid), resolvedCovers[track.uid], track.cover, readCoverByUidOrName(track.uid, track.artist, track.title))}
				<!-- quick-260625-pzs-02: reveal layers sit BEHIND the row; the row translateX
				     (use:swipeAction) slides to expose them. Right-drag → queue, left-drag → play
				     next. aria-hidden (the same actions stay reachable via the long-press menu). -->
				<li class="swipe-wrap related-swipe">
					<span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>
					<span class="reveal reveal-next" aria-hidden="true"><ListStart size={20} /></span>
					<button class="row rel-row" use:tapBounce use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); onMenu(track); }} onclick={() => relatedTapPlay(track)} use:swipeAction={{ onSwipeRight: () => relatedSwipeQueue(track), onSwipeLeft: () => relatedSwipeNext(track) }}><span class="q-art" style:background-image={rArt ? `url(${rArt})` : coverGradient(track.uid)}></span><span class="r-meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-artist">{names.dnArtist(track.artist)}</span></span><RowBadges uid={track.uid} /></button>
				</li>
			{/each}
		</ul>
	{:else if relatedLoading}
		<ul class="list" aria-label={t('nowplaying.loadingRelated')}>
			<span class="vh">{t('nowplaying.loadingRelated')}</span>
			{#each Array(8) as _, i (i)}
				<li><span class="row skel" aria-hidden="true"><span class="r-title sk"></span><span class="r-artist sk"></span></span></li>
			{/each}
		</ul>
	{:else}<p class="empty">{t('nowplaying.noRelated')}</p>{/if}

</div>

<style>
	/* quick-260919-np3: the Related SUBSET of NowPlaying.svelte's old panel CSS, moved verbatim with
	   the markup it styles (Svelte scopes styles per component). `.list` / `.row` / `.q-art` /
	   `.r-title` / `.r-artist` / `.empty` / the hover rule also exist in NpUpNext.svelte — the two
	   row shapes genuinely diverge below that shared base. */
	.rel-pane { min-height: 96px; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
	.row { width: 100%; text-align: left; background: none; border: none; padding: 8px 6px; border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; }
	/* quick-260625-pzs-02: swipe-to-queue on the RELATED list (mirrors search/+page.svelte:669-677).
	   The reveal spans sit BEHIND the row; the row's translateX (use:swipeAction) slides to expose the
	   correct side. The related .row is normally transparent, so it gets an opaque bg + z-index here so
	   the reveal stays masked at rest and clipped during travel.
	   quick-260910-k45: the opaque background this comment described was never actually written —
	   the rule only had `z-index: 1`, which orders layers but does not occlude, so the reveal icons
	   showed through the transparent row at rest. `background: var(--color-bg)` matches `.np`, so the
	   now-opaque row looks unchanged over the sheet. */
	.related-swipe { position: relative; overflow: hidden; border-radius: 10px; }
	.related-swipe .reveal {
		position: absolute; top: 0; bottom: 0; width: 96px; display: flex; align-items: center;
		justify-content: center; color: #fff; pointer-events: none;
	}
	.related-swipe .reveal-queue { left: 0; color: var(--color-text-muted); }
	.related-swipe .reveal-next { right: 0; color: var(--color-text-muted); }
	.related-swipe .row { background: var(--color-bg); position: relative; z-index: 1; }
	/* MENU-03 / D-12: hover-capable devices only — touch otherwise latches this :hover
	   background on a related row under a held finger while the track menu opens. */
	@media (hover: hover) { .row:hover { background: var(--color-surface); } }
	.q-art { width: 36px; height: 36px; border-radius: 6px; background-size: cover; background-position: center; background-color: rgba(255,255,255,0.04); flex: none; }
	.r-title { font-size: calc(0.875rem * var(--fs-title, 1)); font-weight: 600; color: var(--color-text);}
	.r-artist { font-size: calc(0.75rem * var(--fs-artist, 1)); color: var(--color-text-muted); }
	/* quick-260723: Related list rows go row-direction so RowBadges sit at the trailing edge; the
	   text stacks inside .r-meta. The shared `.row` (column) + its skeleton variant stay untouched. */
	.row.rel-row { flex-direction: row; align-items: center; gap: 8px; }
	.rel-row .r-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
	/* Related loading skeleton: placeholder rows mirror the real .row shape
	   (stacked title + artist bars) so the list keeps its size/shape while fetching.
	   Bars use the global `.sk` shimmer; reduce-motion handled there. */
	.row.skel { pointer-events: none; gap: 6px; }
	.row.skel .sk { display: block; }
	.row.skel .r-title { width: 55%; height: 14px; }
	.row.skel .r-artist { width: 38%; height: 12px; }
	/* Visually-hidden screen-reader cue for the skeleton list. */
	.vh { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
	.empty { color: var(--color-text-muted); font-size: 0.875rem; text-align: center; padding: 24px; }
</style>
