<script lang="ts">
	// SeekBar — THE shared progress bar (quick-261119-seekbar). Hector's standard
	// (2026-11-19, STANDING): every progress bar, everywhere, (1) shows the buffered
	// range in GREY behind the played fill and (2) is draggable/tappable to seek
	// ANYWHERE — into unbuffered territory included (it re-buffers; never clamped
	// to the buffer). This component is the ONE implementation: NowPlaying's full
	// scrubber and the Nowbar's top-edge strip are the same bar at two sizes, and
	// Car Mode's sliver is its read-only thin form.
	//
	// Visual language (inherited, not invented): the global .scrubber skin in
	// app.css supplies the track / Tiffany fill / knob and reads --scrub-frac, so
	// this component only ADDS the grey .seek-buf segments (from
	// player.bufferedRanges, geometry by services/seekbar.rangesToPercents)
	// between the track and the fill, plus the drag-time bubble.
	//
	// Seeks commit through player.seekFraction() ONLY (clamps, pending-seek and
	// paused-autoplay semantics are the store's) — never an ad-hoc
	// audio.currentTime write from a component. While scrubbing, the fill is
	// frozen at the drag position (displayFrac) so the 4×/sec timeupdate ticks
	// never fight the finger; the audio itself is seeked ONCE, on release (a
	// plain tap is a release with no drag — it seeks to the tapped point).
	//
	// Variants:
	//  - 'full' (NowPlaying): the plan-002 scrubber, claimed on pointerdown like
	//    use:scrub always did — the sheet behind it must never arm mid-scrub.
	//  - 'mini' (Nowbar): the strip lives on the bar's TOP EDGE with a 24px
	//    invisible hit height (the visual line stays 3px). It sits OUTSIDE
	//    .np-open, so expand / cover-swipe / double-tap never see its gestures;
	//    on top of that the gesture is only CLAIMED after a horizontal-dominant
	//    move past a threshold (services/seekbar.decideGestureClaim) — a
	//    vertical scroll intent is yielded to, never hijacked (touch-action:
	//    pan-y keeps vertical scrolling native). stopPropagation on pointerdown
	//    is the belt to that braces.
	//  - 'thin' (Car Mode): read-only — same grey-buffer + fill layers, no knob,
	//    no handlers, pointer-events:none. A driving surface never seeks.
	import { player, fmtTime } from '$lib/stores/player.svelte';
	import {
		rangesToPercents,
		fractionFromClientX,
		decideGestureClaim
	} from '$lib/services/seekbar';
	import { seekTargetFraction, SEEK_STEP_SECONDS } from '$lib/services/transport-keys';
	import { t } from '$lib/i18n';
	import KeyTip from '$lib/components/KeyTip.svelte';

	type Variant = 'full' | 'mini' | 'thin';

	let {
		variant = 'full',
		onScrubChange
	}: {
		variant?: Variant;
		/**
		 * Preview feed for a host that renders its own time readout (NowPlaying's
		 * .times row): the drag fraction while scrubbing, null when the scrub ends.
		 */
		onScrubChange?: (frac: number | null) => void;
	} = $props();

	const seekable = $derived(variant !== 'thin');
	const frac = $derived(player.duration > 0 ? player.currentTime / player.duration : 0);
	let scrubbing = $state(false);
	let scrubFrac = $state(0);
	// While scrubbing the bar renders the DRAG position, not the playhead.
	const displayFrac = $derived(scrubbing ? scrubFrac : frac);
	const displayTime = $derived(
		scrubbing && player.duration > 0 ? scrubFrac * player.duration : player.currentTime
	);
	const bufferedSegs = $derived(rangesToPercents(player.bufferedRanges, player.duration));
	const bubbleLeft = $derived(Math.min(96, Math.max(4, displayFrac * 100)));

	let barEl = $state<HTMLElement | null>(null);
	// Gesture lifecycle — plain fields, never reactive (house convention).
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let pending = false; // pointer is down, gesture not yet decided (mini only)
	let claimed = false; // this gesture is a scrub

	function fracAt(clientX: number): number {
		if (!barEl) return 0;
		const r = barEl.getBoundingClientRect();
		return fractionFromClientX(clientX, { left: r.left, width: r.width });
	}
	function preview(f: number) {
		scrubFrac = f;
		scrubbing = true;
		onScrubChange?.(f);
	}
	function claim(id: number) {
		claimed = true;
		try {
			barEl?.setPointerCapture(id);
		} catch {
			/* older UA — moves still land while the finger stays on the strip */
		}
	}
	function releaseCapture() {
		if (pointerId !== null) {
			try {
				barEl?.releasePointerCapture(pointerId);
			} catch {
				/* already released */
			}
			pointerId = null;
		}
	}
	function endScrub() {
		pending = false;
		claimed = false;
		if (scrubbing) {
			scrubbing = false;
			onScrubChange?.(null);
		}
	}

	function onPointerDown(e: PointerEvent) {
		if (!seekable || player.duration <= 0) return;
		// Own the gesture from the first frame: no ancestor (sheet drag-close,
		// bar swipe, layout handler) may arm off a press that started on the bar.
		e.stopPropagation();
		pending = true;
		claimed = false;
		pointerId = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		if (variant === 'full') {
			// Immediate claim + preview, exactly the use:scrub behaviour this replaces.
			claim(e.pointerId);
			preview(fracAt(e.clientX));
		}
		// mini: decide on move — a tap must stay a tap, a scroll must stay a scroll.
	}
	function onPointerMove(e: PointerEvent) {
		if (!pending || e.pointerId !== pointerId) return;
		if (!claimed) {
			const d = decideGestureClaim(e.clientX - startX, e.clientY - startY);
			if (d === 'wait') return;
			if (d === 'yield') {
				// Vertical scroll intent — abandon silently, never seek, never capture.
				pending = false;
				pointerId = null;
				return;
			}
			claim(e.pointerId);
		}
		preview(fracAt(e.clientX));
	}
	function onPointerUp(e: PointerEvent) {
		if (!pending || e.pointerId !== pointerId) return;
		// Reaching here means the gesture was a claimed drag OR a plain tap
		// (pending, never yielded): both commit a seek to the release point.
		// Only a RELEASE seeks (DECISIONS §12) — cancel is the other handler.
		const f = fracAt(e.clientX);
		releaseCapture();
		pending = false;
		claimed = false;
		player.seekFraction(f);
		endScrub();
	}
	function onPointerCancel() {
		releaseCapture();
		endScrub();
	}
	// lostpointercapture BUBBLES (quick-261108-swp's lesson): only the bar's OWN
	// lost capture ends the scrub — a child's must not cancel it.
	function onLostCapture(e: PointerEvent) {
		if (e.target === barEl && pending) {
			pending = false;
			pointerId = null;
			endScrub();
		}
	}
	// Keyboard parity (transport-keys): focused arrows seek ∓5s — the same step
	// and arithmetic as the global Shift+arrows, by construction.
	function onKeydown(e: KeyboardEvent) {
		if (!seekable) return;
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		const f = seekTargetFraction(
			player.currentTime,
			player.duration,
			e.key === 'ArrowRight' ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS
		);
		if (f !== null) player.seekFraction(f);
	}
</script>

{#snippet inner()}
	{#each bufferedSegs as seg, i (i)}
		<div class="seek-buf" style:left="{seg.left}%" style:width="{seg.width}%"></div>
	{/each}
	<div class="scrub-fill"></div>
	{#if variant !== 'thin'}
		<div class="scrub-knob"></div>
	{/if}
	{#if scrubbing && variant !== 'thin'}
		<div class="seek-bubble" style:left="{bubbleLeft}%">
			{fmtTime(displayTime)} / {player.duration > 0 ? fmtTime(player.duration) : '--:--'}
		</div>
	{/if}
	{#if variant === 'full'}
		<!-- quick-261008-keytip: focused arrows seek ±5s here; Shift+arrows seek ±5s
		     globally (transport-keys.ts) — carried over from the bespoke scrubber. -->
		<KeyTip label={t('nowplaying.seek')} keys={['← →', 'Shift ← →']} />
	{/if}
{/snippet}

{#if seekable}
	<div
		class="seekbar scrubber"
		class:mini={variant === 'mini'}
		class:tip-host={variant === 'full'}
		class:scrubbing
		style:--scrub-frac={displayFrac}
		role="slider"
		tabindex="0"
		aria-label={t('nowplaying.seek')}
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={Math.round(displayFrac * 100)}
		aria-valuetext={`${fmtTime(displayTime)} / ${player.duration > 0 ? fmtTime(player.duration) : '--:--'}`}
		bind:this={barEl}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerCancel}
		onlostpointercapture={onLostCapture}
		onclick={(e) => e.stopPropagation()}
		onkeydown={onKeydown}
	>
		{@render inner()}
	</div>
{:else}
	<!-- thin (Car Mode): read-only layers only — no slider semantics, no focus,
	     no handlers; the root is pointer-events:none in CSS. -->
	<div
		class="seekbar scrubber thin"
		style:--scrub-frac={displayFrac}
		aria-hidden="true"
	>
		{@render inner()}
	</div>
{/if}

<style>
	.seekbar {
		width: 100%;
	}
	/* The grey buffer layer: one segment per buffered range, sitting between the
	   track (.scrubber::before) and the Tiffany played fill. top:50% pins it to
	   the track line deterministically (the fill rides the flex static position;
	   the segments must not drift a pixel off it). */
	.seek-buf {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		height: 4px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--color-text-muted) 65%, transparent);
		pointer-events: none;
	}

	/* ---- full (NowPlaying) ---- */
	/* quick-261102-s5t's 44px thumb band, moved here with the element in
	   quick-261119-seekbar (it lived in NowPlaying's scoped styles, which cannot
	   reach into a child component): a transparent band centred on the rail is
	   part of the element, so pointerdowns across the full 44px land on the bar. */
	.seekbar:not(.mini):not(.thin)::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 44px;
		transform: translateY(-50%);
	}

	/* ---- mini (Nowbar top-edge strip) ---- */
	/* 24px invisible hit height; the visual line stays the 3px rail at the very
	   top edge. pan-y: a vertical drag scrolls natively (and pointercancels us);
	   horizontal drags are delivered for the claim decision. */
	.seekbar.mini {
		height: 24px;
		touch-action: pan-y;
	}
	.seekbar.mini::before {
		top: 0;
		height: 3px;
	}
	.seekbar.mini .scrub-fill {
		top: 0;
		height: 3px;
	}
	.seekbar.mini .seek-buf {
		top: 0;
		transform: none;
		height: 3px;
	}
	.seekbar.mini .scrub-knob {
		top: 1.5px;
		width: 10px;
		height: 10px;
		transform: translate(-50%, -50%) scale(1);
	}
	.seekbar.mini.scrubbing .scrub-knob {
		transform: translate(-50%, -50%) scale(1.5);
	}

	/* ---- thin (Car Mode read-only sliver) ---- */
	.seekbar.thin {
		height: 3px;
		cursor: default;
		pointer-events: none;
	}
	.seekbar.thin::before {
		height: 3px;
	}
	.seekbar.thin .scrub-fill,
	.seekbar.thin .seek-buf {
		height: 3px;
	}

	/* ---- drag-time bubble ---- */
	.seek-bubble {
		position: absolute;
		bottom: calc(100% + 8px);
		transform: translateX(-50%);
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--color-surface-2);
		color: var(--color-text);
		font-size: 11px;
		line-height: 1.5;
		white-space: nowrap;
		pointer-events: none;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
		z-index: 5;
	}
	/* The docked nowbar is overflow:hidden — a bubble ABOVE the strip would be
	   clipped by the bar's own top edge, so the mini bubble drops BELOW the
	   strip, over the bar's content, for the duration of the drag only. */
	.seekbar.mini .seek-bubble {
		bottom: auto;
		top: 26px;
	}
</style>
