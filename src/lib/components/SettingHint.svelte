<script lang="ts">
	// quick-260919-ebi — the ONE settings description disclosure.
	//
	// Settings pages carried a full explanatory paragraph under every control. Once each visual
	// setting also grew a live preview, the page was a wall: label, preview, paragraph, repeat.
	// The explanation is still worth having, it just should not be on screen by default.
	//
	// WHERE IT GOES (quick-260919-ebi follow-up): INLINE, immediately after the text of the title
	// it explains — inside the section's <h2>, the sub-heading, the slider's own label, or (via
	// SettingToggle's `hint` prop) after a row label. It first shipped as a standalone element
	// placed AFTER the control, which rendered a bare (i) alone on its own line, attached to
	// nothing. An (i) that does not touch a title is noise, which is the opposite of the point.
	//
	// WHY NOT A HOVER TOOLTIP: this app is mobile-first (iOS Safari + Android Chrome are the
	// primary targets) and hover does not exist on touch. A hover-only tooltip would put the
	// explanation permanently out of reach on the device most people use. So the (i) button is a
	// real toggle — TAP works everywhere — and hover/focus is layered on top as a convenience for
	// pointer devices only, behind `@media (hover: hover)`.
	//
	// WHY THE PANEL IS ABSOLUTE, NOT IN FLOW: the (i) now lives inside a HEADING, and a description
	// pushed into the heading's own flow would read as part of the title (and be announced as part
	// of it). So the description is lifted out to `top: 100%; left: 0; right: 0` against its host,
	// which spans it below the title at the host's full width. Every host is a full-width block, so
	// that is the whole positioning story — no collision math, no measurement, no JS.
	// THE HOST MUST BE `position: relative` — a scoped child cannot set that, so each call-site
	// title carries the one line (see `section h2` / `.lab` / `.sub` in the settings pages).
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

	function toggle(e: MouseEvent) {
		// A hint can sit inside a <summary> (Playback → Advanced sources). Without this, the click
		// would bubble and ALSO collapse the accordion the description lives in.
		e.stopPropagation();
		open = !open;
	}
</script>

<span class="hint">
	<button
		class="info"
		type="button"
		aria-expanded={open}
		aria-controls={id}
		aria-label={label ? `${label}: ${t('settings.aboutSetting')}` : t('settings.aboutSetting')}
		onclick={toggle}
		use:tapBounce
	>
		<Info size={14} />
	</button>
	<span class="desc" class:open {id}>{text}</span>
</span>

<style>
	/* INLINE against the title text. The wrapper is an 18px box — big enough not to sit below the
	   15px heading icon, small enough never to stretch a heading's line box — while the button
	   inside it overflows to a 28px tap target. */
	.hint {
		display: inline-flex;
		align-items: center;
		vertical-align: middle;
		width: 18px;
		height: 18px;
		margin-left: 4px;
		flex: none;
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
		margin: -5px;
		padding: 0;
		border-radius: 999px;
		flex: none;
	}
	.info:hover,
	.info[aria-expanded='true'] {
		color: var(--color-text);
	}
	/* The panel, anchored below the title against the host's full width. `* { box-sizing:
	   border-box }` is global, so the collapsed 1x1 box stays 1x1 WITH the padding and border —
	   the panel look can therefore be declared once here instead of in all three reveal rules. */
	.desc {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		margin-top: 6px;
		/* Spans the title on a phone (375 - 32 padding = 343) and stops sprawling into a 1300px
		   one-liner on a desktop rail layout. */
		max-width: 560px;
		z-index: 20;
		/* COLLAPSED: clipped, NOT removed. Still in the accessibility tree, still read in order. */
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		padding: 10px 12px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md, 12px);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
		color: var(--color-text-muted);
		/* Reset the host's type: headings here are uppercase + letter-spaced + semibold, and the
		   description is prose, not a continuation of the title. */
		font-size: 0.75rem;
		font-weight: 400;
		line-height: 1.5;
		text-align: left;
		text-transform: none;
		letter-spacing: normal;
		white-space: normal;
	}
	/* REVEALED by tap (the toggle) or by keyboard focus. */
	.desc.open,
	.info:focus-visible ~ .desc {
		width: auto;
		height: auto;
		overflow: visible;
		clip-path: none;
	}
	/* Pointer devices additionally get it on hover. Gated so a touch browser's emulated :hover
	   cannot leave the panel stuck open after a tap. */
	@media (hover: hover) {
		.info:hover ~ .desc {
			width: auto;
			height: auto;
			overflow: visible;
			clip-path: none;
		}
	}
</style>
