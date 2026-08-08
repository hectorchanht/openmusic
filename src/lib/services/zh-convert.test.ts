import { describe, it, expect, vi } from 'vitest';
import {
	s2tConvertLines,
	t2sConvertLines,
	isChineseLine,
	warmS2T,
	s2tConvertLineSync
} from './zh-convert';

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

describe('t2sConvertLines — Traditional→Simplified for the /api/og cover search (quick-260807-vl1)', () => {
	// The production repro: the Traditional pair misses every cover tier, the Simplified pair hits
	// 4/4. og-cover.ts converts FIRST and searches with these outputs.
	it('converts the probed repro title 止戰之殤 → 止战之殇', async () => {
		expect(await t2sConvertLines(['止戰之殤'])).toEqual(['止战之殇']);
	});

	it('converts the probed repro artist 周傑倫 (傑→杰, 倫→伦)', async () => {
		const [out] = await t2sConvertLines(['周傑倫']);
		expect(out).toContain('杰');
		expect(out).toContain('伦');
		expect(out).not.toContain('傑');
		expect(out).not.toContain('倫');
	});

	it('is a NO-OP on already-Simplified input (this is what makes the fix zero-cost)', async () => {
		expect(await t2sConvertLines(['周杰伦', '止战之殇'])).toEqual(['周杰伦', '止战之殇']);
	});

	it('leaves a non-Chinese string unchanged', async () => {
		expect(await t2sConvertLines(['Come As You Are'])).toEqual(['Come As You Are']);
	});

	it('preserves length and blank slots positionally (out.length === in.length)', async () => {
		const out = await t2sConvertLines(['止戰之殤', '', 'Nirvana', '中國']);
		expect(out).toEqual(['止战之殇', '', 'Nirvana', '中国']);
		expect(out.length).toBe(4);
	});

	it('returns [] for empty input (no dict load needed)', async () => {
		expect(await t2sConvertLines([])).toEqual([]);
	});

	it('never throws — a broken dict import degrades to IDENTITY', async () => {
		// Force the lazy import to fail (the never-throw boundary the edge caller depends on: a
		// converter fault must mean "searched the original terms", never a 500).
		vi.doMock('tongwen-dict/dist/t2s-char.min.json', () => {
			throw new Error('chunk load failed');
		});
		vi.resetModules();
		const { t2sConvertLines: broken } = await import('./zh-convert');
		expect(await broken(['止戰之殤'])).toEqual(['止戰之殤']);
		vi.doUnmock('tongwen-dict/dist/t2s-char.min.json');
		vi.resetModules();
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

describe('s2tConvertLineSync / warmS2T — synchronous no-flash path (quick-260712-et3)', () => {
	// The display-name resolver calls s2tConvertLineSync on the FIRST render so a zh-Hant name
	// paints Traditional immediately instead of Simplified-then-flip. It returns null until the
	// lazy dict is warm; warmS2T() (fire-and-forget) kicks that load at app boot.
	it('converts synchronously once the dict is warm (same D-01 quality as the async path)', async () => {
		warmS2T(); // kick the lazy load
		await s2tConvertLines(['简体']); // await the SAME memoized load so the dict is guaranteed built
		expect(s2tConvertLineSync('简体中文')).toBe('簡體中文'); // per-char
		expect(s2tConvertLineSync('头发')).toBe('頭髮'); // phrase-level (D-01) on the sync path too
	});

	it('passes already-Traditional input through unchanged (identity is a stable result)', async () => {
		await s2tConvertLines(['x']); // ensure warm
		expect(s2tConvertLineSync('台灣')).toBe('台灣');
	});

	it('returns null for an empty line (nothing to convert)', () => {
		expect(s2tConvertLineSync('')).toBeNull();
	});
});
