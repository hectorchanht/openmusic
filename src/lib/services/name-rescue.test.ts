import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	isStrongMatch,
	cleanTitle,
	pairYtmRows,
	pairItunes,
	readRescueCache,
	readRescueHits,
	onRescueHit,
	writeRescueCache,
	lookupChineseName,
	NAME_RESCUE_KEY
} from './name-rescue';
import * as apiBase from './api-base';

// Fixtures below are copied from the 2026-09-26 live probes recorded in
// .planning/quick/260925-wa7-*/260925-wa7-CONTEXT.md (quick-260925-wa7).

class MemStorage {
	m = new Map<string, string>();
	getItem(k: string): string | null {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string): void {
		this.m.set(k, String(v));
	}
	removeItem(k: string): void {
		this.m.delete(k);
	}
}

const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
function setStorage(v: unknown) {
	Object.defineProperty(globalThis, 'localStorage', { value: v, configurable: true, writable: true });
}

const q = (artist: string, title: string) => ({ artist, title });
const GRAD_EN = 'Graduation ("Mom, Don\'t Do That!" TV Series Theme Song)';

describe('isStrongMatch (quick-260925-wa7)', () => {
	it('classifies the probed junk rows as WEAK', () => {
		expect(isStrongMatch(q('Eric Chou', GRAD_EN), q('NCT DREAM', 'Graduation'))).toBe(false);
		expect(isStrongMatch(q('Jay Chou', 'Coral Sea'), q('酷客音乐', '珊瑚海(钢琴曲)'))).toBe(false);
		expect(isStrongMatch(q('Jay Chou', 'Coral Sea'), q('Black Pearl', 'Coral Sea (Chillout Mix)'))).toBe(false);
		expect(isStrongMatch(q('Eric Chou', 'Zai Ai Ni'), q('汪苏泷', '左转灯'))).toBe(false);
		expect(isStrongMatch(q('Eric Chou', 'Zai Ai Ni'), q('Eric周兴哲', '怎么了'))).toBe(false);
	});

	it('classifies normal hits as STRONG', () => {
		expect(isStrongMatch(q('lullaboy', 'someone like u'), q('lullaboy', 'someone like u'))).toBe(true);
		expect(isStrongMatch(q('Bones & The Boy', 'Good In Me'), q('Bones & The Boy', 'Good In Me'))).toBe(true);
		expect(isStrongMatch(q('周兴哲', '再爱你'), q('Eric周兴哲', '再爱你'))).toBe(true);
		expect(isStrongMatch(q('周杰伦', '珊瑚海'), q('周杰伦', '珊瑚海 (Live)'))).toBe(true);
		expect(isStrongMatch(q('Joker Xue', 'The Actor'), q('Joker Xue', 'Actor'))).toBe(true);
	});

	it('only allows containment when the shorter side is ≥ 3 chars', () => {
		expect(isStrongMatch(q('X', 'Ok'), q('X', 'Okay'))).toBe(false);
		expect(isStrongMatch(q('X', 'Ok'), q('X', 'OK'))).toBe(true);
	});
});

describe('cleanTitle (quick-260925-wa7)', () => {
	it.each([
		['珊瑚海 (feat. 梁心頤)', '珊瑚海'],
		['最後一堂課 (《媽,別鬧了!》影集片尾曲)', '最後一堂課'],
		['演員(Live)', '演員'],
		['Some Song - EP', 'Some Song'],
		['Some Song - Single', 'Some Song'],
		['Song feat. Someone', 'Song'],
		['再愛你 - Zai Ai Ni', '再愛你 - Zai Ai Ni'],
		['  Mojito  ', 'Mojito']
	])('%s → %s', (input, out) => {
		expect(cleanTitle(input)).toBe(out);
	});
});

describe('pairYtmRows (quick-260925-wa7)', () => {
	const row = (songid: string, title: string, artist: string) => ({ songid, title, artist });

	it('Zai Ai Ni: bilingual en title → zh-TW names', () => {
		expect(
			pairYtmRows(
				[row('v1', '再愛你 - Zai Ai Ni', 'Eric Chou')],
				[row('v1', '再愛你', '周興哲')],
				q('Eric Chou', 'Zai Ai Ni')
			)
		).toEqual({ artist: '周興哲', title: '再愛你' });
	});

	it('Graduation: long bilingual en title → cleaned zh-TW title', () => {
		expect(
			pairYtmRows(
				[row('v2', '最後一堂課 (《媽，別鬧了！》影集片尾曲) - ' + GRAD_EN, 'Eric Chou')],
				[row('v2', '最後一堂課 (《媽，別鬧了！》影集片尾曲)', '周興哲')],
				q('Eric Chou', GRAD_EN)
			)
		).toEqual({ artist: '周興哲', title: '最後一堂課' });
	});

	it('Coral Sea: en title carries no English → null (stage 2 handles it)', () => {
		expect(
			pairYtmRows([row('v3', '珊瑚海', '周杰倫')], [row('v3', '珊瑚海', '周杰倫')], q('Jay Chou', 'Coral Sea'))
		).toBeNull();
	});

	it('Mojito: Latin title, CJK en-artist → accepted in pass 2 once YTM localized the artist elsewhere', () => {
		// v9 is an official video of ANOTHER song: en 'Jay Chou' ↔ zh '周杰倫' proves the artist mapping.
		expect(
			pairYtmRows(
				[row('v4', 'Mojito', '周杰倫'), row('v9', '七月的極光', 'Jay Chou')],
				[row('v4', 'Mojito', '周杰倫'), row('v9', '七月的極光', '周杰倫')],
				q('Jay Chou', 'Mojito')
			)
		).toEqual({ artist: '周杰倫', title: 'Mojito' });
		// without any localizing row there is no artist evidence → null
		expect(
			pairYtmRows([row('v4', 'Mojito', '周杰倫')], [row('v4', 'Mojito', '周杰倫')], q('Jay Chou', 'Mojito'))
		).toBeNull();
	});

	it('uploader cover with a bilingual title → null even when the artist mapping is known (live probe)', () => {
		expect(
			pairYtmRows(
				[
					row('u1', '周杰倫 Jay Chou & 梁心頤 Lara 珊瑚海 Coral Sea 純鋼琴 #YIMUZIC', '張義 YImuzic'),
					row('v9', '珊瑚海', 'Jay Chou')
				],
				[
					row('u1', '周杰倫 Jay Chou & 梁心頤 Lara 珊瑚海 Coral Sea 純鋼琴 #YIMUZIC', '張義 YImuzic'),
					row('v9', '珊瑚海', '周杰倫')
				],
				q('Jay Chou', 'Coral Sea')
			)
		).toBeNull();
	});

	it('uploader video with identical Latin names in both locales → null', () => {
		expect(
			pairYtmRows(
				[row('v5', 'Coral Sea cover', 'someuploader')],
				[row('v5', 'Coral Sea cover', 'someuploader')],
				q('Jay Chou', 'Coral Sea')
			)
		).toBeNull();
	});

	it('prefers a row whose en artist also matches over an earlier title-only row', () => {
		expect(
			pairYtmRows(
				[row('a', 'Zai Ai Ni (cover)', 'Random Singer'), row('b', '再愛你 - Zai Ai Ni', 'Eric Chou')],
				[row('a', '再愛你 翻唱', '某歌手'), row('b', '再愛你', '周興哲')],
				q('Eric Chou', 'Zai Ai Ni')
			)
		).toEqual({ artist: '周興哲', title: '再愛你' });
	});

	it('ignores a videoId present in only one locale', () => {
		expect(
			pairYtmRows(
				[row('only-en', '再愛你 - Zai Ai Ni', 'Eric Chou')],
				[row('only-zh', '再愛你', '周興哲')],
				q('Eric Chou', 'Zai Ai Ni')
			)
		).toBeNull();
	});
});

describe('pairItunes (quick-260925-wa7)', () => {
	const it_ = (trackId: unknown, trackName: unknown, artistName: unknown) => ({ trackId, trackName, artistName });

	it('Coral Sea: HK search ↔ US lookup → HK names', () => {
		expect(
			pairItunes(
				q('Jay Chou', 'Coral Sea'),
				[it_(1721454126, '珊瑚海 (feat. 梁心頤)', '周杰倫')],
				[],
				[],
				[it_(1721454126, 'Coral Sea (feat. Lara Veronin)', 'Jay Chou')]
			)
		).toEqual({ artist: '周杰倫', title: '珊瑚海' });
	});

	it('Graduation: US search ↔ HK lookup → HK names', () => {
		expect(
			pairItunes(
				q('Eric Chou', GRAD_EN),
				[],
				[it_(1634754406, GRAD_EN, 'Eric Chou')],
				[it_(1634754406, '最後一堂課 (《媽,別鬧了!》影集片尾曲)', '周興哲')],
				[]
			)
		).toEqual({ artist: '周興哲', title: '最後一堂課' });
	});

	it('The Actor: containment on the US title', () => {
		expect(
			pairItunes(q('Joker Xue', 'The Actor'), [], [it_(9, 'Actor (Live)', 'Joker Xue')], [it_(9, '演員(Live)', '薛之謙')], [])
		).toEqual({ artist: '薛之謙', title: '演員' });
	});

	it('MUST REJECT: Zai Ai Ni → Unbreakable Love (title mismatch)', () => {
		expect(
			pairItunes(q('Eric Chou', 'Zai Ai Ni'), [], [it_(5, 'Unbreakable Love', 'Eric Chou')], [it_(5, '永不失聯的愛', '周興哲')], [])
		).toBeNull();
	});

	it('MUST REJECT: Mojito → 屋頂 (title mismatch)', () => {
		expect(
			pairItunes(q('Jay Chou', 'Mojito'), [], [it_(7, '屋頂', 'Landy Wen & Jay Chou')], [it_(7, '屋頂', '溫嵐 & 周杰倫')], [])
		).toBeNull();
	});

	it('skips bad trackIds and rows missing names, never throws', () => {
		expect(
			pairItunes(
				q('Jay Chou', 'Coral Sea'),
				[it_(-1, '珊瑚海', '周杰倫'), it_(1.5, '珊瑚海', '周杰倫'), it_('abc', '珊瑚海', '周杰倫'), it_(3, undefined, '周杰倫')],
				[],
				[],
				[it_(-1, 'Coral Sea', 'Jay Chou'), it_(1.5, 'Coral Sea', 'Jay Chou'), it_(3, 'Coral Sea', 'Jay Chou')]
			)
		).toBeNull();
		// numeric-string ids are accepted
		expect(
			pairItunes(q('Jay Chou', 'Coral Sea'), [it_('42', '珊瑚海', '周杰倫')], [], [], [it_(42, 'Coral Sea', 'Jay Chou')])
		).toEqual({ artist: '周杰倫', title: '珊瑚海' });
		expect(() =>
			pairItunes(q('a', 'b'), null as unknown as [], [null as unknown as {}], [], [])
		).not.toThrow();
	});
});

describe('rescue cache (quick-260925-wa7)', () => {
	let store: MemStorage;
	beforeEach(() => {
		store = new MemStorage();
		setStorage(store);
	});
	afterEach(() => {
		setStorage(originalLocalStorage);
		vi.restoreAllMocks();
	});

	it('round-trips a hit and a miss; unknown key → null', () => {
		writeRescueCache('Jay Chou', 'Coral Sea', { artist: '周杰倫', title: '珊瑚海' });
		writeRescueCache('Nobody', 'Nothing', null);
		expect(readRescueCache('Jay Chou', 'Coral Sea')).toEqual({ artist: '周杰倫', title: '珊瑚海' });
		// keyed by matchKey → case/punct-insensitive
		expect(readRescueCache('jay chou', 'coral sea!')).toEqual({ artist: '周杰倫', title: '珊瑚海' });
		expect(readRescueCache('Nobody', 'Nothing')).toBe('miss');
		expect(readRescueCache('Else', 'Else')).toBeNull();
	});

	it('expires hits after 30 d and misses after 1 d (read-side, no delete)', () => {
		const t0 = 1_800_000_000_000;
		const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
		writeRescueCache('A', 'Hit', { artist: '甲', title: '乙' });
		writeRescueCache('A', 'Miss', null);
		const day = 24 * 60 * 60 * 1000;
		now.mockReturnValue(t0 + day);
		expect(readRescueCache('A', 'Miss')).toBe('miss');
		now.mockReturnValue(t0 + day + 1);
		expect(readRescueCache('A', 'Miss')).toBeNull();
		expect(readRescueCache('A', 'Hit')).toEqual({ artist: '甲', title: '乙' });
		now.mockReturnValue(t0 + 30 * day + 1);
		expect(readRescueCache('A', 'Hit')).toBeNull();
		expect(Object.keys(JSON.parse(store.getItem(NAME_RESCUE_KEY) as string))).toHaveLength(2);
	});

	it('caps at 500 entries, evicting the oldest write', () => {
		let t = 1_000;
		vi.spyOn(Date, 'now').mockImplementation(() => t++);
		for (let i = 0; i < 501; i++) writeRescueCache('artist', 'title ' + i, null);
		const rec = JSON.parse(store.getItem(NAME_RESCUE_KEY) as string);
		expect(Object.keys(rec).length).toBeLessThanOrEqual(500);
		expect(readRescueCache('artist', 'title 0')).toBeNull();
		expect(readRescueCache('artist', 'title 500')).toBe('miss');
	});

	it('malformed storage reads null without throwing', () => {
		store.setItem(NAME_RESCUE_KEY, '{not json');
		expect(readRescueCache('A', 'B')).toBeNull();
		store.setItem(NAME_RESCUE_KEY, '[1,2]');
		expect(readRescueCache('A', 'B')).toBeNull();
		store.setItem(NAME_RESCUE_KEY, '"str"');
		expect(readRescueCache('A', 'B')).toBeNull();
		const at = Date.now();
		store.setItem(
			NAME_RESCUE_KEY,
			JSON.stringify({
				'a|num': { a: 1, t: '乙', at },
				'a|long': { a: 'x'.repeat(201), t: '乙', at },
				'a|noat': { a: '甲', t: '乙' },
				'a|null': null
			})
		);
		expect(readRescueCache('a', 'num')).toBeNull();
		expect(readRescueCache('a', 'long')).toBeNull();
		expect(readRescueCache('a', 'noat')).toBeNull();
		expect(readRescueCache('a', 'null')).toBeNull();
		// a write over a malformed record recovers it
		store.setItem(NAME_RESCUE_KEY, '{not json');
		writeRescueCache('A', 'B', null);
		expect(readRescueCache('A', 'B')).toBe('miss');
	});

	it('no localStorage (node) → read null, write no-op, no throw', () => {
		setStorage(undefined);
		expect(() => writeRescueCache('A', 'B', null)).not.toThrow();
		expect(readRescueCache('A', 'B')).toBeNull();
	});
});

describe('display hits + notify (quick-260925-x8o)', () => {
	let store: MemStorage;
	beforeEach(() => {
		store = new MemStorage();
		setStorage(store);
	});
	afterEach(() => {
		setStorage(originalLocalStorage);
		vi.restoreAllMocks();
	});

	it('readRescueHits ignores the 30 d lookup TTL — a 40-day-old hit still displays', () => {
		const at = Date.now() - 40 * 24 * 60 * 60 * 1000;
		store.setItem(NAME_RESCUE_KEY, JSON.stringify({ 'jaychou|coralsea': { a: '周杰倫', t: '珊瑚海', at } }));
		expect(readRescueCache('Jay Chou', 'Coral Sea')).toBeNull(); // lookup TTL unchanged
		expect(readRescueHits()).toEqual([{ key: 'jaychou|coralsea', zh: { artist: '周杰倫', title: '珊瑚海' } }]);
	});

	it('readRescueHits excludes misses and skips malformed entries without throwing', () => {
		const at = Date.now();
		store.setItem(
			NAME_RESCUE_KEY,
			JSON.stringify({
				'a|miss': { miss: true, at },
				'a|str': 'str',
				'a|null': null,
				'a|num': { a: 1, t: '乙', at },
				'a|noa': { t: '乙', at },
				'a|long': { a: '甲', t: 'x'.repeat(201), at },
				'a|ok': { a: '甲', t: '乙', at }
			})
		);
		expect(readRescueHits()).toEqual([{ key: 'a|ok', zh: { artist: '甲', title: '乙' } }]);
		store.setItem(NAME_RESCUE_KEY, '{not json');
		expect(readRescueHits()).toEqual([]);
		store.setItem(NAME_RESCUE_KEY, '[1,2]');
		expect(readRescueHits()).toEqual([]);
		setStorage(undefined);
		expect(readRescueHits()).toEqual([]);
	});

	it('onRescueHit fires once per HIT write, never for a miss; the returned fn unsubscribes', () => {
		const fn = vi.fn();
		const off = onRescueHit(fn);
		const zh = { artist: '周杰倫', title: '珊瑚海' };
		writeRescueCache('Jay Chou', 'Coral Sea', zh);
		writeRescueCache('Nobody', 'Nothing', null);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith('Jay Chou', 'Coral Sea', zh);
		off();
		writeRescueCache('Jay Chou', 'Coral Sea', zh);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('a throwing listener neither escapes writeRescueCache nor stops the others', () => {
		const bad = onRescueHit(() => {
			throw new Error('boom');
		});
		const good = vi.fn();
		const offGood = onRescueHit(good);
		expect(() => writeRescueCache('A', 'B', { artist: '甲', title: '乙' })).not.toThrow();
		expect(good).toHaveBeenCalledTimes(1);
		bad();
		offGood();
	});

	it('still notifies when persistence fails (quota) — the in-memory alias must not depend on it', () => {
		vi.spyOn(store, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError');
		});
		const fn = vi.fn();
		const off = onRescueHit(fn);
		writeRescueCache('Jay Chou', 'Coral Sea', { artist: '周杰倫', title: '珊瑚海' });
		expect(fn).toHaveBeenCalledWith('Jay Chou', 'Coral Sea', { artist: '周杰倫', title: '珊瑚海' });
		off();
	});
});

// ---- lookupChineseName orchestrator (quick-260925-wa7) ---------------------------------------

/** Minimal InnerTube search envelope: one shelf, rows with videoId + title + ARTIST-typed run. */
function envelope(rows: Array<[videoId: string, title: string, artist: string]>) {
	return {
		contents: {
			sectionListRenderer: {
				contents: [
					{
						musicShelfRenderer: {
							contents: rows.map(([videoId, title, artist]) => ({
								musicResponsiveListItemRenderer: {
									playlistItemData: { videoId },
									flexColumns: [
										{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
										{
											musicResponsiveListItemFlexColumnRenderer: {
												text: {
													runs: [
														{
															text: artist,
															navigationEndpoint: {
																browseEndpoint: {
																	browseEndpointContextSupportedConfigs: {
																		browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' }
																	}
																}
															}
														}
													]
												}
											}
										}
									]
								}
							}))
						}
					}
				]
			}
		}
	};
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Routes = { en?: unknown; zh?: unknown; hk?: unknown; us?: unknown; hkLookup?: unknown; usLookup?: unknown };

/** apiFetch spy routed by URL; a route value that is a Response/Error is returned/thrown as-is. */
function routeApi(r: Routes) {
	const pick = (path: string): unknown => {
		if (path.includes('/api/ytmusic/search')) return path.includes('hl=zh-TW') ? r.zh : r.en;
		if (path.includes('/lookup?')) return path.includes('country=hk') ? r.hkLookup : r.usLookup;
		return path.includes('country=hk') ? r.hk : r.us;
	};
	return vi.spyOn(apiBase, 'apiFetch').mockImplementation(async (path: string) => {
		const v = pick(path);
		if (v instanceof Error) throw v;
		if (v instanceof Response) return v;
		return json(v ?? { results: [] });
	});
}

const urls = (spy: ReturnType<typeof routeApi>) => spy.mock.calls.map((c) => String(c[0]));

describe('lookupChineseName (quick-260925-wa7)', () => {
	beforeEach(() => setStorage(new MemStorage()));
	afterEach(() => {
		setStorage(originalLocalStorage);
		vi.restoreAllMocks();
	});

	it('cache hit / cached miss → no fetch at all', async () => {
		const spy = routeApi({});
		writeRescueCache('Jay Chou', 'Coral Sea', { artist: '周杰倫', title: '珊瑚海' });
		writeRescueCache('Nobody', 'Nothing', null);
		expect(await lookupChineseName('Jay Chou', 'Coral Sea')).toEqual({ artist: '周杰倫', title: '珊瑚海' });
		expect(await lookupChineseName('Nobody', 'Nothing')).toBeNull();
		expect(spy).toHaveBeenCalledTimes(0);
	});

	it('stage 1 verified (Zai Ai Ni) → zh-TW names, no iTunes call, cached', async () => {
		const spy = routeApi({
			en: { ytmusicMerged: [envelope([['v1', '再愛你 - Zai Ai Ni', 'Eric Chou']])] },
			zh: { ytmusicMerged: [envelope([['v1', '再愛你', '周興哲']])] }
		});
		expect(await lookupChineseName('Eric Chou', 'Zai Ai Ni')).toEqual({ artist: '周興哲', title: '再愛你' });
		const q = encodeURIComponent('Eric Chou Zai Ai Ni');
		expect(urls(spy).sort()).toEqual(
			[`/api/ytmusic/search?q=${q}&hl=en`, `/api/ytmusic/search?q=${q}&hl=zh-TW`].sort()
		);
		expect(urls(spy).some((u) => u.includes('itunes.apple.com'))).toBe(false);
		for (const c of spy.mock.calls) expect(c[1]?.signal).toBeInstanceOf(AbortSignal);
		expect(readRescueCache('Eric Chou', 'Zai Ai Ni')).toEqual({ artist: '周興哲', title: '再愛你' });
	});

	it('stage 1 unverified (Coral Sea) → iTunes HK search ↔ US lookup; no lookup for an empty store', async () => {
		const spy = routeApi({
			en: envelope([['v3', '珊瑚海', '周杰倫']]),
			zh: envelope([['v3', '珊瑚海', '周杰倫']]),
			hk: { results: [{ trackId: 1721454126, trackName: '珊瑚海 (feat. 梁心頤)', artistName: '周杰倫' }] },
			us: { results: [] },
			usLookup: { results: [{ trackId: 1721454126, trackName: 'Coral Sea (feat. Lara Veronin)', artistName: 'Jay Chou' }] }
		});
		expect(await lookupChineseName('Jay Chou', 'Coral Sea')).toEqual({ artist: '周杰倫', title: '珊瑚海' });
		const all = urls(spy);
		const searches = all.filter((u) => u.startsWith('https://itunes.apple.com/search?'));
		expect(searches).toHaveLength(2);
		for (const u of searches) {
			const p = new URL(u).searchParams;
			expect(p.get('term')).toBe('Jay Chou Coral Sea');
			expect(p.get('entity')).toBe('song');
			expect(p.get('limit')).toBe('3');
		}
		expect(searches.map((u) => new URL(u).searchParams.get('country')).sort()).toEqual(['hk', 'us']);
		// HK found an id → looked up in the US store; US found none → NO HK lookup.
		expect(all.filter((u) => u.startsWith('https://itunes.apple.com/lookup?'))).toEqual([
			'https://itunes.apple.com/lookup?id=1721454126&country=us'
		]);
		expect(spy).toHaveBeenCalledTimes(5);
		for (const c of spy.mock.calls) expect(c[1]?.signal).toBeInstanceOf(AbortSignal);
	});

	it('both stages miss → null, and the miss is cached (second call fetches nothing)', async () => {
		const spy = routeApi({
			en: envelope([]),
			zh: envelope([]),
			us: { results: [{ trackId: 5, trackName: 'Unbreakable Love', artistName: 'Eric Chou' }] },
			hkLookup: { results: [{ trackId: 5, trackName: '永不失聯的愛', artistName: '周興哲' }] }
		});
		expect(await lookupChineseName('Eric Chou', 'Zai Ai Ni')).toBeNull();
		const n = spy.mock.calls.length;
		expect(n).toBe(5); // 2 YTM + 2 searches + 1 HK lookup
		expect(await lookupChineseName('Eric Chou', 'Zai Ai Ni')).toBeNull();
		expect(spy).toHaveBeenCalledTimes(n);
		expect(readRescueCache('Eric Chou', 'Zai Ai Ni')).toBe('miss');
	});

	it('reject / 500 / non-JSON / shelf-less hops count as empty — never throws, miss cached', async () => {
		routeApi({
			en: new Error('network'),
			zh: { nope: true }, // shelf-less → parseSearchEnvelope contract-drift throw, caught
			hk: new Response('oops', { status: 500 }),
			us: new Response('<html>', { status: 200 })
		});
		await expect(lookupChineseName('Jay Chou', 'Coral Sea')).resolves.toBeNull();
		expect(readRescueCache('Jay Chou', 'Coral Sea')).toBe('miss');
	});
});
