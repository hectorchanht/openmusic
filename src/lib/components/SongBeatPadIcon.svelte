<script lang="ts">
	// Workstream H (Hector 2026-11-23 22:07, GOLD Icon Status Mapping / One-Look-Knows):
	// the SHARED Song Beat pad glyph — ONE component for every pad-style skin (Square,
	// Round, and every future pad skin from workstream F inherits this), so an instrument
	// is recognised from its ICON alone mid-game, never from a word. The instrument name
	// survives ONLY as the pad button's aria-label (PAD_LABEL in songbeat-skins.ts).
	// Glyph choices (one distinct silhouette per instrument, @lucide/svelte first):
	//   snare  → Lucide Drum (a drum with sticks — the snare's own silhouette)
	//   pluck  → Lucide Guitar (plucked strings)
	//   kick   → custom SVG bass-drum head (big circle + centre beater dot + pedal),
	//            Lucide has no bass/kick drum glyph
	//   shaker → custom SVG maraca (tilted egg + handle + rattle dots),
	//            Lucide has no shaker/maraca glyph
	// Custom glyphs follow the Lucide stroke style exactly: 24×24 viewBox, stroke
	// currentColor, stroke-width 2, round caps/joins, no fill (rattle dots excepted —
	// they are the shaker's pellets, drawn as small filled circles like Lucide's dots).
	import { Drum, Guitar } from '@lucide/svelte';
	import type { PadId } from '$lib/services/tapalong';

	let { pad, size = 36 }: { pad: PadId; size?: number } = $props();
</script>

<!-- data-pad-icon={pad} is the machine-readable glyph identity: the regression pin
     (songbeat-pad-icons.test.ts) asserts the four identities are pairwise distinct. -->
<span class="pad-icon" data-pad-icon={pad} aria-hidden="true">
	{#if pad === 'snare'}
		<Drum {size} aria-hidden="true" />
	{:else if pad === 'pluck'}
		<Guitar {size} aria-hidden="true" />
	{:else if pad === 'kick'}
		<!-- Bass drum: front head + centre beater mark + pedal foot below. -->
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="12" cy="10" r="7" />
			<circle cx="12" cy="10" r="1.6" fill="currentColor" stroke="none" />
			<path d="M12 17v2.2" />
			<path d="M8.5 21.5h7" />
		</svg>
	{:else if pad === 'shaker'}
		<!-- Shaker / maraca: tilted rattle egg, handle, pellet dots inside. -->
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<g transform="rotate(24 12 12)">
				<ellipse cx="12" cy="9" rx="5" ry="6.5" />
				<path d="M12 15.5V21" />
				<circle cx="10.2" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
				<circle cx="13.8" cy="9.5" r="0.6" fill="currentColor" stroke="none" />
				<circle cx="11.5" cy="11" r="0.6" fill="currentColor" stroke="none" />
			</g>
		</svg>
	{/if}
</span>

<style>
	/* Fixed-size inline box (NO STRETCH): the glyph never resizes its pad — the pad
	   geometry lives in the skin; this span only centres the icon inside it. */
	.pad-icon { position: relative; z-index: 2; display: inline-grid; place-items: center; line-height: 0; pointer-events: none; }
</style>
