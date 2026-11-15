import { describe, expect, it } from 'vitest';
import { isResumeUrl, NATIVE_RESUME_URL } from './native-resume';

describe('isResumeUrl', () => {
	it('accepts the exact URL ColdMediaLaunch.kt sends', () => {
		expect(isResumeUrl(NATIVE_RESUME_URL)).toBe(true);
	});
	it('rejects everything else', () => {
		for (const u of [null, undefined, '', 'junk', 'openmusic://auth/callback?token=x', 'https://openmusic.lol/play/resume', 'openmusic://play/other']) {
			expect(isResumeUrl(u)).toBe(false);
		}
	});
});
