<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { Capacitor } from '@capacitor/core';
	import {
		CircleUserRound,
		History,
		Languages,
		LibraryBig,
		LogOut,
		Mail,
		RefreshCw,
		Search,
		Settings2
	} from '@lucide/svelte';
	import type { Component } from 'svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { NATIVE_APP_SCHEME } from '$lib/auth/auth-core';
	import { requestLinkErrorKey } from '$lib/auth/request-link-keys';
	import type { SyncItems } from '$lib/config/defaults';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SettingRow from '$lib/components/SettingRow.svelte';
	import SettingToggle from '$lib/components/SettingToggle.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t, type TranslationKey } from '$lib/i18n';

	// quick-261020-acct: Settings → Account. The store stays i18n-free — it returns status
	// unions; requestLinkErrorKey() maps them to account.* keys (unit-tested).
	// quick-261020-sync: honest sign-in errors + the sync-item picker below.
	onMount(() => {
		// The app layout already fires auth.load()/settings.load() at boot; these cover a
		// direct cold navigation to the page (both are idempotent).
		void auth.load();
		settings.load();
	});

	let email = $state('');
	let sending = $state(false);
	let sent = $state(false);
	// A TranslationKey (not raw text) — the store→UI one-way rule.
	let errorKey = $state<TranslationKey | null>(null);
	let signOutOpen = $state(false);

	// quick-261020-deeplink: the APK passes the app scheme so the emailed link's verify
	// page can offer the "Open in OpenMusic" handoff — the system browser's cookie can
	// never reach the WebView. Web flow is byte-identical to before (no scheme field).
	const isNative = browser && Capacitor.isNativePlatform();

	async function sendLink() {
		if (sending) return;
		sending = true;
		errorKey = null;
		errorKey = requestLinkErrorKey(await auth.requestLink(email, isNative ? { scheme: NATIVE_APP_SCHEME } : undefined));
		sending = false;
		if (errorKey === null) sent = true;
	}

	/** quick-261020-sync: flip one picker item. The new selection counts as dirty (the
	 *  engine folds it into the change hash), so the next pass pushes it; syncNow() makes
	 *  it immediate while signed in. Signed-out, the choice is saved and waits for
	 *  sign-in — the note under the section says so. */
	function toggleSyncItem(key: keyof SyncItems) {
		settings.syncItems = { ...settings.syncItems, [key]: !settings.syncItems[key] };
		settings.save();
		if (auth.user) void auth.syncNow();
	}

	// quick-261020-sync: one row per syncable family (SyncItems in defaults.ts). `hint`
	// carries the one-line description in the house (i) affordance, like the share-title
	// row on Settings → General.
	const syncRows: { key: keyof SyncItems; icon: Component; label: TranslationKey; hint: TranslationKey }[] = [
		{ key: 'settings', icon: Settings2, label: 'account.syncSettings', hint: 'account.syncSettingsDesc' },
		{ key: 'library', icon: LibraryBig, label: 'account.syncLibrary', hint: 'account.syncLibraryDesc' },
		{ key: 'history', icon: History, label: 'account.syncHistory', hint: 'account.syncHistoryDesc' },
		{ key: 'searchHistory', icon: Search, label: 'account.syncSearchHistory', hint: 'account.syncSearchHistoryDesc' },
		{ key: 'nameTr', icon: Languages, label: 'account.syncNameTr', hint: 'account.syncNameTrDesc' }
	];

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
{:else}
	{#if auth.user}
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
			<!-- quick-261020-deeplink: the native flow ends with a tap on the emailed link
			     and then on "Open in OpenMusic" — the page says so up front. -->
			<p class="hint">{isNative ? t('account.nativeSignInHint') : t('account.signInDesc')}</p>
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
					{#if errorKey}
						<p class="error">{t(errorKey)}</p>
						<!-- quick-261020-sync: the production case this hint exists for — the
						     server may have queued the mail while the client lost the
						     response, so a blind retry can double-send. -->
						{#if errorKey === 'account.errNetwork'}
							<p class="hint net">{t('account.errNetworkHint')}</p>
						{/if}
					{/if}
					<button class="send" type="submit" disabled={sending} use:tapBounce>
						{sending ? t('account.sending') : t('account.sendLink')}
					</button>
				</form>
			{/if}
		</section>
	{/if}

	<!-- quick-261020-sync: the picker is visible signed-in AND signed-out — the choice is
	     saved either way and takes effect the moment an engine pass runs. -->
	<section>
		<h2><RefreshCw size={15} /> {t('account.syncTitle')}</h2>
		<p class="hint">{t('account.syncDesc')}</p>
		{#each syncRows as row (row.key)}
			<SettingToggle
				icon={row.icon}
				label={t(row.label)}
				hint={t(row.hint)}
				checked={settings.syncItems[row.key]}
				onchange={() => toggleSyncItem(row.key)}
			/>
		{/each}
		{#if !auth.user}
			<p class="hint">{t('account.syncSignedOutNote')}</p>
		{/if}
	</section>
{/if}

<style>
	section { margin: 18px 0; }
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 10px; }
	.email { font-size: 1rem; font-weight: 600; margin: 0 0 6px; overflow-wrap: anywhere; }
	.hint { color: var(--color-text-muted); font-size: 0.8125rem; margin: 0 0 12px; line-height: 1.5; }
	.hint.net { margin-top: -6px; }
	.sent { background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface-2)); border: 1px solid var(--color-primary); border-radius: 12px; padding: 12px 14px; font-size: 0.875rem; line-height: 1.5; margin: 0; }
	.field { display: flex; flex-direction: column; gap: 6px; font-size: 0.8125rem; color: var(--color-text-muted); margin-bottom: 12px; }
	.field input { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 10px; color: var(--color-text); padding: 12px 14px; font-size: 1rem; width: 100%; box-sizing: border-box; }
	.field input:focus { outline: 2px solid var(--color-primary); outline-offset: 0; border-color: transparent; }
	.error { color: #ff5d73; font-size: 0.8125rem; margin: 0 0 12px; }
	.send { width: 100%; background: var(--color-primary); color: #fff; border: none; border-radius: 999px; padding: 12px 20px; font-size: 0.9375rem; font-weight: 600; cursor: pointer; }
	.send:disabled { opacity: 0.55; cursor: default; }
</style>
