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
	import type { Component } from 'svelte';
	import { tapBounce } from '$lib/actions/tapBounce';

	let {
		label,
		icon: Icon,
		checked,
		onchange,
		disabled = false
	}: {
		label: string;
		icon?: Component<{ size?: number }>;
		checked: boolean;
		onchange: () => void;
		disabled?: boolean;
	} = $props();
</script>

<button
	class="setting-toggle"
	class:on={checked}
	role="switch"
	aria-checked={checked}
	{disabled}
	onclick={onchange}
	use:tapBounce
>
	<span class="lbl">
		{#if Icon}<Icon size={16} />{/if}
		{label}
	</span>
	<!-- The pill is pure decoration; aria-checked on the button carries the state. -->
	<span class="sw" class:on={checked} aria-hidden="true"></span>
</button>

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
	}
	.setting-toggle.on {
		border-left-color: var(--color-primary);
	}
	.setting-toggle:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.lbl {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	/* Carried verbatim from the six per-page `.sw` copies. */
	.sw {
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
