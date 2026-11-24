<script lang="ts">
	// Workstream F / Skin F — Rain: the notes fall as rain. Four open lanes with
	// no hard grid — slim droplet notes with a short fall streak, a soft surface
	// line to land on, and a fixed puddle target in each lane where the drop
	// must land. Stateless renderer (brief §2.2): the visible-note set + raw
	// down/up callbacks arrive as props; the core judges, sounds and scores.
	//
	// GROW-OUT skeleton (Hector 2026-11-23 22:09 — shared by every skin): the
	// surface line sits at the field's CENTRE and IS the border / perfect line.
	// A drop's centre is placed by growOut() alone — the fall above the line
	// mirrors the fall below it exactly; the puddle is what the drop aligns
	// with at PERFECT. Holds fall as one long streak (tail→head on the same
	// scale), draining through the line as the hold runs.
	// Fixed geometry (NO STRETCH): 280px field, 22px drops, 44×14px puddles.
	//
	// Workstream H (Icon Status Mapping): the lane's instrument is the shared
	// SongBeatPadIcon glyph at the lane's foot; its word is aria-label only.
	import { tapBounce } from '$lib/actions/tapBounce';
	import { PAD_LABEL } from '$lib/services/songbeat-skins';
	import { growOut, lanePad, type Judgment, type VisibleNote } from '$lib/services/songbeat';
	import SongBeatPadIcon from '$lib/components/SongBeatPadIcon.svelte';

	/** Half the field height — the surface line's distance from either edge;
	 *  the inside and outside travel are this same 140px by construction. */
	const HALF = 140;
	const DROP = 22;

	let { notes, lanes, approachSec, pops, flash, onPadDown, onPadUp, groupLabel }: {
		notes: VisibleNote[];
		/** Lane indices in display order (mirror-aware, resolved by the caller). */
		lanes: number[];
		approachSec: number;
		pops: Record<number, { text: string; cls: string; hint: string; seq: number }>;
		flash: Record<number, { j: Judgment | 'ghost'; seq: number }>;
		onPadDown: (lane: number, e: PointerEvent) => void;
		onPadUp: (lane: number) => void;
		groupLabel: string;
	} = $props();
</script>

<div class="rain-field" role="group" aria-label={groupLabel}>
	<div class="surface-line" aria-hidden="true"></div>
	{#each lanes as lane (lane)}
		{@const pop = pops[lane]}
		{@const fl = flash[lane]}
		<div class="lane">
			<button
				type="button"
				class="lane-hit"
				class:flash-perfect={fl?.j === 'perfect'}
				class:flash-great={fl?.j === 'great'}
				class:flash-good={fl?.j === 'good'}
				class:flash-miss={fl?.j === 'miss'}
				aria-label={PAD_LABEL[lanePad(lane)]}
				onpointerdown={(e) => onPadDown(lane, e)}
				onpointerup={() => onPadUp(lane)}
				onpointercancel={() => onPadUp(lane)}
				use:tapBounce
			>
				<span class="puddle" aria-hidden="true"></span>
				<span class="lane-icon"><SongBeatPadIcon pad={lanePad(lane)} size={26} /></span>
				{#if pop}
					{#key pop.seq}<span class="pop {pop.cls}">{pop.text}{#if pop.hint}<small>{pop.hint}</small>{/if}</span>{/key}
				{/if}
			</button>
			{#each notes.filter((n) => n.lane === lane) as n (n.index)}
				{@const g = growOut(n.signedDt, approachSec)}
				{@const y = HALF * (1 + g.offset)}
				{#if n.type === 'hold'}
					<!-- A hold is one long streak of rain: tail→head on the growOut
					     scale, draining through the surface line as it is held. -->
					{@const tailY = HALF * (1 + g.offset - n.dur / Math.max(0.1, approachSec))}
					<span class="streak" class:holding={n.holding} style:top={`${tailY}px`} style:height={`${Math.max(0, y - tailY)}px`}></span>
				{:else}
					<span class="fall-streak" style:top={`${y - DROP / 2 - 24}px`}></span>
				{/if}
				<span class="drop" class:holding={n.holding} style:top={`${y - DROP / 2}px`}></span>
			{/each}
		</div>
	{/each}
</div>

<style>
	.rain-field { position: relative; display: flex; height: 280px; border-radius: 14px; background: var(--color-surface-2); overflow: hidden; }
	.surface-line { position: absolute; left: 0; right: 0; top: 140px; height: 0; border-top: 2px solid var(--color-accent, #00c2b8); opacity: 0.7; z-index: 2; pointer-events: none; }
	.lane { position: relative; flex: 1 1 0; min-width: 0; }
	.lane + .lane { border-inline-start: 1px dotted var(--color-border, rgba(255,255,255,0.14)); }
	.lane-hit { position: absolute; inset: 0; width: 100%; border: 0; background: transparent; color: var(--color-text); cursor: pointer; touch-action: none; }
	.lane-hit:active { background: var(--color-surface-3, rgba(255,255,255,0.05)); }
	/* The puddle: the drop's landing target on the surface line (44×14 fixed). */
	.puddle { position: absolute; left: 50%; transform: translateX(-50%); top: 133px; width: 44px; height: 14px; border: 1px solid var(--color-border, rgba(255,255,255,0.14)); border-radius: 50%; pointer-events: none; }
	.lane-icon { position: absolute; left: 0; right: 0; bottom: 8px; display: grid; place-items: center; color: var(--color-text-muted); pointer-events: none; }
	/* The drop: a fixed 22px droplet — same size for every note, forever. */
	.drop { position: absolute; left: 50%; margin-left: -11px; width: 22px; height: 22px; border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%; background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--color-accent, #00c2b8) 55%, white), var(--color-accent, #00c2b8) 65%); pointer-events: none; z-index: 1; }
	.drop.holding { outline: 2px solid var(--color-accent, #00c2b8); outline-offset: 2px; }
	.fall-streak { position: absolute; left: 50%; margin-left: -0.5px; width: 1px; height: 24px; background: linear-gradient(to top, var(--color-accent, #00c2b8), transparent); opacity: 0.5; pointer-events: none; z-index: 0; }
	.streak { position: absolute; left: 50%; width: 4px; transform: translateX(-50%); border-radius: 2px; background: linear-gradient(to bottom, transparent, var(--color-accent, #00c2b8)); opacity: 0.55; pointer-events: none; z-index: 0; }
	.streak.holding { opacity: 0.85; }
	.flash-perfect { background: color-mix(in srgb, var(--color-accent, #00c2b8) 18%, transparent); }
	.flash-great { background: color-mix(in srgb, var(--color-accent, #00c2b8) 10%, transparent); }
	.flash-good { background: rgba(255,255,255,0.05); }
	.flash-miss { background: rgba(229,72,77,0.14); }
	.pop { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); z-index: 3; font-size: 14px; font-weight: 900; letter-spacing: 0.06em; pointer-events: none; animation: popfade 0.7s ease-out forwards; white-space: nowrap; }
	.pop small { display: block; text-align: center; font-size: 10px; font-weight: 600; color: var(--color-text-muted); }
	.pop.perfect { color: var(--color-accent, #00c2b8); }
	.pop.great { color: var(--color-text); }
	.pop.good { color: var(--color-text-muted); }
	.pop.miss { color: #e5484d; }
	@keyframes popfade { 0% { opacity: 0; transform: translateX(-50%) translateY(4px); } 15% { opacity: 1; transform: translateX(-50%) translateY(0); } 70% { opacity: 1; } 100% { opacity: 0; } }
</style>
