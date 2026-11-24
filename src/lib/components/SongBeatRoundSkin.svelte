<script lang="ts">
	// Workstream F / brief §2.3 Skin B — Round Pads (songbeat-skin-round): same 2×2 layout
	// and identical mechanic as Square, circular pads with circular approach rings — the
	// Cytus-circle feel. Stateless renderer under the §2.2 contract: identical props and
	// raw callbacks as the Square skin, so judgment outcomes are skin-independent.
	// Fixed geometry (NO STRETCH): every pad is a fixed 112×112 circle, centred in its
	// grid cell; content (label / pop) never resizes it.
	import { tapBounce } from '$lib/actions/tapBounce';
	import { PAD_LABEL } from '$lib/services/songbeat-skins';
	// Workstream H: pads render the SHARED icon glyph (SongBeatPadIcon) — the word
	// survives only as aria-label below (Icon Status Mapping, Hector 2026-11-23).
	import SongBeatPadIcon from '$lib/components/SongBeatPadIcon.svelte';
	import { growOut } from '$lib/services/songbeat';
	import type { Judgment } from '$lib/services/songbeat';
	import type { PadId } from '$lib/services/tapalong';

	let { pads, laneOf, nextNote, approachSec, pops, flash, onPadDown, onPadUp, groupLabel }: {
		pads: PadId[];
		laneOf: (pad: PadId) => number;
		nextNote: (lane: number) => { progress: number; hold: boolean; signedDt: number; holdProgress: number } | null;
		approachSec: number;
		pops: Record<number, { text: string; cls: string; hint: string; seq: number }>;
		flash: Record<number, { j: Judgment | 'ghost'; seq: number }>;
		onPadDown: (lane: number, e: PointerEvent) => void;
		onPadUp: (lane: number) => void;
		groupLabel: string;
	} = $props();
</script>

<div class="deck deck-round" role="group" aria-label={groupLabel}>
	{#each pads as pad (pad)}
		{@const lane = laneOf(pad)}
		{@const next = nextNote(lane)}
		{@const pop = pops[lane]}
		{@const fl = flash[lane]}
		<button
			type="button"
			class="pad pad-round"
			class:flash-perfect={fl?.j === 'perfect'}
			class:flash-great={fl?.j === 'great'}
			class:flash-good={fl?.j === 'good'}
			class:flash-miss={fl?.j === 'miss'}
			aria-label={PAD_LABEL[pad]}
			onpointerdown={(e) => onPadDown(lane, e)}
			onpointerup={() => onPadUp(lane)}
			onpointercancel={() => onPadUp(lane)}
			use:tapBounce
		>
			{#if next && !next.hold}
				{@const g = growOut(next.signedDt, approachSec)}
				<span class="note-shape" style:transform={`scale(${Math.max(0, g.scale)})`} style:opacity={next.signedDt <= 0 ? 0.3 + 0.7 * next.progress : 1}></span>
			{/if}
			{#if next?.hold}
				<span class="holdclip"><span class="holdfill" style:height={`${next.holdProgress * 100}%`}></span></span>
			{/if}
			<SongBeatPadIcon {pad} />
			{#if pop}
				{#key pop.seq}<span class="pop {pop.cls}">{pop.text}{#if pop.hint}<small>{pop.hint}</small>{/if}</span>{/key}
			{/if}
		</button>
	{/each}
</div>

<style>
	.deck { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; justify-items: center; }
	.pad { position: relative; width: 112px; height: 112px; max-width: 100%; aspect-ratio: 1; display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--color-border, rgba(255,255,255,0.14)); background: var(--color-surface-2); color: var(--color-text); overflow: visible; touch-action: none; cursor: pointer; }
	.pad:active { background: var(--color-surface-3, var(--color-surface-2)); }
	.note-shape { position: absolute; inset: 6px; border: 2px solid var(--color-accent, #00c2b8); border-radius: 50%; pointer-events: none; z-index: 1; }
	.holdclip { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; pointer-events: none; z-index: 0; }
	.holdfill { position: absolute; left: 0; right: 0; bottom: 0; background: var(--color-accent, #00c2b8); opacity: 0.35; pointer-events: none; }
	.flash-perfect { border-color: var(--color-accent, #00c2b8); box-shadow: 0 0 0 2px var(--color-accent, #00c2b8) inset; }
	.flash-great { border-color: var(--color-accent, #00c2b8); }
	.flash-good { border-color: var(--color-text-muted); }
	.flash-miss { border-color: #e5484d; }
	.pop { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); z-index: 3; font-size: 15px; font-weight: 900; letter-spacing: 0.06em; pointer-events: none; animation: popfade 0.7s ease-out forwards; white-space: nowrap; }
	.pop small { display: block; text-align: center; font-size: 10px; font-weight: 600; color: var(--color-text-muted); }
	.pop.perfect { color: var(--color-accent, #00c2b8); }
	.pop.great { color: var(--color-text); }
	.pop.good { color: var(--color-text-muted); }
	.pop.miss { color: #e5484d; }
	@keyframes popfade { 0% { opacity: 0; transform: translateX(-50%) translateY(4px); } 15% { opacity: 1; transform: translateX(-50%) translateY(0); } 70% { opacity: 1; } 100% { opacity: 0; } }
</style>
