import { describe, it, expect, vi } from 'vitest';
import {
	buildKuwoSearchUrl,
	mapSearch,
	coverFromShort,
	lrclistToLrc,
	levelFor,
	isAllowedKuwoAudioUrl,
	resolveAudioUrl,
	fetchKuwoSearch,
	fetchKuwoDetail,
	KUWO_AUDIO_RESOLVERS
} from './kuwo';

// quick-261004-n1i: every upstream is reached through an INJECTED fetch (fetchImpl), never
// vi.stubGlobal — the edge helpers are pure so the resolver walk can be asserted call by call.

const GOOD_URL = 'https://car-er.kuwo.cn/sig/ts/resource/x/M800.mp3';
const json = (body: unknown, status = 200) =>
	new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

/** Route a fake fetch by host; an unrouted host throws so an unexpected call fails loudly. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		const host = new URL(url).hostname;
		const route = routes[host];
		if (!route) throw new Error(`unrouted ${host}`);
		return route();
	});
	return { impl: impl as unknown as typeof fetch, calls };
}

describe('mapSearch', () => {
	const row = {
		MUSICRID: 'MUSIC_228908',
		SONGNAME: '晴天',
		NAME: 'ignored',
		ARTIST: '周杰伦',
		ALBUM: '叶惠美',
		web_albumpic_short: '120/s3s94/93/211513640.jpg'
	};

	it('maps an abslist row onto the legacy { rid, name, artist, album, pic } shape', () => {
		expect(mapSearch({ abslist: [row] })).toEqual([
			{
				rid: '228908',
				name: '晴天',
				artist: '周杰伦',
				album: '叶惠美',
				pic: 'https://img2.kuwo.cn/star/albumcover/500/s3s94/93/211513640.jpg'
			}
		]);
	});

	it('falls back to NAME when SONGNAME is absent', () => {
		expect(mapSearch({ abslist: [{ ...row, SONGNAME: undefined }] })?.[0].name).toBe('ignored');
	});

	it('strips the -《…》 tie-in tail but keeps version tags and plain hyphens', () => {
		const name = (SONGNAME: string) => mapSearch({ abslist: [{ ...row, SONGNAME }] })?.[0].name;
		expect(name('富士山下-《爱情转移》粤语版')).toBe('富士山下');
		expect(name('十年-《明年今日》国语版|《隐婚男女》电影插曲')).toBe('十年');
		expect(name('富士山下 (深情版)')).toBe('富士山下 (深情版)');
		expect(name('D-Day')).toBe('D-Day');
		expect(name('《追》')).toBe('《追》'); // tail-only title keeps its raw name rather than blanking
	});

	it('decodes exactly the six HTML entities kuwo emits, once', () => {
		const out = mapSearch({
			abslist: [
				{
					...row,
					SONGNAME: 'A&nbsp;&amp;&nbsp;B',
					ARTIST: '&lt;x&gt; &quot;y&quot; &#39;z&#39;',
					ALBUM: 'Tom &AMP; Jerry &amp;lt;'
				}
			]
		})?.[0];
		expect(out?.name).toBe('A & B');
		expect(out?.artist).toBe(`<x> "y" 'z'`);
		expect(out?.album).toBe('Tom & Jerry &lt;'); // single pass — never double-decoded
	});

	it('emits pic null for an empty or missing short', () => {
		const rows = mapSearch({
			abslist: [
				{ ...row, web_albumpic_short: '' },
				{ ...row, web_albumpic_short: undefined }
			]
		});
		expect(rows?.map((r) => r.pic)).toEqual([null, null]);
	});

	it('skips a row without a numeric MUSICRID', () => {
		const rows = mapSearch({ abslist: [{ ...row, MUSICRID: undefined }, { ...row, MUSICRID: 'MV_1' }, row] });
		expect(rows?.map((r) => r.rid)).toEqual(['228908']);
	});

	it('returns null on contract drift, [] on a clean miss', () => {
		expect(mapSearch({ code: 200, data: [] })).toBeNull();
		expect(mapSearch(null)).toBeNull();
		expect(mapSearch('abslist')).toBeNull();
		expect(mapSearch({ abslist: [] })).toEqual([]);
	});
});

describe('coverFromShort', () => {
	it('strips the size segment and prefixes the fixed 500px base', () => {
		expect(coverFromShort('120/s3s94/93/211513640.jpg')).toBe(
			'https://img2.kuwo.cn/star/albumcover/500/s3s94/93/211513640.jpg'
		);
	});

	it('rejects anything outside the path shape (T-n1i-04)', () => {
		for (const bad of [
			'120/../../etc/passwd',
			'120/a.jpg?x=1',
			'120/a b.jpg',
			`120/a"b.jpg`,
			'https://evil.com/x.jpg',
			's3s94/93/x.jpg',
			'',
			null,
			42
		]) {
			expect(coverFromShort(bad)).toBeNull();
		}
	});
});

describe('lrclistToLrc', () => {
	it('formats [mm:ss.xx] lines', () => {
		expect(lrclistToLrc([{ lineLyric: '晴天', time: '2.25' }])).toBe('[00:02.25]晴天');
		expect(lrclistToLrc([{ lineLyric: 'x', time: '65.5' }])).toBe('[01:05.50]x');
	});

	it('drops entries with a non-numeric or negative time', () => {
		expect(
			lrclistToLrc([
				{ lineLyric: 'a', time: 'abc' },
				{ lineLyric: 'b', time: '-1' },
				{ lineLyric: 'c', time: '' },
				{ lineLyric: 'd', time: '1' }
			])
		).toBe('[00:01.00]d');
	});

	it('returns null for an absent or empty list', () => {
		expect(lrclistToLrc(null)).toBeNull();
		expect(lrclistToLrc(undefined)).toBeNull();
		expect(lrclistToLrc([])).toBeNull();
		expect(lrclistToLrc([{ lineLyric: 'x', time: 'nope' }])).toBeNull();
	});
});

describe('levelFor', () => {
	it('maps the client tokens onto resolver levels, defaulting UP to lossless', () => {
		expect(levelFor('128k')).toBe('standard');
		expect(levelFor('320k')).toBe('exhigh');
		expect(levelFor('zp')).toBe('lossless');
		for (const t of ['', 'auto', 'xyz', null, undefined]) expect(levelFor(t)).toBe('lossless');
	});
});

describe('isAllowedKuwoAudioUrl (T-n1i-01)', () => {
	it('accepts https *.kuwo.cn', () => {
		expect(isAllowedKuwoAudioUrl('https://car-er.kuwo.cn/a/b.mp3')).toBe(true);
		expect(isAllowedKuwoAudioUrl('https://car-lw.kuwo.cn/x.flac')).toBe(true);
	});

	it('rejects everything else', () => {
		for (const bad of [
			'http://car-er.kuwo.cn/a.mp3',
			'https://evil-kuwo.cn/a.mp3',
			'https://kuwo.cn/a.mp3',
			'https://car-er.kuwo.cn.evil.com/a.mp3',
			'javascript:alert(1)',
			'',
			undefined,
			null,
			42,
			{ href: GOOD_URL }
		]) {
			expect(isAllowedKuwoAudioUrl(bad)).toBe(false);
		}
	});
});

describe('resolveAudioUrl — sequential resolver chain', () => {
	const [PRIMARY, SECOND] = ['musicapi.haitangw.net', 'music.nxinxz.com'];
	const ok = () => json({ code: 200, data: { url: GOOD_URL } });

	it('walks primary → second in that order', () => {
		expect(KUWO_AUDIO_RESOLVERS.map((r) => r.id)).toEqual(['haitangw', 'nxinxz']);
	});

	it('a good primary answers alone — the second is never called', async () => {
		const { impl, calls } = fakeFetch({ [PRIMARY]: ok, [SECOND]: ok });
		expect(await resolveAudioUrl('228908', 'exhigh', impl)).toEqual({ url: GOOD_URL, resolver: 'haitangw' });
		expect(calls).toHaveLength(1);
		expect(calls[0].url.startsWith('https://musicapi.haitangw.net/music/kw.php')).toBe(true);
		expect(calls[0].url).toContain('id=228908&level=exhigh&type=json');
	});

	it('a primary url on a foreign host counts as that resolver failing', async () => {
		const { impl, calls } = fakeFetch({
			[PRIMARY]: () => json({ code: 200, data: { url: 'https://evil.com/x.mp3' } }),
			[SECOND]: ok
		});
		expect(await resolveAudioUrl('228908', 'exhigh', impl)).toEqual({ url: GOOD_URL, resolver: 'nxinxz' });
		expect(calls[1].url.startsWith('http://music.nxinxz.com/kw.php')).toBe(true);
		expect(calls[1].url).toContain('id=228908&level=exhigh&type=json');
	});

	it('a primary that rejects (timeout) falls through to the second', async () => {
		const { impl } = fakeFetch({
			[PRIMARY]: () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
			[SECOND]: ok
		});
		expect((await resolveAudioUrl('1', 'exhigh', impl))?.resolver).toBe('nxinxz');
	});

	it('a non-JSON or non-ok primary falls through to the second', async () => {
		const html = fakeFetch({ [PRIMARY]: () => json('<html>'), [SECOND]: ok });
		expect((await resolveAudioUrl('1', 'exhigh', html.impl))?.resolver).toBe('nxinxz');
		const down = fakeFetch({ [PRIMARY]: () => json({ code: 200, data: { url: GOOD_URL } }, 503), [SECOND]: ok });
		expect((await resolveAudioUrl('1', 'exhigh', down.impl))?.resolver).toBe('nxinxz');
	});

	it('both bad → null', async () => {
		const { impl, calls } = fakeFetch({
			[PRIMARY]: () => json({ code: 404, data: { url: GOOD_URL } }),
			[SECOND]: () => json({ code: 200, data: { url: 'http://car-er.kuwo.cn/a.mp3' } })
		});
		expect(await resolveAudioUrl('1', 'exhigh', impl)).toBeNull();
		expect(calls).toHaveLength(2);
	});

	it('accepts a numeric-string code', async () => {
		const { impl } = fakeFetch({ [PRIMARY]: () => json({ code: '200', data: { url: GOOD_URL } }) });
		expect((await resolveAudioUrl('1', 'standard', impl))?.url).toBe(GOOD_URL);
	});
});

describe('fetchKuwoDetail', () => {
	const LYRIC_HOST = 'm.kuwo.cn';
	const audio = () => json({ code: 200, data: { url: GOOD_URL } });

	it('a failed lyric fetch never fails the detail', async () => {
		const { impl } = fakeFetch({
			'musicapi.haitangw.net': audio,
			[LYRIC_HOST]: () => Promise.reject(new Error('down'))
		});
		const out = await fetchKuwoDetail('228908', '320k', impl);
		expect(out.status).toBe(200);
		expect(out.body).toEqual({
			code: 200,
			data: { name: null, artist: null, album: null, pic: null, url: GOOD_URL, lyric: null }
		});
	});

	it('maps songinfo + lrclist; empty fields become null; Referer is sent', async () => {
		const { impl, calls } = fakeFetch({
			'musicapi.haitangw.net': audio,
			[LYRIC_HOST]: () =>
				json({
					data: {
						lrclist: [{ lineLyric: '晴天', time: '2.25' }],
						songinfo: { songName: '晴天', artist: '', album: '叶惠美', pic: '' }
					},
					status: 200
				})
		});
		const out = await fetchKuwoDetail('228908', '320k', impl);
		expect(out.body).toEqual({
			code: 200,
			data: { name: '晴天', artist: null, album: '叶惠美', pic: null, url: GOOD_URL, lyric: '[00:02.25]晴天' }
		});
		const lyricCall = calls.find((c) => c.url.includes(LYRIC_HOST));
		expect(lyricCall?.url).toContain('musicId=228908');
		expect(new Headers(lyricCall?.init?.headers).get('Referer')).toBe('https://m.kuwo.cn/');
		expect(calls.find((c) => c.url.includes('haitangw'))?.url).toContain('level=exhigh');
	});

	it('lrclist null → lyric null', async () => {
		const { impl } = fakeFetch({
			'musicapi.haitangw.net': audio,
			[LYRIC_HOST]: () => json({ data: { lrclist: null, songinfo: { songName: '', artist: '', album: '' } } })
		});
		const out = await fetchKuwoDetail('1', 'zp', impl);
		expect(out.body).toMatchObject({ data: { lyric: null, name: null, artist: null, album: null, pic: null } });
	});

	it('songinfo.pic must be https *.kuwo.cn', async () => {
		const withPic = (pic: string) =>
			fakeFetch({
				'musicapi.haitangw.net': audio,
				[LYRIC_HOST]: () => json({ data: { songinfo: { pic } } })
			}).impl;
		const http = await fetchKuwoDetail('1', 'zp', withPic('http://img1.kuwo.cn/x.jpg'));
		expect(http.body).toMatchObject({ data: { pic: null } });
		const https = await fetchKuwoDetail('1', 'zp', withPic('https://img1.kuwo.cn/x.jpg'));
		expect(https.body).toMatchObject({ data: { pic: 'https://img1.kuwo.cn/x.jpg' } });
	});

	it('no resolver url → 502 with no url in the body (the client health-gate signal)', async () => {
		const { impl } = fakeFetch({
			'musicapi.haitangw.net': () => json('nope'),
			'music.nxinxz.com': () => json({ code: 500 }),
			[LYRIC_HOST]: () => json({ data: { songinfo: { songName: '晴天' } } })
		});
		const out = await fetchKuwoDetail('1', '128k', impl);
		expect(out.status).toBe(502);
		expect(out.body).toMatchObject({ code: 502 });
		expect(out.body).not.toHaveProperty('data');
		expect(JSON.stringify(out.body)).not.toContain('"url"');
	});
});

describe('fetchKuwoSearch', () => {
	const ABS = JSON.stringify({ abslist: [{ MUSICRID: 'MUSIC_228908', SONGNAME: '晴天', ARTIST: '周杰伦' }] });

	it('builds the official r.s query and parses its text/plain JSON body', async () => {
		const { impl, calls } = fakeFetch({
			'search.kuwo.cn': () => new Response(ABS, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
		});
		const out = await fetchKuwoSearch('晴天', 3, 1, impl);
		expect(out).toEqual({
			status: 200,
			body: { code: 200, data: [{ rid: '228908', name: '晴天', artist: '周杰伦', album: '', pic: null }] }
		});
		const u = calls[0].url;
		expect(u.startsWith('https://search.kuwo.cn/r.s?')).toBe(true);
		for (const p of ['all=%E6%99%B4%E5%A4%A9', 'rn=3', 'pn=0', 'ft=music', 'rformat=json']) expect(u).toContain(p);
	});

	it('a non-JSON, non-ok or drifted body is a 502', async () => {
		for (const r of [() => json('<html>'), () => json(ABS, 500), () => json({ data: [] })]) {
			const out = await fetchKuwoSearch('x', 3, 1, fakeFetch({ 'search.kuwo.cn': r }).impl);
			expect(out.status).toBe(502);
		}
		const thrown = await fetchKuwoSearch('x', 3, 1, fakeFetch({}).impl);
		expect(thrown.status).toBe(502);
	});

	it('clamps limit and page to 1..50 (T-n1i-06)', () => {
		const q = (limit: number, page: number) => new URL(buildKuwoSearchUrl('x', limit, page)).searchParams;
		expect(q(500, 999).get('rn')).toBe('50');
		expect(q(500, 999).get('pn')).toBe('49');
		expect(q(0, 0).get('rn')).toBe('1');
		expect(q(-5, -5).get('pn')).toBe('0');
		expect(q(NaN, NaN).get('rn')).toBe('1');
	});
});
