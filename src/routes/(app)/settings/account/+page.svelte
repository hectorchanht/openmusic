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
	import { NATIVE_APP_SCHEME, GOOGLE_WEB_CLIENT_ID } from '$lib/auth/auth-core';
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
		try {
			const raw = localStorage.getItem(RECENT_EMAILS_KEY);
			const parsed = raw ? (JSON.parse(raw) as unknown) : null;
			if (Array.isArray(parsed)) recentEmails = parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT_EMAILS);
		} catch {
			/* storage unavailable — no recent emails, non-fatal */
		}
		// quick-261020-google — web only: the Google Identity Services button. The APK
		// uses the Play-Services plugin instead (nativeGoogleSignIn below).
		if (!isNative) void initGis();
	});

	/** Device-local recent emails for one-tap fill (Hector 2026-10-20: "one click to fill
	 *  in email") — the WebView's OS autofill doesn't offer candidates, so the app keeps its
	 *  own short list. Namespaced like every other openmusic:<domain>:v<N> key. */
	const RECENT_EMAILS_KEY = 'openmusic:recent-emails:v1';
	const MAX_RECENT_EMAILS = 3;

	let email = $state('');
	let sending = $state(false);
	let sent = $state(false);
	let recentEmails = $state<string[]>([]);
	// A TranslationKey (not raw text) — the store→UI one-way rule.
	let errorKey = $state<TranslationKey | null>(null);
	let signOutOpen = $state(false);
	// quick-261020-google — Google sign-in state (separate from the magic-link errorKey).
	let googleLoading = $state(false);
	let googleError = $state(false);
	let gisButtonHost: HTMLDivElement | undefined = $state();
	let gisReady = $state(false);

	/** Remember a successfully-sent email (most-recent-first, deduped, capped). */
	function rememberEmail(clean: string) {
		const list = [clean, ...recentEmails.filter((x) => x !== clean)].slice(0, MAX_RECENT_EMAILS);
		recentEmails = list;
		try {
			localStorage.setItem(RECENT_EMAILS_KEY, JSON.stringify(list));
		} catch {
			/* non-fatal */
		}
	}

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
		if (errorKey === null) {
			sent = true;
			rememberEmail(email.trim().toLowerCase());
		}
	}

	/**
	 * quick-261020-google — web: render the Google Identity Services button. The GIS
	 * script is loaded lazily (never in the APK) and the button lives in gisButtonHost.
	 * The callback credential is a JWT idToken with aud = the web client — the server
	 * verifies it exactly like a native token. A GIS load failure is silent: the magic
	 * link still works.
	 */
	async function initGis() {
		if (gisReady || !browser) return;
		try {
			await loadGisScript();
			const g = window.google?.accounts?.id;
			if (!g || !gisButtonHost) return;
			g.initialize({
				client_id: GOOGLE_WEB_CLIENT_ID,
				callback: (resp) => void onGoogleCredential(resp?.credential)
			});
			g.renderButton(gisButtonHost, {
				theme: 'filled_black',
				size: 'large',
				width: 300,
				text: 'signin_with'
			});
			gisReady = true;
		} catch {
			/* GIS unavailable — magic link remains */
		}
	}

	function loadGisScript(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (document.querySelector('script[src="https://accounts.google.com/gsi/client"]')) {
				resolve();
				return;
			}
			const s = document.createElement('script');
			s.src = 'https://accounts.google.com/gsi/client';
			s.async = true;
			s.defer = true;
			s.onload = () => resolve();
			s.onerror = () => reject(new Error('gis-load'));
			document.head.appendChild(s);
		});
	}

	/** Shared landing for the GIS callback AND the native plugin: one idToken in. */
	async function onGoogleCredential(credential: string | undefined) {
		googleError = false;
		if (!credential) {
			googleError = true;
			return;
		}
		googleLoading = true;
		try {
			const res = await auth.signInWithGoogle(credential);
			// Success: auth.user is set → the page re-renders into the signed-in section
			// (and the sync engine's first pass pulls the account's envelope).
			if (!res.ok) googleError = true;
		} finally {
			googleLoading = false;
		}
	}

	/**
	 * quick-261020-google — native: Play-Services Google Sign-In, NO Firebase. The
	 * plugin mints an ID token with aud = the web client (see the GoogleAuth block in
	 * capacitor.config.ts), so the server verifies it exactly like a GIS credential.
	 * Dynamic import keeps the plugin out of the web bundle.
	 */
	async function nativeGoogleSignIn() {
		if (googleLoading) return;
		googleError = false;
		googleLoading = true;
		try {
			const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');
			const user = await GoogleAuth.signIn();
			// A cancelled account chooser lands here too — one quiet error line, no drama.
			await onGoogleCredential(user?.authentication?.idToken);
		} catch {
			googleError = true;
		} finally {
			googleLoading = false;
		}
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
			<!-- quick-261020-onefill (Hector: "one click to fill in email") — the WebView's OS
			     autofill offers no candidates, so the last-used emails are one tap away.
			     Shown only while the field is empty; typing hides them. -->
			{#if recentEmails.length > 0 && !email}
				<div class="chips">
					{#each recentEmails as e (e)}
						<button type="button" class="chip" onclick={() => (email = e)} use:tapBounce>{e}</button>
					{/each}
				</div>
			{/if}
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
							<!-- quick-261020-realerr (Hector: "why don't you show the real error
							     message?") — the RAW failure, not a paraphrase: per-attempt
							     name/message/elapsed plus the differential server probe. -->
							{#if auth.lastLinkDiag}
								<p class="diag">{auth.lastLinkDiag}</p>
							{/if}
						{/if}
					{/if}
					<button class="send" type="submit" disabled={sending} use:tapBounce>
						{sending ? t('account.sending') : t('account.sendLink')}
					</button>
				</form>
			{/if}
			<!-- quick-261020-google — the second sign-in path, next to the magic link. The
			     two coexist: magic link for email-first, Google for one-tap. -->
			<div class="or"><span>{t('account.googleOr')}</span></div>
			{#if isNative}
				<button class="google" onclick={() => void nativeGoogleSignIn()} disabled={googleLoading} use:tapBounce>
					<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41 35.4 44 30.2 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
					{googleLoading ? t('account.googleSigningIn') : t('account.googleSignIn')}
				</button>
			{:else}
				<div class="gis" bind:this={gisButtonHost}></div>
				{#if googleLoading}
					<p class="hint">{t('account.googleSigningIn')}</p>
				{/if}
			{/if}
			{#if googleError}
				<p class="error">{t('account.errGoogle')}</p>
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
	/* quick-261020-onefill — one-tap recent-email chips. Pill buttons, muted; the email
	   text itself is the label, so no i18n key needed. */
	.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); border-radius: 999px; padding: 8px 14px; font-size: 0.8125rem; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.chip:active { border-color: var(--color-primary); }
	/* quick-261020-realerr — the raw diagnostic: muted, monospace, wraps. Technical on
	   purpose — it's a log line for diagnosis, not user copy. */
	.diag { color: var(--color-text-muted); font-family: ui-monospace, monospace; font-size: 0.6875rem; line-height: 1.5; margin: -6px 0 12px; overflow-wrap: anywhere; opacity: 0.85; }
	.send { width: 100%; background: var(--color-primary); color: #fff; border: none; border-radius: 999px; padding: 12px 20px; font-size: 0.9375rem; font-weight: 600; cursor: pointer; }
	.send:disabled { opacity: 0.55; cursor: default; }
	/* quick-261020-google — the divider + second sign-in path. */
	.or { display: flex; align-items: center; gap: 10px; margin: 16px 0 12px; color: var(--color-text-muted); font-size: 0.75rem; }
	.or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--color-border); }
	.google { width: 100%; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); border-radius: 999px; padding: 12px 20px; font-size: 0.9375rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; }
	.google:disabled { opacity: 0.55; cursor: default; }
	.gis { display: flex; justify-content: center; margin: 0 0 4px; min-height: 44px; }
</style>
