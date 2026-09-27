<script lang="ts">
	import { onMount } from 'svelte';
	import { ListEnd, ListStart } from '@lucide/svelte';
	import { buildRadio } from '$lib/services/radio';
	import { clampShelfSize } from '$lib/services/home-layout';
	import { resolveStub } from '$lib/services/discovery';
	import { player } from '$lib/stores/player.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { history as playHistory } from '$lib/stores/history.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SongRow from '$lib/components/SongRow.svelte';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import type { Track } from '$lib/sources/types';

	let tracks = $state<Track[]>([]);

	const SKELETON_MIN_MS = 280;
	let showSkeleton = $state(true);

	function minDwell(startedAt: number): Promise<void> {
		const remaining = SKELETON_MIN_MS - (Date.now() - startedAt);
		return remaining > 0 ? new Promise((r) => setTimeout(r, remaining)) : Promise.resolve();
	}

	// quick-260927-1fx: same cap as the home shelf, and quick-260926-lw8's session seed replays the
	// same draw, so this page IS the "Your Radio" shelf in full rows; every upstream call is memoised
	// 6 h, so the SPA nav from the shelf title costs zero requests. Empty history → [] → nothing under
	// the header (the home shelf hides itself the same way; reaching /radio with no history is URL-only).
	onMount(() => {
		settings.load(); // both idempotent — the home does the same
		playHistory.load();
		const startedAt = Date.now();
		void buildRadio(playHistory.entries, clampShelfSize(settings.homeShelfSize))
			.then((r) => {
				tracks = r;
			})
			.finally(async () => {
				await minDwell(startedAt);
				showSkeleton = false;
			});
	});

	// Mirrors the home's playRadioTrack (quick-260924-pgu): `sameList` pins the same-list branch so
	// the fresh-play tail does not regenerate over the install; setListQueue after the resolve anchors
	// the now-real `current` into the list by uid-then-sameSongKey, so the remaining rows are Up Next.
	// null = miss OR supersede; only a miss clears pendingTrack, so only a miss toasts.
	async function play(tr: Track) {
		const resolved = await player.playStub(tr.artist, tr.title, tr.cover, 'home-discovery', { sameList: true });
		if (!resolved) {
			if (player.pendingTrack == null) toast.show(t('home.unplayable'));
			return;
		}
		player.setListQueue(tracks, 'home-discovery');
	}

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);
</script>

<PageHeader title={t('settings.homeSectionRadio')} backLabel={t('common.back')} />

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
	<ul class="list">{@render skeletonRows(12, t('settings.homeSectionRadio'))}</ul>
{:else if tracks.length > 0}
	<ul class="list">
		{#each tracks as tr (tr.uid)}
			<!-- `resolve` is the album-tracklist seam (quick-260919-l9e): a nameStub's uid is truthy
			     but synthetic, so Like/Download must key off the RESOLVED uid. `swipe` stays at its
			     default: the generated Up Next already holds nameStub tracks, so addToQueue /
			     playNext of a stub is the app's normal path. -->
			<li class="row-wrap">
				<span class="reveal reveal-right" aria-hidden="true"><ListEnd size={20} /></span>
				<span class="reveal reveal-left" aria-hidden="true"><ListStart size={20} /></span>
				<SongRow
					track={tr}
					resolve={() => resolveStub(tr.artist, tr.title).catch(() => null)}
					onplay={() => play(tr)}
					onrequestmenu={() => {
						menuTrack = tr;
						menuOpen = true;
					}}
				/>
			</li>
		{/each}
	</ul>
{/if}

<!-- TrackMenu resolves `resolveByName` stubs itself (same as the home's radio tiles). -->
<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />

<style>
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.row-wrap { position: relative; overflow: hidden; border-radius: var(--radius-md); }
	.reveal {
		position: absolute; top: 0; bottom: 0; width: 72px; display: flex; align-items: center;
		justify-content: center; color: #fff; pointer-events: none;
	}
	.reveal-right { left: 0; color: var(--color-text-muted); }
	.reveal-left { right: 0; color: var(--color-text-muted); }
	/* `.row` / `.art` / `.meta` serve only the skeleton; the real rows are SongRow.svelte. */
	.row {
		position: relative; z-index: 1; width: 100%; display: flex; align-items: center; gap: 12px;
		padding: 8px; background: var(--color-bg); border: none; border-radius: var(--radius-md);
		text-align: left;
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
