import { describe, it, expect } from 'vitest';
import {
	parseLRC,
	inferQualityFromUrl,
	splitParenLines,
	dominantScript,
	reorderPairs,
	lineSeekFraction,
	activeLineAt
} from './lrc';

describe('parseLRC', () => {
	// Test 1: sorted ascending by time, blank lines dropped.
	it('parses [mm:ss.xxx] lyrics into a time-sorted array, dropping blanks', () => {
		expect(parseLRC('[00:12.34]hello\n[00:01.00]world')).toEqual([
			{ time: 1, text: 'world' },
			{ time: 12.34, text: 'hello' }
		]);
	});

	// Test 2: the no-millis branch.
	it('handles the no-millis branch [mm:ss]', () => {
		expect(parseLRC('[01:05]line')).toEqual([{ time: 65, text: 'line' }]);
	});

	it('returns [] for empty/falsy input', () => {
		expect(parseLRC('')).toEqual([]);
	});

	it('drops lines whose text is blank after stripping the timestamp', () => {
		expect(parseLRC('[00:00.00]\n[00:02.00]kept')).toEqual([{ time: 2, text: 'kept' }]);
	});
});

describe('inferQualityFromUrl', () => {
	// Test 3: lossless vs 320k branches.
	it('returns lossless for .flac', () => {
		expect(inferQualityFromUrl('https://x/y.flac')).toEqual({ tag: 'lossless', label: 'LOSSLESS' });
	});

	it('returns 320k for .mp3 (the everything-else branch)', () => {
		expect(inferQualityFromUrl('https://x/y.mp3')).toEqual({ tag: '320k', label: '320K' });
	});

	it('treats wav/ape/alac/aiff as lossless', () => {
		for (const ext of ['wav', 'ape', 'alac', 'aiff']) {
			expect(inferQualityFromUrl(`https://x/y.${ext}`)).toEqual({
				tag: 'lossless',
				label: 'LOSSLESS'
			});
		}
	});

	it('returns {tag:null,label:""} for a null url', () => {
		expect(inferQualityFromUrl(null)).toEqual({ tag: null, label: '' });
	});

	it('ignores query strings when sniffing the extension', () => {
		expect(inferQualityFromUrl('https://x/y.flac?token=abc')).toEqual({
			tag: 'lossless',
			label: 'LOSSLESS'
		});
	});
});

describe('splitParenLines', () => {
	it('splits a line with one ASCII parens clause into two entries sharing the timestamp', () => {
		const out = splitParenLines([{ time: 10, text: 'or never (我们可以一同去往世界各地)' }]);
		expect(out).toEqual([
			{ time: 10, text: 'or never' },
			{ time: 10, text: '我们可以一同去往世界各地', fromParen: true }
		]);
	});

	it('recognises full-width parens too', () => {
		const out = splitParenLines([{ time: 5, text: '愛 (love) ／ 永遠（forever）' }]);
		expect(out[0]).toEqual({ time: 5, text: '愛 ／ 永遠' });
		expect(out[1]).toEqual({ time: 5, text: 'love', fromParen: true });
		expect(out[2]).toEqual({ time: 5, text: 'forever', fromParen: true });
		expect(out).toHaveLength(3);
	});

	it('passes lines without parens through untouched (no fromParen)', () => {
		const out = splitParenLines([{ time: 0, text: 'plain line' }]);
		expect(out).toEqual([{ time: 0, text: 'plain line' }]);
	});

	it('treats a whole-line parens (no other text) as a single line, no split', () => {
		const out = splitParenLines([{ time: 1, text: '(only this)' }]);
		expect(out).toEqual([{ time: 1, text: '(only this)' }]);
	});

	it('recognises all 9 bracket pairs when the clause script mismatches the main text', () => {
		// Latin main text + a CJK (Han) clause in each bracket type → each splits out.
		const pairs: [string, string][] = [
			['（', '）'],
			['(', ')'],
			['【', '】'],
			['[', ']'],
			['［', '］'],
			['「', '」'],
			['『', '』'],
			['〈', '〉'],
			['《', '》']
		];
		for (const [open, close] of pairs) {
			const out = splitParenLines([{ time: 2, text: `main line ${open}副歌${close}` }]);
			expect(out).toEqual([
				{ time: 2, text: 'main line' },
				{ time: 2, text: '副歌', fromParen: true }
			]);
		}
	});

	it('splits a CJK clause out of a Latin line (script mismatch)', () => {
		const out = splitParenLines([{ time: 10, text: 'or never （我们可以一同去往世界各地）' }]);
		expect(out).toEqual([
			{ time: 10, text: 'or never' },
			{ time: 10, text: '我们可以一同去往世界各地', fromParen: true }
		]);
	});

	it('NEVER drops a same-script bracketed clause — Latin backing vocals stay inline', () => {
		const out = splitParenLines([{ time: 3, text: 'oh yeah (oh oh)' }]);
		// same script (latin/latin) → no split, no fromParen entry, clause survives in text
		expect(out).toEqual([{ time: 3, text: 'oh yeah (oh oh)' }]);
		expect(out.some((l) => l.fromParen)).toBe(false);
	});

	it('NEVER drops a same-script CJK bracketed clause — Han quote stays inline', () => {
		const out = splitParenLines([{ time: 4, text: '愛「だよ」永遠' }]);
		// 'だよ' has kana → kana; main '愛永遠' is han → these DIFFER, so it WOULD split.
		// Use an all-Han same-script case to assert never-drop:
		const out2 = splitParenLines([{ time: 4, text: '我爱你「真的」哦' }]);
		expect(out2).toEqual([{ time: 4, text: '我爱你「真的」哦' }]);
		expect(out2.some((l) => l.fromParen)).toBe(false);
		// (out is referenced to keep the kana-vs-han mismatch documented)
		expect(out.some((l) => l.fromParen)).toBe(true);
	});

	it('passes a whole-line bracket / section marker through unsplit (D-09)', () => {
		expect(splitParenLines([{ time: 0, text: '[Chorus]' }])).toEqual([
			{ time: 0, text: '[Chorus]' }
		]);
		expect(splitParenLines([{ time: 1, text: '【副歌】' }])).toEqual([
			{ time: 1, text: '【副歌】' }
		]);
	});

	it('pairs each open bracket with its MATCHING close on a mixed-bracket line (Pitfall 4)', () => {
		// 愛（love）【chorus】: main text is Han (愛); both clauses are Latin → both split.
		const out = splitParenLines([{ time: 6, text: '愛（love）【chorus】' }]);
		expect(out).toEqual([
			{ time: 6, text: '愛' },
			{ time: 6, text: 'love', fromParen: true },
			{ time: 6, text: 'chorus', fromParen: true }
		]);
	});

	it('keeps a same-script clause inline while splitting a mismatched one on the same line', () => {
		// Latin main + Latin clause (oh oh) stays; Han clause splits out.
		const out = splitParenLines([{ time: 8, text: 'sing (oh oh) （副歌）' }]);
		expect(out).toEqual([
			{ time: 8, text: 'sing (oh oh)' },
			{ time: 8, text: '副歌', fromParen: true }
		]);
	});
});

describe('lineSeekFraction', () => {
	it('returns time/duration when duration > 0', () => {
		expect(lineSeekFraction(30, 120)).toBe(0.25);
		expect(lineSeekFraction(0, 100)).toBe(0);
	});

	it('returns null when duration === 0', () => {
		expect(lineSeekFraction(10, 0)).toBeNull();
	});

	it('returns null for negative or non-finite duration', () => {
		expect(lineSeekFraction(10, -5)).toBeNull();
		expect(lineSeekFraction(10, Infinity)).toBeNull();
		expect(lineSeekFraction(10, NaN)).toBeNull();
	});
});

describe('lrc pipeline idempotency', () => {
	it('splitParenLines(reorderPairs(parseLRC(x))) is stable when applied twice', () => {
		const raw =
			'[00:10.00]we can go anywhere together\n' +
			'[00:10.00]我们可以一同去往世界各地\n' +
			'[00:20.00]another line （副歌）\n' +
			'[00:30.00]plain line';
		const pipe = (txt: string) => splitParenLines(reorderPairs(parseLRC(txt)));
		const once = pipe(raw);
		// Re-running reorder+split over the already-processed lines must be a no-op
		// (deterministic pure function of input — Pitfall 2 action item).
		const twice = splitParenLines(reorderPairs(once));
		expect(twice).toEqual(once);
	});
});

describe('dominantScript', () => {
	it('classifies a pure-Han (CN) line as han', () => {
		expect(dominantScript('稻香')).toBe('han');
	});

	it('classifies a kanji+kana (JP) line as kana — any kana presence wins over Han count (A1)', () => {
		expect(dominantScript('君のため')).toBe('kana');
		// kanji-heavy JP line with only a little kana still resolves to kana
		expect(dominantScript('心配だ')).toBe('kana');
	});

	it('classifies a hangul (KR) line as hangul', () => {
		expect(dominantScript('사랑해')).toBe('hangul');
	});

	it('classifies an English (latin) line as latin', () => {
		expect(dominantScript('or never')).toBe('latin');
	});

	it('classifies a digits/punctuation-only line as other', () => {
		expect(dominantScript('123 ... !!!')).toBe('other');
		expect(dominantScript('')).toBe('other');
	});

	it('resolves a mixed Han+Latin line by max count (no kana → max wins)', () => {
		// mostly Han, a couple of latin chars → han
		expect(dominantScript('告白气球 oh')).toBe('han');
		// mostly latin, a couple of Han → latin
		expect(dominantScript('hello world 你')).toBe('latin');
	});
});

describe('reorderPairs', () => {
	it('moves the EN original above its CN translation within a same-timestamp group', () => {
		// Song is EN-dominant overall; CN line is the translation → original (EN) first.
		const input = [
			{ time: 10, text: '我们可以一同去往世界各地' },
			{ time: 10, text: 'we can go anywhere together' }
		];
		const out = reorderPairs(input);
		expect(out).toEqual([
			{ time: 10, text: 'we can go anywhere together' },
			{ time: 10, text: '我们可以一同去往世界各地' }
		]);
	});

	it('returns a pure-CN song unchanged (no-op)', () => {
		const input = [
			{ time: 0, text: '稻香' },
			{ time: 5, text: '麦田' },
			{ time: 10, text: '回家' }
		];
		expect(reorderPairs(input)).toEqual(input);
	});

	it('moves a JP-kana original above its CN translation', () => {
		const input = [
			{ time: 3, text: '永远的爱' },
			{ time: 3, text: '君のため' }
		];
		const out = reorderPairs(input);
		expect(out).toEqual([
			{ time: 3, text: '君のため' },
			{ time: 3, text: '永远的爱' }
		]);
	});

	it('moves a KR-hangul original above its CN translation', () => {
		const input = [
			{ time: 7, text: '我爱你' },
			{ time: 7, text: '사랑해' }
		];
		const out = reorderPairs(input);
		expect(out).toEqual([
			{ time: 7, text: '사랑해' },
			{ time: 7, text: '我爱你' }
		]);
	});

	it('preserves stable relative order of non-reordered lines in a 3-line group', () => {
		// EN-dominant song; one EN original + two CN translation siblings.
		// Original moves to front; the two CN lines keep their relative order.
		const input = [
			{ time: 4, text: '第一句翻译' },
			{ time: 4, text: 'the only english line' },
			{ time: 4, text: '第二句翻译' }
		];
		const out = reorderPairs(input);
		expect(out).toEqual([
			{ time: 4, text: 'the only english line' },
			{ time: 4, text: '第一句翻译' },
			{ time: 4, text: '第二句翻译' }
		]);
	});

	it('is idempotent: reorderPairs(reorderPairs(x)) === reorderPairs(x)', () => {
		const input = [
			{ time: 10, text: '我们可以一同去往世界各地' },
			{ time: 10, text: 'we can go anywhere together' },
			{ time: 20, text: '另一句' },
			{ time: 20, text: 'another line here' }
		];
		const once = reorderPairs(input);
		const twice = reorderPairs(once);
		expect(twice).toEqual(once);
	});
});

// quick-260919-1we: the active-line scan, lifted verbatim out of NowPlaying so the Nowbar's one-line
// variant shares it. These assertions ARE the extraction's regression gate — NowPlaying's scroll
// anchor and its sibling-active test both read this return, so a "cleanup" that changed the group
// contract would silently desync the highlighted line from the scrolled-to line.
describe('activeLineAt', () => {
	const L = (time: number, text: string) => ({ time, text });

	it('is inactive before the first timestamp', () => {
		expect(activeLineAt([L(5, 'a'), L(10, 'b')], 0)).toEqual({ idx: -1, time: -1 });
		expect(activeLineAt([L(5, 'a')], 4.99)).toEqual({ idx: -1, time: -1 });
	});

	it('activates at/after a timestamp — exactly ON the boundary counts', () => {
		const lines = [L(5, 'a'), L(10, 'b')];
		expect(activeLineAt(lines, 5)).toEqual({ idx: 0, time: 5 });
		expect(activeLineAt(lines, 7.2)).toEqual({ idx: 0, time: 5 });
		expect(activeLineAt(lines, 10)).toEqual({ idx: 1, time: 10 });
	});

	it('anchors a same-timestamp GROUP on its FIRST entry (do not "fix" this to the last)', () => {
		// The CN original + inline-translation pair, the reason the contract is what it is.
		const lines = [L(5, 'original'), L(5, 'translation'), L(5, '(paren)'), L(9, 'next')];
		expect(activeLineAt(lines, 6)).toEqual({ idx: 0, time: 5 });
		// `time` is what every sibling compares against to render itself active.
		expect(lines.filter((l) => l.time === activeLineAt(lines, 6).time)).toHaveLength(3);
	});

	it('an empty array is inactive', () => {
		expect(activeLineAt([], 12)).toEqual({ idx: -1, time: -1 });
	});

	it('past the final timestamp the last line stays active (no wrap, no reset)', () => {
		const lines = [L(5, 'a'), L(10, 'b')];
		expect(activeLineAt(lines, 10_000)).toEqual({ idx: 1, time: 10 });
	});
});
