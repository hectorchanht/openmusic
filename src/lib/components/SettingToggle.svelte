<script lang="ts">
	// quick-260919-ebi (F2) — THE at-a-glance rule, one half of it:
	//
	//     inset + switch + accent edge  = a boolean you flip HERE.
	//     raised + chevron + value badge = something that LEADS SOMEWHERE (SettingRow.svelte).
	//
	// Before this component, `.row-toggle` (a boolean) and `.item` (navigates to a sub-page) were
	// byte-identical boxes — same surface-2 fill, same 1px border, same radius 12, same padding.
	// That identity was the findability defect: the user had to read the label to learn whether a
	// tap would flip something or move them. The two kinds now differ in fill, edge and chevron,
	// so the row KIND reads before the label does.
	//
	// The switch geometry (.sw, 40x22 pill with an 18px knob translating 18px) is carried VERBATIM
	// from the six per-page copies this replaces, so nothing visibly jumps on adoption.
	//
	// A11y, not a nicety: this renders a real <button role="switch" aria-checked>. Most of the
	// call sites it replaces exposed NO state to assistive tech at all — the switch pill was a
	// decorative <span> inside a plain button. Free correctness fix.
	//
	// WHY THE ROW IS A DIV WITH A STRETCHED HIT BUTTON (quick-260919-ebi follow-up): `hint` puts a
	// SettingHint (i) — itself a <button> — directly after the label text, and a button inside a
	// button is invalid HTML that browsers resolve by making the inner one unreachable. So the box
	// is a plain div and `.hit` is a transparent button stretched over it: the whole row still
	// toggles, the (i) is still clickable, and the bounce moved to the wrapper so the row presses
	// exactly as it did before. `.lbl`/`.sw` are pointer-events:none so they never swallow a tap
	// meant for `.hit`; the (i) opts back in.
	import type { Component } from 'svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import SettingHint from './SettingHint.svelte';

	let {
		label,
		icon: Icon,
		checked,
		onchange,
		hint,
		disabled = false
	}: {
		label: string;
		icon?: Component<{ size?: number }>;
		checked: boolean;
		onchange: () => void;
		/** The setting's description, revealed by an (i) inline after the row's own label. */
		hint?: string;
		disabled?: boolean;
	} = $props();
</script>

<!-- quick-260919-l9e — `only: '.hit'` for the same reason SongRow needs it: pointerdown BUBBLES,
     so an ungated container bounce scaled this row for a press on ANY descendant, and a scale
     moves children. The browser hit-tests pointerup at the ORIGINAL coordinates, so a control
     that slid inward loses its outer edge and the click retargets to this inert div. That is not
     hypothetical here — `.lbl` carries SettingHint's own 28px (i) button, which is small enough
     that the displacement eats a real share of it. Gating on `.hit` keeps the row's own bounce
     (a press anywhere on the row still toggles and still bounces, because `.lbl`/`.sw` are
     pointer-events:none) while leaving the (i) at rest so it keeps its full tap target. -->
<div class="setting-toggle" class:on={checked} class:disabled use:tapBounce={{ only: '.hit' }}>
	<button
		class="hit"
		role="switch"
		aria-checked={checked}
		aria-label={label}
		{disabled}
		onclick={onchange}
	></button>
	<span class="lbl">
		{#if Icon}<Icon size={16} />{/if}
		{label}
		{#if hint}<SettingHint text={hint} {label} />{/if}
	</span>
	<!-- The pill is pure decoration; aria-checked on the button carries the state. -->
	<span class="sw" class:on={checked} aria-hidden="true"></span>
</div>

<style>
	/* TOGGLE kind: INSET (--color-bg sunk inside the hairline), no chevron, switch on the right,
	   and a 3px accent edge when on. The left border is always 3px and merely changes colour, so
	   flipping the switch never reflows the row. */
	.setting-toggle {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-left: 3px solid transparent;
		color: var(--color-text);
		padding: 13px 14px;
		border-radius: 12px;
		font-size: 14px;
		cursor: pointer;
		text-align: left;
		margin-bottom: 8px;
		/* Anchors both `.hit` and the hint's description panel. */
		position: relative;
	}
	.setting-toggle.on {
		border-left-color: var(--color-primary);
	}
	.setting-toggle.disabled {
		opacity: 0.5;
		cursor: default;
	}
	/* Transparent, covers the row, carries the whole switch semantics. */
	.hit {
		position: absolute;
		inset: 0;
		width: 100%;
		background: none;
		border: none;
		border-radius: inherit;
		padding: 0;
		cursor: inherit;
	}
	.lbl {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		/* Painted over `.hit`, so it must not intercept the row's tap. */
		position: relative;
		pointer-events: none;
		/* Being positioned makes this the hint panel's anchor, so it stretches to the switch —
		   otherwise the panel would be as narrow as the label text. Visually identical: the row
		   is already space-between, so the switch stays hard right either way. */
		flex: 1;
	}
	/* …except the (i), which is the one thing in the row that is NOT the switch. */
	.lbl :global(.hint) {
		pointer-events: auto;
	}
	/* Carried verbatim from the six per-page `.sw` copies. */
	.sw {
		pointer-events: none;
		width: 40px;
		height: 22px;
		border-radius: 999px;
		background: var(--color-border);
		position: relative;
		transition: background 0.15s ease;
		flex: none;
	}
	.sw::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.15s ease;
	}
	.sw.on {
		background: var(--color-primary);
	}
	.sw.on::after {
		transform: translateX(18px);
	}
	@media (prefers-reduced-motion: reduce) {
		.sw,
		.sw::after {
			transition: none;
		}
	}
</style>
