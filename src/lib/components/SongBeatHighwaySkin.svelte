<script lang="ts">
	// Workstream F / brief §2.3 Skin C — Highway: four falling lanes over a judge
	// line. Stateless renderer (brief §2.2): the visible-note set + raw down/up
	// callbacks arrive as props; timing, judgment, sound and score stay in the
	// caller/core.
	//
	// GROW-OUT geometry (Hector 2026-11-23 22:09 — the shared skeleton, skins never
	// change it): the judge line sits at the field's CENTRE and IS the border /
	// perfect line. A note's centre is placed by growOut() alone — distance above
	// the line while approaching EQUALS distance below it after the hit moment
	// (offset −1 → +1 maps to the field's full height symmetrically). The hit
	// target box drawn on the line is what the note aligns with at PERFECT.
	// Fixed geometry (NO STRETCH): field height and note height are constants.
	//
	// Workstream H (Icon Status Mapping): the lane's instrument is its ICON —
	// the shared SongBeatPadIcon glyph at the lane's foot; the instrument word
	// survives only as the lane button's aria-label (PAD_LABEL).
	import { tapBounce } from '$lib/actions/tapBounce';
	import { PAD_LABEL } from '$lib/services/songbeat-skins';
	import { growOut, lanePad, type Judgment, type VisibleNote } from '$lib/services/songbeat';
	import SongBeatPadIcon from '$lib/components/SongBeatPadIcon.svelte';

	/** Half the field height: the judge line's distance from either edge — the
	 *  inside travel and the outside travel are this same 140px, by construction. */
	const HALF = 140;
	const NOTE_H = 18;

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

<div class="field" role="group" aria-label={groupLabel}>
	<div class="judge-line" aria-hidden="true"></div>
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
				<span class="lane-target" aria-hidden="true"></span>
				<span class="lane-icon"><SongBeatPadIcon pad={lanePad(lane)} size={26} /></span>
				{#if pop}
					{#key pop.seq}<span class="pop {pop.cls}">{pop.text}{#if pop.hint}<small>{pop.hint}</small>{/if}</span>{/key}
				{/if}
			</button>
			{#each notes.filter((n) => n.lane === lane) as n (n.index)}
				{@const g = growOut(n.signedDt, approachSec)}
				{@const y = HALF * (1 + g.offset)}
				{#if n.type === 'hold'}
					<!-- The trail spans tail→head on the same growOut scale: its length is
					     dur/window × HALF, and it drains through the line as the hold runs. -->
					{@const tailY = HALF * (1 + g.offset - n.dur / Math.max(0.1, approachSec))}
					<span class="trail" class:holding={n.holding} style:top={`${tailY}px`} style:height={`${Math.max(0, y - tailY)}px`}></span>
				{/if}
				<span class="note" class:holding={n.holding} style:top={`${y - NOTE_H / 2}px`}></span>
			{/each}
		</div>
	{/each}
</div>

<style>
	.field { position: relative; display: flex; height: 280px; border: 1px solid var(--color-border, rgba(255,255,255,0.14)); border-radius: 14px; background: var(--color-surface-2); overflow: hidden; }
	.judge-line { position: absolute; left: 0; right: 0; top: 140px; height: 0; border-top: 2px solid var(--color-accent, #00c2b8); opacity: 0.85; z-index: 2; pointer-events: none; }
	.lane { position: relative; flex: 1 1 0; min-width: 0; }
	.lane + .lane { border-inline-start: 1px solid var(--color-border, rgba(255,255,255,0.14)); }
	.lane-hit { position: absolute; inset: 0; width: 100%; border: 0; background: transparent; color: var(--color-text); cursor: pointer; touch-action: none; }
	.lane-hit:active { background: var(--color-surface-3, rgba(255,255,255,0.05)); }
	.lane-target { position: absolute; left: 6px; right: 6px; top: 131px; height: 18px; border: 1px dashed var(--color-border, rgba(255,255,255,0.14)); border-radius: 6px; pointer-events: none; }
	.lane-icon { position: absolute; left: 0; right: 0; bottom: 8px; display: grid; place-items: center; color: var(--color-text-muted); pointer-events: none; }
	.note { position: absolute; left: 6px; right: 6px; height: 18px; border-radius: 6px; border: 2px solid var(--color-accent, #00c2b8); background: color-mix(in srgb, var(--color-accent, #00c2b8) 30%, transparent); pointer-events: none; z-index: 1; }
	.note.holding { background: var(--color-accent, #00c2b8); }
	.trail { position: absolute; left: 50%; width: 6px; transform: translateX(-50%); border-radius: 3px; background: var(--color-accent, #00c2b8); opacity: 0.4; pointer-events: none; z-index: 0; }
	.trail.holding { opacity: 0.75; }
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
