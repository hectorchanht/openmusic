<script lang="ts">
	// quick-261024-vid1 — the Now Playing MV layer: a muted <video> following the master
	// <audio>. The player store stays the single clock (play/pause/seek/queue/MediaSession
	// untouched); this component only paints picture in sync. Its own control bar drives
	// the MASTER (play/pause/seek), picks the quality (the shared settings.videoQuality),
	// and offers PiP / fullscreen / close. Any failure lands as an inline error over the
	// stage with Retry — the music never notices.
	import { onDestroy } from 'svelte';
	import { Play, Pause, X, Maximize, PictureInPicture2, ChevronDown, Check, RotateCcw } from '@lucide/svelte';
	import { player, fmtTime } from '$lib/stores/player.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { VIDEO_QUALITIES, type VideoQuality } from '$lib/config/defaults';
	import { t } from '$lib/i18n';
	import { VideoFeeder, syncDecision, type VideoStageError } from '$lib/services/video-stage';
	import { videoAvailability } from '$lib/services/video-availability.svelte';

	let { videoId, onclose }: { videoId: string; onclose: () => void } = $props();

	let stageEl = $state<HTMLDivElement | null>(null);
	let videoEl = $state<HTMLVideoElement | null>(null);
	let err = $state<VideoStageError | null>(null);
	let height = $state(0);
	let waiting = $state(false);
	let qualityOpen = $state(false);
	let scrubbing = $state(false);
	let scrubValue = $state(0);
	let feeder: VideoFeeder | null = null;
	let runId = 0;

	const pipOk = typeof document !== 'undefined' && !!document.pictureInPictureEnabled;
	const shownTime = $derived(scrubbing ? scrubValue : player.currentTime);

	function startFeed() {
		feeder?.stop();
		err = null;
		height = 0;
		const mine = ++runId;
		const el = videoEl;
		if (!el) return;
		feeder = new VideoFeeder(el, videoId, settings.videoQuality, {
			onMeta: (h) => {
				if (mine !== runId) return;
				height = h;
				videoAvailability.mark(videoId, true);
			},
			onError: (e) => {
				if (mine !== runId) return;
				err = e;
				if (e.kind === 'none') videoAvailability.mark(videoId, false);
			}
		});
		void feeder.start();
	}

	// (Re)start on track / quality change.
	$effect(() => {
		void videoId;
		void settings.videoQuality;
		if (videoEl) startFeed();
	});

	// Mirror the master, 4×/s, via the pure syncDecision (quick-261024-vid2): NEVER seek
	// into unbuffered time (the first live check froze exactly that way — a mid-song open
	// snapped into the void every tick and the element never played). While the playhead
	// is ahead of the feed the picture waits; once the buffer covers it, one snap lands
	// and small drifts are absorbed by a rate nudge instead of repeated seeks.
	$effect(() => {
		const tick = setInterval(() => {
			const v = videoEl;
			if (!v || err) return;
			const d = syncDecision({
				masterTime: player.currentTime,
				videoTime: v.currentTime,
				bufferedEnd: feeder?.bufferedEnd() ?? 0,
				masterPlaying: player.playing
			});
			waiting = d.action === 'wait';
			if (d.action === 'pause' || d.action === 'wait') {
				if (!v.paused) v.pause();
				v.playbackRate = 1;
				return;
			}
			if (d.action === 'snap') {
				try {
					v.currentTime = player.currentTime;
				} catch {
					// not seekable yet — the next tick retries
				}
			}
			v.playbackRate = d.rate;
			if (v.paused && v.readyState >= 2) void v.play().catch(() => {});
		}, 250);
		return () => clearInterval(tick);
	});

	onDestroy(() => feeder?.stop());

	function pickQuality(q: VideoQuality) {
		qualityOpen = false;
		if (q === settings.videoQuality) return;
		settings.videoQuality = q;
		settings.save();
	}

	async function goFullscreen() {
		try {
			// quick-261024-vid2: the button is a TOGGLE — in fullscreen it must exit (the
			// first live check found tapping it again did nothing).
			if (document.fullscreenElement) {
				await document.exitFullscreen();
				return;
			}
			await stageEl?.requestFullscreen();
			const o = screen.orientation as unknown as { lock?: (x: string) => Promise<void> };
			await o.lock?.('landscape').catch(() => {});
		} catch {
			// fullscreen refused (iframe policy / native shell) — the stage stays inline
		}
	}

	async function goPip() {
		try {
			await videoEl?.requestPictureInPicture();
		} catch {
			// PiP refused — nothing to surface, the stage keeps playing inline
		}
	}

	function errText(e: VideoStageError): string {
		if (e.kind === 'none') return t('video.noVideo');
		if (e.kind === 'gated') return e.reason ? `${t('video.gated')} (${e.reason})` : t('video.gated');
		if (e.kind === 'unsupported') return t('video.unsupported');
		return t('video.network');
	}
</script>

<div class="vstage" bind:this={stageEl}>
	<!-- svelte-ignore a11y_media_has_caption — an MV picture layer; the song's lyrics view is one tap away and captions do not exist for these streams -->
	<video bind:this={videoEl} muted playsinline preload="auto"></video>

	{#if err}
		<div class="v-err" role="alert">
			<p>{errText(err)}</p>
			<div class="v-err-btns">
				{#if err.kind !== 'none' && err.kind !== 'unsupported'}
					<button onclick={startFeed}><RotateCcw size={14} /> {t('video.retry')}</button>
				{/if}
				<button onclick={onclose}><X size={14} /> {t('nowplaying.closeVideo')}</button>
			</div>
		</div>
	{:else if height === 0}
		<div class="v-loading" aria-hidden="true">{t('video.loading')}</div>
	{:else if waiting}
		<div class="v-waiting" aria-hidden="true">{t('video.loading')}</div>
	{/if}

	<div class="v-bar">
		<button class="v-btn" aria-label={t('nowplaying.playPause')} onclick={() => player.toggle()}>
			{#if player.playing}<Pause size={18} />{:else}<Play size={18} />{/if}
		</button>
		<span class="v-time">{fmtTime(shownTime)}</span>
		<input
			class="v-seek"
			type="range"
			min="0"
			max={player.duration || 0}
			step="0.1"
			value={shownTime}
			aria-label={t('video.seek')}
			onpointerdown={() => (scrubbing = true)}
			onpointerup={() => (scrubbing = false)}
			oninput={(e) => {
				scrubValue = Number((e.currentTarget as HTMLInputElement).value);
				if (player.duration > 0) player.seekFraction(scrubValue / player.duration);
			}}
		/>
		<span class="v-time">{player.duration > 0 ? fmtTime(player.duration) : '--:--'}</span>
		<div class="v-q">
			<button class="v-btn v-qbtn" aria-haspopup="menu" aria-expanded={qualityOpen} onclick={() => (qualityOpen = !qualityOpen)}>
				{height > 0 ? `${height}p` : t('video.quality')}<ChevronDown size={14} />
			</button>
			{#if qualityOpen}
				<div class="v-menu" role="menu">
					{#each VIDEO_QUALITIES as q (q)}
						<button role="menuitemradio" aria-checked={settings.videoQuality === q} onclick={() => pickQuality(q)}>
							{q}p {#if settings.videoQuality === q}<Check size={14} />{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
		{#if pipOk}
			<button class="v-btn" aria-label={t('video.pip')} onclick={goPip}><PictureInPicture2 size={17} /></button>
		{/if}
		<button class="v-btn" aria-label={t('video.fullscreen')} onclick={goFullscreen}><Maximize size={17} /></button>
		<button class="v-btn" aria-label={t('nowplaying.closeVideo')} onclick={onclose}><X size={17} /></button>
	</div>
</div>

<style>
	.vstage { position: absolute; inset: 0; background: #000; overflow: hidden; }
	.vstage video { width: 100%; height: 100%; object-fit: contain; display: block; }
	.vstage:fullscreen { border-radius: 0; }
	.v-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #cfcfe0; font-size: 13px; background: rgba(0,0,0,0.35); }
	.v-waiting { position: absolute; top: 10px; left: 10px; padding: 4px 10px; border-radius: 999px; color: #cfcfe0; font-size: 12px; background: rgba(0,0,0,0.55); }
	.v-err { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 10px; align-items: center; justify-content: center; text-align: center; padding: 16px; color: #f0eefc; background: rgba(8,6,18,0.82); font-size: 13px; }
	.v-err p { margin: 0; max-width: 34ch; }
	.v-err-btns { display: flex; gap: 8px; }
	.v-err-btns button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.35); background: transparent; color: inherit; font-size: 12.5px; cursor: pointer; }
	.v-bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 8px; padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px)); background: linear-gradient(180deg, transparent, rgba(0,0,0,0.72) 38%); color: #fff; }
	.v-btn { display: inline-flex; align-items: center; justify-content: center; gap: 3px; min-width: 32px; height: 32px; padding: 0 6px; border: none; border-radius: 8px; background: transparent; color: #fff; cursor: pointer; font-size: 12.5px; }
	.v-btn:hover { background: rgba(255,255,255,0.14); }
	.v-time { font-size: 11.5px; font-variant-numeric: tabular-nums; opacity: 0.9; min-width: 34px; text-align: center; }
	.v-seek { flex: 1; accent-color: #fff; min-width: 40px; }
	.v-q { position: relative; }
	.v-menu { position: absolute; right: 0; bottom: calc(100% + 6px); display: flex; flex-direction: column; min-width: 92px; padding: 4px; border-radius: 10px; background: rgba(18,16,30,0.97); box-shadow: 0 10px 30px rgba(0,0,0,0.5); z-index: 5; }
	.v-menu button { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; border: none; border-radius: 6px; background: transparent; color: #fff; font-size: 13px; cursor: pointer; text-align: left; }
	.v-menu button:hover { background: rgba(255,255,255,0.12); }
</style>
