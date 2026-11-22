<script lang="ts">
	// PromoShareSheet — "ready-written for you" sharing (quick-261122-sharefeed).
	//
	// GOLD RULE — FEED IT TO THEIR MOUTH （喂到口邊, Hector 2026-11-21): nobody writes their own
	// promo text, so the track ⋮ menu's Share opens this sheet with the FINISHED canon message,
	// in the user's own language first, signed with the name they gave once — one tap to the
	// clipboard or to WhatsApp. Plain copy-link (Share's old behaviour) stays one tap away.
	//
	// The message words are the promo deck canon (services/promo-message over promo-canon.json) —
	// never authored here. Mounted ONCE in (app)/+layout.svelte (SupporterSheet precedent), driven
	// by promoShare.sheetOpen; same dismiss convergence (scrim / drag / back → overlays.dismiss).
	import { untrack } from 'svelte';
	import { fly } from '$lib/motion';
	import { Copy, Check, Link, X, Send } from '@lucide/svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { promoShare } from '$lib/stores/promoShare.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { orderedPromoLangs, renderShort, whatsappUrl, SENDER_MAX } from '$lib/services/promo-message';
	import { t } from '$lib/i18n';

	const langs = $derived(orderedPromoLangs(promoShare.defaultLang));
	const message = $derived(promoShare.message());
	const shortText = $derived(renderShort(promoShare.lang));
	let copied = $state<'full' | 'short' | null>(null);
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;

	function close() {
		promoShare.close();
	}

	$effect(() => {
		if (promoShare.sheetOpen) {
			untrack(() => {
				copied = null;
				overlays.open('promo-share-sheet', () => (promoShare.sheetOpen = false));
			});
			return () => untrack(() => overlays.dismiss('promo-share-sheet'));
		}
	});

	function flash(which: 'full' | 'short') {
		copied = which;
		if (copiedTimer) clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = null), 2200);
		toast.show(t('promo.copied'));
	}

	async function copyFull() {
		if (await promoShare.copyFull()) flash('full');
	}
	async function copyShort() {
		if (await promoShare.copyShort()) flash('short');
	}
	async function copyLink() {
		if (await promoShare.copyLink()) toast.show(t('toast.shareCopied'));
	}
</script>

{#if promoShare.sheetOpen}
	<button class="scrim" aria-label={t('menu.close')} onclick={close}></button>
	<div
		class="menu"
		role="dialog"
		aria-modal="true"
		aria-label={t('promo.title')}
		data-testid="promo-share-sheet"
		transition:fly={{ y: 240, duration: 200 }}
		use:dragClose={{ onclose: close }}
		use:focusTrap
	>
		<div class="menu-head">
			<span>{t('promo.title')}</span>
			<button class="x" aria-label={t('menu.close')} onclick={close} use:tapBounce><X size={18} /></button>
		</div>
		<p class="sub">{t('promo.subtitle')}</p>

		<div class="langs" role="tablist" aria-label={t('promo.title')}>
			{#each langs as l (l.id)}
				<button
					class="pill"
					class:on={promoShare.lang === l.id}
					role="tab"
					aria-selected={promoShare.lang === l.id}
					data-lang={l.id}
					onclick={() => (promoShare.lang = l.id)}
					use:tapBounce>{l.label}</button
				>
			{/each}
		</div>

		<label class="lbl" for="promo-sender">{t('promo.senderLabel')}</label>
		<input
			id="promo-sender"
			class="txt"
			type="text"
			value={promoShare.sender}
			oninput={(e) => promoShare.setSender(e.currentTarget.value)}
			maxlength={SENDER_MAX}
			placeholder={t('promo.senderPlaceholder')}
			autocomplete="nickname"
		/>
		<p class="hint">{t('promo.senderHint')}</p>

		{#if promoShare.track}
			<label class="switch">
				<input type="checkbox" bind:checked={promoShare.includeTrack} />
				<span class="track"><span class="thumb"></span></span>
				<span class="switch-label">{t('promo.includeSong')}</span>
			</label>
		{/if}

		<div class="bubble" data-testid="promo-message" lang={promoShare.lang === 'yue' ? 'zh-HK' : promoShare.lang}>{message}</div>

		<div class="actions">
			<button class="btn primary" onclick={() => void copyFull()} use:tapBounce data-testid="promo-copy">
				{#if copied === 'full'}<Check size={18} />{:else}<Copy size={18} />{/if}
				{t('promo.copy')}
			</button>
			<a
				class="btn wa"
				href={whatsappUrl(message)}
				target="_blank"
				rel="noopener"
				onclick={() => promoShare.countWhatsApp()}
				use:tapBounce
				data-testid="promo-wa"
			>
				<Send size={18} />
				{t('promo.whatsapp')}
			</a>
		</div>

		{#if shortText}
			<p class="lbl short-lbl">{t('promo.short')}</p>
			<div class="short-row">
				<p class="short-text">{shortText}</p>
				<button class="icon-btn" aria-label={t('promo.copy')} onclick={() => void copyShort()} use:tapBounce>
					{#if copied === 'short'}<Check size={18} />{:else}<Copy size={18} />{/if}
				</button>
			</div>
		{/if}

		{#if promoShare.track}
			<button class="btn ghost" onclick={() => void copyLink()} use:tapBounce>
				<Link size={18} />
				{t('promo.copyLink')}
			</button>
		{/if}
	</div>
{/if}

<style>
	/* Scoped copies of the SupporterSheet overlay classes (the sheet is its own component). */
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.45); border: none; }
	.menu { position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px; padding: 8px 12px 16px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0,0,0,0.5); max-height: 90vh; overflow-y: auto; box-sizing: border-box; }
	.menu-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: calc(1rem * var(--fs-title, 1)); font-weight: 700; color: var(--color-text); padding: 10px 4px 2px; }
	.x { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; border: none; background: transparent; color: var(--color-text-muted); cursor: pointer; }
	.sub { margin: 4px 4px 0; font-size: 0.875rem; color: var(--color-text-muted); line-height: 1.45; }
	.langs { display: flex; gap: 8px; overflow-x: auto; padding: 12px 2px 4px; scrollbar-width: none; }
	.langs::-webkit-scrollbar { display: none; }
	.pill { flex: 0 0 auto; min-height: 36px; padding: 6px 14px; border-radius: 999px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); font-size: 0.875rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
	.pill.on { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-on-primary); }
	.lbl { display: block; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); margin: 14px 4px 6px; }
	.txt { width: 100%; min-height: 44px; padding: 12px 14px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; color: var(--color-text); font-family: inherit; font-size: 1rem; box-sizing: border-box; }
	.hint { margin: 6px 4px 0; font-size: 0.75rem; color: var(--color-text-muted); }
	.bubble { margin-top: 14px; padding: 14px; border-radius: 14px; background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text); font-size: 0.9375rem; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
	.actions { display: flex; gap: 10px; margin-top: 12px; }
	.btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; padding: 12px; border-radius: 12px; font-size: 0.9375rem; font-weight: 700; border: none; cursor: pointer; text-decoration: none; box-sizing: border-box; }
	.btn.primary { background: var(--color-primary); color: var(--color-on-primary); }
	.btn.wa { background: #25d366; color: #0b2e17; }
	.btn.ghost { width: 100%; margin-top: 14px; background: transparent; border: 1px solid var(--color-border); color: var(--color-text); }
	.short-lbl { margin-top: 18px; }
	.short-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--color-surface); border: 1px solid var(--color-border); }
	.short-text { flex: 1; margin: 0; font-size: 0.875rem; line-height: 1.45; color: var(--color-text); overflow-wrap: anywhere; }
	.icon-btn { flex: 0 0 auto; width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border-radius: 12px; border: none; background: var(--color-surface-2); color: var(--color-text); cursor: pointer; }
	.switch { display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 12px 4px 0; }
	.switch input { position: absolute; opacity: 0; width: 0; height: 0; margin: 0; }
	.track { width: 46px; height: 26px; border-radius: 999px; background: var(--color-border); position: relative; transition: background 0.2s; flex: 0 0 auto; }
	.thumb { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform 0.2s; }
	.switch input:checked + .track { background: var(--color-primary); }
	.switch input:checked + .track .thumb { transform: translateX(20px); }
	.switch input:focus-visible + .track { outline: 2px solid var(--color-focus); outline-offset: 2px; }
	.switch-label { font-size: 0.9375rem; font-weight: 600; color: var(--color-text); }
</style>
