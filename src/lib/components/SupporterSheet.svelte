<script lang="ts">
	// Donor-wall sheet — 2026-10-14 donor-wall-ui. UI-ONLY: no payment, no verification.
	//
	// Follows the SleepTimerSheet precedent: mounted ONCE in (app)/+layout.svelte, driven by
	// `support.sheetOpen`, opened from the album "Download all" gate and the Settings support
	// card. Same dismiss convergence (scrim / drag / back-gesture → sheetOpen=false → the
	// $effect cleanup calls overlays.dismiss).
	//
	// The two donation URLs are empty constants below. Until Hector pastes his real Ko-fi /
	// GitHub Sponsors links, the CTAs render in an honest "coming soon" state — never a dead
	// link. The email-verification row is likewise present but disabled (no backend yet).
	import { untrack } from 'svelte';
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { Heart, Coffee, HeartHandshake, BadgeCheck } from '@lucide/svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { support } from '$lib/stores/support.svelte';
	import { t } from '$lib/i18n';

	// Donation destinations — Hector pastes his real links here; empty = "coming soon".
	const KOFI_URL = '';
	const GITHUB_SPONSORS_URL = '';
	const kofiLive = KOFI_URL.length > 0;
	const githubLive = GITHUB_SPONSORS_URL.length > 0;

	const TIERS = [
		{ nameKey: 'support.tier1Name', descKey: 'support.tier1Desc' },
		{ nameKey: 'support.tier2Name', descKey: 'support.tier2Desc' },
		{ nameKey: 'support.tier3Name', descKey: 'support.tier3Desc' }
	] as const;

	onMount(() => support.load());

	function close() {
		support.closeSheet();
	}

	// Single dismiss path, mirroring SleepTimerSheet (DEP is sheetOpen ONLY).
	$effect(() => {
		if (support.sheetOpen) {
			untrack(() => overlays.open('supporter-sheet', () => (support.sheetOpen = false)));
			return () => untrack(() => overlays.dismiss('supporter-sheet'));
		}
	});
</script>

{#if support.sheetOpen}
	<button class="scrim" aria-label={t('menu.close')} onclick={close}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: close }} use:focusTrap>
		<div class="menu-head">
			<Heart size={18} fill="currentColor" /> {t('support.title')}
		</div>
		<!-- Hector's line, verbatim (kept English in every locale — a brand line). -->
		<p class="tagline">“{t('support.tagline')}”</p>
		<p class="body">{t('support.body')}</p>

		<p class="perk-title">{t('support.perkTitle')}</p>
		<div class="tiers">
			{#each TIERS as tier (tier.nameKey)}
				<div class="tier">
					<span class="tier-name">{t(tier.nameKey)}</span>
					<span class="tier-desc">{t(tier.descKey)}</span>
				</div>
			{/each}
		</div>

		<div class="ctas">
			{#if kofiLive}
				<a class="cta" href={KOFI_URL} target="_blank" rel="noopener" use:tapBounce>
					<Coffee size={18} /> {t('support.donateKofi')}
				</a>
			{:else}
				<button class="cta soon" disabled>
					<Coffee size={18} /> {t('support.donateKofi')}
					<span class="soon-badge">{t('support.comingSoon')}</span>
				</button>
			{/if}
			{#if githubLive}
				<a class="cta" href={GITHUB_SPONSORS_URL} target="_blank" rel="noopener" use:tapBounce>
					<HeartHandshake size={18} /> {t('support.sponsorGithub')}
				</a>
			{:else}
				<button class="cta soon" disabled>
					<HeartHandshake size={18} /> {t('support.sponsorGithub')}
					<span class="soon-badge">{t('support.comingSoon')}</span>
				</button>
			{/if}
		</div>

		<!-- Verification leg not built yet (UI-only phase) — present, disabled, honest. -->
		<div class="verify">
			<BadgeCheck size={18} class="verify-icon" />
			<input type="email" disabled placeholder={t('support.alreadySupported')} aria-label={t('support.alreadySupported')} />
			<button class="verify-btn" disabled>{t('support.checkEmail')}</button>
		</div>
	</div>
{/if}

<style>
	/* Scoped copies of the SleepTimerSheet overlay classes (the sheet is its own component). */
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.45); border: none; }
	.menu { position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px; padding: 8px 12px 16px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0,0,0,0.5); max-height: 90vh; overflow-y: auto; }
	.menu-head { display: flex; align-items: center; gap: 8px; font-size: calc(1rem * var(--fs-title, 1)); font-weight: 700; color: var(--color-text); padding: 10px 4px 2px; }
	.tagline { margin: 10px 4px 0; font-size: 0.9375rem; font-style: italic; color: var(--color-primary); }
	.body { margin: 8px 4px 0; font-size: 0.875rem; color: var(--color-text-muted); line-height: 1.5; }
	.perk-title { margin: 16px 4px 0; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-muted); }
	.tiers { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
	.tier { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 12px; }
	.tier-name { font-weight: 700; font-size: 0.9375rem; color: var(--color-text); white-space: nowrap; }
	.tier-desc { font-size: 0.8125rem; color: var(--color-text-muted); text-align: right; }
	.ctas { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
	.cta { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 13px; border-radius: 12px; font-size: 0.9375rem; font-weight: 700; background: var(--color-primary); color: #fff; text-decoration: none; border: none; cursor: pointer; }
	.cta.soon { background: var(--color-surface); color: var(--color-text-muted); cursor: default; opacity: 0.85; }
	.soon-badge { font-size: 0.6875rem; font-weight: 700; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-full); padding: 2px 8px; }
	.verify { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 4px; opacity: 0.55; }
	.verify-icon { flex: none; color: var(--color-text-muted); }
	.verify input { flex: 1; min-width: 0; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 10px 12px; font-size: 0.8125rem; color: var(--color-text-muted); }
	.verify-btn { flex: none; background: none; border: 1px solid var(--color-border); border-radius: 10px; padding: 10px 14px; font-size: 0.8125rem; font-weight: 700; color: var(--color-text-muted); cursor: default; }
</style>
