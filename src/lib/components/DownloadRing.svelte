<script lang="ts">
	// DownloadRing — the ONE in-flight download affordance (quick-260919-dlring). Every download
	// control renders THIS while a download is running: an accent ring that fills CLOCKWISE from 12
	// o'clock around the control's existing Download glyph.
	//
	// LAYOUT IS UNTOUCHED BY DESIGN. The ring is an absolutely positioned overlay drawn OUTSIDE the
	// wrapper box (`.arc` is inset by a negative --ring-gap), and the wrapper takes its size from the
	// glyph the caller passes in. So a control that swaps its idle Download icon for a ring keeps the
	// exact same box — the NowPlaying transport row and the TrackMenu header are measured layouts
	// where a size change would shift siblings. There is deliberately NO `size` prop: the glyph the
	// call site already renders (18px in list rows, 20px in the menu header, 20px under NowPlaying's
	// `.t-dl :global(.dc svg)` override) sizes the ring, so one call site restyling its icon can
	// never leave the ring behind at a stale hardcoded size.
	//
	// DETERMINATE vs INDETERMINATE is the whole point. `value` is `library.downloadProgress[uid]`, and
	// an ABSENT entry means INDETERMINATE — the response carried no Content-Length, so there is no
	// honest fraction (see the field's doc in library.svelte.ts and readBlobWithProgress's "never
	// invents progress" note). `undefined` therefore must NOT render as 0%: it renders a spinning arc,
	// because a frozen empty ring reads as a broken download rather than an unmeasurable one.
	//
	// WHY SVG + stroke-dashoffset, not a conic-gradient: stroke-dashoffset animates natively
	// everywhere, whereas a conic-gradient's angle cannot transition at all without an @property
	// registration (iOS 16.4+) and would step visibly at each whole-percent update. The arc is also
	// antialiased for free and costs no mask compositing in a long list.
	//
	// ARIA lives on the CALLING button (aria-busy + an aria-label carrying the percent, which is the
	// shape the TrackMenu row already used). The ring is decoration: aria-hidden, so it can never
	// announce a second competing value — and an indeterminate ring claims no value at all.
	import type { Snippet } from 'svelte';

	let {
		value = undefined,
		children
	}: {
		/** 0..1 byte progress. `undefined` = INDETERMINATE (no Content-Length) → spinning arc. */
		value?: number | undefined;
		/** The control's own Download glyph. The ring wraps it; it also sizes the ring. */
		children?: Snippet;
	} = $props();

	const R = 14;
	const C = 2 * Math.PI * R;
	// Clamp defensively: a server under-reporting Content-Length must not draw a 137% arc (the same
	// clamp readBlobWithProgress applies at the source — cheap to re-assert at the render boundary).
	const frac = $derived(value === undefined ? undefined : Math.min(1, Math.max(0, value)));
</script>

<span class="ring">
	<span class="arc" class:indet={frac === undefined} class:motion-always={frac === undefined}>
		<!-- rotate(-90 16 16) as a presentation attribute (not CSS transform-box/origin, which the
		     indeterminate spin on the parent would then have to share): a <circle>'s path starts at 3
		     o'clock and runs clockwise, so this moves the start to 12 o'clock and the shrinking
		     dashoffset reveals the arc CLOCKWISE from there. -->
		<svg class="arc-svg" viewBox="0 0 32 32" aria-hidden="true">
			<circle class="trk" cx="16" cy="16" r={R} />
			<circle
				class="fil"
				cx="16"
				cy="16"
				r={R}
				transform="rotate(-90 16 16)"
				stroke-dasharray={frac === undefined ? `${C * 0.28} ${C}` : C}
				stroke-dashoffset={frac === undefined ? 0 : C * (1 - frac)}
			/>
		</svg>
	</span>
	{@render children?.()}
</span>

<style>
	.ring {
		position: relative;
		display: inline-grid;
		place-items: center;
		flex: none;
		/* How far outside the glyph box the ring is drawn. Overridable per call site if one ever
		   needs a tighter ring; nothing sets it today. */
		--ring-gap: 5px;
	}
	.arc {
		position: absolute;
		inset: calc(-1 * var(--ring-gap));
		pointer-events: none;
	}
	/* Four classes deep ON PURPOSE. NowPlaying's `.t-dl :global(.dc svg) { width: 20px }` sizes the
	   control's glyph and, unqualified, also hits THIS svg — at equal specificity it won on source
	   order and collapsed the overlay to the glyph's size, drawing a ring SMALLER than the icon and
	   anchored to its top-left. Verified in the browser, not assumed. */
	.ring .arc svg.arc-svg {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.trk {
		fill: none;
		stroke: var(--color-border);
		stroke-opacity: 0.35;
		stroke-width: 2.5;
	}
	/* Accent token, not a literal — identical in both themes (app.css keeps the accent out of the
	   light-theme override on purpose), and it reads against both surfaces. */
	.fil {
		fill: none;
		stroke: var(--color-primary);
		stroke-width: 2.5;
		stroke-linecap: round;
		/* Progress lands roughly once per whole percent, so ease between updates rather than step.
		   Short and linear: a longer/eased catch-up visibly lags a fast transfer. Deliberately NOT
		   tagged .motion-always, so app.css's reduce-motion rule kills it (the fill is data, not
		   motion — losing the tween loses nothing). */
		transition: stroke-dashoffset var(--dur-quick) linear;
	}
	/* Indeterminate: a 28% arc chasing its own tail. Carries .motion-always so the APP's reduce-motion
	   setting does not freeze it — quick-260809-mvz's call, that a frozen spinner reads as a hung app.
	   The OS-level query is a different matter and IS honoured below. */
	.arc.indet {
		animation: ring-spin 0.8s linear infinite;
	}
	@keyframes ring-spin {
		to {
			rotate: 360deg;
		}
	}
	/* OS reduced-motion: no rotation at all. A cross-fade is the standard vestibular-safe substitute
	   for a spinner, so the arc pulses instead — still unmistakably "working", no movement. */
	@media (prefers-reduced-motion: reduce) {
		.arc.indet {
			animation: ring-pulse 1.4s ease-in-out infinite;
		}
		.fil {
			transition: none;
		}
	}
	@keyframes ring-pulse {
		50% {
			opacity: 0.3;
		}
	}
</style>
