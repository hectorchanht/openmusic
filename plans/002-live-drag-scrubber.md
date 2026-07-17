# 002 — Live Drag Scrubber (Domain 2, HIGH)

**Severity:** HIGH
**Depends on:** 001 (`.scrubber` global class, `--dur-*` tokens)
**New file:** `src/lib/actions/scrub.ts`
**Edited file:** `src/lib/components/NowPlaying.svelte` (progress markup + a few runes + CSS trim)

## Goal
Replace click-only seek with a real pointer-drag scrubber: immediate pointer-down feedback, 1:1
live tracking during drag, a preview position that follows the finger (audio commits on release),
and a tap that still seeks. Preserve keyboard `role="slider"` + arrow seeking and `aria-valuenow`.

---

## Part A — new action `src/lib/actions/scrub.ts`

Mirrors the repo gesture idiom (velocity tracker import path, arm/commit/release), but as a
*slider* it MAY capture on pointerdown (the whole element is the control — there is no child
`onclick` to preserve, so the Pitfall-7 tap-passthrough concern does not apply here). It
`stopPropagation`s pointerdown so the ancestor `.np-top` collapse-drag never arms while scrubbing.

```ts
import type { Action } from 'svelte/action';

// use:scrub — press-and-drag horizontal seek (plan 002). The node is the FULL control (the
// `.scrubber` rail), so unlike coverSwipe/dragClose this DOES setPointerCapture on pointerdown:
// there is no child click to preserve, and capturing immediately gives 1:1 tracking even when the
// finger leaves the thin rail vertically. pointerdown also stopPropagation()s so the ancestor
// `.np-top` vertical-collapse handler never arms mid-scrub.
//
// Contract:
//  - pointerdown: capture, emit onScrubStart + onPreview(frac) synchronously (immediate feedback),
//    where frac = clamp((clientX - rect.left) / rect.width, 0, 1).
//  - pointermove (while down): emit onPreview(frac) every move — the host paints the preview.
//  - pointerup/cancel: emit onSeek(frac) (the single audio commit) then onScrubEnd. A pure tap
//    (down→up, no move) therefore still seeks to the tapped fraction.
//  - `enabled:false` makes it inert. update() swaps callbacks + enabled. destroy() releases a held
//    capture and detaches.
export interface ScrubOpts {
	/** Commit the seek (release / tap). frac is clamped 0..1. */
	onSeek: (frac: number) => void;
	/** Live preview during press+drag (also fires on the initial pointerdown). */
	onPreview?: (frac: number) => void;
	onScrubStart?: () => void;
	onScrubEnd?: () => void;
	enabled?: boolean;
}

export const scrub: Action<HTMLElement, ScrubOpts> = (node, opts) => {
	let onSeek = opts.onSeek;
	let onPreview = opts.onPreview;
	let onScrubStart = opts.onScrubStart;
	let onScrubEnd = opts.onScrubEnd;
	let enabled = opts.enabled ?? true;

	let dragging = false;
	let pointerId: number | null = null;

	function fracFrom(clientX: number): number {
		const r = node.getBoundingClientRect();
		if (r.width <= 0) return 0;
		const f = (clientX - r.left) / r.width;
		return f < 0 ? 0 : f > 1 ? 1 : f;
	}

	function down(e: PointerEvent) {
		if (!enabled) return;
		// Own the gesture: stop the ancestor .np-top collapse-drag from arming, capture so moves
		// keep flowing if the finger drifts off the thin rail, and emit immediate feedback.
		e.stopPropagation();
		dragging = true;
		pointerId = e.pointerId;
		try { node.setPointerCapture(e.pointerId); } catch { /* older UA — fine */ }
		const f = fracFrom(e.clientX);
		onScrubStart?.();
		onPreview?.(f);
	}
	function move(e: PointerEvent) {
		if (!dragging) return;
		onPreview?.(fracFrom(e.clientX));
	}
	function up(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		if (pointerId !== null) {
			try { node.releasePointerCapture(pointerId); } catch { /* already released */ }
			pointerId = null;
		}
		onSeek(fracFrom(e.clientX)); // single audio commit (tap or release)
		onScrubEnd?.();
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', up);

	return {
		update(next: ScrubOpts) {
			onSeek = next.onSeek;
			onPreview = next.onPreview;
			onScrubStart = next.onScrubStart;
			onScrubEnd = next.onScrubEnd;
			enabled = next.enabled ?? true;
		},
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', up);
			if (pointerId !== null) {
				try { node.releasePointerCapture(pointerId); } catch { /* fine */ }
				pointerId = null;
			}
		}
	};
};
```

---

## Part B — NowPlaying.svelte runes (state engine)

**Add** near the existing progress block (replace the `frac` / `seek` / `seekKey` region at
lines 132-143). Keep `seekKey` unchanged; keep `player.seekFraction` as the only commit API.

```ts
	// ---- progress / scrubber (plan 002) ----
	const frac = $derived(player.duration > 0 ? player.currentTime / player.duration : 0);
	// While a live scrub is in flight, the UI shows the PREVIEW fraction (finger position) and the
	// audio is NOT seeked until release — so playback never stutters mid-drag. displayFrac is what
	// the rail + time readout render; it falls back to the real playback frac when not scrubbing.
	let scrubbing = $state(false);
	let scrubFrac = $state(0);
	const displayFrac = $derived(scrubbing ? scrubFrac : frac);
	const displayTime = $derived(
		scrubbing && player.duration > 0 ? scrubFrac * player.duration : player.currentTime
	);
	function onScrubPreview(f: number) {
		scrubFrac = f;
		scrubbing = true;
	}
	function onScrubCommit(f: number) {
		player.seekFraction(f); // clamps [0,1] internally; auto-plays if paused (same as tap-to-seek)
	}
	function onScrubEnd() {
		scrubbing = false;
	}
	// Keyboard parity retained: arrows nudge ±5s via the store (unchanged behaviour).
	function seekKey(e: KeyboardEvent) {
		if (player.duration <= 0) return;
		if (e.key === 'ArrowRight') player.seekFraction((player.currentTime + 5) / player.duration);
		else if (e.key === 'ArrowLeft') player.seekFraction((player.currentTime - 5) / player.duration);
	}
```

**Delete** the old `function seek(e: MouseEvent) { … }` (lines 134-138) — replaced by the action.

**Add** the import (with the other action imports near line 42):
```ts
	import { scrub } from '$lib/actions/scrub';
```

---

## Part C — NowPlaying.svelte markup (replace the `.prog` block, lines 1276-1285)

```svelte
	<div class="prog">
		<div
			class="scrubber"
			class:scrubbing
			style:--scrub-frac={displayFrac}
			role="slider"
			tabindex="0"
			aria-label={t('nowplaying.seek')}
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={Math.round(displayFrac * 100)}
			onkeydown={seekKey}
			use:scrub={{ onSeek: onScrubCommit, onPreview: onScrubPreview, onScrubEnd }}
		>
			<div class="scrub-fill"></div>
			<div class="scrub-knob"></div>
		</div>
		<div class="times">
			<span>{fmtTime(displayTime)}</span>
			<span>{player.duration > 0 ? fmtTime(player.duration) : '--:--'}</span>
		</div>
	</div>
```

## Part D — NowPlaying.svelte CSS trim (lines 1596-1601)

Remove the now-dead local `.track`/`.track::before`/`.fill`/`.knob` rules (the `.scrubber` global
in plan 001 replaces them). KEEP `.prog` and `.times`, and add `tabular-nums` to `.times` (this is
also plan 006's fix — apply it here):

```css
	.prog { margin: 4px 0; }
	.times { display: flex; justify-content: space-between; font-size: 11px; color: var(--color-text-muted); margin-top: 4px; font-variant-numeric: tabular-nums; }
```

## Invariants preserved
- `player.seekFraction` remains the sole seek API (one commit on release/tap).
- Keyboard slider semantics + `aria-valuenow` intact (now reflect the live preview).
- `stopPropagation` on pointerdown keeps the `.np-top` collapse gesture from firing during a scrub.
- Reduce-motion handled by the `.scrubber` global media block (plan 001).

## Verification
`pnpm check`. In the running app: press-and-hold the bar and drag — knob grows, fill + time follow
the finger 1:1, audio jumps only on release; a single tap still seeks; keyboard arrows still nudge.
