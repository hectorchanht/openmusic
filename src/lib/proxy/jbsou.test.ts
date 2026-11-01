import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	extractMkVisitCookie,
	parseJbsouRows,
	pickJbsouRow,
	normalizeJbsouLocation,
	resolveViaJbsou,
	__resetJbsouSession,
	type JbsouRow
} from './jbsou';

// Fixture shapes captured live from the VM probe 2026-11-01 (values trimmed; the cookie
// token is a fake stand-in — the real one is a per-visit challenge, never stored).
const HOME_HTML =
	'<html><head><script>document.cookie="mk_visit=faketoken123abc; expires=Wed, 01-Jan-2031 00:00:00 GMT; path=/";</script></head><body>煎饼搜</body></html>';

// The real netease page-1 for input "晴天 周杰伦" — cover-heavy by design of the upstream:
// the 周杰伦/Jay original (3440441479) sits among fan covers with lookalike titles.
const NETEASE_SEARCH_BODY = {
	code: 200,
	error: '',
	data: [
		{
			songid: '3440441479',
			name: '晴天',
			artist: 'Jay',
			url: 'api.php?get=url&type=wy&id=3440441479&sign=7ee/IlFAjp2GM&t=1',
			lrc: 'api.php?get=lrc&type=wy&id=3440441479&sign=7ee/IlFAjp2GM&t=1',
			cover: 'api.php?get=pic&type=wy&id=3440441479&sign=7ee/IlFAjp2GM&t=1',
			link: 'https://music.163.com/#/song?id=3440441479'
		},
		{
			songid: '2668397359',
			name: '晴天 (原唱 周杰伦)',
			artist: 'RyaVocal',
			url: 'api.php?get=url&type=wy&id=2668397359&sign=4egPwJ6zEt1cE&t=1'
		},
		{
			songid: '3391116218',
			name: '晴天',
			artist: '梦里啥都有',
			url: 'api.php?get=url&type=wy&id=3391116218&sign=63g1tzH9Jf/Bs&t=1'
		}
	]
};

// The real qq page-1 for input "晴天 周杰伦" (first rows) — songid IS the qq mid.
const QQ_SEARCH_BODY = {
	code: 200,
	error: '',
	data: [
		{
			songid: '0039MnYb0qxYhV',
			name: '晴天',
			artist: '周杰伦',
			url: 'api.php?get=url&type=tx&id=0039MnYb0qxYhV&sign=abcd1234&t=1'
		},
		{
			songid: '004Fs2FP1EvZYc',
			name: '晴天 (Live)',
			artist: '周杰伦',
			url: 'api.php?get=url&type=tx&id=004Fs2FP1EvZYc&sign=efgh5678&t=1'
		}
	]
};

const rows = (body: unknown): JbsouRow[] => parseJbsouRows(body);

describe('extractMkVisitCookie', () => {
	it('extracts the mk_visit pair from the homepage inline script', () => {
		expect(extractMkVisitCookie(HOME_HTML)).toBe('mk_visit=faketoken123abc');
	});

	it('returns null when the challenge script is absent (shape drift)', () => {
		expect(extractMkVisitCookie('<html><body>no script</body></html>')).toBeNull();
		expect(extractMkVisitCookie('')).toBeNull();
	});

	it('returns null for an empty token value', () => {
		expect(extractMkVisitCookie('<script>document.cookie="mk_visit=; path=/";</script>')).toBeNull();
	});
});

describe('parseJbsouRows', () => {
	it('maps the live search body into rows (songid / name / artist / signed url)', () => {
		const out = rows(NETEASE_SEARCH_BODY);
		expect(out).toHaveLength(3);
		expect(out[0]).toEqual({
			songid: '3440441479',
			name: '晴天',
			artist: 'Jay',
			urlPath: 'api.php?get=url&type=wy&id=3440441479&sign=7ee/IlFAjp2GM&t=1'
		});
	});

	it('returns [] on any shape drift (never throws)', () => {
		expect(rows(null)).toEqual([]);
		expect(rows('nope')).toEqual([]);
		expect(rows({})).toEqual([]);
		expect(rows({ data: 'x' })).toEqual([]);
		// rows without songid or url are unplayable/unidentifiable — dropped
		expect(rows({ data: [{ name: 'x' }, { songid: '1' }, { url: 'api.php?x' }] })).toEqual([]);
	});
});

describe('pickJbsouRow', () => {
	it('songid identity wins outright — even over a same-title cover listed first', () => {
		const reordered = [...rows(NETEASE_SEARCH_BODY)].reverse();
		const picked = pickJbsouRow(reordered, { id: '3440441479', title: '晴天', artist: 'Jay' }, 'netease');
		expect(picked?.songid).toBe('3440441479');
	});

	it('matchKey identity picks the same artist+title row when the id is unknown', () => {
		const picked = pickJbsouRow(rows(QQ_SEARCH_BODY), { title: '晴天', artist: '周杰伦' }, 'qq');
		expect(picked?.songid).toBe('0039MnYb0qxYhV');
	});

	it('rejects a same-title cover by a different artist (no fuzzy rescue)', () => {
		// Only the cover rows: identity set for {Jay, 晴天} is empty (the 梦里啥都有 row has the
		// same TITLE but a different artist; the RyaVocal row's title differs too).
		const covers = rows(NETEASE_SEARCH_BODY).filter((r) => r.songid !== '3440441479');
		expect(pickJbsouRow(covers, { title: '晴天', artist: 'Jay' }, 'netease')).toBeNull();
	});

	it('rejects an identity-equal LIVE variant when the studio row is absent', () => {
		// norm() folds "(Live)" out of the matchKey, so the Live row IS in the identity set —
		// the scoreMatch variant penalty (10−4=6) must hold it under the JBSOU_MIN_SCORE floor.
		const liveOnly = rows(QQ_SEARCH_BODY).filter((r) => r.songid !== '0039MnYb0qxYhV');
		expect(pickJbsouRow(liveOnly, { title: '晴天', artist: '周杰伦' }, 'qq')).toBeNull();
	});

	it('returns null on an empty row set / empty want', () => {
		expect(pickJbsouRow([], { id: '1', title: '晴天', artist: '周杰伦' }, 'qq')).toBeNull();
		expect(pickJbsouRow(rows(QQ_SEARCH_BODY), { title: '', artist: '' }, 'qq')).toBeNull();
	});
});

describe('normalizeJbsouLocation', () => {
	it('accepts an https mp3 location verbatim', () => {
		const loc = 'https://m801.music.126.net/20261101/abc/song.mp3?auth=xyz';
		expect(normalizeJbsouLocation(loc)).toBe(loc);
	});

	it('upgrades http to https (mixed-content guard)', () => {
		expect(normalizeJbsouLocation('http://isure6.stream.qqmusic.qq.com/F000x.m4a')).toBe(
			'https://isure6.stream.qqmusic.qq.com/F000x.m4a'
		);
	});

	it('rejects non-audio landings (HTML walls, missing location, junk)', () => {
		expect(normalizeJbsouLocation(null)).toBeNull();
		expect(normalizeJbsouLocation('https://www.jbsou.cn/login.html')).toBeNull();
		expect(normalizeJbsouLocation('javascript:alert(1)')).toBeNull();
	});
});

// --- Orchestration: cookie → search → redirect, with a routed fetch stub ------------------

const FINAL_URL = 'https://m801.music.126.net/20261101/deadbeef/song.mp3';

function routedFetch(opts: {
	searchBody?: unknown;
	homeHtml?: string;
	location?: string | null;
	searchStatus?: number;
} = {}) {
	const calls: string[] = [];
	const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const u = String(input);
		calls.push(`${init?.method ?? 'GET'} ${u}`);
		if (u === 'https://www.jbsou.cn/' && (init?.method ?? 'GET') === 'GET') {
			return new Response(opts.homeHtml ?? HOME_HTML, { status: 200 });
		}
		if (u === 'https://www.jbsou.cn/' && init?.method === 'POST') {
			return new Response(JSON.stringify(opts.searchBody ?? QQ_SEARCH_BODY), {
				status: opts.searchStatus ?? 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		if (u.startsWith('https://www.jbsou.cn/api.php')) {
			return new Response(null, {
				status: 302,
				headers: opts.location === null ? {} : { location: opts.location ?? FINAL_URL }
			});
		}
		throw new Error(`unexpected fetch ${u}`);
	});
	return { fn, calls };
}

describe('resolveViaJbsou', () => {
	beforeEach(() => __resetJbsouSession());
	afterEach(() => vi.restoreAllMocks());

	it('runs the full chain and returns the final CDN url', async () => {
		const { fn, calls } = routedFetch();
		vi.stubGlobal('fetch', fn);

		const out = await resolveViaJbsou('qq', { id: '0039MnYb0qxYhV', title: '晴天', artist: '周杰伦' });

		expect(out).toEqual({ kind: 'ok', url: FINAL_URL });
		// homepage (cookie) → search POST → signed path
		expect(calls[0]).toBe('GET https://www.jbsou.cn/');
		expect(calls[1]).toBe('POST https://www.jbsou.cn/');
		expect(calls[2]).toContain('api.php?get=url&type=tx&id=0039MnYb0qxYhV');
	});

	it('memoizes the cookie across resolves (one homepage fetch for two pipes)', async () => {
		const { fn, calls } = routedFetch();
		vi.stubGlobal('fetch', fn);

		await resolveViaJbsou('qq', { id: '0039MnYb0qxYhV', title: '晴天', artist: '周杰伦' });
		await resolveViaJbsou('qq', { id: '0039MnYb0qxYhV', title: '晴天', artist: '周杰伦' });

		// only the HOMEPAGE gets are counted (the api.php redirect fetches are GETs too)
		expect(calls.filter((c) => c === 'GET https://www.jbsou.cn/')).toHaveLength(1);
	});

	it('returns nomatch when the rows hold no confident pick (no redirect fetch spent)', async () => {
		const { fn, calls } = routedFetch({ searchBody: { data: [] } });
		vi.stubGlobal('fetch', fn);

		const out = await resolveViaJbsou('qq', { title: '不存在的歌', artist: '没人' });

		expect(out).toEqual({ kind: 'nomatch' });
		expect(calls.some((c) => c.includes('api.php'))).toBe(false);
	});

	it('retries ONCE with a fresh cookie when the search dies, then reports fail', async () => {
		// 404 is outside fetchWithRetry's retryable set, so each pipe attempt is exactly one
		// POST — what is being counted here is resolveViaJbsou's own cookie-refresh retry.
		const { fn, calls } = routedFetch({ searchStatus: 404 });
		vi.stubGlobal('fetch', fn);

		const out = await resolveViaJbsou('qq', { title: '晴天', artist: '周杰伦' });

		expect(out).toEqual({ kind: 'fail' });
		// two attempts: home+search, home+search — bounded, never a loop
		expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(2);
		expect(calls.filter((c) => c === 'GET https://www.jbsou.cn/')).toHaveLength(2);
	});

	it('reports fail when a matched row redirects somewhere that is not audio', async () => {
		const { fn } = routedFetch({ location: 'https://www.jbsou.cn/oops.html' });
		vi.stubGlobal('fetch', fn);

		const out = await resolveViaJbsou('qq', { id: '0039MnYb0qxYhV', title: '晴天', artist: '周杰伦' });
		expect(out).toEqual({ kind: 'fail' });
	});
});
