<script lang="ts">
	// Workstream F / brief §2.3 Skin A — Square Pads: the Tap-Along deck geometry,
	// extracted from NpGame into its own renderer (brief §2.2 skin contract). Stateless:
	// lane state + raw down/up callbacks arrive as props; judgment, sound and score stay
	// in the caller/core. Fixed geometry (NO STRETCH): 2×2 grid, pad height fixed.
	import { tapBounce } from '$lib/actions/tapBounce';
	import { PAD_LABEL } from '$lib/services/songbeat-skins';
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

<div class="deck" role="group" aria-label={groupLabel}>
	{#each pads as pad (pad)}
		{@const lane = laneOf(pad)}
		{@const next = nextNote(lane)}
		{@const pop = pops[lane]}
		{@const fl = flash[lane]}
		<button
			type="button"
			class="pad"
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
			<span class="pad-label">{PAD_LABEL[pad]}</span>
			{#if pop}
				{#key pop.seq}<span class="pop {pop.cls}">{pop.text}{#if pop.hint}<small>{pop.hint}</small>{/if}</span>{/key}
			{/if}
		</button>
	{/each}
</div>

<style>
	.deck { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
	.pad { position: relative; height: 104px; border-radius: 14px; border: 1px solid var(--color-border, rgba(255,255,255,0.14)); background: var(--color-surface-2); color: var(--color-text); overflow: visible; touch-action: none; cursor: pointer; }
	.pad:active { background: var(--color-surface-3, var(--color-surface-2)); }
	.pad-label { position: relative; z-index: 2; font-size: 13px; font-weight: 800; letter-spacing: 0.14em; }
	.note-shape { position: absolute; inset: 6px; border: 2px solid var(--color-accent, #00c2b8); border-radius: 10px; pointer-events: none; z-index: 1; }
	.holdclip { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; pointer-events: none; z-index: 0; }
	.holdfill { position: absolute; left: 0; right: 0; bottom: 0; background: var(--color-accent, #00c2b8); opacity: 0.35; pointer-events: none; }
	.flash-perfect { border-color: var(--color-accent, #00c2b8); box-shadow: 0 0 0 2px var(--color-accent, #00c2b8) inset; }
	.flash-great { border-color: var(--color-accent, #00c2b8); }
	.flash-good { border-color: var(--color-text-muted); }
	.flash-miss { border-color: #e5484d; }
	.pop { position: absolute; left: 50%; top: 8px; transform: translateX(-50%); z-index: 3; font-size: 15px; font-weight: 900; letter-spacing: 0.06em; pointer-events: none; animation: popfade 0.7s ease-out forwards; white-space: nowrap; }
	.pop small { display: block; text-align: center; font-size: 10px; font-weight: 600; color: var(--color-text-muted); }
	.pop.perfect { color: var(--color-accent, #00c2b8); }
	.pop.great { color: var(--color-text); }
	.pop.good { color: var(--color-text-muted); }
	.pop.miss { color: #e5484d; }
	@keyframes popfade { 0% { opacity: 0; transform: translateX(-50%) translateY(4px); } 15% { opacity: 1; transform: translateX(-50%) translateY(0); } 70% { opacity: 1; } 100% { opacity: 0; } }
</style>
