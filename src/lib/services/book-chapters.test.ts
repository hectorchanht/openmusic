import { describe, it, expect } from 'vitest';
import {
	parseChineseNumber,
	parseChapter,
	isBookChapter,
	seriesName,
	seriesKey,
	sortChapters,
	groupSeries,
	chaptersFrom,
	seriesQuery
} from './book-chapters';

// quick-261122-books — pins every title shape from Hector's 2026-11-22 screenshot (風雲谷 by
// 小酷說書 / 喜馬拉雅 / 張小樓 / 說書的小曲, 七界武神) plus the ordinary-song negatives.
type T = { uid: string; title: string; album: string; artist: string };
const tr = (uid: string, title: string, album = '', artist = '小酷說書'): T => ({ uid, title, album, artist });

describe('parseChineseNumber', () => {
	it('positional digits: 七八三 = 783, 〇三五 = 35', () => {
		expect(parseChineseNumber('七八三')).toBe(783);
		expect(parseChineseNumber('〇三五')).toBe(35);
		expect(parseChineseNumber('九四八')).toBe(948);
	});
	it('structured: 十 / 十五 / 二十 / 九十五 / 一百零五 / 七百八十三 / 三千二百', () => {
		expect(parseChineseNumber('十')).toBe(10);
		expect(parseChineseNumber('十五')).toBe(15);
		expect(parseChineseNumber('二十')).toBe(20);
		expect(parseChineseNumber('九十五')).toBe(95);
		expect(parseChineseNumber('一百零五')).toBe(105);
		expect(parseChineseNumber('七百八十三')).toBe(783);
		expect(parseChineseNumber('三千二百')).toBe(3200);
		expect(parseChineseNumber('一万零一')).toBe(10001);
		expect(parseChineseNumber('兩百')).toBe(200);
	});
	it('rejects non-numerals', () => {
		expect(parseChineseNumber('')).toBeNull();
		expect(parseChineseNumber('风云')).toBeNull();
	});
});

describe('parseChapter — the screenshot titles', () => {
	const cases: [string, number, string][] = [
		['風雲谷 第783集', 783, '風雲谷'],
		['风云谷 第948集', 948, '风云谷'],
		['风云谷 第95集', 95, '风云谷'],
		['風雲谷 第七八三集', 783, '風雲谷'],
		['風雲谷 第七百八十三集', 783, '風雲谷'],
		['七界武神 - 第 944 集', 944, '七界武神'],
		['风云谷0035', 35, '风云谷'],
		['风云谷 0035', 35, '风云谷'],
		['风云谷_0035', 35, '风云谷'],
		['風雲谷（第12集）', 12, '風雲谷'],
		['风云谷 第一百零五章', 105, '风云谷'],
		['第十回 风云谷', 10, '风云谷'],
		['风云谷 783集', 783, '风云谷'],
		['风云谷 EP12', 12, '风云谷'],
		['风云谷 第783集 夜探谷底', 783, '风云谷 夜探谷底']
	];
	for (const [title, n, rest] of cases) {
		it(`${title} → ${n}`, () => {
			const p = parseChapter(title);
			expect(p?.n).toBe(n);
			expect(p?.strong).toBe(true);
			expect(p?.rest).toBe(rest);
		});
	}

	it('a bare trailing number is a WEAK chapter', () => {
		expect(parseChapter('风云谷 783')).toEqual({ n: 783, strong: false, rest: '风云谷' });
		expect(parseChapter('风云谷-95')).toEqual({ n: 95, strong: false, rest: '风云谷' });
	});

	it('ordinary songs are not chapters', () => {
		expect(parseChapter('晴天')).toBeNull();
		expect(parseChapter('七里香')).toBeNull();
		expect(parseChapter('1989')).toBeNull();
		expect(parseChapter('Summer 2008')).toBeNull();
		expect(parseChapter('2002年的第一场雪')).toBeNull();
		expect(parseChapter('')).toBeNull();
		expect(isBookChapter({ title: '稻香' })).toBe(false);
		expect(isBookChapter({ title: '风云谷 783' })).toBe(false);
		expect(isBookChapter({ title: '风云谷 第783集' })).toBe(true);
	});
});

describe('seriesName / seriesKey', () => {
	it('prefers a real album', () => {
		expect(seriesName(tr('a', '第783集', '风云谷'))).toBe('风云谷');
	});
	it('falls back to title-minus-chapter when album is empty / the title / a per-episode label', () => {
		expect(seriesName(tr('a', '风云谷 第783集'))).toBe('风云谷');
		expect(seriesName(tr('a', '风云谷 第783集', '风云谷 第783集'))).toBe('风云谷');
		expect(seriesName(tr('a', '风云谷 第783集', '第783集'))).toBe('风云谷');
		expect(seriesName(tr('a', '风云谷 第783集', '未知'))).toBe('风云谷');
	});
	it('narrator is part of identity; case/space/punctuation are not', () => {
		expect(seriesKey(tr('a', '风云谷 第1集'))).toBe(seriesKey(tr('b', '风云谷-第2集')));
		expect(seriesKey(tr('a', '风云谷 第1集', '', '小酷說書'))).not.toBe(
			seriesKey(tr('b', '风云谷 第1集', '', '張小樓'))
		);
	});
});

describe('sortChapters', () => {
	it('the screenshot scatter 783, 948, 95, 0035, 七八三… sorts ascending, dupes collapse', () => {
		const list = [
			tr('1', '风云谷 第783集'),
			tr('2', '风云谷 第948集'),
			tr('3', '风云谷 第95集'),
			tr('4', '风云谷0035'),
			tr('5', '風雲谷 第七八三集'),
			tr('6', '风云谷 第1集')
		];
		expect(sortChapters(list).map((t) => t.uid)).toEqual(['6', '4', '3', '1', '2']);
	});
	it('unnumbered rows sink to the end in input order; input not mutated', () => {
		const list = [tr('x', '花絮'), tr('2', '第2集'), tr('y', '片尾'), tr('1', '第1集')];
		const copy = [...list];
		expect(sortChapters(list).map((t) => t.uid)).toEqual(['1', '2', 'x', 'y']);
		expect(list).toEqual(copy);
	});
});

describe('groupSeries', () => {
	it('groups by series + narrator, in first-seen order, songs excluded', () => {
		const list = [
			tr('a783', '风云谷 第783集'),
			tr('s', '晴天', '叶惠美', '周杰伦'),
			tr('q944', '七界武神 - 第 944 集', '', '說書的小曲'),
			tr('a95', '风云谷 第95集'),
			tr('z1', '风云谷 第1集', '', '張小樓'),
			tr('q1', '七界武神 - 第 1 集', '', '說書的小曲')
		];
		const g = groupSeries(list);
		expect(g.map((s) => [s.name, s.narrator, s.chapters.map((c) => c.uid)])).toEqual([
			['风云谷', '小酷說書', ['a95', 'a783']],
			['七界武神', '說書的小曲', ['q1', 'q944']],
			['风云谷', '張小樓', ['z1']]
		]);
	});
	it('a group of only weak numbers is not a book', () => {
		expect(groupSeries([tr('a', 'Mix 22', '', 'DJ'), tr('b', 'Mix 23', '', 'DJ')])).toEqual([]);
	});
});

describe('seriesQuery', () => {
	it('cuts marketing-stuffed album strings to the core title (found live)', () => {
		expect(seriesQuery('雪中悍刀行|多播剧|无删减完整版|热播剧原著|完结放心听|全站最热')).toBe('雪中悍刀行');
		expect(seriesQuery('风云谷（完结）')).toBe('风云谷');
		expect(seriesQuery('【多人有声剧】七界武神')).toBe('七界武神');
		expect(seriesQuery('七界武神 - 说书的小曲')).toBe('七界武神');
		expect(seriesQuery('风云谷')).toBe('风云谷');
		expect(seriesQuery('【完结】')).toBe('【完结】');
	});
});

describe('chaptersFrom', () => {
	const sorted = sortChapters([tr('1', '第1集'), tr('2', '第2集'), tr('3', '第3集')]);
	it('slices from the chapter onward', () => {
		expect(chaptersFrom(sorted, sorted[1]).map((t) => t.uid)).toEqual(['2', '3']);
	});
	it('a chapter missing from the list keeps only the chapters after it', () => {
		expect(chaptersFrom(sorted, tr('x', '第2集')).map((t) => t.uid)).toEqual(['x', '3']);
	});
});
