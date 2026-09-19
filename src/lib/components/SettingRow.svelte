<script lang="ts">
	// quick-260919-ebi (F2) — THE at-a-glance rule, the other half of it:
	//
	//     inset + switch + accent edge  = a boolean you flip HERE (SettingToggle.svelte).
	//     raised + chevron + value badge = something that LEADS SOMEWHERE.
	//
	// This is the navigation/action row. It is deliberately RAISED (--color-surface-2), carries no
	// accent edge, and ALWAYS shows a chevron — the chevron is the kind marker, not decoration, so
	// it is never conditional. An optional `value` badge in the accent colour reports the current
	// choice without opening the row.
	import type { Component } from 'svelte';
	import { ChevronRight } from '@lucide/svelte';
	import { tapBounce } from '$lib/actions/tapBounce';

	let {
		label,
		icon: Icon,
		desc,
		value,
		onclick,
		danger = false,
		disabled = false
	}: {
		label: string;
		icon?: Component<{ size?: number }>;
		desc?: string;
		value?: string;
		onclick: () => void;
		danger?: boolean;
		disabled?: boolean;
	} = $props();
</script>

<button class="setting-row" class:danger {disabled} {onclick} use:tapBounce>
	{#if Icon}<Icon size={20} />{/if}
	<span class="txt">
		<span class="lbl">{label}</span>
		{#if desc}<span class="desc">{desc}</span>{/if}
	</span>
	{#if value}<span class="value">{value}</span>{/if}
	<ChevronRight size={18} class="chev" />
</button>

<style>
	/* CONFIG kind: RAISED surface, no accent edge, chevron ALWAYS present. */
	.setting-row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 14px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		padding: 14px;
		border-radius: 12px;
		font-size: 15px;
		cursor: pointer;
		text-align: left;
		margin-bottom: 8px;
	}
	.setting-row:hover {
		background: var(--color-surface);
	}
	.setting-row:disabled {
		opacity: 0.5;
		cursor: default;
	}
	/* The danger tint is the same #ff7a90 /settings/data already used for "Clear library". */
	.setting-row.danger {
		color: #ff7a90;
	}
	.txt {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.lbl {
		font-size: 15px;
		font-weight: 600;
	}
	.desc {
		font-size: 12px;
		color: var(--color-text-muted);
	}
	.value {
		font-size: 13px;
		color: var(--color-primary);
		flex: none;
		max-width: 45%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.setting-row :global(.chev) {
		color: var(--color-text-muted);
		flex: none;
	}
</style>
