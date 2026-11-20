// quick-261102-sdm (DECISIONS.md §2) — characterization + invariants for the ONE identity fold.
// Golden fixtures: 周杰倫/周杰伦 and 陳奕迅/陈奕迅 query pairs.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { warmScript, foldScript } from '$lib/services/zh-convert';
import { songKey } from '$lib/services/dedupe';
import { coverCacheKey } from '$lib/services/cover-cache';
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

describe('search keyword script — product call 2026-11-03: fold to Simplified, one query', () => {
	it('周杰倫 and 周杰伦 send the SAME Simplified keyword and share one cache entry', async () => {
		const seen: string[] = [];
		vi.spyOn(SOURCES.qq, 'search').mockImplementation(async (kw: string) => {
			seen.push(kw);
			return [];
		});
		const a = await searchAll('周杰倫 晴天', 1, ONLY_QQ);
		const b = await searchAll('周杰伦 晴天', 1, ONLY_QQ);
		expect(seen).toEqual(['周杰伦 晴天']); // second call is a cache hit
		expect(b).toBe(a);
	});

	it('陳奕迅 and 陈奕迅 return the same pool', async () => {
		vi.spyOn(SOURCES.qq, 'search').mockImplementation(async (kw: string) =>
			kw === '陈奕迅 富士山下' ? [{ uid: 'qq:1' } as never] : []
		);
		const a = await searchAll('陳奕迅 富士山下', 1, ONLY_QQ);
		__clearSearchCache();
		const b = await searchAll('陈奕迅 富士山下', 1, ONLY_QQ);
		expect(a.interleaved.map((t) => t.uid)).toEqual(['qq:1']);
		expect(b.interleaved.map((t) => t.uid)).toEqual(['qq:1']);
	});
});

describe('one fold algorithm — per character, kana/hangul lines untouched', () => {
	it('cover key folds script only (no regional vocabulary swap)', () => {
		expect(coverCacheKey('', '緊急聯絡人')).toContain('紧急联络人');
		expect(foldScript('緊急聯絡人')).toBe('紧急联络人');
	});

	it('a Japanese (kana) line keeps its kanji', () => {
		expect(foldScript('東京ラブストーリー')).toBe('東京ラブストーリー');
	});

	it('mixed Han + Latin still folds (淺粉紅 pale pink)', () => {
		expect(foldScript('淺粉紅 pale pink')).toBe('浅粉红 pale pink');
	});
});
