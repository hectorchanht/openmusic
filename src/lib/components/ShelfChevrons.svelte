<script lang="ts">
	// ShelfChevrons — quick-260919-et3. Desktop-only sideways paging for a horizontal shelf.
	//
	// On touch a shelf scrolls natively and use:dragScroll already covers click-drag on a mouse;
	// what a pointer user at 1440px has no affordance for is "show me the next screenful". These
	// are that affordance, and nothing else: two overlay buttons, no props, no state of its own
	// beyond the two disabled flags.
	//
	// ponytail: sibling-position coupling — the target is `root.previousElementSibling`, so this
	// MUST be placed as the immediate sibling AFTER the .albumrow it drives. A wrapper component
	// would be the tidier API, but the shelves live inside {#snippet}s rendered from {#each}
	// blocks, where a single `bind:this` in the host page gets overwritten by every later
	// instance. Upgrade path if this ever bites: pass the element in as a prop from a host that
	// can keep per-instance refs.
	import { browser } from '$app/environment';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { t } from '$lib/i18n';
	import { canScroll, nextScrollLeft, type ShelfDir } from './shelf-scroll';

	let root = $state<HTMLDivElement | undefined>(undefined);
	let target: HTMLElement | null = null;

	// Whether the shelf overflows at all, and whether each direction has anywhere left to go.
	let overflows = $state(false);
	let canPrev = $state(false);
	let canNext = $state(false);

	function sync() {
		if (!target) {
			overflows = canPrev = canNext = false;
			return;
		}
		const { scrollLeft, clientWidth, scrollWidth } = target;
		overflows = clientWidth > 0 && scrollWidth > clientWidth;
		canPrev = canScroll(scrollLeft, clientWidth, scrollWidth, 'prev');
		canNext = canScroll(scrollLeft, clientWidth, scrollWidth, 'next');
	}

	$effect(() => {
		// SSR/native guard per CLAUDE.md — this app SSRs on Cloudflare and builds as a Capacitor
		// SPA, so every window/DOM touch is gated.
		if (!browser || !root) return;
		const sib = root.previousElementSibling;
		if (!(sib instanceof HTMLElement)) return;
		target = sib;

		// The shelves populate ASYNCHRONOUSLY (discovery data arrives after mount), so a single
		// mount-time measurement would read an empty 0px-tall row and leave the buttons both
		// mispositioned and permanently disabled. A ResizeObserver fires once on observe AND
		// again when the tiles land, which covers the measurement and the enabled state in one
		// mechanism — fewer moving parts than a mount read plus a retry.
		const measure = () => {
			root?.style.setProperty('--shelf-h', `${sib.offsetHeight}px`);
			sync();
		};
		const ro = new ResizeObserver(measure);
		ro.observe(sib);
		measure();

		sib.addEventListener('scroll', sync, { passive: true });
		// Catches the one case the ResizeObserver cannot see: tiles appended to an already-tall
		// shelf (same height, wider scrollWidth). A pointer user crosses the shelf to reach a
		// chevron, so re-syncing on entry is enough — no observer on the subtree.
		sib.addEventListener('pointerenter', sync);

		return () => {
			ro.disconnect();
			sib.removeEventListener('scroll', sync);
			sib.removeEventListener('pointerenter', sync);
			target = null;
		};
	});

	function page(dir: ShelfDir) {
		if (!target) return;
		const { scrollLeft, clientWidth, scrollWidth } = target;
		// D-9: reduced motion turns the smooth page into an instant jump. Same destination.
		const reduce = browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		target.scrollTo({
			left: nextScrollLeft(scrollLeft, clientWidth, scrollWidth, dir),
			behavior: reduce ? 'auto' : 'smooth'
		});
	}
</script>

<!-- height:0 + position:relative — this element occupies no layout space; the buttons are
     absolutely positioned back UP over the shelf that precedes it. -->
<div class="chevs" bind:this={root}>
	{#if overflows}
		<!-- D-10: reuses the existing nowplaying.previous / nowplaying.next strings rather than
		     adding dictionary keys. Tradeoff recorded: that is transport wording, so several
		     buttons on the page share the name "Next". Dedicated shelf.scrollPrev/scrollNext keys
		     are the upgrade once the i18n files are free. -->
		<button
			type="button"
			class="chev prev"
			aria-label={t('nowplaying.previous')}
			disabled={!canPrev}
			onclick={() => page('prev')}
		>
			<ChevronLeft size={20} />
		</button>
		<button
			type="button"
			class="chev next"
			aria-label={t('nowplaying.next')}
			disabled={!canNext}
			onclick={() => page('next')}
		>
			<ChevronRight size={20} />
		</button>
	{/if}
</div>

<style>
	/* The ONLY rule in this component outside the desktop media query, and it is the one that
	   makes the component free on mobile: display:none means the buttons are not rendered as
	   boxes, not focusable and not in the accessibility tree below 1024px. CSS therefore stays
	   the single source of truth for the breakpoint — no matchMedia in JS deciding layout. */
	.chevs {
		display: none;
	}

	@media (min-width: 1024px) {
		.chevs {
			display: block;
			position: relative;
			height: 0;
		}
		.chev {
			position: absolute;
			/* --shelf-h is measured from the shelf above. This element sits at the shelf's BOTTOM
			   edge, so going up by half the shelf plus half the button centres the button on the
			   shelf's midline. (The plan's formula omitted the button's own 36px, which would
			   have hung it below the midline.) The fallback keeps it sane pre-measurement. */
			top: calc((var(--shelf-h, 160px) + 36px) / -2);
			display: grid;
			place-items: center;
			width: 36px;
			height: 36px;
			border-radius: var(--radius-full);
			border: 1px solid var(--color-border);
			background: var(--color-surface-2);
			color: var(--color-text);
			cursor: pointer;
			padding: 0;
			z-index: 2;
			transition: opacity var(--dur-quick) var(--ease-standard);
		}
		.chev.prev {
			left: -4px;
		}
		.chev.next {
			right: -4px;
		}
		.chev:disabled {
			opacity: 0.35;
			cursor: default;
		}
	}

	@media (min-width: 1024px) and (hover: hover) {
		.chev:not(:disabled):hover {
			background: var(--color-surface);
		}
	}
</style>
