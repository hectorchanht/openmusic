<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { CircleUserRound, LogOut, Mail, RefreshCw } from '@lucide/svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SettingRow from '$lib/components/SettingRow.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';

	// quick-261020-acct: Settings → Account. The store stays i18n-free — it returns status
	// unions ('invalid-email', 'rate-limited', …) and this page maps them to account.* keys.
	onMount(() => {
		// The app layout already fires auth.load() at boot; this covers a direct cold
		// navigation to the page (load() is idempotent).
		void auth.load();
	});

	let email = $state('');
	let sending = $state(false);
	let sent = $state(false);
	// A TranslationKey (not raw text) — the store→UI one-way rule.
	let errorKey = $state<'account.invalidEmail' | 'account.rateLimited' | 'account.sendFailed' | 'account.notConfigured' | 'account.error' | null>(null);
	let signOutOpen = $state(false);

	async function sendLink() {
		if (sending) return;
		sending = true;
		errorKey = null;
		const r = await auth.requestLink(email);
		sending = false;
		if (r === 'ok') {
			sent = true;
			return;
		}
		errorKey =
			r === 'invalid-email'
				? 'account.invalidEmail'
				: r === 'rate-limited'
					? 'account.rateLimited'
					: r === 'not-configured'
						? 'account.notConfigured'
						: r === 'send-failed'
							? 'account.sendFailed'
							: 'account.error';
	}

	async function doSignOut() {
		signOutOpen = false;
		await auth.logout();
		sent = false;
		email = '';
	}
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<PageHeader title={t('settings.groupAccount')} backLabel={t('settings.backToSettings')} onback={() => goto('/settings')} />

<ConfirmModal
	open={signOutOpen}
	title={t('account.signOut')}
	body={t('account.signOutConfirm')}
	confirmLabel={t('account.signOut')}
	onconfirm={doSignOut}
	onclose={() => (signOutOpen = false)}
/>

{#if !auth.ready}
	<!-- Boot probe still in flight — render nothing rather than flashing the form. -->
{:else if auth.user}
	<section>
		<h2><CircleUserRound size={15} /> {t('account.signedInAs')}</h2>
		<p class="email">{auth.user.email}</p>
		<p class="hint">{t('account.syncHint')}</p>
	</section>

	<section>
		<SettingRow
			icon={RefreshCw}
			label={t('account.syncNow')}
			desc={auth.syncStatus === 'syncing'
				? t('account.syncSyncing')
				: auth.syncStatus === 'error'
					? t('account.syncError')
					: auth.syncStatus === 'synced'
						? t('account.syncSynced')
						: t('account.syncIdle')}
			onclick={() => void auth.syncNow()}
		/>
		<SettingRow icon={LogOut} label={t('account.signOut')} onclick={() => (signOutOpen = true)} />
	</section>
{:else}
	<section>
		<h2><Mail size={15} /> {t('account.signInTitle')}</h2>
		<p class="hint">{t('account.signInDesc')}</p>
		{#if sent}
			<p class="sent">{t('account.linkSent')}</p>
		{:else}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					void sendLink();
				}}
			>
				<label class="field">
					<span>{t('account.emailLabel')}</span>
					<input
						type="email"
						inputmode="email"
						autocomplete="email"
						placeholder={t('account.emailPlaceholder')}
						bind:value={email}
					/>
				</label>
				{#if errorKey}<p class="error">{t(errorKey)}</p>{/if}
				<button class="send" type="submit" disabled={sending} use:tapBounce>
					{sending ? t('account.sending') : t('account.sendLink')}
				</button>
			</form>
		{/if}
	</section>
{/if}

<style>
	section { margin: 18px 0; }
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 10px; }
	.email { font-size: 1rem; font-weight: 600; margin: 0 0 6px; overflow-wrap: anywhere; }
	.hint { color: var(--color-text-muted); font-size: 0.8125rem; margin: 0 0 12px; line-height: 1.5; }
	.sent { background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface-2)); border: 1px solid var(--color-primary); border-radius: 12px; padding: 12px 14px; font-size: 0.875rem; line-height: 1.5; margin: 0; }
	.field { display: flex; flex-direction: column; gap: 6px; font-size: 0.8125rem; color: var(--color-text-muted); margin-bottom: 12px; }
	.field input { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 10px; color: var(--color-text); padding: 12px 14px; font-size: 1rem; width: 100%; box-sizing: border-box; }
	.field input:focus { outline: 2px solid var(--color-primary); outline-offset: 0; border-color: transparent; }
	.error { color: #ff5d73; font-size: 0.8125rem; margin: 0 0 12px; }
	.send { width: 100%; background: var(--color-primary); color: #fff; border: none; border-radius: 999px; padding: 12px 20px; font-size: 0.9375rem; font-weight: 600; cursor: pointer; }
	.send:disabled { opacity: 0.55; cursor: default; }
</style>
