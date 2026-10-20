<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { MailWarning } from '@lucide/svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';

	// quick-261020-acct: the magic-link landing page. The email link points HERE
	// (not at an API endpoint) so redeeming the token is a POST from this page's JS —
	// a mail scanner that merely FETCHES the link cannot burn the single-use token.
	// On success → /settings/account; on failure → the friendly error below.
	let failed = $state(false);

	onMount(async () => {
		const token = page.url.searchParams.get('token') ?? '';
		// Strip the token from the address bar FIRST THING: a copied or shared URL must
		// never carry a (possibly still live) credential, and history must not keep it.
		try {
			history.replaceState(history.state, '', '/auth/magic');
		} catch {
			/* history unavailable — redeeming still works, only the bar keeps the token */
		}
		if (token && (await auth.verify(token))) {
			await goto('/settings/account');
			return;
		}
		failed = true;
	});
</script>

<svelte:head><title>{t('account.verifyTitle')}</title></svelte:head>

<main class="magic">
	{#if failed}
		<MailWarning size={40} class="magic-ic" />
		<h1>{t('account.verifyFailedTitle')}</h1>
		<p>{t('account.verifyFailed')}</p>
		<button class="home" onclick={() => goto('/')} use:tapBounce>{t('account.backHome')}</button>
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
	.home { margin-top: 14px; background: var(--color-primary); color: #fff; border: none; border-radius: 999px; padding: 10px 22px; font-size: 0.875rem; font-weight: 600; cursor: pointer; }
</style>
