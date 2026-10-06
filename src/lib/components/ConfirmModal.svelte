<script lang="ts">
	// ConfirmModal — the ONE in-app confirm dialog (user call 2026-10-06).
	//
	// Replaces every native window.confirm() in the settings reset buttons. A native confirm
	// is a browser-chrome popup that breaks the app's visual language (and is blocked or
	// ugly in some WebViews); this is a bottom-sheet modal in the app's own style, following
	// the TrackMenu remove-download confirm precedent (scrim + fly transition + dragClose +
	// focusTrap). Cancel and the scrim/drag/back all just close; only the explicit confirm
	// button fires onconfirm.
	import { fly } from 'svelte/transition';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';

	interface Props {
		/** Whether the modal is visible. */
		open: boolean;
		/** Modal title (already translated by the caller). */
		title: string;
		/** Body copy (already translated by the caller). */
		body: string;
		/** Confirm button label (already translated by the caller). */
		confirmLabel: string;
		/** Fired when the confirm button is tapped. The modal closes itself after. */
		onconfirm: () => void;
		/** Fired on cancel / scrim / drag / back. */
		onclose: () => void;
	}

	let { open, title, body, confirmLabel, onconfirm, onclose }: Props = $props();
</script>

{#if open}
	<button class="scrim" aria-label={t('tags.cancel')} onclick={onclose}></button>
	<div
		class="confirm-modal"
		role="alertdialog"
		aria-modal="true"
		aria-label={title}
		transition:fly={{ y: 240, duration: 200 }}
		use:dragClose={{ onclose }}
		use:focusTrap
	>
		<div class="cm-title">{title}</div>
		<p class="cm-body">{body}</p>
		<div class="cm-actions">
			<button class="cm-btn" onclick={onclose} use:tapBounce>{t('tags.cancel')}</button>
			<button
				class="cm-btn danger"
				onclick={() => {
					onconfirm();
					onclose();
				}}
				use:tapBounce>{confirmLabel}</button
			>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 80;
		background: rgba(0, 0, 0, 0.45);
		border: none;
	}
	.confirm-modal {
		position: fixed;
		left: 12px;
		right: 12px;
		bottom: 16px;
		z-index: 81;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 16px;
		padding: 12px;
		max-width: 680px;
		margin: 0 auto;
		box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
	}
	.cm-title {
		font-size: calc(1rem * var(--fs-title, 1));
		font-weight: 700;
		color: var(--color-text);
		padding: 4px 4px 8px;
	}
	.cm-body {
		margin: 0;
		padding: 0 4px 12px;
		font-size: 0.9rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}
	.cm-actions {
		display: flex;
		gap: 8px;
	}
	.cm-btn {
		flex: 1;
		min-height: 48px;
		border-radius: 12px;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}
	.cm-btn.danger {
		background: #ff5a76;
		border-color: #ff5a76;
		color: #fff;
	}
</style>
