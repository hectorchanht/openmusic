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
		goto('/settings');
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
		display: flex; align-items: center; justify-content: center; padding: 24px;
	}
	.sheet {
		background: var(--color-bg); border-radius: 16px; padding: 28px 24px;
		max-width: 380px; width: 100%; text-align: center;
	}
	.icon {
		display: inline-flex; align-items: center; justify-content: center;
		width: 56px; height: 56px; border-radius: 50%;
		background: var(--color-primary); color: #fff; margin-bottom: 12px;
	}
	.sheet h2 { margin: 0 0 8px; font-size: 1.2rem; }
	.sheet p { margin: 0 0 16px; color: var(--color-text-muted); font-size: 0.9rem; line-height: 1.5; }
	.steps {
		text-align: left; margin: 0 0 20px; padding-left: 20px;
		color: var(--color-text); font-size: 0.88rem; line-height: 1.7;
	}
	.steps li { margin-bottom: 4px; }
	.steps li::marker { color: var(--color-primary); font-weight: 700; }
	.row { display: flex; gap: 12px; margin-bottom: 12px; }
	.btn {
		flex: 1; padding: 12px; border-radius: 10px; font-size: 0.95rem;
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
