// quick-261102-sdm (DECISIONS.md §2) — characterization + invariants for the ONE identity fold.
// Golden fixtures: 周杰倫/周杰伦 and 陳奕迅/陈奕迅 query pairs.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { warmScript } from '$lib/services/zh-convert';
import { foldScript, songKey } from '$lib/services/dedupe';
import { aliasCoverCacheKey } from '$lib/services/cover-cache';
import { foldArtistName } from '$lib/sync/merge-logic';
import { searchAll, __clearSearchCache } from '$lib/services/catalog';
import { SOURCES } from '$lib/sources/registry';
import type { SourceId } from '$lib/sources/types';

vi.mock('$lib/stores/actionLog.svelte', () => ({ logAction: vi.fn() }));

const ONLY_QQ = Object.fromEntries(
	(Object.keys(SOURCES) as SourceId[]).map((id) => [id, id === 'qq'])
) as Partial<Record<SourceId, boolean>>;

beforeAll(async () => {
	await warmScript('zh-Hans');
});

afterEach(() => {
	__clearSearchCache();
	vi.restoreAllMocks();
});

describe('identity fold — warm', () => {
	it('繁/簡 artist pairs share one song key', () => {
		expect(songKey('周杰倫', '晴天')).toBe(songKey('周杰伦', '晴天'));
		expect(songKey('陳奕迅', '富士山下')).toBe(songKey('陈奕迅', '富士山下'));
	});

	it('sync tombstone fold maps both scripts to one key', () => {
		expect(foldArtistName('周杰倫')).toBe(foldArtistName('周杰伦'));
	});
});

describe('search keyword script (characterization: current behaviour)', () => {
	it('searchAll hands the adapter the raw keyword (no zhs fold)', async () => {
		const seen: string[] = [];
		vi.spyOn(SOURCES.qq, 'search').mockImplementation(async (kw: string) => {
			seen.push(kw);
			return [];
		});
		await searchAll('周杰倫 晴天', 1, ONLY_QQ);
		await searchAll('周杰伦 晴天', 1, ONLY_QQ);
		expect(seen).toEqual(['周杰倫 晴天', '周杰伦 晴天']);
	});
});

describe('fold algorithm (characterization: current behaviour)', () => {
	it('cover alias key folds phrase-level (regional vocabulary swapped)', () => {
		expect(aliasCoverCacheKey('', '緊急聯絡人')).toContain('紧急联系人');
	});

	it('foldScript folds kanji inside a kana line', () => {
		expect(foldScript('東京ラブストーリー')).toBe('东京ラブストーリー');
	});
});
