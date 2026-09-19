<script lang="ts">
	// quick-260919-ebi — the ONE settings description disclosure.
	//
	// Settings pages carried a full explanatory paragraph under every control. Once each visual
	// setting also grew a live preview, the page was a wall: label, preview, paragraph, repeat.
	// The explanation is still worth having, it just should not be on screen by default.
	//
	// WHY NOT A HOVER TOOLTIP: this app is mobile-first (iOS Safari + Android Chrome are the
	// primary targets) and hover does not exist on touch. A hover-only tooltip would put the
	// explanation permanently out of reach on the device most people use. So the (i) button is a
	// real toggle — TAP works everywhere — and hover/focus is layered on top as a convenience for
	// pointer devices only, behind `@media (hover: hover)`.
	//
	// WHY AN INLINE REVEAL, NOT A FLOATING BUBBLE: a positioned overlay needs collision math and
	// clips inside scrolling sections on a narrow screen. Pushing the line into flow always fits,
	// never clips, and reads the same on a phone and a desktop.
	//
	// SCREEN READERS ALWAYS REACH THE TEXT. The description is in the DOM at all times; collapsed
	// it is visually hidden by CLIPPING, never `display: none` / `visibility: hidden` / `hidden`,
	// any of which would take it out of the accessibility tree. aria-expanded + aria-controls tie
	// the button to it for users who want the visual state too.
	import { Info } from '@lucide/svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';

	let {
		text,
		label
	}: {
		text: string;
		/** The setting's own label. Makes each (i) button's accessible name unique on a page that
		 *  has several of them — otherwise a screen-reader user hears "About this setting" ×6. */
		label?: string;
	} = $props();

	const id = $props.id();
	let open = $state(false);
</script>

<span class="hint">
	<button
		class="info"
		type="button"
		aria-expanded={open}
		aria-controls={id}
		aria-label={label ? `${label}: ${t('settings.aboutSetting')}` : t('settings.aboutSetting')}
		onclick={() => (open = !open)}
		use:tapBounce
	>
		<Info size={14} />
	</button>
	<span class="desc" class:open {id}>{text}</span>
</span>

<style>
	.hint {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin-top: 8px;
		/* Positioned so the COLLAPSED (absolutely-positioned, clipped) description resolves against
		   this row rather than the page — an unpositioned .sr-only node can land outside the
		   viewport and add a stray scrollbar on a narrow screen. */
		position: relative;
	}
	.info {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		display: grid;
		place-items: center;
		/* 28px keeps the tap target usable on a phone without looking like a button. */
		width: 28px;
		height: 28px;
		margin: -6px 0 0 -6px;
		border-radius: 999px;
		flex: none;
	}
	.info:hover,
	.info[aria-expanded='true'] {
		color: var(--color-text);
	}
	/* COLLAPSED: clipped, NOT removed. Still in the accessibility tree, still read in order. */
	.desc {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		color: var(--color-text-muted);
		font-size: 12px;
	}
	/* REVEALED by tap (the toggle) or by keyboard focus. */
	.desc.open,
	.info:focus-visible ~ .desc {
		position: static;
		width: auto;
		height: auto;
		overflow: visible;
		clip-path: none;
		white-space: normal;
	}
	/* Pointer devices additionally get it on hover. Gated so a touch browser's emulated :hover
	   cannot leave the line stuck open after a tap. */
	@media (hover: hover) {
		.info:hover ~ .desc {
			position: static;
			width: auto;
			height: auto;
			overflow: visible;
			clip-path: none;
			white-space: normal;
		}
	}
</style>
