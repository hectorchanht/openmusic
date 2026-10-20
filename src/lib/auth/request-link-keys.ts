// PURE: map a requestLink() outcome to the `account.*` i18n key the Settings → Account
// page renders (quick-261020-sync).
//
// The auth STORE stays i18n-free (it returns the union); the PAGE localizes. This module
// is the single mapping between the two, extracted so the unit test can pin every
// outcome to its key — including the 'network' case the 2026-10-20 APK report motivated
// (generic "Something went wrong" while the server HAD created the token and Resend HAD
// sent the mail).
//
// `import type` from the runes store is erased at compile, so the node Vitest project
// never loads auth.svelte.ts's runtime.
import type { TranslationKey } from '$lib/i18n';
import type { RequestLinkResult } from '$lib/stores/auth.svelte';

/** null = success (no error line). */
export function requestLinkErrorKey(result: RequestLinkResult): TranslationKey | null {
	switch (result) {
		case 'ok':
			return null;
		case 'invalid-email':
			return 'account.invalidEmail';
		case 'rate-limited':
			return 'account.rateLimited';
		case 'not-configured':
			return 'account.notConfigured';
		case 'send-failed':
			return 'account.sendFailed';
		case 'network':
			return 'account.errNetwork';
		default:
			return 'account.error';
	}
}
