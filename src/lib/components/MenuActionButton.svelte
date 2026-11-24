<!-- quick-261021-menu8 (user): shared menu action button — every tappable action in
     pickers/sheets uses this, so buttons LOOK like buttons (not subtle text). Single
     source of truth for the "this is clickable" affordance. -->
<script lang="ts">
	import type { Component } from 'svelte';
	import { tapBounce } from '$lib/actions/tapBounce';

	interface Props {
		/** Lucide icon component. */
		icon?: Component;
		/** Click handler. */
		onclick?: (e: MouseEvent) => void;
		/** Disabled state. */
		disabled?: boolean;
		/** Additional class. */
		class?: string;
		/** Workstream H batch 5 (Dawn-Design §8): accessible name for icon-only use —
		    when set with an icon and no children, the button renders the glyph alone. */
		label?: string;
		/** Button children (label). */
		children?: import('svelte').Snippet;
	}

	let { icon: Icon, onclick, disabled = false, class: klass = '', label, children }: Props = $props();
</script>

<button
	class="menu-action-btn {klass}"
	class:icon-only={label && !children}
	{disabled}
	aria-disabled={disabled}
	aria-label={label}
	title={label}
	{onclick}
	use:tapBounce
>
	{#if Icon}<Icon size={18} />{/if}
	{#if children}<span class="label">{@render children?.()}</span>{/if}
</button>

<style>
	.menu-action-btn {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 14px 16px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 12px;
		color: var(--color-text);
		font-size: 0.9375rem;
		font-weight: 500;
		cursor: pointer;
		text-align: start;
		transition: background 0.15s, border-color 0.15s;
	}
	.menu-action-btn:active {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.24);
	}
	.menu-action-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.menu-action-btn .label {
		flex: 1;
	}
	.menu-action-btn.icon-only {
		justify-content: center;
	}
</style>
