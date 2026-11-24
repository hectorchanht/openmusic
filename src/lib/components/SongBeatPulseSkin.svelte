<script lang="ts">
	// Workstream F / Skin E — Pulse: ONE pulsing heart instead of four pads.
	// The read is singular: whichever lane's note is due next owns the stage —
	// its ring grows out inside the fixed stage circle and its instrument icon
	// sits at the centre; the player answers on the four slim lane buttons
	// below, which keep the pad contract exactly (raw down/up per lane, pops
	// and flashes per lane). Stateless renderer (brief §2.2): lane state +
	// callbacks arrive as props; the core judges, sounds and scores.
	//
	// GROW-OUT skeleton (Hector 2026-11-23 22:09): the stage circle's border IS
	// the perfect line. The next note's ring starts as a point at the centre,
	// grows outward, aligns with the stage border at PERFECT, and keeps growing
	// past it when late — inside travel equals outside travel by construction
	// (growOut scale 0 → 1 → 2 across the symmetric window). A hold fills the
	// stage circle from the bottom while it is held (the pad skins' fill,
	// clipped to the circle).
	// Fixed geometry (NO STRETCH): the stage is a 200px circle, buttons 64px.
	//
	// Workstream H (Icon Status Mapping): instruments are the shared
	// SongBeatPadIcon glyphs; words survive only as aria-labels (PAD_LABEL).
	import { tapBounce } from '$lib/actions/tapBounce';
	import { PAD_LABEL } from '$lib/services/songbeat-skins';
	import { growOut, type Judgment } from '$lib/services/songbeat';
	import type { PadId } from '$lib/services/tapalong';
	import SongBeatPadIcon from '$lib/components/SongBeatPadIcon.svelte';

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

	// The stage's note: the soonest obligation across the four lanes — a hold in
	// progress first (it owns the player's hand), else the pending note closest
	// to its hit moment. Derived per frame from the same nextNote() the pads use.
	const stage = $derived.by(() => {
		let best: { pad: PadId; lane: number; progress: number; hold: boolean; signedDt: number; holdProgress: number } | null = null;
		for (const pad of pads) {
			const lane = laneOf(pad);
			const n = nextNote(lane);
			if (!n) continue;
			if (!best || (n.hold && !best.hold) || (n.hold === best.hold && n.signedDt > best.signedDt)) {
				best = { pad, lane, ...n };
			}
		}
		return best;
	});
	const stageFlash = $derived(stage ? flash[stage.lane] : undefined);
	const stageGrow = $derived(stage && !stage.hold ? growOut(stage.signedDt, approachSec) : null);
</script>

<div class="pulse-wrap" role="group" aria-label={groupLabel}>
	<div
		class="pulse-stage"
		class:flash-perfect={stageFlash?.j === 'perfect'}
		class:flash-great={stageFlash?.j === 'great'}
		class:flash-good={stageFlash?.j === 'good'}
		class:flash-miss={stageFlash?.j === 'miss'}
		aria-hidden="true"
	>
		{#if stage?.hold}
			<span class="holdclip"><span class="holdfill" style:height={`${stage.holdProgress * 100}%`}></span></span>
		{/if}
		{#if stageGrow && stage}
			<span class="pulse-ring" style:transform={`scale(${Math.max(0, stageGrow.scale)})`} style:opacity={stage.signedDt <= 0 ? 0.3 + 0.7 * stage.progress : 1}></span>
		{/if}
		{#if stage}
			<span class="stage-icon"><SongBeatPadIcon pad={stage.pad} size={44} /></span>
		{/if}
	</div>
	<div class="pulse-lanes">
		{#each pads as pad (pad)}
			{@const lane = laneOf(pad)}
			{@const pop = pops[lane]}
			{@const fl = flash[lane]}
			<button
				type="button"
				class="pulse-lane"
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
				<SongBeatPadIcon {pad} size={28} />
				{#if pop}
					{#key pop.seq}<span class="pop {pop.cls}">{pop.text}{#if pop.hint}<small>{pop.hint}</small>{/if}</span>{/key}
				{/if}
			</button>
		{/each}
	</div>
</div>

<style>
	.pulse-wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; }
	/* The stage: a fixed 200px circle; its border is the perfect line. overflow
	   visible so a late ring can grow PAST the border (grow-out overshoot). */
	.pulse-stage { position: relative; width: 200px; height: 200px; border-radius: 50%; border: 2px solid var(--color-border, rgba(255,255,255,0.14)); background: var(--color-surface-2); overflow: visible; }
	.pulse-ring { position: absolute; inset: 10px; border: 2px solid var(--color-accent, #00c2b8); border-radius: 50%; pointer-events: none; }
	.stage-icon { position: absolute; inset: 0; display: grid; place-items: center; color: var(--color-text); pointer-events: none; }
	.holdclip { position: absolute; inset: 0; overflow: hidden; border-radius: 50%; pointer-events: none; }
	.holdfill { position: absolute; left: 0; right: 0; bottom: 0; background: var(--color-accent, #00c2b8); opacity: 0.35; pointer-events: none; }
	.pulse-lanes { display: flex; gap: 10px; width: 100%; }
	.pulse-lane { position: relative; flex: 1 1 0; min-width: 0; height: 64px; display: grid; place-items: center; border-radius: 12px; border: 1px solid var(--color-border, rgba(255,255,255,0.14)); background: var(--color-surface-2); color: var(--color-text); cursor: pointer; touch-action: none; }
	.pulse-lane:active { background: var(--color-surface-3, var(--color-surface-2)); }
	.flash-perfect { border-color: var(--color-accent, #00c2b8); box-shadow: 0 0 0 2px var(--color-accent, #00c2b8) inset; }
	.flash-great { border-color: var(--color-accent, #00c2b8); }
	.flash-good { border-color: var(--color-text-muted); }
	.flash-miss { border-color: #e5484d; }
	.pop { position: absolute; left: 50%; top: 4px; transform: translateX(-50%); z-index: 3; font-size: 13px; font-weight: 900; letter-spacing: 0.06em; pointer-events: none; animation: popfade 0.7s ease-out forwards; white-space: nowrap; }
	.pop small { display: block; text-align: center; font-size: 10px; font-weight: 600; color: var(--color-text-muted); }
	.pop.perfect { color: var(--color-accent, #00c2b8); }
	.pop.great { color: var(--color-text); }
	.pop.good { color: var(--color-text-muted); }
	.pop.miss { color: #e5484d; }
	@keyframes popfade { 0% { opacity: 0; transform: translateX(-50%) translateY(4px); } 15% { opacity: 1; transform: translateX(-50%) translateY(0); } 70% { opacity: 1; } 100% { opacity: 0; } }
</style>
