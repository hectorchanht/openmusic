<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { CircleCheck, MailWarning } from '@lucide/svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { buildAuthCallbackUrl } from '$lib/auth/auth-core';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';

	// quick-261020-acct: the magic-link landing page. The email link points HERE
	// (not at an API endpoint) so redeeming the token is a POST from this page's JS —
	// a mail scanner that merely FETCHES the link cannot burn the single-use token.
	// On success → /settings/account; on failure → the friendly error below.
	//
	// quick-261020-deeplink: this page runs in the SYSTEM browser when the request came
	// from the APK — the session cookie it sets here can never reach the app's WebView.
	// A scheme-tagged redeem (the token row carried 'openmusic://') therefore STAYS on a
	// handoff state: a prominent "Open in OpenMusic" button pointing at
	// openmusic://auth/callback?token=<session-bearer>. Tapping it routes through the
	// manifest's intent-filter into the app, which adopts the bearer (adoptNativeToken)
	// and lands signed in. The bearer is multi-use, so re-tapping the button is harmless.
	let failed = $state(false);
	let deepLink = $state<string | null>(null);

	onMount(async () => {
		const token = page.url.searchParams.get('token') ?? '';
		// Strip the token from the address bar FIRST THING: a copied or shared URL must
		// never carry a (possibly still live) credential, and history must not keep it.
		try {
			history.replaceState(history.state, '', '/auth/magic');
		} catch {
			/* history unavailable — redeeming still works, only the bar keeps the token */
		}
		if (!token) {
			failed = true;
			return;
		}
		const res = await auth.verify(token);
		if (!res.ok) {
			failed = true;
			return;
		}
		if (res.scheme && res.token) {
			deepLink = buildAuthCallbackUrl(res.scheme, res.token);
			return;
		}
		await goto('/settings/account');
	});
</script>

<svelte:head><title>{t('account.verifyTitle')}</title></svelte:head>

<main class="magic">
	{#if failed}
		<MailWarning size={40} class="magic-ic" />
		<h1>{t('account.verifyFailedTitle')}</h1>
		<p>{t('account.verifyFailed')}</p>
		<button class="home" onclick={() => goto('/')} use:tapBounce>{t('account.backHome')}</button>
	{:else if deepLink}
		<CircleCheck size={40} class="magic-ic" />
		<h1>{t('account.openInAppTitle')}</h1>
		<p>{t('account.openInAppDesc')}</p>
		<a class="home" href={deepLink} use:tapBounce>{t('account.openInApp')}</a>
	{:else}
		<h1>{t('account.verifyTitle')}</h1>
		<p>{t('account.verifySub')}</p>
	{/if}
</main>

<style>
	.magic { max-width: 420px; margin: 0 auto; padding: calc(env(safe-area-inset-top, 0px) + 64px) 20px 40px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
	.magic h1 { font-size: 1.25rem; margin: 6px 0 0; }
	.magic p { color: var(--color-text-muted); font-size: 0.875rem; margin: 0; line-height: 1.5; }
	.magic :global(.magic-ic) { color: var(--color-primary); }
	.home { margin-top: 14px; background: var(--color-primary); color: #fff; border: none; border-radius: 999px; padding: 10px 22px; font-size: 0.875rem; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
</style>
