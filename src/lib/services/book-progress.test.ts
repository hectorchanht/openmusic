import { describe, it, expect } from 'vitest';
import type { Track } from '$lib/sources/types';
import { toEntry } from '$lib/history/history-logic';
import {
	recordBookProgress,
	removeBookProgress,
	seedFromHistory,
	parseBookProgress,
	BOOKS_PROGRESS_CAP
} from './book-progress';

// quick-261122-books
const track = (uid: string, title: string, artist = '小酷說書', album = ''): Track => ({
	uid,
	source: 'kuwo',
	songid: uid,
	title,
	artist,
	album,
	cover: null,
	audioUrl: 'https://x/a.mp3',
	lrc: null,
	lrcUrl: null,
	detailsLoaded: true,
	quality: null,
	qualityLabel: null,
	keyword: '',
	displayIndex: 1
});

describe('recordBookProgress', () => {
	it('ignores ordinary songs (same reference back)', () => {
		const list = [] as const;
		expect(recordBookProgress(list, track('s', '晴天', '周杰伦'), 1)).toBe(list);
	});
	it('one row per series, latest chapter on top, volatile fields dropped', () => {
		let l = recordBookProgress([], track('a1', '风云谷 第1集'), 1);
		l = recordBookProgress(l, track('b9', '七界武神 - 第 9 集', '說書的小曲'), 2);
		l = recordBookProgress(l, track('a2', '风云谷 第2集'), 3);
		expect(l.map((r) => [r.name, r.n, r.entry.uid])).toEqual([
			['风云谷', 2, 'a2'],
			['七界武神', 9, 'b9']
		]);
		expect('audioUrl' in l[0].entry).toBe(false);
	});
	it('is capped', () => {
		let l: ReturnType<typeof recordBookProgress> = [];
		for (let i = 0; i < BOOKS_PROGRESS_CAP + 5; i++) l = recordBookProgress(l, track(`x${i}`, `书${i}号 第1集`), i);
		expect(l.length).toBe(BOOKS_PROGRESS_CAP);
	});
});

describe('seedFromHistory', () => {
	it('newest chapter per series wins, recency kept, songs skipped', () => {
		const h = [
			toEntry(track('a3', '风云谷 第3集')),
			toEntry(track('s', '晴天', '周杰伦')),
			toEntry(track('b1', '七界武神 - 第 1 集', '說書的小曲')),
			toEntry(track('a2', '风云谷 第2集'))
		];
		expect(seedFromHistory(h).map((r) => r.entry.uid)).toEqual(['a3', 'b1']);
	});
});

describe('parse / remove', () => {
	it('null when nothing stored, [] when corrupt, drops malformed rows', () => {
		expect(parseBookProgress(null)).toBeNull();
		expect(parseBookProgress('{nope')).toEqual([]);
		const good = recordBookProgress([], track('a1', '风云谷 第1集'), 1);
		expect(parseBookProgress(JSON.stringify([...good, { key: 1 }]))).toEqual(good);
	});
	it('removes by key', () => {
		const l = recordBookProgress([], track('a1', '风云谷 第1集'), 1);
		expect(removeBookProgress(l, l[0].key)).toEqual([]);
	});
});
