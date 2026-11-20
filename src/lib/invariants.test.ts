// DECISIONS.md Phase 3 — the PERMANENT product invariants of "one decision, one decider".
//
// Each test states a product truth through the shared deciders every surface calls. A failure here
// means a surface (or a new parallel implementation) has started deciding on its own again. The
// per-domain suites (script-fold, identity, acceptance, ranking, cover-identity, upnext-window,
// quality-truth) pin the details; this file pins the truths.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { warmScript } from '$lib/services/zh-convert';
import * as catalog from '$lib/services/catalog';
import { searchAll, __clearSearchCache } from '$lib/services/catalog';
import { resolveStub } from '$lib/services/discovery';
import { walkSource } from '$lib/services/fallback';
import { rankPool, rankAutoCandidates, isAutoAcceptable, isCoverOf } from '$lib/services/song-variant';
import { scoreMatch } from '$lib/services/score-match';
import { pickRowCover } from '$lib/services/row-cover';
import { writeCoverBoth, readCoverByUidOrName } from '$lib/stores/cover-version.svelte';
import { upNextWindowStart } from '$lib/services/upnext-scroll';
import { SOURCES } from '$lib/sources/registry';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

vi.mock('$lib/stores/actionLog.svelte', () => ({ logAction: vi.fn() }));
vi.mock('$lib/services/name-rescue', async (orig) => ({
	...(await orig<typeof import('$lib/services/name-rescue')>()),
	lookupChineseName: vi.fn(async () => null)
}));

function mk(source: SourceId, id: string, artist: string, title: string, extra: Partial<Track> = {}): Track {
	return {
		uid: makeUid(source, id), source, songid: id, title, artist, album: '', cover: null,
		audioUrl: null, lrc: null, lrcUrl: null, detailsLoaded: false, quality: null,
		qualityLabel: null, keyword: 'x', displayIndex: 0, ...extra
	};
}
const pool = (tracks: Track[]): catalog.SearchResult => ({ perSource: [], interleaved: tracks });
const ONLY_QQ = Object.fromEntries(
	(Object.keys(SOURCES) as SourceId[]).map((id) => [id, id === 'qq'])
) as Partial<Record<SourceId, boolean>>;

class MemStorage {
	private m = new Map<string, string>();
	getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
	setItem(k: string, v: string) { this.m.set(k, String(v)); }
	removeItem(k: string) { this.m.delete(k); }
	clear() { this.m.clear(); }
	key(i: number) { return [...this.m.keys()][i] ?? null; }
	get length() { return this.m.size; }
}

beforeAll(async () => {
	await warmScript('zh-Hans');
});
beforeEach(() => {
	Object.defineProperty(globalThis, 'localStorage', { value: new MemStorage(), configurable: true, writable: true });
});
afterEach(() => {
	vi.restoreAllMocks();
	__clearSearchCache();
});

describe('INVARIANT: same song ⇒ same cover on row, now bar, song page and OG card', () => {
	it('one write is what every in-app surface reads — across uids and scripts', () => {
		writeCoverBoth('qq:1', '高爾宣 OSN', 'Without You (Explicit)', 'https://img.example/right.jpg');
		// now bar / Now Playing hero (displayCover's cache rung), keyed by the playing uid
		const nowBar = readCoverByUidOrName('qq:1', '高爾宣 OSN', 'Without You (Explicit)');
		// a list row of the SAME song from another source, through the row ladder
		const row = pickRowCover(null, undefined, undefined, 'https://img.example/stale-seed.jpg',
			readCoverByUidOrName('joox:9', '高爾宣 OSN', 'Without You'));
		// the song page (seated by name, no uid) — and the Simplified-script spelling
		const songPage = readCoverByUidOrName('', '高尔宣 OSN', 'Without You');
		expect(nowBar).toBe('https://img.example/right.jpg');
		expect(row).toBe(nowBar);
		expect(songPage).toBe(nowBar);
	});

	it('the OG card and the in-app chain accept and refuse the SAME candidates', () => {
		const song = { artist: '高爾宣 OSN', title: 'Without You (Explicit)' };
		// /api/og's gate (ogIdentityMatches) and every in-app rung both call isCoverOf
		expect(isCoverOf(song, { artist: 'Lilcory_offical', title: 'Without you' })).toBe(false);
		expect(isCoverOf(song, { artist: 'Osn', title: 'Without you explicit' })).toBe(true);
	});
});

describe('INVARIANT: same pool ⇒ same top pick in search, auto-play and VersionPicker', () => {
	const clean = () => mk('qq', 'c', '陳百強', '偏偏喜歡你', { duration: 236 });
	const ring = () => mk('suyin', 'r', '陳百強', '偏偏喜歡你（鈴聲）', { duration: 48, qualityLabel: '320K' });
	const live = () => mk('joox', 'l', '陳百強', '偏偏喜歡你 (Live)', { duration: 250, qualityLabel: 'LOSSLESS' });

	it('search ranking, the auto-pick ranking, discovery and the VersionPicker agree', async () => {
		const rows = [ring(), live(), clean()];
		const q = { artist: '陳百強', title: '偏偏喜歡你' };
		const search = rankPool(rows, q.title, { score: (c) => scoreMatch(q, c) })[0];
		const autoPick = rankAutoCandidates(rows, q)[0];
		const versionPicker = rankPool(rows, clean().title, { score: (c) => scoreMatch(clean(), c) })[0];
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(pool(rows));
		const discovery = await resolveStub(q.artist, q.title);
		expect(search.uid).toBe('qq:c');
		expect(autoPick.uid).toBe('qq:c');
		expect(versionPicker.uid).toBe('qq:c');
		expect(discovery?.uid).toBe('qq:c');
	});
});

describe('INVARIANT: 繁/簡 queries ⇒ the same pool', () => {
	it.each([
		['周杰倫 晴天', '周杰伦 晴天'],
		['陳奕迅 富士山下', '陈奕迅 富士山下']
	])('%s and %s are one upstream search', async (trad, simp) => {
		const seen: string[] = [];
		vi.spyOn(SOURCES.qq, 'search').mockImplementation(async (kw: string) => {
			seen.push(kw);
			return [];
		});
		const a = await searchAll(trad, 1, ONLY_QQ);
		const b = await searchAll(simp, 1, ONLY_QQ);
		expect(seen).toEqual([simp]);
		expect(b).toBe(a);
	});
});

describe('INVARIANT: a covers-only pool ⇒ the song is skipped, never substituted', () => {
	const covers = () => [mk('netease', '1', '阿傑', '說了再見'), mk('netease', '2', '張錫陽', '說了再見')];

	it('discovery (tap resolve) returns nothing', async () => {
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(pool(covers()));
		expect(await resolveStub('周杰倫', '說了再見')).toBeNull();
	});

	it('the fallback / name-stub walker rejects the source (no hit, genuine rejection)', async () => {
		vi.spyOn(catalog, 'searchAll').mockResolvedValue({
			perSource: [{ source: 'netease', status: 'ok', tracks: covers() }],
			interleaved: covers()
		} as catalog.SearchResult);
		const out = await walkSource('netease', '周杰倫 說了再見', mk('qq', 'x', '周杰倫', '說了再見'), new AbortController().signal);
		expect(out.hit).toBeNull();
		expect(out.verdict).toBe('rejected');
	});
});

describe('INVARIANT: a duet credit containing the target ⇒ accepted as the original', () => {
	it('every automatic path shares the predicate (whole segments: 阿傑 ≠ 阿傑正傳, Jay ≠ Jay Park)', () => {
		expect(isAutoAcceptable({ artist: '周杰倫', title: '不能說的秘密' }, { artist: '周杰倫/蔡依林', title: '不能說的秘密' })).toBe(true);
		expect(isAutoAcceptable({ artist: '阿傑', title: 'X' }, { artist: '阿傑正傳', title: 'X' })).toBe(false);
		expect(isAutoAcceptable({ artist: 'Jay', title: 'X' }, { artist: 'Jay Park', title: 'X' })).toBe(false);
	});
});

describe('INVARIANT: a reorder ⇒ the current song is still visible in Up Next', () => {
	it.each([
		['anchor moved after current (playNext on the anchor row)', ['x', 'cur', 'anchor'], 'cur', 'anchor'],
		['prev() past the anchor', ['cur', 'anchor', 'y'], 'cur', 'anchor'],
		['anchor removed', ['a', 'cur'], 'cur', 'gone']
	])('%s', (_name, ids, cur, anchor) => {
		const queue = (ids as string[]).map((uid) => ({ uid }));
		const start = upNextWindowStart(queue, cur as string, anchor as string);
		expect(queue.slice(start).some((t) => t.uid === cur)).toBe(true);
	});
});
