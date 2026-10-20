// quick-261020-sync: the honest-error mapping — every requestLink() outcome pins its
// account.* key. The 2026-10-20 APK report showed a generic "Something went wrong"
// while the server HAD created the token and Resend HAD sent the mail; each class gets
// its own message from here on, and this test keeps the mapping from drifting.
import { describe, expect, it } from 'vitest';
import { requestLinkErrorKey } from './request-link-keys';

describe('requestLinkErrorKey', () => {
	it('maps every outcome to its account.* key', () => {
		expect(requestLinkErrorKey('ok')).toBe(null);
		expect(requestLinkErrorKey('invalid-email')).toBe('account.invalidEmail');
		expect(requestLinkErrorKey('rate-limited')).toBe('account.rateLimited');
		expect(requestLinkErrorKey('not-configured')).toBe('account.notConfigured');
		expect(requestLinkErrorKey('send-failed')).toBe('account.sendFailed');
		expect(requestLinkErrorKey('network')).toBe('account.errNetwork');
		expect(requestLinkErrorKey('error')).toBe('account.error');
	});
});
