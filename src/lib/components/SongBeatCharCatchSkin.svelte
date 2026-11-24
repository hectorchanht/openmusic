<script lang="ts">
	// Workstream F / Skin D — 接字 Character-Catch (addendum-character-catch.md).
	// The lyric characters themselves rain down the four lanes, exactly as sung;
	// the player catches each TARGET character by tapping its lane as the glyph
	// crosses the judge line. Stateless renderer (brief §2.2): the visible-char
	// set + raw down/up callbacks arrive as props — the core judges, sounds and
	// scores through the derived note chart, identically to every other skin.
	//
	// GROW-OUT skeleton (Hector 2026-11-23 22:09): the judge line is the field's
	// centre border; a character's centre is placed by growOut() alone, so the
	// fall inside the line mirrors the fall outside it. A target's approach ring
	// grows INSIDE its cell and aligns with the cell border at PERFECT — the
	// Square skin's cue language, so skills transfer (addendum §4).
	//
	// Typography is the game piece (addendum §4): every character — 漢字, kana or
	// Latin — renders in the SAME fixed square cell at the same size (NO STRETCH:
	// the cell never sizes to its glyph). Targets are full-brightness with the
	// accent ring; stream characters are muted and pass through unjudged; a
	// missed target dims and falls through grey.
	//
	// Workstream H (Icon Status Mapping): the lane's instrument is the shared
	// SongBeatPadIcon glyph at the lane's foot; its word is aria-label only.
	import { tapBounce } from '$lib/actions/tapBounce';
	import { PAD_LABEL } from '$lib/services/songbeat-skins';
	import { growOut, lanePad, type Judgment, type VisibleChar } from '$lib/services/songbeat';
	import SongBeatPadIcon from '$lib/components/SongBeatPadIcon.svelte';

	/** Half the field height — the judge line's distance from either edge; the
	 *  inside and outside travel are this same 140px by construction. */
	const HALF = 140;
	/** The fixed square cell (addendum §4): identical for every glyph, forever. */
	const CELL = 40;

	let { chars, lanes, approachSec, pops, flash, onPadDown, onPadUp, groupLabel }: {
		chars: VisibleChar[];
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
			{#each chars.filter((c) => c.lane === lane) as c (c.index)}
				{@const g = growOut(c.signedDt, approachSec)}
				{@const y = HALF * (1 + g.offset)}
				<span
					class="cell"
					class:target={c.target}
					class:stream={!c.target}
					class:caught={c.state === 'hit'}
					class:missed={c.state === 'missed'}
					style:top={`${y - CELL / 2}px`}
					aria-hidden="true"
				>
					{#if c.target && c.state === 'pending'}
						<span class="ring" style:transform={`scale(${Math.max(0, g.scale)})`}></span>
					{/if}
					<span class="glyph">{c.ch}</span>
				</span>
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
	.lane-target { position: absolute; left: 50%; transform: translateX(-50%); top: 120px; width: 40px; height: 40px; border: 1px dashed var(--color-border, rgba(255,255,255,0.14)); border-radius: 8px; pointer-events: none; }
	.lane-icon { position: absolute; left: 0; right: 0; bottom: 8px; display: grid; place-items: center; color: var(--color-text-muted); pointer-events: none; }
	/* The fixed cell: 40×40 for every glyph — a wide Latin letter and a 漢字 get
	   the same box, the same font size, the same fall (addendum §4, NO STRETCH). */
	.cell { position: absolute; left: 50%; margin-left: -20px; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 8px; pointer-events: none; z-index: 1; overflow: visible; }
	.cell .glyph { font-size: 20px; font-weight: 700; line-height: 1; }
	.cell.target { border: 1px solid var(--color-border, rgba(255,255,255,0.14)); background: var(--color-surface-2); color: var(--color-text); }
	.cell.stream { color: var(--color-text-muted); opacity: 0.55; }
	.cell.caught { background: var(--color-accent, #00c2b8); color: #04211f; border-color: var(--color-accent, #00c2b8); }
	.cell.missed { color: var(--color-text-muted); opacity: 0.4; filter: grayscale(1); }
	/* The approach ring: grows inside the cell on the growOut scale; at scale 1 it
	   IS the cell border — the border is the perfect line, in miniature. */
	.ring { position: absolute; inset: 0; border: 2px solid var(--color-accent, #00c2b8); border-radius: 8px; pointer-events: none; }
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
