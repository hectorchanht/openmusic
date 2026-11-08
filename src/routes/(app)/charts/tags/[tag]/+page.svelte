<script lang="ts">
	import { page } from '$app/state';
	import { getTagTopTracks, type DiscoveryTrack } from '$lib/services/lastfm';
	import { resolveStub } from '$lib/services/discovery';
	import { player } from '$lib/stores/player.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SongRow from '$lib/components/SongRow.svelte';
	import SwipeReveal from '$lib/components/SwipeReveal.svelte';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import type { Track } from '$lib/sources/types';

	const CHART_LIMIT = 100; // D-12: deep list (~100 rows)

	// Defensive param decode (T-23-13): an undefined/garbage [tag] → '' → empty fetch → hidden
	// list (never crash). decodeURIComponent is wrapped so a malformed escape sequence can't throw.
	const tag = $derived.by(() => {
		const raw = page.params.tag ?? '';
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	});

	let tracks = $state<DiscoveryTrack[]>([]);

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

	async function play(it: DiscoveryTrack) {
		const tr = await player.tapStub(it.artist, it.title, it.image, 'home-discovery'); // quick-261103-tapsplice (Hector 2026-11-03): splice like a Related tap — queue + history survive
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

	// quick-261108-swp: row swipes moved into SongRow (settings.swipeRow via rowSwipe).

	// Refetch whenever the [tag] param changes. A generation guard discards a stale fetch if the
	// route param changed mid-flight. Empty tag → empty result → hidden list (never-throw).
	let fetchGen = 0;
	$effect(() => {
		const myTag = tag; // track the dependency
		const gen = ++fetchGen;
		showSkeleton = true;
		const startedAt = Date.now();
		if (!myTag.trim()) {
			tracks = [];
			void minDwell(startedAt).then(() => { if (gen === fetchGen) showSkeleton = false; });
			return;
		}
		void getTagTopTracks(myTag, CHART_LIMIT)
			.then((rows) => {
				if (gen !== fetchGen) return; // superseded by a newer param
				tracks = rows;
			})
			.finally(async () => {
				await minDwell(startedAt);
				if (gen === fetchGen) showSkeleton = false;
			});
	});
</script>

<PageHeader title={t('charts.tagTitle', { tag })} backLabel={t('common.back')} showSettings />

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
	<ul class="list">{@render skeletonRows(12, t('charts.tagTitle', { tag }))}</ul>
{:else if tracks.length > 0}
	<ul class="list">
		{#each tracks as it (rowKey(it))}
			<!-- quick-260919-l9e: the shared row. These rows are DiscoveryTrack STUBS, so every
			     interaction has to resolve first — which is why all four callbacks are overridden
			     here rather than taking SongRow's defaults: `onplay` is playStub (not setListQueue
			     + play), `onrequestmenu` resolves before opening, and the swipe pair keeps the
			     D-16/WR-03 per-row-per-action in-flight guard. `resolve` is that same seam for the
			     INLINE buttons (quick-260919-l9e): a stub has no uid, so Like/Download key off the
			     RESOLVED uid. This row used to pass `actions={[]}` to hide them, which meant
			     settings.rowActions was silently ignored here. The ⋮ is unconditional, so the menu is
			     reachable by tap, not only by long-press. {@const} must be the immediate block child
			     of the {#each}. -->
			{@const stub = stubTrack(it)}
			<li class="row-wrap">
				<SwipeReveal />
				<SongRow
					track={stub}
					resolve={() => resolveStub(it.artist, it.title).catch(() => null)}
					onplay={() => play(it)}
					onrequestmenu={() => openMenu(it)}
				/>
			</li>
		{/each}
	</ul>
{/if}

<TrackMenu track={menuTrack} open={menuOpen} loading={menuLoading} onclose={() => (menuOpen = false)} />

<style>
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.row-wrap { position: relative; overflow: hidden; border-radius: var(--radius-md); }
	/* quick-260919-l9e: the real row is SongRow.svelte now (its styles travelled with it — Svelte
	   scopes per component). `.row` / `.art` / `.meta` are KEPT because the 12-row skeleton above
	   still renders `<span class="row skel">` with them, and it is the whole first paint of a cold
	   charts page. The interactive-only rules (:hover, .r-title, .r-artist) went with the markup. */
	.row {
		position: relative; z-index: 1; width: 100%; display: flex; align-items: center; gap: 12px;
		padding: 8px; background: var(--color-bg); border: none; border-radius: var(--radius-md);
		text-align: start;
	}
	.art { width: 48px; height: 48px; border-radius: 8px; background-size: cover; background-position: center; flex: none; }
	.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
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
</style>
