import { describe, it, expect } from 'vitest';
import { splitLyricSegments, isMixedLyricLine } from './lyric-segments';

// quick-261120-segmix: the segment splitter behind the mixed-line translation fix.
// Contract: Han runs are 'cjk' (offline script conversion only), letter-bearing
// non-Han runs are 'mt' (MT API), letter-free runs are 'raw' (pass-through), and
// joining the segment texts reproduces the input EXACTLY.
describe('splitLyricSegments', () => {
	it('splits a Han + English line into a cjk run and an mt run', () => {
		expect(splitLyricSegments('我爱你 love you')).toEqual([
			{ kind: 'cjk', text: '我爱你 ' },
			{ kind: 'mt', text: 'love you' }
		]);
	});

	it('alternates runs in original order, spacing glued to the run it follows', () => {
		expect(splitLyricSegments('love 我爱你 forever')).toEqual([
			{ kind: 'mt', text: 'love ' },
			{ kind: 'cjk', text: '我爱你 ' },
			{ kind: 'mt', text: 'forever' }
		]);
	});

	it('pure lines are a single run of their own kind', () => {
		expect(splitLyricSegments('简体中文')).toEqual([{ kind: 'cjk', text: '简体中文' }]);
		expect(splitLyricSegments('hello world')).toEqual([{ kind: 'mt', text: 'hello world' }]);
		expect(splitLyricSegments('')).toEqual([]);
	});

	it('digits and punctuation glue onto the Han run instead of fragmenting it', () => {
		expect(splitLyricSegments('第1名 first')).toEqual([
			{ kind: 'cjk', text: '第1名 ' },
			{ kind: 'mt', text: 'first' }
		]);
		expect(splitLyricSegments('我爱你, love')).toEqual([
			{ kind: 'cjk', text: '我爱你, ' },
			{ kind: 'mt', text: 'love' }
		]);
	});

	it('a letter-free line is one raw run (nothing translatable, nothing convertible)', () => {
		expect(splitLyricSegments('··· 123')).toEqual([{ kind: 'raw', text: '··· 123' }]);
	});

	it('kana runs are mt, never cjk (the D-04 Japanese-kanji guard at segment level)', () => {
		expect(splitLyricSegments('我愛さくら')).toEqual([
			{ kind: 'cjk', text: '我愛' },
			{ kind: 'mt', text: 'さくら' }
		]);
		expect(splitLyricSegments('사랑해')).toEqual([{ kind: 'mt', text: '사랑해' }]);
	});

	it('joining the segments reproduces the input exactly (stitch invariant)', () => {
		const lines = [
			'我爱你 love you',
			'love 我爱你 forever',
			'我爱你, love you 一起走',
			'  leading and trailing  ',
			'只有中文',
			'only english',
			'第1名 first place 第2名'
		];
		for (const l of lines) {
			expect(splitLyricSegments(l).map((s) => s.text).join('')).toBe(l);
		}
	});
});

describe('isMixedLyricLine', () => {
	it('is true only when a Han run AND a translatable run coexist', () => {
		expect(isMixedLyricLine('我爱你 love you')).toBe(true);
		expect(isMixedLyricLine('我愛さくら')).toBe(true); // Han + kana segment
		expect(isMixedLyricLine('只有中文')).toBe(false);
		expect(isMixedLyricLine('only english')).toBe(false);
		expect(isMixedLyricLine('中文···123')).toBe(false); // Han + furniture only
		expect(isMixedLyricLine('')).toBe(false);
	});
});
