<script lang="ts">
	// CarMode — the Car Mode panel (quick-261116-carmode, Car Mode plan Phase 4, Q2/Q4).
	//
	// A driving surface, designed for the BOTTOM PANE of a split screen (Maps on top,
	// this underneath, per Hector's Bluetooth Routine): it takes over the whole app
	// viewport in the (app) layout — page, bottom nav and Nowbar are all swapped out
	// for this one panel — and it must lay out cleanly from a ~150px-tall pane up to
	// full-screen height, down to 339px wide.
	//
	// Impeccable operate/distill: exactly what a driver needs at a glance and nothing
	// else — a progress sliver, cover + title/artist, a colour-only reliability dot,
	// and five >=56px controls (Prev / Play / Next / Like / Download). No lyrics, no
	// queue, no search, no text badges: provenance is a DOT (green = the bytes are on
	// the device, amber = streaming) because colour is readable at a glance in
	// sunlight and a pill is not. Text is large and full-contrast (--color-text, never
	// the muted token) for the same reason.
	//
	// The cover carries the Phase 3 doubleTap action (double-tap = random discovery
	// dive), inherited unchanged: in Car Mode there is no expand for a single tap to
	// defer to, so onsingletap is deliberately a no-op — the tap is claimed by the
	// gate, waits out the 260ms window, and does nothing. The dive's feedback (genre
	// toast + haptic) mirrors Nowbar's coverRandom exactly.
	import { X, Play, Pause, Loader, SkipBack, SkipForward, Heart } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { carMode } from '$lib/stores/car-mode.svelte';
	import { doubleTap } from '$lib/actions/doubleTap';
	import { marquee } from '$lib/actions/marquee';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { playRandomDiscovery } from '$lib/services/random-discovery';
	import { CHART_GENRE_LABEL } from '$lib/services/home-charts';
	import { progressFraction, reliabilityDot } from '$lib/services/car-mode';
	import { toast } from '$lib/stores/toast.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import { t } from '$lib/i18n';
	import DownloadControl from '$lib/components/DownloadControl.svelte';

	const np = $derived(player.current ?? player.pendingTrack);
	const resolving = $derived(!player.current && !!player.pendingTrack);
	const cover = $derived(player.displayCover ?? np?.cover);
	const dot = $derived(
		reliabilityDot({ hasTrack: !!np, isLocal: player.currentLocal })
	);
	const frac = $derived(progressFraction(player.currentTime, player.duration));
	const liked = $derived(player.current ? library.isLikedTrack(player.current) : false);

	function fallbackCover(): string {
		return 'linear-gradient(145deg,#3a2d63,#1a1326)';
	}

	// quick-261116-dtap's dive, verbatim feedback contract (see Nowbar.coverRandom).
	async function coverRandom() {
		hapticTick();
		const r = await playRandomDiscovery();
		if (!r) {
			toast.show(t('home.unplayable'));
			return;
		}
		if (r.kind === 'genre') toast.show(t('toast.dtapGenre', { genre: t(CHART_GENRE_LABEL[r.genre]) }));
		else if (r.kind === 'local') toast.show(t('toast.dtapLocal'));
		else toast.show(t('toast.dtapAny'));
	}

	function toggleLike() {
		if (!player.current) return;
		library.toggleLike(player.current);
		toast.show(library.isLikedTrack(player.current) ? t('toast.liked') : t('toast.unliked'));
	}
</script>

<section class="car" aria-label={t('home.carMode')}>
	<!-- Progress sliver: the Nowbar .np-prog idiom (determinate fill, or the
	     indeterminate sliver while loading — spinner XOR skeleton doctrine: this
	     rail is the panel's ONE loading indicator for track changes). -->
	<div class="cm-prog" class:indet={player.loading}>
		{#if player.loading}
			<i class="sliver motion-always"></i>
		{:else}
			<i style:width={`${frac * 100}%`}></i>
		{/if}
	</div>

	<div class="cm-body">
		<div class="cm-row1">
			<!-- Cover: 56px, doubleTap attached (Phase 3). No coverSwipe here — a
			     swipe on a 56px target in a moving car is an accident, not a gesture. -->
			<span
				class="cm-art"
				use:doubleTap={{
					onsingletap: () => {},
					ondoubletap: coverRandom,
					enabled: !resolving
				}}
				style:background-image={cover ? `url(${cover}), ${fallbackCover()}` : fallbackCover()}
			></span>
			<span class="cm-meta">
				<span class="cm-title" use:marquee>
					<span class="marquee-inner">{np ? names.dnTitle(np.title ?? '', np.artist ?? '') : 'OpenMusic'}</span>
				</span>
				<span class="cm-artist">
					{#if dot !== 'none'}
						<i class="cm-dot" class:local={dot === 'local'} aria-hidden="true"></i>
					{/if}
					<span class="cm-artist-name">{np ? names.dnArtist(np.artist ?? '') : t('home.carMode')}</span>
				</span>
			</span>
			<button
				type="button"
				class="cm-exit"
				aria-label={t('menu.close')}
				title={t('menu.close')}
				onclick={() => carMode.exit()}
				use:tapBounce
			>
				<X size={26} />
			</button>
		</div>

		<div class="cm-controls">
			<button
				type="button"
				class="cm-btn"
				aria-label={t('nowplaying.previous')}
				onclick={() => player.prev()}
				disabled={!np}
				use:tapBounce
			>
				<SkipBack size={28} />
			</button>
			<button
				type="button"
				class="cm-btn cm-play"
				aria-label={t('nowplaying.playPause')}
				onclick={() => player.toggle()}
				disabled={!np}
				use:tapBounce
			>
				{#if player.loading}
					<Loader size={34} class="motion-always cm-spin" />
				{:else if player.playing}
					<Pause size={34} />
				{:else}
					<Play size={34} />
				{/if}
			</button>
			<button
				type="button"
				class="cm-btn cm-next"
				aria-label={t('nowplaying.next')}
				onclick={() => player.next()}
				disabled={!np}
				use:tapBounce
			>
				<SkipForward size={30} />
			</button>
			<button
				type="button"
				class="cm-btn"
				class:on={liked}
				aria-label={liked ? t('menu.liked') : t('menu.like')}
				aria-pressed={liked}
				onclick={toggleLike}
				disabled={!player.current}
				use:tapBounce
			>
				<Heart size={26} fill={liked ? 'currentColor' : 'none'} />
			</button>
			<!-- Download: the shared DownloadControl owns every state (idle /
			     ring-with-real-progress / downloaded tick / unavailable) — the
			     wrapper only stretches its 40px box to the panel's 56px+ target
			     via the :global rule below. probe stays OFF (house rule). -->
			<span class="cm-btn cm-dl">
				<DownloadControl track={player.current} size={26} />
			</span>
		</div>
	</div>
</section>

<style>
	.car {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: var(--color-bg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		/* Full-screen use (not split-screen): keep the sliver + panel clear of the
		   notch / status bar. In a bottom split pane the inset is 0 — no-op there. */
		padding-top: env(safe-area-inset-top);
		box-sizing: border-box;
	}
	.cm-prog {
		position: relative;
		flex: none;
		height: 3px;
		background: rgba(255, 255, 255, 0.12);
		overflow: hidden;
	}
	.cm-prog > i {
		display: block;
		height: 100%;
		background: var(--color-primary);
		transition: width 0.25s linear;
	}
	.cm-prog.indet > i.sliver {
		width: 35%;
		transition: none;
		animation: cm-indet 1.1s ease-in-out infinite;
	}
	@keyframes cm-indet {
		0% {
			transform: translateX(-110%);
		}
		100% {
			transform: translateX(310%);
		}
	}
	.cm-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 10px;
		width: 100%;
		max-width: 720px;
		margin: 0 auto;
		padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
		box-sizing: border-box;
	}
	.cm-row1 {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}
	.cm-art {
		flex: none;
		width: 56px;
		height: 56px;
		border-radius: var(--radius-md);
		background-size: cover;
		background-position: center;
	}
	.cm-meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.cm-title {
		font-size: 19px;
		font-weight: 700;
		line-height: 1.25;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
	}
	.cm-artist {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 15px;
		line-height: 1.3;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
	}
	.cm-artist-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* The reliability dot: colour is the whole message (subconscious-first, no
	   badge text). Green = local bytes (download / car buffer), amber = streaming. */
	.cm-dot {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: var(--radius-full);
		background: #ffb02e;
	}
	.cm-dot.local {
		background: #2ecc71;
	}
	.cm-exit {
		flex: none;
		width: 52px;
		height: 56px;
		display: grid;
		place-items: center;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text);
		cursor: pointer;
	}
	.cm-controls {
		display: grid;
		grid-template-columns: 1fr 1.3fr 1.15fr 1fr 1fr;
		gap: 6px;
	}
	.cm-btn {
		height: 68px;
		min-width: 0;
		display: grid;
		place-items: center;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text);
		cursor: pointer;
	}
	.cm-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.cm-btn.on {
		color: var(--color-primary);
	}
	/* Play is the panel's hero: NowPlaying's proven treatment — a white disc with a
	   black glyph (the brightest-contrast object on screen, sunlight-readable),
	   inverting on the light theme exactly as .np .play does. NOT the accent
	   colour: white-on-teal measures ~2.6:1, which fails a moving car. */
	.cm-play {
		background: #fff;
		border-color: transparent;
		color: #000;
	}
	:global(:root[data-theme='light']) .cm-play {
		background: var(--color-text);
		color: var(--color-bg);
	}
	/* DownloadControl's own box is a fixed 40px (list-row footprint); inside the
	   car panel it must fill the 56px+ grid cell so the whole cell is the target. */
	.cm-dl {
		padding: 0;
	}
	.cm-dl :global(.dc) {
		width: 100%;
		height: 100%;
		min-height: 68px;
		border-radius: var(--radius-md);
	}
	/* Short split-screen panes (~150–180px): compact the vertical rhythm so all
	   five controls stay fully on-screen — targets stay >=56px, only the cover,
	   gaps and button height give. */
	@media (max-height: 180px) {
		.cm-body {
			gap: 6px;
			padding-top: 4px;
			padding-bottom: 4px;
		}
		.cm-art {
			width: 48px;
			height: 48px;
		}
		.cm-exit {
			height: 48px;
		}
		.cm-btn {
			height: 60px;
		}
		.cm-dl :global(.dc) {
			min-height: 60px;
		}
	}
	:global(.cm-spin) {
		animation: cm-rot 1s linear infinite;
	}
	@keyframes cm-rot {
		to {
			transform: rotate(360deg);
		}
	}
</style>
