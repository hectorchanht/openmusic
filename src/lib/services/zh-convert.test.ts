import { describe, it, expect } from 'vitest';
import { s2tConvertLines, isChineseLine } from './zh-convert';

// Pure/node tests (no jsdom, no $app/environment mock, no localStorage): zh-convert is a pure
// service whose only side effect is a dynamic import() of the tongwen s2t dict, which Vitest
// resolves natively. These pin the D-01 phrase-level conversion quality AND the D-04
// Japanese-kanji offline-eligibility guard (isChineseLine('さくら') === false).

describe('s2tConvertLines — offline Simplified→Traditional (D-01)', () => {
	it('converts basic characters (per-char single map)', async () => {
		expect(await s2tConvertLines(['简体中文'])).toEqual(['簡體中文']);
	});

	it('disambiguates at phrase level (头发→頭髮, not 頭發)', async () => {
		// D-01 quality claim: a char-only lib would mis-convert 发; the phrase map picks 髮.
		expect(await s2tConvertLines(['头发'])).toEqual(['頭髮']);
	});

	it('preserves length and blank slots (out.length === in.length)', async () => {
		expect(await s2tConvertLines(['', '中国'])).toEqual(['', '中國']);
	});

	it('is a no-op on already-Traditional input', async () => {
		expect(await s2tConvertLines(['台灣'])).toEqual(['台灣']);
	});

	it('returns [] for empty input (no dict load needed)', async () => {
		expect(await s2tConvertLines([])).toEqual([]);
	});

	it('converts a mixed batch positionally', async () => {
		const out = await s2tConvertLines(['头发', '', '简体中文', '台灣']);
		expect(out).toEqual(['頭髮', '', '簡體中文', '台灣']);
		expect(out.length).toBe(4);
	});
});

describe('isChineseLine — offline-eligibility predicate (D-04)', () => {
	it('is true for Simplified Chinese', () => {
		expect(isChineseLine('简体')).toBe(true);
	});

	it('is true for Traditional Chinese', () => {
		expect(isChineseLine('中國風')).toBe(true);
	});

	it('is FALSE for lines containing kana (Japanese guard, D-04)', () => {
		// The critical JA-kanji-vs-Chinese edge: kana present ⇒ detectLang→"ja" ⇒ leave for the
		// API cascade so Japanese lyrics are never wrongly s2t-converted.
		expect(isChineseLine('さくら')).toBe(false);
	});

	it('is false for hangul (Korean)', () => {
		expect(isChineseLine('안녕')).toBe(false);
	});

	it('is false for pure Latin / English', () => {
		expect(isChineseLine('hello world')).toBe(false);
	});

	it('is false for an empty line', () => {
		expect(isChineseLine('')).toBe(false);
	});
});
