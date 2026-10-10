<script lang="ts">
	// Download gate modal — shown when a non-supporter taps a bulk-download button.
	// (Hector 2026-10-10: "when user click download multi files, they will see a
	// popup modal stating that the function need tips".)
	import { t } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { TIP_JAR_URL } from '$lib/config/sponsored';
	import { goto } from '$app/navigation';
	import { Heart } from '@lucide/svelte';

	let { open = $bindable(false) }: { open: boolean } = $props();

	function goTip() {
		open = false;
		window.open(TIP_JAR_URL, '_blank', 'noopener');
	}
	function goSettings() {
		open = false;
		goto('/settings/sponsored');
	}
</script>

{#if open}
	<div class="scrim" onclick={() => (open = false)} role="presentation">
		<div class="sheet" role="dialog" aria-modal="true" aria-label={t('pack.downloadGateTitle')} onclick={(e) => e.stopPropagation()}>
			<span class="icon"><Heart size={28} fill="currentColor" /></span>
			<h2>{t('pack.downloadGateTitle')}</h2>
			<p>{t('pack.downloadGateBody')}</p>
			<ol class="steps">
				<li>{t('pack.downloadGateStep1')}</li>
				<li>{t('pack.downloadGateStep2')}</li>
				<li>{t('pack.downloadGateStep3')}</li>
				<li>{t('pack.downloadGateStep4')}</li>
			</ol>
			<div class="row">
				<button type="button" class="btn ghost" onclick={() => (open = false)} use:tapBounce>
					{t('pack.downloadGateCancel')}
				</button>
				<button type="button" class="btn primary" onclick={goTip} use:tapBounce>
					{t('pack.downloadGateTip')}
				</button>
			</div>
			<button type="button" class="link" onclick={goSettings} use:tapBounce>
				{t('pack.downloadGateHaveKey')}
			</button>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); z-index: 60;
		display: flex; align-items: center; justify-content: center; padding: 20px;
		/* Ensure the scrim itself never causes overflow on small screens. */
		box-sizing: border-box;
	}
	.sheet {
		background: var(--color-bg); border-radius: 16px; padding: 24px 20px;
		/* quick-261010-soy6: must stay smaller than the viewport on phones —
		   the 380px max was overflowing ~390px screens. */
		width: calc(100vw - 56px);
		max-width: 340px;
		max-height: calc(100vh - 80px);
		max-height: calc(100dvh - 80px);
		overflow-y: auto;
		box-sizing: border-box;
		text-align: center;
	}
	.icon {
		display: inline-flex; align-items: center; justify-content: center;
		width: 48px; height: 48px; border-radius: 50%;
		background: var(--color-primary); color: #fff; margin-bottom: 10px;
	}
	.sheet h2 { margin: 0 0 8px; font-size: 1.15rem; }
	.sheet p { margin: 0 0 14px; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5; }
	.steps {
		text-align: left; margin: 0 0 16px; padding-left: 20px;
		color: var(--color-text); font-size: 0.83rem; line-height: 1.6;
	}
	.steps li { margin-bottom: 3px; }
	.steps li::marker { color: var(--color-primary); font-weight: 700; }
	.row { display: flex; gap: 10px; margin-bottom: 10px; }
	.btn {
		flex: 1; padding: 11px; border-radius: 10px; font-size: 0.9rem;
		font-weight: 600; cursor: pointer; border: none;
	}
	.btn.ghost {
		background: var(--color-surface); color: var(--color-text);
		border: 1px solid var(--color-border);
	}
	.btn.primary { background: var(--color-primary); color: #fff; }
	.link {
		background: none; border: none; color: var(--color-primary);
		font-size: 0.85rem; cursor: pointer; text-decoration: underline;
	}
</style>
