import { describe, it, expect } from 'vitest';
// Import ONLY the PURE exports (no $state / browser) — these run under the node
// Vitest project, mirroring i18n.test.ts.
import { detectLang, shouldTranslate } from './detect';

describe('detectLang', () => {
	it('classifies Hiragana as ja', () => {
		expect(detectLang('こんにちは')).toBe('ja');
	});

	it('classifies Katakana as ja', () => {
		expect(detectLang('テスト')).toBe('ja');
	});

	it('classifies Hangul (syllables) as ko', () => {
		expect(detectLang('안녕')).toBe('ko');
	});

	it('classifies Hangul jamo as ko', () => {
		expect(detectLang('ㄱㄴㄷ')).toBe('ko');
	});

	it('classifies Latin text as en', () => {
		expect(detectLang('Taylor Swift')).toBe('en');
		expect(detectLang('Hello World')).toBe('en');
	});

	it('classifies empty string as en', () => {
		expect(detectLang('')).toBe('en');
	});

	it('classifies simplified-only Han as zh-Hans', () => {
		// 简体 + 爱国 are simplified-only forms.
		expect(detectLang('简体')).toBe('zh-Hans');
		expect(detectLang('爱国')).toBe('zh-Hans');
	});

	it('classifies traditional-only Han as zh-Hant', () => {
		// 繁體 + 愛國 are traditional-only forms.
		expect(detectLang('繁體')).toBe('zh-Hant');
		expect(detectLang('愛國')).toBe('zh-Hant');
	});

	it('classifies ambiguous Han (no signal either way) as zh-Hant', () => {
		// Characters identical in both scripts → default Traditional.
		expect(detectLang('人山')).toBe('zh-Hant');
	});

	it('lets kana win over Han when both present', () => {
		expect(detectLang('東京テスト')).toBe('ja');
		expect(detectLang('愛のうた')).toBe('ja');
	});

	it('lets hangul win over Han when both present', () => {
		expect(detectLang('韓國안녕')).toBe('ko');
	});
});

describe('shouldTranslate', () => {
	it('returns false when target is off (regardless of whitelist)', () => {
		expect(shouldTranslate('Hello', 'off', [])).toBe(false);
		expect(shouldTranslate('简体', 'off', ['ja'])).toBe(false);
	});

	it('returns false when the detected source is in the whitelist', () => {
		expect(shouldTranslate('Taylor Swift', 'zh-Hant', ['en'])).toBe(false);
		expect(shouldTranslate('简体', 'zh-Hant', ['zh-Hans'])).toBe(false);
	});

	it('skips an exact src===target match ONLY for non-Chinese targets (reliable detection)', () => {
		expect(shouldTranslate('Hello', 'en', [])).toBe(false);
		expect(shouldTranslate('こんにちは', 'ja', [])).toBe(false);
	});

	it('still translates Han for a Chinese target even when detection says src===target', () => {
		// zh detection is unreliable on a small char-set: 繁體 detects as zh-Hant but we still
		// route it through the converter (no-op when already correct) so misdetected simplified
		// never gets stranded. Opt out by adding the script to the whitelist.
		expect(shouldTranslate('繁體', 'zh-Hant', [])).toBe(true);
		expect(shouldTranslate('繁體', 'zh-Hant', ['zh-Hant'])).toBe(false); // whitelist opt-out
	});

	it('translates simplified Han that misdetects as zh-Hant (陈奕迅 regression)', () => {
		// 陈/奕/迅 are NOT in the SIMP_ONLY disambiguation set → detectLang defaults to zh-Hant.
		// Pre-fix this matched the target and was skipped, leaving 陈奕迅 (simplified) on screen.
		expect(shouldTranslate('陈奕迅', 'zh-Hant', ['en'])).toBe(true);
	});

	it('returns true otherwise', () => {
		expect(shouldTranslate('简体', 'zh-Hant', [])).toBe(true);
		expect(shouldTranslate('Taylor Swift', 'zh-Hant', [])).toBe(true);
		expect(shouldTranslate('こんにちは', 'en', ['ko'])).toBe(true);
	});
});
