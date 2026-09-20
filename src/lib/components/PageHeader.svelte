<script lang="ts">
	// PageHeader — the ONE back-header for every sub-page (quick-260919-hdr).
	//
	// There were SEVENTEEN independent `.back` declarations across seventeen route files, and they
	// had drifted into four visually different headers: the reference (`‹ title` on one row, 36px
	// ghost chevron, hover ring gated on `@media (hover: hover)`), a settings variant with an
	// ungated hover and a different h1 scale, a hero variant that put the chevron on its OWN row
	// above the title, and /charts/top — which declared NO `.back` rule at all, so its chevron fell
	// back to the UA's default grey boxed button sitting alone above the title. That last one is the
	// bug the user reported; the others are the drift that let it hide. This component is now the
	// only place the shape is declared.
	//
	// D-1 — THE BACK ACTION IS A PROP, not a hardcoded `history.back()`. Most sites do want the
	// history pop, so that is the DEFAULT, but three do not: /settings/* pops to the settings index
	// (`goto('/settings')`) and the album page navigates to its ARTIST
	// (`goto('/artist/' + name)`). Flattening those to history.back() would break a documented
	// navigation, so `onback` overrides and the default only fires when nothing is passed.
	//
	// D-2 — THE ARIA LABEL IS A PROP for the same reason: the existing keys are `common.back`,
	// `album.back` and `settings.backToSettings` ("Settings"), and the settings one is genuinely
	// more informative than a generic "Back". No NEW i18n string is introduced by this component —
	// it defaults to the key the majority already used.
	//
	// D-3 — THE BOUNCE SITS ON THE CHEVRON, never on the header. `quick-260919-l9e` is the whole
	// reason: pointerdown bubbles, so a `use:tapBounce` on a container that also holds other
	// controls scales the WHOLE container for a press on any of them, displacing the child under
	// the finger between press and release — which swallows the tap. Five settings headers carry a
	// "Reset to default" button in `trailing`, so an unscoped bounce here would reproduce that bug
	// exactly. The chevron is a leaf and bounces about its own centre; `trailing` content brings
	// its own bounce (all five reset buttons already had one).
	//
	// D-4 — HOVER IS GATED ON `@media (hover: hover)`. The reference variant did this; the artist
	// page's copy did not, and an ungated `:hover` latches a sticky ring under a finger after a tap
	// on touch. The gated rule is the correct one, so it is the one that survives.
	//
	// D-5 — NO `children` SNIPPET. Every header that carries more than a title carries it either as
	// a TRAILING control on the same row (the settings reset button → the `trailing` snippet) or as
	// a sibling BELOW the header that is already outside it in the page's own markup (the
	// /charts/top tabs, the discography chips, the album/artist hero bodies). A body slot would have
	// had exactly zero callers, so there isn't one.
	import type { Snippet } from 'svelte';
	import { ChevronLeft } from '@lucide/svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { marquee } from '$lib/actions/marquee';
	import { t } from '$lib/i18n';

	interface Props {
		/** The h1. Omit for a chevron-only header (the album/artist heroes, whose title belongs to
		 *  the centred hero body below, not to this row). */
		title?: string;
		/** Optional second line under the title (the discography page's "Albums" subtitle). */
		subtitle?: string;
		/** aria-label for the chevron. Defaults to the existing `common.back` (D-2). */
		backLabel?: string;
		/** What the chevron does. Defaults to `history.back()` (D-1). */
		onback?: () => void;
		/** Trailing control(s) on the title row — the settings "Reset to default" button. It must
		 *  bring its own `use:tapBounce` (D-3). */
		trailing?: Snippet;
	}

	let { title, subtitle, backLabel, onback, trailing }: Props = $props();
</script>

<!-- `bare` = a chevron-only header (album/artist). Its bottom margin collapses, because the hero
     body that follows brings its own top padding and 12px of dead air between the chevron and a
     160px cover reads as a gap, not as spacing. -->
<header class="head" class:bare={title === undefined}>
	<button
		type="button"
		class="back"
		aria-label={backLabel ?? t('common.back')}
		onclick={() => (onback ? onback() : history.back())}
		use:tapBounce><ChevronLeft size={22} /></button
	>
	{#if title !== undefined}
		<!-- use:marquee so a long/CJK title SCROLLS instead of wrapping the header to two rows or
		     sitting clipped. It self-measures and is inert when the text fits (isOverflowing is a
		     strict `>`), so the short titles are unaffected. -->
		<div class="titles">
			<h1 use:marquee><span class="marquee-inner">{title}</span></h1>
			{#if subtitle}<p class="sub">{subtitle}</p>{/if}
		</div>
	{/if}
	{#if trailing}{@render trailing()}{/if}
</header>

<style>
	.head {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 16px 0 12px;
	}
	.head.bare {
		margin-bottom: 0;
	}
	/* The only flexible box, so a trailing control keeps its full width and the title gives. */
	.titles {
		flex: 1;
		min-width: 0;
	}
	/* min-width:0 + overflow:hidden so use:marquee measures a REAL overflow and can scroll it. */
	.head h1 {
		font-size: calc(1.4rem * var(--fs-title, 1));
		margin: 0;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}
	.sub {
		margin: 2px 0 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	/* -8px pulls the 36px tap target's optical left edge back to the page gutter, so the chevron
	   GLYPH lines up with the content below it while the target stays finger-sized. */
	.back {
		flex: none;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		margin-left: -8px;
		padding: 0;
		background: none;
		border: none;
		color: var(--color-text);
		cursor: pointer;
	}
	/* D-4: hover-capable devices only — touch otherwise latches this ring under a held finger. */
	@media (hover: hover) {
		.back:hover {
			background: var(--color-surface-2);
			border-radius: 50%;
		}
	}
</style>
